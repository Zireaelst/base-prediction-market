// The page remains free to scroll vertically; only a deliberate, dominant horizontal drag selects.
export function swipeDirection(dx: number, dy: number): 'first' | 'second' | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy) * 1.25) return null;
  return dx > 0 ? 'first' : 'second';
}

export function swipeOffset(dx: number, dy: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) <= Math.abs(dy) * 1.25) return 0;
  return Math.max(-180, Math.min(180, dx));
}
