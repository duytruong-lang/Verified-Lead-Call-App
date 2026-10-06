import type {
  LeadDetails,
  LeadQueue,
  LeadSummary,
  PublicRecordingInfo,
  SaveOutcomeInput,
  SaveOutcomeResult,
  UUID,
} from './types';

export interface LeadCallRepository {
  listLeads(queue: LeadQueue, cursor?: string): Promise<LeadSummary[]>;
  getLead(leadId: UUID): Promise<LeadDetails>;
  getSession(): Promise<{ actor: import('./types').Actor | null }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(listener: () => void): () => void;
  acceptAuthLink(tokenHash: string, type: 'invite' | 'recovery'): Promise<void>;
  completeOnboarding(password: string): Promise<void>;
  listMembers(): Promise<import('./types').TeamMember[]>;
  inviteMember(input: { email: string; role: import('./types').MemberRole; idempotencyKey: string }): Promise<import('./types').MemberLink>;
  issueMemberLink(input: { memberId: UUID; kind: 'invite' | 'recovery'; idempotencyKey: string }): Promise<import('./types').MemberLink>;
  setMemberRole(input: { memberId: UUID; role: import('./types').MemberRole; expectedVersion: number; idempotencyKey: string }): Promise<import('./types').TeamMember>;
  setMemberStatus(input: { memberId: UUID; status: 'active' | 'disabled'; expectedVersion: number; idempotencyKey: string }): Promise<import('./types').TeamMember>;
  claimAttempt(leadId: UUID, idempotencyKey: string): Promise<{ claimId: UUID; ordinal: number }>;
  resumeAttempt(claimId: UUID): Promise<{ claimId: UUID; ordinal: number; claimExpiresAt: string }>;
  cancelAttempt(claimId: UUID, idempotencyKey: string): Promise<void>;
  saveOutcome(input: SaveOutcomeInput): Promise<SaveOutcomeResult>;
  beginRecordingUpload(input: { leadId: UUID; claimId: UUID; filename: string; contentType: string; sizeBytes: number; idempotencyKey: string }): Promise<import('./types').UploadTarget>;
  completeRecordingUpload(input: { recordingId: UUID; sizeBytes: number; durationSeconds: number; checksum?: string }): Promise<import('./types').Recording>;
  completeEvaluation(input: { leadId: UUID; result: 'verified' | 'unverified'; recordingId?: UUID; expectedVersion: number; idempotencyKey: string }): Promise<{ version: number }>;
  createShare(recordingId: UUID, idempotencyKey: string): Promise<{ shareId: UUID; publicUrl: string }>;
  replaceHandoff(input: { leadId: UUID; recordingId: UUID; expectedVersion: number; idempotencyKey: string }): Promise<{ version: number; shareId: UUID }>;
  revokeShare(shareId: UUID, idempotencyKey: string): Promise<void>;
  resolveShare(token: string): Promise<PublicRecordingInfo>;
  validateSheetMapping(mapping: import('./types').SheetMapping): Promise<import('./types').SheetMappingValidation>;
  enqueueSheetSync(leadId: UUID, desiredVersion: number, idempotencyKey: string): Promise<UUID>;
}

export class RepositoryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}
