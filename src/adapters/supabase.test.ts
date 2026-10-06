import { describe, expect, it } from 'vitest';
import { authErrorCode } from './supabase';

describe('Supabase Auth error classification', () => {
  it('keeps retryable network and server failures distinct from invalid sessions', () => {
    expect(authErrorCode({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe('AUTH_UNAVAILABLE');
    expect(authErrorCode({ status: 503, message: 'Service unavailable' })).toBe('AUTH_UNAVAILABLE');
    expect(authErrorCode({ status: 401, message: 'Invalid JWT' })).toBe('AUTH_ERROR');
  });
});
