import { decryptMemberToken, encryptMemberToken, inputFingerprint, memberActionLink, normalizeTeamEmail } from './team-links.ts';

Deno.test('team email is normalized and validated before reaching Auth or SQL', () => {
  equal(normalizeTeamEmail('  Pilot.User+QA@Example.Invalid '), 'pilot.user+qa@example.invalid');
  for (const value of [null, '', 'name at example.invalid', 'a@b', 'x'.repeat(321)]) {
    let rejected = false;
    try { normalizeTeamEmail(value); } catch { rejected = true; }
    if (!rejected) throw new Error(`Expected invalid email rejection: ${String(value)}`);
  }
});

Deno.test('idempotency fingerprint ignores object property order but preserves values', async () => {
  equal(await inputFingerprint({ role: 'staff', email: 'pilot@example.invalid' }), await inputFingerprint({ email: 'pilot@example.invalid', role: 'staff' }));
  different(await inputFingerprint({ role: 'staff' }), await inputFingerprint({ role: 'admin' }));
});

Deno.test('Auth token hashes are encrypted at rest with randomized AES-GCM ciphertext', async () => {
  const hash = 'opaque-auth-token-hash';
  const secret = 'synthetic-local-encryption-secret';
  const first = await encryptMemberToken(hash, secret);
  const second = await encryptMemberToken(hash, secret);
  different(first, second);
  if (first.includes(hash)) throw new Error('Ciphertext must not contain the bearer token hash.');
  equal(await decryptMemberToken(first, secret), hash);
  let rejected = false;
  try { await decryptMemberToken(first, 'wrong-secret'); } catch { rejected = true; }
  if (!rejected) throw new Error('A wrong encryption key must not decrypt a stored token.');
});

Deno.test('manual action URL carries only the app callback and Auth token hash', () => {
  const action = new URL(memberActionLink('http://127.0.0.1:5173', 'synthetic-hash', 'invite'));
  equal(action.origin, 'http://127.0.0.1:5173');
  equal(action.pathname, '/auth/confirm');
  equal(action.searchParams.get('token_hash'), 'synthetic-hash');
  equal(action.searchParams.get('type'), 'invite');
  equal(action.hash, '');
});

function equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }
function different(actual: unknown, expected: unknown) { if (actual === expected) throw new Error('Expected values to differ.'); }
