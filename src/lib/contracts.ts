export type DataSource = 'LIVE_LIMITLESS' | 'STALE_LIMITLESS' | 'UNAVAILABLE';
export type MarketStatus = 'open' | 'closed' | 'resolved' | 'unknown';
export interface Market {
  venueId: 'limitless';
  venueMarketId: string;
  slug: string;
  question: string;
  description: string;
  deadline: string;
  resolutionSource: string | null;
  status: MarketStatus;
  outcomeIds: [string, string];
  outcomeLabels: [string, string];
  midpointYes: number | null;
  priceLabel: string;
  winningOutcome: string | null;
  payoutNumerators: [number, number] | null;
  termsVersion: string;
  observedAt: string;
  source: DataSource;
}
export interface Catalog { markets: Market[]; observedAt: string | null; source: DataSource; error?: string; totalMarketsCount?: number; hasNextPage?: boolean; page?: number; }
export interface User { id: number; handle: string; createdAt: string; }
export interface Room { id: number; name: string; description: string; ownerId: number; private: boolean; memberCount: number; role: 'owner' | 'member' | null; }
export interface Forecast { id: number; userId: number; handle: string; roomId: number; marketId: string; marketSlug: string; marketQuestion?: string; outcomeId: string; probability: number; rationale: string; createdAt: string; revisedAt: string; lockAt: string; revisions: { probability: number; rationale: string; at: string }[]; score: number | null; scoreVersion: string | null; scoreState: 'confirmed' | 'last-known' | 'pending'; scoreHistory: { outcomeId: string; score: number | null; version: string; correctedAt: string }[]; }
export interface PaperOrder { id: number; userId: number; marketId: string; marketSlug: string; marketQuestion?: string; outcomeId: string; side: 'YES' | 'NO'; stakeCents: number; price: number; shares: number; state: 'filled' | 'settled' | 'void'; createdAt: string; settlementCents: number | null; settlementState: 'confirmed' | 'last-known' | 'pending'; model: 'midpoint-v1'; settlementHistory: { settlementCents: number | null; version: string; correctedAt: string }[]; }
export interface Notice { id: number; userId: number; kind: string; message: string; createdAt: string; readAt: string | null; }
export type ApiError = { error: string };
