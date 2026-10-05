import { describe, expect, it } from 'vitest';
import { canMarkVerified, nextAttemptOrdinal, validateOutcome } from './rules';

describe('business contracts', () => {
  it('requires a note for other', () => {
    expect(() => validateOutcome('other')).toThrow(/note is required/i);
    expect(() => validateOutcome('other', 'Không đúng lựa chọn')).not.toThrow();
  });

  it('allows five attempts and blocks the sixth', () => {
    expect(nextAttemptOrdinal(4)).toBe(5);
    expect(() => nextAttemptOrdinal(5)).toThrow(/five-attempt/i);
  });

  it('requires a ready, playable recording and active share to verify', () => {
    expect(canMarkVerified({ ready: true, playable: true, shareActive: true })).toBe(true);
    expect(canMarkVerified({ ready: false, playable: true, shareActive: true })).toBe(false);
  });
});
