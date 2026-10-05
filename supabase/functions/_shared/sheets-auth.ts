import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createServiceAccountToken, type ServiceAccountCredentials, GoogleSheetsHttp } from '../../../src/integrations/sheets/google-http.ts';

export const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
export const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
export const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
export const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

export function authenticatedClient(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  return createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { authorization } }, auth: { persistSession: false } });
}

export async function requireAdmin(request: Request): Promise<{ userId: string } | Response> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
  const client = authenticatedClient(request);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return json({ error: 'Invalid session.' }, 401);
  const { data: profile, error: profileError } = await serviceClient.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profileError || profile?.role !== 'admin') return json({ error: 'Administrator role required.' }, 403);
  return { userId: user.id };
}

export async function sheetsClient(): Promise<GoogleSheetsHttp> {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('Google service account is not configured on the server.');
  const credentials = JSON.parse(raw) as ServiceAccountCredentials;
  return new GoogleSheetsHttp(await createServiceAccountToken(credentials));
}
