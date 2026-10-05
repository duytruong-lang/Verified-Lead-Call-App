import type { LeadCallRepository } from '../shared/repository';
import { DemoRepository } from './demo';
import { SupabaseRepository } from './supabase';

export function createRepository(env: ImportMetaEnv = import.meta.env): { mode: 'demo' | 'supabase'; repository: LeadCallRepository } {
  const mode = env.VITE_APP_MODE;
  if (mode === 'demo') {
    if (env.PROD) throw new Error('Demo mode is disabled in production builds. Configure VITE_APP_MODE=supabase.');
    return { mode, repository: new DemoRepository() };
  }
  if (mode === 'supabase') {
    return { mode, repository: SupabaseRepository.connect(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY) };
  }
  throw new Error('Set VITE_APP_MODE explicitly to “demo” or “supabase”.');
}
