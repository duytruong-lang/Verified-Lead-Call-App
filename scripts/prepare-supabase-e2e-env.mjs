/* global process, URL, console */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const usersFile = resolve(process.env.SUPABASE_E2E_USERS_FILE ?? '.supabase/backend-test-users.json');
if (!existsSync(usersFile)) throw new Error('Create synthetic local test users first; see docs/OPERATIONS.md.');
let status;
try { status = execFileSync('npx', ['supabase', 'status', '--output', 'env'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
catch { throw new Error('The local Supabase project must be running before preparing browser-test configuration.'); }
const values = Object.fromEntries(status.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
}));
const url = values.API_URL;
if (!url || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) throw new Error('Supabase status omitted required local API or test keys.');
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) throw new Error('Refusing to write privileged test configuration for a non-loopback URL.');
const contents = [
  'VITE_APP_MODE=supabase',
  `VITE_SUPABASE_URL=${url}`,
  `VITE_SUPABASE_ANON_KEY=${values.ANON_KEY}`,
  `SUPABASE_E2E_SERVICE_ROLE_KEY=${values.SERVICE_ROLE_KEY}`,
  `SUPABASE_E2E_USERS_FILE=${usersFile}`,
].join('\n') + '\n';
mkdirSync(resolve(cwd, '.supabase'), { recursive: true });
const path = resolve(cwd, '.env.supabase.e2e');
writeFileSync(path, contents, { mode: 0o600 });
console.log(`Wrote ignored loopback-only test configuration: ${path}`);
