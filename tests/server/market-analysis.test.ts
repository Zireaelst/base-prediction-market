import { describe, expect, it } from 'vitest';
import { extractAnalysis } from '../../src/lib/server/market-analysis';

describe('local model response', () => {
  it('rejects incomplete or empty model output rather than presenting it as analysis', () => {
    expect(() => extractAnalysis({ done: false, response: 'partial' })).toThrow();
    expect(() => extractAnalysis({ done: true, response: '   ' })).toThrow();
    expect(extractAnalysis({ done: true, response: '  A result  ' })).toBe('A result');
  });
});
