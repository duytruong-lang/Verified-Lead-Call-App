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
  };
  const key = Object.keys(codeMap).find((candidate) => message.includes(candidate));
  return json({ error: { code: key ? codeMap[key] : 'BACKEND_ERROR', message } }, 400);
}

export async function requireActor(user: SupabaseClient): Promise<{ id: string; role: 'admin' | 'staff' }> {
  const { data, error } = await user.auth.getUser();
  if (error || !data.user) throw new Error('authentication_required');
  const { data: profile, error: profileError } = await user.from('profiles').select('role').eq('user_id', data.user.id).single();
  if (profileError || !profile) throw new Error('profile_required');
  return { id: data.user.id, role: profile.role };
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
