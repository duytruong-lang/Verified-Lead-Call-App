/* global process, console */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = process.cwd();
const raw = execFileSync('npx', ['supabase', 'status', '--output', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const values = Object.fromEntries(raw.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]));
for (const key of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) if (!values[key]) throw new Error(`Missing ${key} from local Supabase status.`);
const envPath = join(root, '.supabase/functions.env');
const previous = existsSync(envPath) ? Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value])) : {};
const output = [
  `SUPABASE_URL=${values.API_URL}`,
  `SUPABASE_ANON_KEY=${values.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${values.SERVICE_ROLE_KEY}`,
  `PUBLIC_SUPABASE_URL=${values.API_URL}`,
  `SHARE_ENCRYPTION_KEY=${previous.SHARE_ENCRYPTION_KEY ?? randomBytes(32).toString('base64url')}`,
  `TEAM_LINK_ENCRYPTION_KEY=${previous.TEAM_LINK_ENCRYPTION_KEY ?? randomBytes(32).toString('base64url')}`,
  `TEAM_LINK_TTL_SECONDS=${previous.TEAM_LINK_TTL_SECONDS ?? '3600'}`,
  'PUBLIC_APP_URL=http://127.0.0.1:5173',
  'APP_ORIGIN=http://127.0.0.1:5173',
].join('\n') + '\n';
mkdirSync(join(root, '.supabase'), { recursive: true });
writeFileSync(join(root, '.supabase/functions.env'), output, { mode: 0o600 });
console.log('Prepared ignored local Edge Function environment at .supabase/functions.env.');
