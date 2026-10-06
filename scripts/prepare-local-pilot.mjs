/* global process, console, URL */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const cwd = process.cwd();
const output = execFileSync('npx', ['supabase', 'status', '--output', 'env'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
}));
const apiUrl = values.API_URL;
if (!apiUrl || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) throw new Error('Start the local Supabase project first.');
const parsedUrl = new URL(apiUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname)) throw new Error('Refusing to seed or configure anything outside loopback Supabase.');
const envPath = resolve(cwd, '.env.supabase.local');
const envContents = `VITE_APP_MODE=supabase\nVITE_SUPABASE_URL=${apiUrl}\nVITE_SUPABASE_ANON_KEY=${values.ANON_KEY}\n`;
if (existsSync(envPath) && readFileSync(envPath, 'utf8') !== envContents) {
  throw new Error('Existing .env.supabase.local differs from this local Supabase instance; preserve it and resolve manually.');
}

const leads = [
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f01', '+10000000001', 'Nguyễn Minh An'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f02', '+10000000002', 'Trần Gia Bảo'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f03', '+10000000003', 'Lê Khánh Linh'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f04', '+10000000004', 'Phạm Hoàng Nam'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f05', '+10000000005', 'Võ Ngọc Mai'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f06', '+10000000006', 'Đặng Quốc Huy'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f07', '+10000000007', 'Bùi Thanh Hà'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f08', '+10000000008', 'Đỗ Tuấn Kiệt'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f09', '+10000000009', 'Hồ Phương Vy'],
  ['0d1de8b7-d5f4-4fc7-9528-60c623b36f10', '+10000000010', 'Ngô Đức Long'],
].map(([id, phone, display_name], index) => ({
  id,
  source_platform_id: `verified-pilot-local-v1-${String(index + 1).padStart(2, '0')}`,
  phone,
  display_name,
  source: 'local-pilot-synthetic',
  form_answers: { fixture: 'verified-call-local-pilot-v1', synthetic: true },
}));

const service = createClient(apiUrl, values.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let inserted = 0;
let alreadyPresent = 0;
for (const lead of leads) {
  const [byId, bySource] = await Promise.all([
    service.from('leads').select('id,source_platform_id,phone,display_name,source,form_answers').eq('id', lead.id).maybeSingle(),
    service.from('leads').select('id,source_platform_id,phone,display_name,source,form_answers').eq('source_platform_id', lead.source_platform_id).maybeSingle(),
  ]);
  if (byId.error || bySource.error) throw byId.error ?? bySource.error;
  const identityMatches = (row) => row && row.id === lead.id && row.source_platform_id === lead.source_platform_id && row.phone === lead.phone && row.display_name === lead.display_name && row.source === lead.source && row.form_answers?.fixture === lead.form_answers.fixture;
  if (byId.data || bySource.data) {
    if (!identityMatches(byId.data) || !identityMatches(bySource.data)) {
      throw new Error(`Synthetic lead fixture conflict for ${lead.source_platform_id}; no existing row was changed.`);
    }
    alreadyPresent += 1;
    continue;
  }
  const created = await service.from('leads').insert(lead);
  if (created.error) throw created.error;
  inserted += 1;
}

if (!existsSync(envPath)) {
  writeFileSync(envPath, envContents, { mode: 0o600, flag: 'wx' });
  chmodSync(envPath, 0o600);
}
console.log(`Local Supabase app config is ready. Synthetic leads inserted: ${inserted}; already present and unchanged: ${alreadyPresent}. No Sheet writes were made.`);
