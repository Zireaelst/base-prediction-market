'use client';

import { PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import { baseSepolia } from 'viem/chains';
import { api, clearSnapshots, useSession } from './api';
import { FormFeedback } from './ui';

function PrivyLogin() {
  const { ready, getAccessToken, logout } = usePrivy();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useLogin({
    onComplete: () => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const token = await getAccessToken();
          if (!token) throw new Error('Privy did not provide an access token. Try again.');
          await api('/api/auth/privy', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          // The local app session is independent of the Privy session.
          try { await logout(); } catch { /* Local sign-in already succeeded. */ }
          clearSnapshots(); refresh(); window.location.assign('/rooms');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not sign in with Privy.');
          setBusy(false);
        }
      })();
    },
    onError: () => { setBusy(false); setError('Privy sign-in was not completed. Please try again.'); },
  });
  return <div className="form-stack"><p className="small muted">Privy sign-in creates a separate local account; it does not link your existing password or wallet account.</p><FormFeedback message={error}/><button type="button" className="button button-secondary" disabled={!ready || busy} onClick={() => { setError(null); login(); }}>{busy ? 'Signing in…' : 'Continue with Privy ↗'}</button></div>;
}

export function PrivySignIn({ appId }: { appId: string | null }) {
  const { user, loading, error } = useSession();
  if (loading || user || error) return null;
  if (!appId) return <p className="small muted">Privy sign-in is not configured.</p>;
  return <PrivyProvider appId={appId} config={{ loginMethods: ['email'], defaultChain: baseSepolia, supportedChains: [baseSepolia], embeddedWallets: { ethereum: { createOnLogin: 'off' } } }}><PrivyLogin/></PrivyProvider>;
}
