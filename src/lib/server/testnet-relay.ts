import { createWalletClient, encodeFunctionData, http, keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { sessionUser } from './auth';
import { database } from './db';
import { DomainError } from './errors';
import { assertDeployment, predictionAbi, testnetClient, testnetConfig, tokenAbi } from './testnet-chain';
import { validateSwipe } from './testnet-swipe';

// Queue within this process; the durable lock additionally excludes other processes sharing the database.
let queue: Promise<void> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function relayDatabase() {
  const db = database();
  db.exec(`
    CREATE TABLE IF NOT EXISTS testnet_relay_locks (relayer TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS testnet_relay_nonces (relayer TEXT PRIMARY KEY, next_nonce TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS testnet_swipes (
      contract TEXT NOT NULL, owner TEXT NOT NULL, nonce TEXT NOT NULL,
      digest TEXT NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL,
      PRIMARY KEY (contract, owner, nonce)
    );
  `);
  return db;
}

export async function relaySwipe(body: Record<string, unknown>, sessionToken: string | undefined) {
  const user = sessionUser(sessionToken);
  if (!user?.walletAddress) throw new DomainError('A wallet sign-in is required', 401);
  const config = testnetConfig();
  const secret = process.env.TESTNET_RELAYER_PRIVATE_KEY;
  if (!secret || !/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new DomainError('Testnet relayer is not configured', 503);
  let account;
  try { account = privateKeyToAccount(secret as Hex); } catch { throw new DomainError('Testnet relayer is not configured', 503); }
  const signed = await validateSwipe(body, user.walletAddress, config.contract);
  const relayer = `${baseSepolia.id}:${account.address.toLowerCase()}`;
  const contract = config.contract.toLowerCase();
  const owner = signed.swipe.owner.toLowerCase();
  const nonce = signed.swipe.nonce.toString();

  return serialized(async () => {
    const current = sessionUser(sessionToken);
    if (!current?.walletAddress || current.id !== user.id || current.walletAddress.toLowerCase() !== owner) throw new DomainError('Wallet session expired', 401);
    const db = relayDatabase();
    const existing = db.prepare('SELECT digest, hash, state FROM testnet_swipes WHERE contract = ? AND owner = ? AND nonce = ?').get(contract, owner, nonce) as { digest: string; hash: Hex; state: string } | undefined;
    if (existing) {
      if (existing.digest !== signed.digest) throw new DomainError('Swipe nonce is already reserved', 409);
      if (existing.state !== 'submitted') throw new DomainError('Swipe submission is unresolved; operator reconciliation required', 503);
      return { hash: existing.hash };
    }
    const acquired = db.prepare('INSERT OR IGNORE INTO testnet_relay_locks (relayer) VALUES (?)').run(relayer);
    if (!acquired.changes) throw new DomainError('Relayer is busy or requires operator reconciliation', 503);
    let release = true;
    try {
      const client = testnetClient(config.rpc);
      await assertDeployment(client, config.contract, config.token);
      const block = await client.getBlock();
      const blockNumber = block.number;
      const s = signed.swipe;
      const [market, authorization, used, balance, allowance] = await Promise.all([
        client.readContract({ address: config.contract, abi: predictionAbi, functionName: 'markets', args: [s.marketId], blockNumber }),
        client.readContract({ address: config.contract, abi: predictionAbi, functionName: 'authorizations', args: [s.owner, s.delegate], blockNumber }),
        client.readContract({ address: config.contract, abi: predictionAbi, functionName: 'usedNonces', args: [s.owner, s.nonce], blockNumber }),
        client.readContract({ address: config.token, abi: tokenAbi, functionName: 'balanceOf', args: [s.owner], blockNumber }),
        client.readContract({ address: config.token, abi: tokenAbi, functionName: 'allowance', args: [s.owner, config.contract], blockNumber }),
      ]);
      const [creator, , stake, , deadline, , status] = market;
      const [maxPerTrade, remaining, expiresAt, epoch] = authorization;
      if (status !== 1 || block.timestamp >= deadline || creator.toLowerCase() === owner || stake !== s.stake) throw new DomainError('Market is no longer joinable', 409);
      if (used || epoch !== s.epoch || block.timestamp >= expiresAt || block.timestamp > s.validUntil || s.stake > maxPerTrade || s.stake > remaining) throw new DomainError('Swipe authorization or nonce is no longer valid', 409);
      if (balance < s.stake || allowance < s.stake) throw new DomainError('Insufficient test token balance or allowance', 409);
      const args = [s, signed.v, signed.r, signed.sigS] as const;
      await client.simulateContract({ account, address: config.contract, abi: predictionAbi, functionName: 'executeSwipe', args });
      const pendingNonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
      const saved = db.prepare('SELECT next_nonce FROM testnet_relay_nonces WHERE relayer = ?').get(relayer) as { next_nonce: string } | undefined;
      const nextNonce = saved ? Math.max(pendingNonce, Number(saved.next_nonce)) : pendingNonce;
      if (!Number.isSafeInteger(nextNonce) || nextNonce < 0) throw new DomainError('Relayer nonce is invalid', 503);
      const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(config.rpc, { timeout: 10_000, retryCount: 0 }) });
      const request = await wallet.prepareTransactionRequest({ account, to: config.contract, data: encodeFunctionData({ abi: predictionAbi, functionName: 'executeSwipe', args }), nonce: nextNonce });
      const raw = await wallet.signTransaction(request);
      const hash = keccak256(raw);
      const activeSession = sessionUser(sessionToken);
      if (!activeSession?.walletAddress || activeSession.id !== user.id || activeSession.walletAddress.toLowerCase() !== owner) throw new DomainError('Wallet session expired', 401);
      // From this point a crash or RPC error can leave an unknown broadcast outcome.
      // Keep both the reservation and the lock until an operator reconciles it.
      db.prepare("INSERT INTO testnet_swipes (contract, owner, nonce, digest, hash, state) VALUES (?, ?, ?, ?, ?, 'broadcasting')").run(contract, owner, nonce, signed.digest, hash);
      release = false;
      const returnedHash = await client.sendRawTransaction({ serializedTransaction: raw });
      if (returnedHash.toLowerCase() !== hash.toLowerCase()) throw new DomainError('Relayer submission outcome is unresolved', 503);
      db.transaction(() => {
        db.prepare("UPDATE testnet_swipes SET state = 'submitted' WHERE contract = ? AND owner = ? AND nonce = ?").run(contract, owner, nonce);
        db.prepare('INSERT INTO testnet_relay_nonces (relayer, next_nonce) VALUES (?, ?) ON CONFLICT(relayer) DO UPDATE SET next_nonce = excluded.next_nonce').run(relayer, String(nextNonce + 1));
        db.prepare('DELETE FROM testnet_relay_locks WHERE relayer = ?').run(relayer);
      })();
      return { hash };
    } finally {
      if (release) db.prepare('DELETE FROM testnet_relay_locks WHERE relayer = ?').run(relayer);
    }
  });
}
