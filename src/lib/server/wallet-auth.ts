import { createHash, randomBytes } from 'node:crypto';
import { createPublicClient, getAddress, http, isAddress, verifyMessage, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createSiweMessage, parseSiweMessage, type SiweMessage } from 'viem/siwe';
import { database } from './db';
import { issueSession } from './auth';
import { DomainError } from './errors';
import type { User } from '../contracts';

const chainId = baseSepolia.id;
const challengeLifetime = 5 * 60 * 1000;
export const walletSessionSeconds = 60 * 60;
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org', { timeout: 7_000, retryCount: 0 }),
});

interface ChallengeRow { address: string; origin: string; message: string; expires_at: string }
interface WalletRow { user_id: number }

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function siteOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new DomainError('Invalid sign-in origin', 400); }
  if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new DomainError('Wallet sign-in requires HTTPS or local development', 400);
  }
  return url;
}

export function createWalletChallenge(rawAddress: string, origin: string): string {
  if (typeof rawAddress !== 'string' || !isAddress(rawAddress)) throw new DomainError('Select a valid wallet address', 400);
  const address = getAddress(rawAddress);
  const site = siteOrigin(origin);
  const now = new Date();
  const nonce = randomBytes(16).toString('hex');
  const expires = new Date(now.getTime() + challengeLifetime);
  const message = createSiweMessage({
    domain: site.host,
    address,
    statement: 'Sign in to PREDICT. This is free and does not authorize any transaction.',
    uri: site.origin,
    version: '1',
    chainId,
    nonce,
    issuedAt: now,
    expirationTime: expires,
    scheme: site.protocol.slice(0, -1),
  });
  const db = database();
  db.prepare('DELETE FROM wallet_challenges WHERE expires_at <= ?').run(now.toISOString());
  db.prepare('INSERT INTO wallet_challenges (nonce_hash, address, origin, message, expires_at) VALUES (?, ?, ?, ?, ?)').run(digest(nonce), address.toLowerCase(), site.origin, message, expires.toISOString());
  return message;
}

export async function verifyWalletChallenge(message: string, signature: string, origin: string): Promise<{ user: User; token: string }> {
  const site = siteOrigin(origin);
  if (typeof message !== 'string' || message.length > 2048 || typeof signature !== 'string' || signature.length > 131_074 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) {
    throw new DomainError('Invalid wallet signature or challenge', 401);
  }
  let fields: Partial<SiweMessage>;
  try { fields = parseSiweMessage(message); } catch { throw new DomainError('Invalid wallet sign-in message', 401); }
  if (!fields.nonce || !fields.address || !isAddress(fields.address)) throw new DomainError('Invalid wallet sign-in message', 401);
  const challenge = database().prepare('SELECT address, origin, message, expires_at FROM wallet_challenges WHERE nonce_hash = ?').get(digest(fields.nonce)) as ChallengeRow | undefined;
  const now = new Date();
  if (!challenge || challenge.message !== message || challenge.origin !== site.origin || challenge.expires_at <= now.toISOString()
    || fields.chainId !== chainId || fields.domain !== site.host || fields.uri !== site.origin
    || fields.scheme !== site.protocol.slice(0, -1) || fields.version !== '1'
    || fields.address.toLowerCase() !== challenge.address || !fields.expirationTime || fields.expirationTime.getTime() <= now.getTime()
    || !fields.issuedAt || fields.issuedAt.getTime() > now.getTime() + 30_000) {
    throw new DomainError('Wallet challenge expired or does not match this site', 401);
  }
  const address = getAddress(fields.address);
  let verified = false;
  try { verified = await verifyMessage({ address, message, signature: signature as Hex }); } catch { /* Smart account signatures need chain-specific verification. */ }
  if (!verified) {
    try {
      if (await publicClient.getChainId() !== chainId) throw new DomainError('Base Sepolia RPC returned the wrong chain', 503);
      verified = await publicClient.verifySiweMessage({ address, message, signature: signature as Hex, domain: site.host, nonce: fields.nonce, time: now });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('Base Sepolia wallet verification is temporarily unavailable. Try again later.', 503);
    }
  }
  if (!verified) throw new DomainError('Wallet signature does not match this account', 401);

  const db = database();
  return db.transaction(() => {
    const consumed = db.prepare('DELETE FROM wallet_challenges WHERE nonce_hash = ? AND message = ? AND origin = ? AND expires_at > ?').run(digest(fields.nonce!), message, site.origin, new Date().toISOString());
    if (consumed.changes !== 1) throw new DomainError('Wallet challenge already used or expired', 401);
    let userId = (db.prepare('SELECT user_id FROM wallet_accounts WHERE chain_id = ? AND address = ?').get(chainId, address.toLowerCase()) as WalletRow | undefined)?.user_id;
    if (!userId) {
      let handle = `w_${digest(address.toLowerCase()).slice(0, 20)}`;
      const handleExists = db.prepare('SELECT 1 FROM users WHERE handle = ?');
      while (handleExists.get(handle)) handle = `w_${randomBytes(10).toString('hex')}`;
      const createdAt = new Date().toISOString();
      userId = Number(db.prepare('INSERT INTO users (handle, password_hash, created_at) VALUES (?, ?, ?)').run(handle, 'wallet-only', createdAt).lastInsertRowid);
      db.prepare('INSERT INTO wallet_accounts (chain_id, address, user_id, created_at) VALUES (?, ?, ?, ?)').run(chainId, address.toLowerCase(), userId, createdAt);
    }
    return issueSession(userId, walletSessionSeconds * 1000);
  })();
}
