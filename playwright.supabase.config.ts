import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const envFile = process.env.SUPABASE_E2E_ENV_FILE ?? '.env.supabase.e2e';
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}
for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_E2E_SERVICE_ROLE_KEY', 'SUPABASE_E2E_USERS_FILE']) {
  if (!process.env[name]) throw new Error(`Local Supabase browser test requires ${name} in ${envFile}.`);
}
const supabaseHost = new URL(process.env.VITE_SUPABASE_URL!).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(supabaseHost)) throw new Error('The privileged browser test setup only permits a loopback Supabase URL.');

export default defineConfig({
  testDir: './e2e/supabase',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --mode supabase --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
