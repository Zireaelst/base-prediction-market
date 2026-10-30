'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPublicClient, createWalletClient, custom, formatUnits, getAddress, isAddress, parseAbi, parseUnits, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { api, useSession } from './api';
import { swipeDirection } from './swipe-gesture';

const predictionAbi = parseAbi([
  'function authorize(address delegate, uint256 maxPerTrade, uint256 total, uint64 expiresAt)',
  'function revoke(address delegate)',
  'function create(uint256 target, uint64 deadline, uint256 stake, bool creatorAbove) returns (uint256)',
  'function authorizations(address owner, address delegate) view returns (uint256 maxPerTrade, uint256 remaining, uint64 expiresAt, uint256 epoch)',
  'function markets(uint256 id) view returns (address creator, address opponent, uint256 stake, uint256 target, uint64 deadline, bool creatorAbove, uint8 status, uint256 price)',
  'function token() view returns (address)',
  'function usedNonces(address owner, uint256 nonce) view returns (bool)',
  'function resolve(uint256 id)',
  'function voidMarket(uint256 id)',
  'function withdraw()',
  'function credits(address owner) view returns (uint256)',
]);
const tokenAbi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function mint(uint256 amount)',
]);
const swipeTypes = { Swipe: [
  { name: 'owner', type: 'address' }, { name: 'delegate', type: 'address' }, { name: 'kind', type: 'uint8' },
  { name: 'marketId', type: 'uint256' }, { name: 'target', type: 'uint256' }, { name: 'deadline', type: 'uint64' },
  { name: 'stake', type: 'uint256' }, { name: 'creatorAbove', type: 'bool' }, { name: 'nonce', type: 'uint256' },
  { name: 'validUntil', type: 'uint64' }, { name: 'epoch', type: 'uint256' },
] } as const;
type Provider = { request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>; on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void };
type Market = { id: string; creator: Address; opponent: Address; stake: string; target: string; deadline: number; creatorAbove: boolean; status: number; price: string };
type Catalog = { chainId: number; contract: Address; token: Address; feed: Address; feedDescription: string; feedDecimals: number; markets: Market[] };
type Key = { owner: Address; contract: Address; privateKey: Hex };
type Tracked = { owner: Address; contract: Address; marketId: string; hash?: Hex; state: 'unknown' | 'pending' | 'confirmed' | 'reverted' };
const KEY = 'testnet-delegate-v1';
const TRACK = 'testnet-swipes-v1';
function provider(): Provider {
  const p = 'ethereum' in window ? window.ethereum : null;
  if (!p || typeof p !== 'object' || !('request' in p) || typeof p.request !== 'function') throw new Error('No injected wallet found. Connect a wallet with Base Sepolia support.');
  return p as Provider;
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong.'; }
function readStored<T>(key: string, fallback: T): T { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; }
function save(key: string, value: unknown) { sessionStorage.setItem(key, JSON.stringify(value)); }
function same(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
function checkedCatalog(value: Catalog): Catalog {
  if (!value || value.chainId !== 84532 || !isAddress(value.contract) || !isAddress(value.token) || !isAddress(value.feed) || typeof value.feedDescription !== 'string' || !value.feedDescription.trim() || !Number.isInteger(value.feedDecimals) || value.feedDecimals < 0 || value.feedDecimals > 255 || !Array.isArray(value.markets) || value.markets.some(m => !m || !/^\d+$/.test(m.id) || !isAddress(m.creator) || !isAddress(m.opponent) || !/^\d+$/.test(m.stake) || !/^\d+$/.test(m.target) || !/^\d+$/.test(m.price) || !Number.isSafeInteger(m.deadline) || typeof m.creatorAbove !== 'boolean' || !Number.isInteger(m.status))) throw new Error('Invalid testnet configuration or market data.');
  return value;
}
function positive(value: string, decimals: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`Enter an amount with at most ${decimals} decimal places.`);
  const amount = parseUnits(value, decimals);
  if (amount <= 0n) throw new Error('Enter a positive amount.');
  return amount;
}

export function TestnetDeck() {
  const { user, loading, error: sessionError, refresh } = useSession();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chain, setChain] = useState<number | null>(null);
  const [key, setKey] = useState<Key | null>(null);
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [perTrade, setPerTrade] = useState('10');
  const [total, setTotal] = useState('50');
  const [hours, setHours] = useState('1');
  const [mint, setMint] = useState('100');
  const [target, setTarget] = useState('');
  const [stake, setStake] = useState('10');
  const [deadline, setDeadline] = useState('');
  const [above, setAbove] = useState(true);
  const [risk, setRisk] = useState(false);
  const lock = useRef(false);
  const trackedRef = useRef<Tracked[]>([]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const walletAddress = user?.walletAddress;
  const ready = !!account && !!walletAddress && same(account, walletAddress) && chain === 84532 && !loading && !sessionError;

  const refreshCatalog = useCallback(async () => {
    try { const data = checkedCatalog(await api<Catalog>('/api/testnet/markets')); setCatalog(data); setError(''); }
    catch (e) { setCatalog(null); setError(message(e)); }
  }, []);
  useEffect(() => { void refreshCatalog(); }, [refreshCatalog]);
  useEffect(() => {
    try { setKey(readStored<Key | null>(KEY, null)); const saved = readStored<Tracked[]>(TRACK, []); if (!Array.isArray(saved)) throw new Error('Invalid saved swipes'); trackedRef.current = saved; setTracked(saved); }
    catch { setError('Session storage is unavailable or corrupt; delegation and swipes are disabled.'); }
    let p: Provider;
    try { p = provider(); } catch { return; }
    const update = () => { void Promise.all([p.request({ method: 'eth_accounts' }), p.request({ method: 'eth_chainId' })]).then(([accounts, id]) => {
      const first = Array.isArray(accounts) ? accounts[0] : null;
      setAccount(typeof first === 'string' && isAddress(first) ? getAddress(first) : null);
      setChain(typeof id === 'string' ? Number.parseInt(id, 16) : null);
    }).catch(() => { setAccount(null); setChain(null); }); };
    update(); p.on?.('accountsChanged', update); p.on?.('chainChanged', update);
    return () => { p.removeListener?.('accountsChanged', update); p.removeListener?.('chainChanged', update); };
  }, []);
  const clients = useCallback(async () => {
    if (!catalog) throw new Error('Testnet markets are unavailable.');
    const p = provider();
    const [accounts, chainId, session] = await Promise.all([p.request({ method: 'eth_accounts' }), p.request({ method: 'eth_chainId' }), api<{ user: { walletAddress?: string } | null }>('/api/me')]);
    const owner = Array.isArray(accounts) && typeof accounts[0] === 'string' && isAddress(accounts[0]) ? getAddress(accounts[0]) : null;
    if (!owner || chainId !== '0x14a34' || !session.user?.walletAddress || !same(owner, session.user.walletAddress) || !account || !same(owner, account)) throw new Error('Connect the wallet used to sign in and select Base Sepolia.');
    const publicClient = createPublicClient({ chain: baseSepolia, transport: custom(p) });
    const wallet = createWalletClient({ account: owner, chain: baseSepolia, transport: custom(p) });
    const actualToken = await publicClient.readContract({ address: catalog.contract, abi: predictionAbi, functionName: 'token' });
    if (!same(actualToken, catalog.token)) throw new Error('Configured token does not match the prediction contract.');
    return { owner, publicClient, wallet };
  }, [account, catalog]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(false); }
  };
  const updateTracked = useCallback((items: Tracked[]) => { save(TRACK, items); trackedRef.current = items; setTracked(items); }, []);
  useEffect(() => {
    if (!tracked.some(t => t.hash && (t.state === 'pending' || t.state === 'unknown'))) return;
    let cancelled = false;
    const check = async () => {
      try {
        const p = provider();
        if (await p.request({ method: 'eth_chainId' }) !== '0x14a34') return;
        const client = createPublicClient({ chain: baseSepolia, transport: custom(p) });
        const next = await Promise.all(tracked.map(async t => {
          if (!t.hash || (t.state !== 'pending' && t.state !== 'unknown')) return t;
          try { const receipt = await client.getTransactionReceipt({ hash: t.hash }); return { ...t, state: receipt.status === 'success' ? 'confirmed' as const : 'reverted' as const }; }
          catch { try { await client.getTransaction({ hash: t.hash }); return { ...t, state: 'pending' as const }; } catch { return { ...t, state: 'unknown' as const }; } }
        }));
        if (!cancelled && !lock.current && trackedRef.current === tracked && JSON.stringify(next) !== JSON.stringify(tracked)) { updateTracked(next); if (next.some((t, i) => t.state !== tracked[i].state && t.state === 'confirmed')) void refreshCatalog(); }
      } catch { /* Keep the last status when the RPC is unreachable. */ }
    };
    void check(); const timer = window.setInterval(check, 6000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tracked, updateTracked, refreshCatalog]);

  const connect = () => run(async () => {
    const p = provider(); const result = await p.request({ method: 'eth_requestAccounts' });
    const id = await p.request({ method: 'eth_chainId' });
    const first = Array.isArray(result) ? result[0] : null;
    setAccount(typeof first === 'string' && isAddress(first) ? getAddress(first) : null); setChain(typeof id === 'string' ? Number.parseInt(id, 16) : null);
  });
  const setup = () => run(async () => {
    if (!risk || !catalog) throw new Error('Acknowledge the delegate risk first.');
    const max = positive(perTrade, 18), cap = positive(total, 18), duration = Number(hours);
    if (cap < max || !Number.isFinite(duration) || duration <= 0 || duration > 24) throw new Error('Total must cover one trade; expiry must be within 24 hours.');
    const { owner, publicClient, wallet } = await clients();
    const existing = readStored<Key | null>(KEY, null);
    if (existing) throw new Error('Revoke the existing session delegate before creating another.');
    const privateKey = generatePrivateKey(); const delegate = privateKeyToAccount(privateKey);
    const record: Key = { owner, contract: catalog.contract, privateKey };
    save(KEY, record); setKey(record);
    const expires = BigInt(Math.floor(Date.now() / 1000 + duration * 3600));
    setNotice('Approve the limited test-token allowance in your wallet.');
    const approval = await wallet.writeContract({ address: catalog.token, abi: tokenAbi, functionName: 'approve', args: [catalog.contract, cap] });
    const approved = await publicClient.waitForTransactionReceipt({ hash: approval, timeout: 120_000 });
    if (approved.status !== 'success') throw new Error('Token approval reverted.');
    await clients();
    setNotice('Approve delegate limits and expiry in your wallet.');
    const hash = await wallet.writeContract({ address: catalog.contract, abi: predictionAbi, functionName: 'authorize', args: [delegate.address, max, cap, expires] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Delegate authorization reverted.');
    setNotice(`Delegate authorized: ${delegate.address}. Authorization expires ${new Date(Number(expires) * 1000).toLocaleString()}.`);
  });
  const revoke = () => run(async () => {
    if (!key || !catalog || !same(key.contract, catalog.contract)) throw new Error('This delegate belongs to a different contract. Switch back to revoke it.');
    const { owner, publicClient, wallet } = await clients();
    if (!same(owner, key.owner)) throw new Error('Reconnect the delegate owner to revoke.');
    const hash = await wallet.writeContract({ address: catalog.contract, abi: predictionAbi, functionName: 'revoke', args: [privateKeyToAccount(key.privateKey).address] });
    setNotice(`Revocation submitted: ${hash}. Waiting for confirmation.`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Revocation reverted; the delegate may still be active.');
    sessionStorage.removeItem(KEY); setKey(null); setNotice('Delegate revoked. Token allowance remains until separately changed.');
  });
  const mintTokens = () => run(async () => {
    if (!catalog) return; const amount = positive(mint, 18); const { publicClient, wallet } = await clients();
    const hash = await wallet.writeContract({ address: catalog.token, abi: tokenAbi, functionName: 'mint', args: [amount] });
    setNotice(`Mint submitted: ${hash}. Waiting for confirmation.`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Mint reverted.'); setNotice(`Mint confirmed: ${hash}`);
  });
  const createMarket = () => run(async () => {
    if (!catalog || !risk) throw new Error('Acknowledge the checkpoint and delegate risks first.');
    const amount = positive(stake, 18), price = positive(target, catalog.feedDecimals), time = Math.floor(new Date(deadline).getTime() / 1000);
    if (!Number.isSafeInteger(time) || time <= Math.floor(Date.now() / 1000)) throw new Error('Choose a future deadline.');
    const { owner, publicClient, wallet } = await clients();
    const allowance = await publicClient.readContract({ address: catalog.token, abi: tokenAbi, functionName: 'allowance', args: [owner, catalog.contract] });
    if (allowance < amount) {
      const hash = await wallet.writeContract({ address: catalog.token, abi: tokenAbi, functionName: 'approve', args: [catalog.contract, amount] });
      setNotice(`Approval submitted: ${hash}. Waiting for confirmation.`);
      if ((await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })).status !== 'success') throw new Error('Approval reverted.');
      await clients();
    }
    const hash = await wallet.writeContract({ address: catalog.contract, abi: predictionAbi, functionName: 'create', args: [price, BigInt(time), amount, above] });
    setNotice(`Market creation submitted: ${hash}. Waiting for confirmation.`);
    if ((await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })).status !== 'success') throw new Error('Market creation reverted.');
    setNotice(`Market creation confirmed: ${hash}`); await refreshCatalog();
  });
  const settleMarket = (id: string, action: 'resolve' | 'voidMarket') => run(async () => {
    if (!catalog) return;
    const { wallet, publicClient } = await clients();
    const hash = await wallet.writeContract({ address: catalog.contract, abi: predictionAbi, functionName: action, args: [BigInt(id)] });
    setNotice(`${action === 'resolve' ? 'Resolution' : 'Refund'} submitted: ${hash}. Waiting for confirmation.`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Settlement transaction reverted.');
    setNotice(`Settlement confirmed: ${hash}`);
    await refreshCatalog();
  });
  const withdrawCredit = () => run(async () => {
    if (!catalog) return;
    const { wallet, publicClient } = await clients();
    const hash = await wallet.writeContract({ address: catalog.contract, abi: predictionAbi, functionName: 'withdraw' });
    setNotice(`Withdrawal submitted: ${hash}. Waiting for confirmation.`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Withdrawal reverted or no credit is available.');
    setNotice(`Withdrawal confirmed: ${hash}`);
  });
  const join = (market: Market) => run(async () => {
    if (!catalog || !key || !same(key.contract, catalog.contract)) throw new Error('Set up a delegate for this contract first.');
    const { owner, publicClient } = await clients();
    if (!same(owner, key.owner)) throw new Error('The delegate belongs to a different wallet.');
    const fresh = checkedCatalog(await api<Catalog>('/api/testnet/markets'));
    if (!same(fresh.contract, catalog.contract) || !same(fresh.token, catalog.token)) throw new Error('Testnet configuration changed. Refresh the deck.');
    const current = fresh.markets.find(m => m.id === market.id);
    if (!current || current.status !== 1 || current.deadline <= Date.now() / 1000 || same(current.creator, owner) || current.stake !== market.stake || current.target !== market.target || current.deadline !== market.deadline || current.creatorAbove !== market.creatorAbove) throw new Error('Market terms changed or are no longer available. Refresh the deck.');
    const stored = readStored<Tracked[]>(TRACK, []);
    if (stored.some(t => same(t.owner, owner) && same(t.contract, catalog.contract) && t.marketId === market.id && t.state !== 'reverted')) throw new Error('This market already has a submitted or unresolved swipe.');
    const delegate = privateKeyToAccount(key.privateKey);
    const [onchain, auth, allowance, balance] = await Promise.all([
      publicClient.readContract({ address: catalog.contract, abi: predictionAbi, functionName: 'markets', args: [BigInt(market.id)] }),
      publicClient.readContract({ address: catalog.contract, abi: predictionAbi, functionName: 'authorizations', args: [owner, delegate.address] }),
      publicClient.readContract({ address: catalog.token, abi: tokenAbi, functionName: 'allowance', args: [owner, catalog.contract] }),
      publicClient.readContract({ address: catalog.token, abi: tokenAbi, functionName: 'balanceOf', args: [owner] }),
    ]);
    const amount = BigInt(market.stake), now = Math.floor(Date.now() / 1000);
    if (onchain[6] !== 1 || !same(onchain[0], market.creator) || onchain[2] !== amount || onchain[3] !== BigInt(market.target) || Number(onchain[4]) !== market.deadline || onchain[5] !== market.creatorAbove || market.deadline <= now || same(onchain[0], owner)) throw new Error('Onchain market changed. Refresh before swiping.');
    if (amount > auth[0] || amount > auth[1] || Number(auth[2]) <= now || allowance < amount || balance < amount) throw new Error('Delegate expired or limits, token allowance, or balance are insufficient.');
    const nonce = BigInt(generatePrivateKey());
    if (await publicClient.readContract({ address: catalog.contract, abi: predictionAbi, functionName: 'usedNonces', args: [owner, nonce] })) throw new Error('Nonce already used. Retry.');
    const validUntil = Math.min(now + 120, Number(auth[2]) - 1, market.deadline - 1);
    if (validUntil <= now) throw new Error('Market or authorization expires too soon.');
    const swipe = { owner, delegate: delegate.address, kind: 1, marketId: BigInt(market.id), target: 0n, deadline: 0n, stake: amount, creatorAbove: false, nonce, validUntil: BigInt(validUntil), epoch: auth[3] } as const;
    const signature = await delegate.signTypedData({ domain: { name: 'BaseSepoliaPrediction', version: '1', chainId: 84532, verifyingContract: catalog.contract }, types: swipeTypes, primaryType: 'Swipe', message: swipe });
    await clients();
    const pending: Tracked = { owner, contract: catalog.contract, marketId: market.id, state: 'unknown' };
    updateTracked([...stored, pending]);
    const response = await api<{ hash: Hex }>('/api/testnet/swipes', { method: 'POST', body: JSON.stringify({ swipe: { ...swipe, marketId: swipe.marketId.toString(), target: '0', deadline: 0, stake: amount.toString(), nonce: nonce.toString(), validUntil, epoch: swipe.epoch.toString() }, signature }) });
    if (!/^0x[0-9a-fA-F]{64}$/.test(response.hash)) throw new Error('Submission response has no valid transaction hash. Outcome is unknown; do not retry.');
    updateTracked([...stored, { ...pending, hash: response.hash, state: 'pending' }]);
    setNotice(`Swipe submitted, not yet confirmed: ${response.hash}`);
  });
  const markets = catalog?.markets.filter(m => m.status === 1 && m.deadline > Date.now() / 1000) ?? [];
  const market = markets[index % Math.max(markets.length, 1)];
  const blocked = market && account && catalog && tracked.some(t => same(t.owner, account) && same(t.contract, catalog.contract) && t.marketId === market.id && t.state !== 'reverted');
  const canJoin = !!market && ready && !busy && risk && !!key && !blocked && !same(market.creator, account ?? '');
  return <section aria-label="Base Sepolia testnet predictions" className="form-stack testnet-deck">
    <h2>Base Sepolia testnet</h2>
    <p>Real onchain transactions using valueless test tokens, separate from paper forecasts. Gas is required. Never use a valuable wallet or tokens.</p>
    <p><strong>Risk:</strong> the session delegate private key is stored unencrypted in this tab’s session storage. Malicious scripts, extensions, or anyone with access to this tab can use it up to the onchain limits. Closing the tab does not revoke authorization or token allowance. Anyone holding a signed swipe can relay it until expiry. Revoke onchain when finished.</p>
    <p><strong>Settlement:</strong> the first successful qualifying Chainlink checkpoint after the deadline determines the result, not necessarily the price at the deadline. Caller timing and oracle update timing can change the outcome. If no checkpoint succeeds within the resolution window, the market can be voided; winnings and refunds require a separate onchain withdrawal. Base Sepolia has no verified Chainlink sequencer-uptime feed configured here; this test-only contract is not safe for mainnet.</p>
    <label><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)}/> I understand the delegate and checkpoint risks.</label>
    {loading ? <p role="status">Checking sign-in…</p> : !walletAddress ? <p>Sign in with your Base Sepolia wallet before using testnet. <a href="/auth">Sign in</a> <button type="button" onClick={refresh}>Refresh sign-in</button></p> : <p>Signed-in wallet: {walletAddress}</p>}
    <p>Connected: {account ?? 'none'} · Network: {chain === 84532 ? 'Base Sepolia' : 'not Base Sepolia'}</p>
    <button type="button" onClick={connect} disabled={busy}>Connect injected wallet</button>
    {!ready && <p role="status">Connect the same wallet as your wallet sign-in and select Base Sepolia.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button type="button" onClick={() => void refreshCatalog()} disabled={busy}>Refresh onchain markets</button>
    <h3>Open markets</h3>
    <p>Swipe right to submit the available side; swipe left only skips. This contract cannot join the creator’s side. Buttons provide the same actions without gestures.</p>
    {!catalog ? <p>Markets unavailable; swiping is disabled.</p> : !market ? <p>No open markets. Create one below or refresh.</p> : <article className="swipe-card" onTouchStart={e => { const point = e.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null; }} onTouchCancel={() => { touch.current = null; }} onTouchEnd={e => { const start = touch.current; const end = e.changedTouches[0]; touch.current = null; if (!start || !end) return; const direction = swipeDirection(end.clientX - start.x, end.clientY - start.y); if (direction === 'second') setIndex(i => i + 1); else if (direction === 'first' && canJoin) void join(market); }}>
      <h4>{catalog.feedDescription} · Market {market.id}</h4><p>Creator: {market.creator}</p>
      <p>Target: {formatUnits(BigInt(market.target), catalog.feedDecimals)} · Deadline: {new Date(market.deadline * 1000).toLocaleString()}</p>
      <p>Creator side: {market.creatorAbove ? 'at or above' : 'below'} target. <strong>Available side: {market.creatorAbove ? 'below' : 'at or above'} target.</strong></p>
      <p>Equal stake: {formatUnits(BigInt(market.stake), 18)} test tokens per party. Winner receives both stakes as a withdrawable credit; void refunds each party.</p>
      {blocked && <p role="status">This market has an unresolved or confirmed swipe in this tab.</p>}
      <button type="button" onClick={() => setIndex(i => i + 1)}>Skip (or swipe left)</button>{' '}
      <button type="button" disabled={!canJoin} onClick={() => join(market)}>Join available side</button>
    </article>}
    {catalog && <p>Contract: {catalog.contract}<br/>Test token: {catalog.token}<br/>Chainlink feed: {catalog.feedDescription} · {catalog.feed}<br/>Feed decimals: {catalog.feedDecimals}</p>}
    <fieldset disabled={!ready || busy || !catalog}><legend>Test tokens and market creation</legend>
      <label>Mint test tokens <input inputMode="decimal" value={mint} onChange={e => setMint(e.target.value)}/></label> <button type="button" onClick={mintTokens}>Mint</button>
      <p>The faucet is unrestricted. Minting and market creation each require wallet transactions and gas.</p>
      <label>Target price <input inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)}/></label>
      <label>Stake in test tokens <input inputMode="decimal" value={stake} onChange={e => setStake(e.target.value)}/></label>
      <label>Deadline (local time) <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}/></label>
      <label>Creator side <select value={above ? 'above' : 'below'} onChange={e => setAbove(e.target.value === 'above')}><option value="above">Price at or above target</option><option value="below">Price below target</option></select></label>
      <button type="button" disabled={!risk} onClick={createMarket}>Approve if needed and create market</button>
    </fieldset>
    <fieldset disabled={!ready || busy || !catalog}><legend>Temporary swipe delegate</legend>
      <label>Maximum per trade (test tokens) <input inputMode="decimal" value={perTrade} onChange={e => setPerTrade(e.target.value)}/></label>
      <label>Total authorization (test tokens) <input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)}/></label>
      <label>Expires in hours (maximum 24) <input type="number" min="0.01" max="24" step="0.01" value={hours} onChange={e => setHours(e.target.value)}/></label>
      {key ? <><p>Stored delegate: {privateKeyToAccount(key.privateKey).address}; owner: {key.owner}; contract: {key.contract}</p><button type="button" onClick={revoke}>Revoke delegate onchain</button></> : <button type="button" disabled={!risk} onClick={setup}>Approve tokens and authorize delegate</button>}
    </fieldset>
    <h3>Swipe transactions</h3><p>Pending means seen by the RPC but not confirmed. Unknown means the RPC cannot establish its status, or submission returned no hash; do not retry. Status is tracked only in this tab.</p>
    {tracked.length === 0 ? <p>No swipes submitted in this tab.</p> : <ul>{tracked.map((t, i) => <li key={`${t.contract}-${t.marketId}-${i}`}>Market {t.marketId}: {t.state}{t.hash ? <> · <a href={`https://sepolia.basescan.org/tx/${t.hash}`} target="_blank" rel="noopener noreferrer">{t.hash}</a></> : ' · no transaction hash received'}</li>)}</ul>}
    <h3>Resolution and withdrawals</h3>
    <p>After the deadline, anyone can request a checkpoint while the resolution window is open. If no qualifying price arrives, refund becomes available after the window. Each action requires a wallet transaction.</p>
    <button type="button" disabled={!ready || busy || !catalog} onClick={withdrawCredit}>Withdraw available credit</button>
    {catalog && <ul>{catalog.markets.filter(m => m.deadline <= Date.now() / 1000 && (m.status === 1 || m.status === 2)).map(m => <li key={m.id}>Market {m.id} · {m.status === 1 ? 'unmatched' : 'matched'}{' '}{m.status === 2 && <button type="button" disabled={!ready || busy} onClick={() => settleMarket(m.id, 'resolve')}>Resolve checkpoint</button>}{' '}<button type="button" disabled={!ready || busy} onClick={() => settleMarket(m.id, 'voidMarket')}>Request refund if eligible</button></li>)}</ul>}
  </section>;
}
