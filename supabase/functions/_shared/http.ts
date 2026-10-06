import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function clients(req: Request): { user: SupabaseClient; service: SupabaseClient } {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !serviceKey) throw new Error('server_configuration_missing');
  const authorization = req.headers.get('Authorization') ?? '';
  return {
    user: createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }),
    service: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

export function publicApiUrl(): string {
  return Deno.env.get('PUBLIC_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
}

export function fail(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const codeMap: Record<string, string> = {
    attempt_limit_reached: 'ATTEMPT_LIMIT', claim_active: 'CLAIM_CONFLICT', claim_expired_owner_only: 'CLAIM_CONFLICT',
    active_claim_required: 'ACTIVE_CLAIM_REQUIRED', claim_expired: 'CLAIM_CONFLICT', stale_evaluation_version: 'VERSION_CONFLICT',
    stale_handoff_version: 'VERSION_CONFLICT', ready_recording_required: 'RECORDING_INVALID', recording_not_found: 'RECORDING_INVALID',
    recording_size_invalid: 'RECORDING_INVALID', recording_type_invalid: 'RECORDING_INVALID', other_note_required: 'OTHER_NOTE_REQUIRED',
    share_not_found: 'SHARE_REVOKED', recording_not_ready: 'RECORDING_INVALID', claim_owner_required: 'FORBIDDEN',
    staff_required: 'FORBIDDEN', profile_required: 'FORBIDDEN', admin_required: 'FORBIDDEN', share_owner_or_admin_required: 'FORBIDDEN',
    attempt_already_completed: 'ATTEMPT_CONFLICT', idempotency_key_reused: 'IDEMPOTENCY_KEY_REUSED',
    evaluation_invalid: 'VERSION_CONFLICT', sheet_mapping: 'MAPPING_INVALID',
    authentication_required: 'UNAUTHENTICATED', active_member_required: 'FORBIDDEN', membership_pending: 'FORBIDDEN',
    member_disabled: 'FORBIDDEN', staff_upload_required: 'FORBIDDEN', recording_owner_required: 'FORBIDDEN',
  };
  const key = Object.keys(codeMap).find((candidate) => message.includes(candidate));
  const code = key ? codeMap[key] : 'BACKEND_ERROR';
  const status = code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : 400;
  return json({ error: { code, message } }, status);
}

export async function requireIdentity(user: SupabaseClient): Promise<{ id: string; email: string }> {
  const { data, error } = await user.auth.getUser();
  if (error || !data.user) throw new Error('authentication_required');
  return { id: data.user.id, email: data.user.email ?? '' };
}

export async function requireActor(
  user: SupabaseClient,
  service: SupabaseClient,
): Promise<{ id: string; role: 'admin' | 'staff' | 'viewer'; status: 'active'; email: string; displayName: string | null }> {
  const identity = await requireIdentity(user);
  const { data, error } = await service.rpc('team_auth_context', { p_auth_user_id: identity.id });
  if (error || !Array.isArray(data) || !data.length) throw new Error('active_member_required');
  const member = data[0] as Record<string, unknown>;
  if (member.status !== 'active') throw new Error(member.status === 'pending' ? 'membership_pending' : 'member_disabled');
  if (member.email === null || String(member.email).toLowerCase() !== identity.email.toLowerCase()) throw new Error('active_member_required');
  if (!['admin', 'staff', 'viewer'].includes(String(member.role))) throw new Error('active_member_required');
  return {
    id: identity.id,
    role: member.role as 'admin' | 'staff' | 'viewer',
    status: 'active',
    email: identity.email,
    displayName: typeof member.display_name === 'string' ? member.display_name : null,
  };
}

export async function createShareToken(): Promise<{ token: string; hash: string; ciphertext: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(bytes);
  const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = toBase64Url(new Uint8Array(hashBytes));
  const keyText = Deno.env.get('SHARE_ENCRYPTION_KEY');
  if (!keyText) throw new Error('share_encryption_key_missing');
  const keyRaw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyText));
  const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return { token, hash, ciphertext: `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}` };
}

export async function tokenHash(token: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
