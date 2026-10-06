/* global process, console, URL */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const cwd = process.cwd();
const manifestPath = resolve(cwd, '.supabase/backend-test-users.json');
if (!existsSync(manifestPath)) throw new Error('No local backend fixture manifest exists.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.localOnly !== true || typeof manifest.tag !== 'string' || !manifest.tag) throw new Error('Refusing cleanup without a valid local fixture manifest.');
const status = execFileSync('npx', ['supabase', 'status', '--output', 'env'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const env = Object.fromEntries(status.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
}));
if (!env.API_URL || !env.SERVICE_ROLE_KEY || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.API_URL).hostname)) {
  throw new Error('Refusing cleanup unless Supabase is running on loopback.');
}
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const leadIds = [...new Set((manifest.leadIds ?? []).filter((id) => typeof id === 'string'))];
const mappingIds = [...new Set((manifest.mappingIds ?? []).filter((id) => typeof id === 'string'))];
const users = Object.values(manifest.users ?? {}).filter((user) => user && typeof user.email === 'string');
const knownUsers = users.filter((user) => user.email.endsWith(`-${manifest.tag}@example.invalid`) || user.email === `invite-${manifest.tag}@example.invalid`);
if (knownUsers.length !== users.length) throw new Error('Fixture manifest contains an email outside this run tag; refusing cleanup.');
const authIds = [...new Set(knownUsers.map((user) => user.id).filter((id) => typeof id === 'string'))];
const knownEmails = [...new Set(knownUsers.map((user) => user.email.toLowerCase()))];
const missingIdUsers = knownUsers.filter((user) => typeof user.id !== 'string');
for (const user of missingIdUsers) {
  const found = await service.rpc('team_find_auth_user', { p_email: user.email });
  if (found.error) throw found.error;
  if (found.data?.[0]?.user_id) authIds.push(found.data[0].user_id);
}

if (leadIds.length) {
  const recordings = await service.from('recordings').select('id,object_key').in('lead_id', leadIds);
  if (recordings.error) throw recordings.error;
  const objectKeys = recordings.data.map((row) => row.object_key).filter(Boolean);
  for (let offset = 0; offset < objectKeys.length; offset += 100) {
    const result = await service.storage.from('lead-recordings').remove(objectKeys.slice(offset, offset + 100));
    if (result.error) throw result.error;
  }
  const recordingIds = recordings.data.map((row) => row.id);
  for (const [table, column, ids] of [
    ['sheet_sync_jobs', 'lead_id', leadIds],
    ['handoff_versions', 'lead_id', leadIds],
    ['current_handoffs', 'lead_id', leadIds],
    ['recording_shares', 'recording_id', recordingIds],
    ['recordings', 'lead_id', leadIds],
    ['contact_attempts', 'lead_id', leadIds],
    ['leads', 'id', leadIds],
  ]) {
    if (!ids.length) continue;
    const result = await service.from(table).delete().in(column, ids);
    if (result.error) throw result.error;
  }
}
if (mappingIds.length) {
  const result = await service.from('sheet_mappings').delete().in('id', mappingIds);
  if (result.error) throw result.error;
}
if (authIds.length) {
  const profiles = await service.from('profiles').update({ status: 'disabled' }).in('user_id', authIds);
  if (profiles.error) throw profiles.error;
}
if (knownEmails.length) {
  const members = await service.from('team_members').select('id,version,auth_user_id,status').in('normalized_email', knownEmails);
  if (members.error) throw members.error;
  if (members.data.some((member) => member.auth_user_id && !authIds.includes(member.auth_user_id))) {
    throw new Error('A tagged fixture email is bound to an Auth ID absent from the manifest; refusing cleanup.');
  }
  for (const member of members.data) {
    if (member.status === 'disabled') continue;
    const result = await service.from('team_members').update({ status: 'disabled', version: Number(member.version) + 1 }).eq('id', member.id);
    if (result.error) throw result.error;
  }
}
unlinkSync(manifestPath);
console.log(`Removed only local fixture leads/mappings and disabled ${authIds.length} tagged test identities for run ${manifest.tag}. Auth history is retained.`);
