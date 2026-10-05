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
