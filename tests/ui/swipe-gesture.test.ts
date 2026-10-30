import { describe, expect, it } from 'vitest';
import { swipeDirection } from '../../src/components/swipe-gesture';

describe('swipeDirection', () => {
  it('maps a horizontal drag right to the first outcome and left to the second', () => {
    expect(swipeDirection(90, 5)).toBe('first');
    expect(swipeDirection(-90, 5)).toBe('second');
  });

  it('leaves vertical page scrolling alone even if the drag travels far', () => {
    expect(swipeDirection(20, 90)).toBeNull();
    expect(swipeDirection(-90, 120)).toBeNull();
  });

  it('does not select on a short drag or a cancelled drag reset to zero', () => {
    expect(swipeDirection(30, 0)).toBeNull();
    expect(swipeDirection(0, 0)).toBeNull();
  });
});
