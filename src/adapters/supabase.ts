import { createClient, isAuthSessionMissingError, type SupabaseClient } from '@supabase/supabase-js';
import type { LeadCallRepository } from '../shared/repository';
import { RepositoryError } from '../shared/repository';
import type { Actor, LeadDetails, LeadQueue, LeadSummary, MemberLink, MemberRole, PublicRecordingInfo, SaveOutcomeInput, SaveOutcomeResult, SheetMapping, SheetMappingValidation, TeamMember, UUID } from '../shared/types';

type EdgeFunctionName = 'list-leads' | 'get-lead' | 'claim-attempt' | 'resume-attempt' | 'cancel-attempt' | 'save-outcome' | 'begin-recording-upload' | 'complete-recording-upload' | 'complete-evaluation' | 'create-share' | 'replace-handoff' | 'revoke-share' | 'resolve-share' | 'validate-sheet-mapping' | 'enqueue-sheet-sync';

export function authErrorCode(error: unknown): 'AUTH_ERROR' | 'AUTH_UNAVAILABLE' {
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown } | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  if (status === 0 || (status !== undefined && status >= 500) || name === 'AuthRetryableFetchError' || /failed to fetch|network|timeout|temporar(?:y|ily) unavailable/i.test(message)) return 'AUTH_UNAVAILABLE';
  return 'AUTH_ERROR';
}

async function repositoryFunctionError(error: Error, fallbackCode: string): Promise<never> {
  let code = fallbackCode; let message = error.message;
  const context = (error as Error & { context?: unknown }).context;
  if (context instanceof Response) {
    try { const body = await context.clone().json() as { error?: { code?: string; message?: string } }; code = body.error?.code ?? code; message = body.error?.message ?? message; } catch { /* use SDK message */ }
  }
  throw new RepositoryError(message, code);
}

export class SupabaseRepository implements LeadCallRepository {
  private constructor(private readonly client: SupabaseClient) {}

  static connect(url: string | undefined, anonKey: string | undefined): SupabaseRepository {
    if (!url || !anonKey) throw new Error('Supabase mode requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    return new SupabaseRepository(createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } }));
  }

  listLeads(queue: LeadQueue): Promise<LeadSummary[]> {
    return this.invoke('list-leads', { queue });
  }

  async getSession(): Promise<{ actor: import('../shared/types').Actor | null }> {
    const { data, error } = await this.client.auth.getUser();
    if (error && isAuthSessionMissingError(error)) return { actor: null };
    if (error) throw new RepositoryError(error.message, authErrorCode(error));
    if (!data.user) return { actor: null };
    const result = await this.invokeTeam<{ actor: Actor | null }>('get-session', {});
    return { actor: result.actor };
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new RepositoryError(error.message, 'AUTH_ERROR');
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) throw new RepositoryError(error.message, 'AUTH_ERROR');
  }

  onAuthChange(listener: () => void): () => void {
    const { data } = this.client.auth.onAuthStateChange(() => listener());
    return () => data.subscription.unsubscribe();
  }

  async acceptAuthLink(tokenHash: string, type: 'invite' | 'recovery'): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new RepositoryError(error.message, 'AUTH_LINK_ERROR');
  }

  async completeOnboarding(password: string): Promise<void> {
    await this.invokeTeam<{ id: UUID }>('complete-onboarding', { password });
  }

  listMembers(): Promise<TeamMember[]> { return this.invokeTeam<{ members: TeamMember[] }>('list-members', {}).then((result) => result.members); }
  inviteMember(input: { email: string; role: MemberRole; idempotencyKey: string }): Promise<MemberLink> { return this.invokeTeam('invite-member', input); }
  issueMemberLink(input: { memberId: UUID; kind: 'invite' | 'recovery'; idempotencyKey: string }): Promise<MemberLink> { return this.invokeTeam('issue-member-link', input); }
  setMemberRole(input: { memberId: UUID; role: MemberRole; expectedVersion: number; idempotencyKey: string }): Promise<TeamMember> { return this.invokeTeam('set-member-role', input); }
  setMemberStatus(input: { memberId: UUID; status: 'active' | 'disabled'; expectedVersion: number; idempotencyKey: string }): Promise<TeamMember> { return this.invokeTeam('set-member-status', input); }

  getLead(leadId: UUID): Promise<LeadDetails> {
    return this.invoke('get-lead', { leadId });
  }

  claimAttempt(leadId: UUID, idempotencyKey: string): Promise<{ claimId: UUID; ordinal: number }> {
    return this.invoke('claim-attempt', { leadId, idempotencyKey });
  }

  resumeAttempt(claimId: UUID): Promise<{ claimId: UUID; ordinal: number; claimExpiresAt: string }> {
    return this.invoke('resume-attempt', { claimId });
  }

  async cancelAttempt(claimId: UUID, idempotencyKey: string): Promise<void> {
    await this.invoke('cancel-attempt', { claimId, idempotencyKey });
  }

  saveOutcome(input: SaveOutcomeInput): Promise<SaveOutcomeResult> {
    return this.invoke('save-outcome', { ...input });
  }

  beginRecordingUpload(input: { leadId: UUID; claimId: UUID; filename: string; contentType: string; sizeBytes: number; idempotencyKey: string }): Promise<import('../shared/types').UploadTarget> {
    return this.invoke('begin-recording-upload', input);
  }

  completeRecordingUpload(input: { recordingId: UUID; sizeBytes: number; durationSeconds: number; checksum?: string }): Promise<import('../shared/types').Recording> {
    return this.invoke('complete-recording-upload', input);
  }

  completeEvaluation(input: { leadId: UUID; result: 'verified' | 'unverified'; recordingId?: UUID; expectedVersion: number; idempotencyKey: string }): Promise<{ version: number }> {
    return this.invoke('complete-evaluation', input);
  }

  createShare(recordingId: UUID, idempotencyKey: string): Promise<{ shareId: UUID; publicUrl: string }> {
    return this.invoke('create-share', { recordingId, idempotencyKey });
  }

  replaceHandoff(input: { leadId: UUID; recordingId: UUID; expectedVersion: number; idempotencyKey: string }): Promise<{ version: number; shareId: UUID }> {
    return this.invoke('replace-handoff', input);
  }

  async revokeShare(shareId: UUID, idempotencyKey: string): Promise<void> {
    await this.invoke('revoke-share', { shareId, idempotencyKey });
  }

  validateSheetMapping(mapping: SheetMapping): Promise<SheetMappingValidation> {
    return this.invoke('validate-sheet-mapping', { ...mapping });
  }

  enqueueSheetSync(leadId: UUID, desiredVersion: number, idempotencyKey: string): Promise<UUID> {
    return this.invoke('enqueue-sheet-sync', { leadId, desiredVersion, idempotencyKey });
  }

  resolveShare(token: string): Promise<PublicRecordingInfo> {
    return this.invokePublic('public-recording', { token });
  }

  async adminSheet<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke<{ data?: T; error?: { code?: string; message?: string } }>('sheets-admin', { body });
    if (error) return repositoryFunctionError(error, 'SHEET_ADMIN_ERROR');
    if (!data) throw new RepositoryError('Sheet admin returned no response.', 'EMPTY_RESPONSE');
    if (data.error) throw new RepositoryError(data.error.message ?? 'Sheet admin request failed.', data.error.code ?? 'SHEET_ADMIN_ERROR');
    return (data.data === undefined ? data : data.data) as T;
  }

  private async invoke<T>(name: EdgeFunctionName, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke<{ data?: T; error?: { code?: string; message?: string } }>('call-api', { body: { operation: name, ...body } });
    if (error) return repositoryFunctionError(error, 'BACKEND_ERROR');
    if (!data) throw new RepositoryError(`Backend function ${name} returned no data.`, 'EMPTY_RESPONSE');
    if (data.error) throw new RepositoryError(data.error.message ?? 'Backend request failed.', data.error.code ?? 'BACKEND_ERROR');
    if (data.data === undefined) throw new RepositoryError(`Backend function ${name} returned no data.`, 'EMPTY_RESPONSE');
    return data.data;
  }

  private async invokePublic<T>(name: 'public-recording', body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke<{ data?: T; error?: { code?: string; message?: string } }>(name, { body });
    if (error) return repositoryFunctionError(error, 'BACKEND_ERROR');
    if (!data) throw new RepositoryError(`Backend function ${name} returned no data.`, 'EMPTY_RESPONSE');
    if (data.error) throw new RepositoryError(data.error.message ?? 'Backend request failed.', data.error.code ?? 'BACKEND_ERROR');
    if (data.data === undefined) throw new RepositoryError(`Backend function ${name} returned no data.`, 'EMPTY_RESPONSE');
    return data.data;
  }

  private async invokeTeam<T>(operation: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke<{ data?: T; error?: { code?: string; message?: string } }>('team-admin', { body: { operation, ...body } });
    if (error) return repositoryFunctionError(error, 'TEAM_ADMIN_ERROR');
    if (!data) throw new RepositoryError('Team admin returned no response.', 'EMPTY_RESPONSE');
    if (data.error) throw new RepositoryError(data.error.message ?? 'Team admin request failed.', data.error.code ?? 'TEAM_ADMIN_ERROR');
    if (data.data === undefined) throw new RepositoryError('Team admin returned no data.', 'EMPTY_RESPONSE');
    return data.data;
  }
}
