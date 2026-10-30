import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { closeDatabase, database } from '../../src/lib/server/db';
import { register, sessionCookie } from '../../src/lib/server/auth';
import { createRoom, getActivity, getProfile } from '../../src/lib/server/domain';
import { normalizeMarket } from '../../src/lib/server/venue';
import { POST } from '../../src/app/api/forecasts/route';

let dir: string;
const deadline = Date.now() + 3_600_000;
const venueRow = () => ({ id: 17, slug: 'team-match', title: '76ers vs Hornets', description: '<p>76ers win resolves 76ers; Hornets win resolves Hornets.</p>', expirationTimestamp: deadline, status: 'FUNDED', tradeType: 'clob', marketType: 'single', tokens: { yes: '101', no: '202' }, metadata: { outcomeLabels: { '0': '76ers', '1': 'Hornets' } }, prices: [.4, .6] });
const request = (body: Record<string, unknown>, token?: string) => new NextRequest('http://localhost:3000/api/forecasts', { method: 'POST', headers: { origin: 'http://localhost:3000', ...(token ? { cookie: `${sessionCookie}=${token}` } : {}) }, body: JSON.stringify(body) });
const form = () => ({ marketSlug: 'team-match', outcomeId: '202', selectedProbability: .7, rationale: 'Defence is stronger this week', destination: 'personal', termsVersion: normalizeMarket(venueRow(), new Date().toISOString())!.termsVersion });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prediction-forecast-route-')); process.env.DB_PATH = join(dir, 'test.sqlite'); });
afterEach(() => { vi.unstubAllGlobals(); closeDatabase(); rmSync(dir, { recursive: true, force: true }); delete process.env.DB_PATH; });

describe('confirmed free forecast submission', () => {
  it('requires an authenticated account before fetching a venue market', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await POST(request(form()));
    expect(result.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('maps a chosen second-outcome chance to first-token scoring and rejects duplicate records', async () => {
    const alice = register('alice', 'long-secret-one');
    const bob = register('bob', 'long-secret-two');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(venueRow()), { headers: { 'content-type': 'application/json' } })));
    const saved = await POST(request(form(), alice.token));
    expect(saved.status).toBe(201);
    const body = await saved.json();
    expect(body.forecast).toMatchObject({ outcomeId: '202', probability: expect.closeTo(.3), rationale: form().rationale, destinationKind: 'personal', firstOutcomeLabel: '76ers', selectedOutcomeLabel: 'Hornets' });
    expect(getActivity(alice.user.id).forecasts).toHaveLength(1);
    expect(getProfile('alice', bob.user.id).forecasts).toHaveLength(0);
    const duplicate = await POST(request(form(), alice.token));
    expect(duplicate.status).toBe(409);
    expect(getActivity(alice.user.id).forecasts).toHaveLength(1);
  });
  it('refuses a private room destination without membership', async () => {
    const alice = register('alice', 'long-secret-one');
    const bob = register('bob', 'long-secret-two');
    const room = createRoom(alice.user.id, 'Private room', '', true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(venueRow()), { headers: { 'content-type': 'application/json' } })));
    const denied = await POST(request({ ...form(), destination: room.id }, bob.token));
    expect(denied.status).toBe(404);
    expect(getActivity(bob.user.id).forecasts).toEqual([]);
    expect(getActivity(bob.user.id).orders).toEqual([]);
  });
  it('rejects a probability outside the selected outcome range without creating a personal room', async () => {
    const alice = register('alice', 'long-secret-one');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(venueRow()), { headers: { 'content-type': 'application/json' } })));
    const invalid = await POST(request({ ...form(), selectedProbability: 1.4 }, alice.token));
    expect(invalid.status).toBe(400);
    expect(getActivity(alice.user.id).forecasts).toEqual([]);
  });
  it('rejects a confirmation if the displayed venue terms no longer match the live record', async () => {
    const alice = register('alice', 'long-secret-one');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(venueRow()), { headers: { 'content-type': 'application/json' } })));
    const changed = await POST(request({ ...form(), termsVersion: '0'.repeat(24) }, alice.token));
    expect(changed.status).toBe(409);
    expect(getActivity(alice.user.id).forecasts).toEqual([]);
  });
  it('keeps original venue identities and resolution terms after a newer market overwrites cache', async () => {
    const alice = register('alice', 'long-secret-one');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(venueRow()), { headers: { 'content-type': 'application/json' } })));
    expect((await POST(request(form(), alice.token))).status).toBe(201);
    const newer = { ...normalizeMarket(venueRow(), new Date().toISOString())!, question: 'Different team match', description: 'Changed resolution conditions', outcomeLabels: ['Other', 'Team'], termsVersion: '0'.repeat(24) };
    database().prepare('UPDATE venue_cache SET payload = ? WHERE cache_key = ?').run(JSON.stringify(newer), 'market:team-match');
    expect(getActivity(alice.user.id).forecasts[0]).toMatchObject({
      marketQuestion: '76ers vs Hornets',
      firstOutcomeLabel: '76ers',
      selectedOutcomeLabel: 'Hornets',
      termsAtEntry: '76ers win resolves 76ers; Hornets win resolves Hornets.',
      deadlineAtEntry: new Date(deadline).toISOString(),
    });
  });
});
