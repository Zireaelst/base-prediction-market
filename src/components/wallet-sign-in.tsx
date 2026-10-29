'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSnapshots, useSession } from './api';
import { FormFeedback } from './ui';

type WalletProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
type AnnouncedWallet = { id: string; name: string; provider: WalletProvider };
type EthereumWindow = Window & { ethereum?: WalletProvider };

const chainId = '0x14a34';
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

function isBaseSepolia(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase() === chainId;
}

function walletError(cause: unknown): string {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  if (code === 4001) return 'Request cancelled in your wallet. Choose your wallet and try again.';
  if (code === -32002) return 'A wallet request is already open. Finish it in your wallet, then try again.';
  if (code === 4900 || code === 4901) return 'Your wallet is disconnected. Reconnect it and try again.';
  return cause instanceof Error ? cause.message : 'Wallet sign-in failed. Please try again.';
}

function validAddress(value: unknown): string {
  if (typeof value !== 'string' || !addressPattern.test(value)) throw new Error('Your wallet did not return a valid account. Try again.');
  return value;
}

async function account(provider: WalletProvider, method: 'eth_requestAccounts' | 'eth_accounts'): Promise<string> {
  const accounts = await provider.request({ method });
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('No wallet account is available. Unlock your wallet and try again.');
  return validAddress(accounts[0]);
}

async function onBaseSepolia(provider: WalletProvider): Promise<void> {
  const current = await provider.request({ method: 'eth_chainId' });
  if (isBaseSepolia(current)) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (cause) {
    if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 4902) throw cause;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: 'Base Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] }] });
  }
  if (!isBaseSepolia(await provider.request({ method: 'eth_chainId' }))) throw new Error('Switch your wallet to Base Sepolia and try again.');
}

export function WalletSignIn() {
  const router = useRouter();
  const { refresh } = useSession();
  const [wallets, setWallets] = useState<AnnouncedWallet[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const [discovering, setDiscovering] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const found = new Map<string, AnnouncedWallet>();
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object' || !('info' in detail) || !('provider' in detail)) return;
      const { info, provider } = detail;
      if (!info || typeof info !== 'object' || !('uuid' in info) || typeof info.uuid !== 'string' || !info.uuid || !provider || typeof provider !== 'object' || !('request' in provider) || typeof provider.request !== 'function') return;
      if (found.has(info.uuid)) return;
      const name = 'name' in info && typeof info.name === 'string' && info.name.trim() ? info.name.trim().slice(0, 80) : 'Wallet';
      found.set(info.uuid, { id: info.uuid, name, provider: provider as WalletProvider });
      setWallets(Array.from(found.values()));
      setDiscovering(false);
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const timer = window.setTimeout(() => {
      if (found.size === 0 && (window as EthereumWindow).ethereum?.request) {
        setWallets([{ id: 'injected', name: 'Browser wallet', provider: (window as EthereumWindow).ethereum! }]);
      }
      setDiscovering(false);
    }, 400);
    return () => { window.clearTimeout(timer); window.removeEventListener('eip6963:announceProvider', announce); };
  }, [discoveryVersion]);

  const selectedWallet = wallets.find(wallet => wallet.id === selected) ?? (wallets.length === 1 ? wallets[0] : null);

  async function signIn() {
    if (!selectedWallet || active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    let stage = 'connecting';
    let changed = false;
    const provider = selectedWallet.provider;
    const accountChanged = () => { if (stage !== 'connecting') changed = true; };
    const chainChanged = () => { if (stage !== 'switching') changed = true; };
    const disconnected = () => { changed = true; };
    const ensureStable = () => { if (changed) throw new Error('Your wallet account or network changed during sign-in. Try again.'); };
    try {
      setStatus('Waiting for your wallet to connect…');
      const address = await account(provider, 'eth_requestAccounts');
      provider.on?.('accountsChanged', accountChanged);
      provider.on?.('chainChanged', chainChanged);
      provider.on?.('disconnect', disconnected);
      stage = 'switching';
      setStatus('Checking Base Sepolia in your wallet…');
      await onBaseSepolia(provider);
      ensureStable();
      stage = 'challenge';
      if ((await account(provider, 'eth_accounts')).toLowerCase() !== address.toLowerCase()) throw new Error('Your selected wallet account changed. Try again.');
      ensureStable();
      setStatus('Preparing your sign-in message…');
      const challenge = await api<{ message: string }>('/api/auth/wallet/challenge', { method: 'POST', body: JSON.stringify({ address }) });
      if (typeof challenge.message !== 'string' || !challenge.message) throw new Error('The server returned an invalid sign-in message. Try again.');
      ensureStable();
      setStatus('Confirm the free, off-chain message in your wallet…');
      if (!isBaseSepolia(await provider.request({ method: 'eth_chainId' }))) throw new Error('Your wallet left Base Sepolia. Switch back and try again.');
      if ((await account(provider, 'eth_accounts')).toLowerCase() !== address.toLowerCase()) throw new Error('Your selected wallet account changed. Try again.');
      ensureStable();
      stage = 'signing';
      const signature = await provider.request({ method: 'personal_sign', params: [challenge.message, address] });
      ensureStable();
      if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error('Your wallet did not return a signature. Try again.');
      if (!isBaseSepolia(await provider.request({ method: 'eth_chainId' })) || (await account(provider, 'eth_accounts')).toLowerCase() !== address.toLowerCase()) throw new Error('Your wallet account or network changed during signing. Try again.');
      ensureStable();
      setStatus('Verifying your signature…');
      const result = await api<{ user: unknown }>('/api/auth/wallet/verify', { method: 'POST', body: JSON.stringify({ message: challenge.message, signature }) });
      if (!result.user) throw new Error('The server did not confirm your sign-in. Try again.');
      clearSnapshots();
      refresh();
      router.push('/rooms');
    } catch (cause) {
      setError(walletError(cause));
    } finally {
      provider.removeListener?.('accountsChanged', accountChanged);
      provider.removeListener?.('chainChanged', chainChanged);
      provider.removeListener?.('disconnect', disconnected);
      setStatus(null);
      setBusy(false);
      active.current = false;
    }
  }

  return <section className="wallet-sign-in" aria-labelledby="wallet-sign-in-title">
    <div className="wallet-sign-in-heading"><span className="wallet-sign-in-symbol" aria-hidden="true">◇</span><div><p className="eyebrow">ALTERNATE SIGN-IN / BASE SEPOLIA</p><h2 id="wallet-sign-in-title">Use your wallet.</h2></div></div>
    <p className="wallet-sign-in-copy">Sign a free, off-chain message to prove this wallet is yours. No transaction, gas fee, funds or real trade. Wallet and password accounts are separate; signing in with a wallet won’t access your password account or its forecasts.</p>
    {discovering ? <p className="small muted" role="status">Looking for wallets…</p> : wallets.length === 0 ? <div className="wallet-empty"><p>No wallet detected. Open this site in a wallet’s in-app browser that supports Base Sepolia, or install a browser wallet, then try again. You can still use a password above.</p><button type="button" className="text-button" onClick={() => { setWallets([]); setSelected(null); setDiscovering(true); setError(null); setDiscoveryVersion(version => version + 1); }}>Look again ↗</button></div> : <>
      {wallets.length > 1 && <fieldset className="wallet-choices" disabled={busy}><legend>Choose a wallet to continue</legend>{wallets.map((wallet, index) => <label className="wallet-choice" key={wallet.id}><input type="radio" name="wallet-provider" checked={selected === wallet.id} onChange={() => { setSelected(wallet.id); setError(null); }}/><span className="wallet-choice-name">{wallet.name}</span><span className="wallet-choice-number" aria-hidden="true">0{index + 1}</span></label>)}</fieldset>}
      {wallets.length === 1 && <p className="wallet-found small">Wallet available: <strong>{wallets[0].name}</strong></p>}
      <button type="button" className="button button-primary wallet-sign-in-button" onClick={signIn} disabled={busy || !selectedWallet}>{busy ? 'Working with your wallet…' : error ? 'Try wallet sign-in again ↗' : 'Continue with wallet ↗'}</button>
    </>}
    {status && <p className="wallet-sign-in-status" role="status" aria-live="polite"><span className="loading-glyph" aria-hidden="true">◌</span> {status}</p>}
    <FormFeedback message={error}/>
    <p className="wallet-sign-in-note">Only Base Sepolia (testnet) is supported for signing. Connecting alone never signs you in. Wallet names come from your browser extensions; check the wallet prompt before signing.</p>
  </section>;
}
