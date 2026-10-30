'use client';

import { useState } from 'react';
import { api, useSession } from './api';
import { formatDate } from './display';

export function MarketAnalysis({ slug }: { slug: string }) {
  const { user, loading } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ analysis: string; model: string; observedAt: string; source: string } | null>(null);
  async function analyze() {
    setBusy(true); setError(null); setResult(null);
    try { setResult(await api(`/api/markets/${encodeURIComponent(slug)}/analysis`, { method: 'POST' })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Analysis unavailable.'); }
    finally { setBusy(false); }
  }
  return <section className="page-wrap"><div className="info-panel"><p className="eyebrow">READ-ONLY / LOCAL AI</p><h2>Analyze this question.</h2><p className="small muted">A local model reviews the venue snapshot only; it does not browse, trade or resolve markets. Its answer can be wrong.</p><button type="button" className="button button-secondary" disabled={loading || !user || busy} onClick={analyze}>{busy ? 'Analyzing…' : 'Analyze market ↗'}</button>{!loading && !user && <p className="small muted">Sign in to use local analysis.</p>}{error && <p className="status-banner" role="alert">{error}</p>}{result && <div role="status"><p className="small muted">{result.model} · {result.source} · observed {formatDate(result.observedAt)}</p><p style={{ whiteSpace: 'pre-wrap' }}>{result.analysis}</p></div>}</div></section>;
}
