import { describe, expect, it } from 'vitest';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { authErrorCode, SupabaseRepository } from './supabase';

function repositoryWithGetUser(result: { data: { user: unknown }; error: Error | null }): SupabaseRepository {
  const repository = Object.create(SupabaseRepository.prototype) as SupabaseRepository;
  Object.assign(repository, { client: { auth: { getUser: async () => result } } });
  return repository;
}

describe('Supabase Auth error classification', () => {
  it('keeps retryable network and server failures distinct from invalid sessions', () => {
    expect(authErrorCode({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe('AUTH_UNAVAILABLE');
    expect(authErrorCode({ status: 503, message: 'Service unavailable' })).toBe('AUTH_UNAVAILABLE');
    expect(authErrorCode({ status: 401, message: 'Invalid JWT' })).toBe('AUTH_ERROR');
  });

  it('treats a missing session on a fresh or logged-out client as anonymous', async () => {
    const repository = repositoryWithGetUser({ data: { user: null }, error: new AuthSessionMissingError() });

    await expect(repository.getSession()).resolves.toEqual({ actor: null });
  });

  it('keeps invalid JWT and transient network failures visible to callers', async () => {
    const invalidJwt = repositoryWithGetUser({ data: { user: null }, error: Object.assign(new Error('Invalid JWT'), { status: 401 }) });
    const networkFailure = repositoryWithGetUser({ data: { user: null }, error: Object.assign(new Error('Failed to fetch'), { status: 0 }) });

    await expect(invalidJwt.getSession()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    await expect(networkFailure.getSession()).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' });
  });
});
