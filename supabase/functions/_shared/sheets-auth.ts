import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createServiceAccountToken, type ServiceAccountCredentials, GoogleSheetsHttp } from '../../../src/integrations/sheets/google-http.ts';

export const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
export const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
export const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
export const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

export function authenticatedClient(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  return createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
}

export async function requireAdmin(request: Request): Promise<{ userId: string } | Response> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
  const client = authenticatedClient(request);
  const token = authorization.slice('Bearer '.length).trim();
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return json({ error: 'Invalid session.' }, 401);
  const { data: members, error: memberError } = await serviceClient.rpc('team_auth_context', { p_auth_user_id: user.id });
  const member = Array.isArray(members) ? members[0] : null;
  if (memberError || member?.status !== 'active' || member?.role !== 'admin' || String(member?.email ?? '').toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return json({ error: 'Active administrator membership required.' }, 403);
  }
  return { userId: user.id };
}

export async function sheetsClient(): Promise<GoogleSheetsHttp> {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('Google service account is not configured on the server.');
  const credentials = JSON.parse(raw) as ServiceAccountCredentials;
  return new GoogleSheetsHttp(await createServiceAccountToken(credentials));
}
