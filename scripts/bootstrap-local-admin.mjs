/* global process, console, URL */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const cwd = process.cwd();
const email = String(process.argv[2] ?? process.env.LOCAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
  throw new Error('Pass a valid local admin email as the first argument or LOCAL_ADMIN_EMAIL.');
}
const output = execFileSync('npx', ['supabase', 'status', '--output', 'env'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
}));
const apiUrl = values.API_URL;
if (!apiUrl || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) throw new Error('Start the local Supabase project first.');
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(apiUrl).hostname)) throw new Error('Refusing to bootstrap an admin outside loopback Supabase.');
const credentialPath = resolve(cwd, '.supabase/local-admin-credentials.json');
if (existsSync(credentialPath)) {
  const saved = JSON.parse(readFileSync(credentialPath, 'utf8'));
  if (saved.email?.toLowerCase() !== email) throw new Error('A different local admin credential file already exists; preserve it and resolve manually.');
}
const service = createClient(apiUrl, values.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const normalizedEmail = email;
const roster = await service.from('team_members').select('*').eq('normalized_email', normalizedEmail).maybeSingle();
if (roster.error) throw roster.error;
const activeAdmins = await service.from('team_members').select('id,auth_user_id').eq('role', 'admin').eq('status', 'active');
if (activeAdmins.error) throw activeAdmins.error;
if (activeAdmins.data.length && !activeAdmins.data.some((member) => member.id === roster.data?.id)) {
  throw new Error('A different active admin already exists; use the team admin invitation flow.');
}

let userId = roster.data?.auth_user_id ?? null;
let newPassword = null;
if (!userId) {
  const authLookup = await service.rpc('team_find_auth_user', { p_email: normalizedEmail });
  if (authLookup.error) throw authLookup.error;
  const existingAuth = authLookup.data?.[0];
  if (existingAuth) userId = existingAuth.user_id;
  else {
    newPassword = randomBytes(32).toString('base64url');
    const created = await service.auth.admin.createUser({ email: normalizedEmail, password: newPassword, email_confirm: true, user_metadata: { display_name: 'Local Pilot Admin' } });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const dir = resolve(cwd, '.supabase');
    mkdirSync(dir, { recursive: true });
    writeFileSync(credentialPath, `${JSON.stringify({ localOnly: true, email, password: newPassword }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(credentialPath, 0o600);
  }
}

if (roster.data && (roster.data.auth_user_id !== userId || roster.data.role !== 'admin' || roster.data.status !== 'active')) {
  throw new Error('The requested email already has a non-admin or inactive roster entry; refusing to change it.');
}
const existingProfile = await service.from('profiles').select('user_id,role,status,email').eq('user_id', userId).maybeSingle();
if (existingProfile.error) throw existingProfile.error;
if (existingProfile.data && (existingProfile.data.role !== 'admin' || existingProfile.data.status !== 'active')) {
  throw new Error('The existing Auth identity has a non-admin profile; refusing to elevate it automatically.');
}
if (!roster.data) {
  const now = new Date().toISOString();
  const profile = await service.from('profiles').upsert({ user_id: userId, role: 'admin', display_name: 'Local Pilot Admin', status: 'active', email: normalizedEmail, activated_at: now }, { onConflict: 'user_id' });
  if (profile.error) throw profile.error;
  const member = await service.from('team_members').insert({ auth_user_id: userId, email: normalizedEmail, normalized_email: normalizedEmail, display_name: 'Local Pilot Admin', role: 'admin', status: 'active', activated_at: now });
  if (member.error) throw member.error;
}

if (newPassword) {
  console.log('Bootstrapped a loopback-only local admin; its generated password is stored in ignored .supabase/local-admin-credentials.json.');
} else {
  console.log('The loopback-only local admin roster is ready; existing credentials were left unchanged.');
}
