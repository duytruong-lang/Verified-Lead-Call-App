export type UUID = string & { readonly __brand: 'UUID' };
export type OpaqueToken = string & { readonly __brand: 'OpaqueToken' };
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };

export const CONTACT_OUTCOMES = [
  'interested',
  'unreachable',
  'callback',
  'hung_up',
  'not_interested',
  'spam',
  'wrong_number',
  'other',
] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export type LeadQueue = 'not_called' | 'in_progress' | 'callback' | 'finished';
export type RecordingState = 'uploading' | 'validating' | 'ready' | 'rejected' | 'failed';
export type ShareState = 'active' | 'revoked';
export type AttemptState = 'draft' | 'completed' | 'canceled';
export type ActorRole = 'admin' | 'staff' | 'service';
export type SyncState = 'pending' | 'running' | 'succeeded' | 'retrying' | 'blocked' | 'superseded';

export interface Actor {
  id: UUID;
  role: ActorRole;
}

export interface LeadSummary {
  id: UUID;
  displayName: string | null;
  phone: string;
  source: string | null;
  createdAt: IsoDateTime | null;
  attemptCount: number;
  queue: LeadQueue;
  claimedBy: UUID | null;
}

export interface LeadDetails extends LeadSummary {
  email: string | null;
  formAnswers: Record<string, string | null>;
  notes: string | null;
  attempts: ContactAttempt[];
  recordings: Recording[];
  handoff: HandoffVersion | null;
  evaluation: 'verified' | 'unverified' | null;
  evaluationVersion: number;
  shares: RecordingShare[];
  syncStatus: SyncStatus | null;
  legacySourceMetadata?: {
    outcome: string | null;
    evaluation: 'verified' | 'unverified' | null;
    evaluationAt: IsoDateTime | null;
    note: string | null;
    recordingLinks: string[];
  } | null;
}

export interface ContactAttempt {
  id: UUID;
  leadId: UUID;
  ordinal: number;
  state: AttemptState;
  outcome: ContactOutcome | null;
  note: string | null;
  actorId: UUID;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  idempotencyKey: string;
  claimExpiresAt: IsoDateTime;
}

export interface Recording {
  id: UUID;
  leadId: UUID;
  attemptId: UUID | null;
  state: RecordingState;
  objectKey: string | null;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  recordedAt: IsoDateTime | null;
  createdBy: UUID;
  checksum: string | null;
}

export interface RecordingShare {
  id: UUID;
  recordingId: UUID;
  state: ShareState;
  publicUrl: string;
  createdAt: IsoDateTime;
  createdBy: UUID;
  revokedAt: IsoDateTime | null;
}

export interface HandoffVersion {
  version: number;
  recordingId: UUID;
  shareId: UUID;
  changedAt: IsoDateTime;
  changedBy: UUID;
}

export interface SyncStatus {
  state: SyncState;
  desiredVersion: number;
  appliedVersion: number | null;
  lastError: string | null;
  updatedAt: IsoDateTime;
}

export interface SheetColumnRef {
  /** Stable Sheets API column metadata (for example developer metadata ID). */
  metadataId: string;
  /** Current A1 column label, for display/diagnostics only. */
  currentLabel: string;
  /** Header text is descriptive; never use it as the sole identity. */
  header: string;
}

export interface SheetFieldMapping {
  role: string;
  column: SheetColumnRef;
  required: boolean;
  direction: 'input' | 'output' | 'both';
}

export interface SheetMapping {
  spreadsheetId: string;
  tabId: number;
  tabTitle: string;
  headerRow: number;
  schemaFingerprint: string;
  fields: SheetFieldMapping[];
  validatedAt: IsoDateTime | null;
  writesEnabled: boolean;
}

export interface SheetSyncJob {
  id: UUID;
  leadId: UUID;
  desiredVersion: number;
  idempotencyKey: string;
  state: SyncState;
  attempts: number;
  nextRunAt: IsoDateTime;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: IsoDateTime | null;
  fencingToken: number;
}

export interface PublicRecordingInfo {
  recordingCode: string;
  recordedAt: IsoDateTime;
  durationSeconds: number;
  signedAudioUrl: string;
  expiresAt: IsoDateTime;
}

export interface UploadTarget {
  recordingId: UUID;
  objectKey: string;
  uploadUrl: string;
  expiresAt: IsoDateTime;
}

export interface SheetMappingValidation {
  valid: boolean;
  schemaFingerprint: string;
  errors: string[];
  ambiguousRoles: string[];
}

export interface SaveOutcomeInput {
  claimId: UUID;
  outcome: ContactOutcome;
  note?: string;
  recordingId?: UUID;
  evaluation?: { result: 'verified' | 'unverified'; recordingId?: UUID; expectedVersion: number };
  idempotencyKey: string;
}

export interface SaveOutcomeResult {
  attempt: ContactAttempt;
  attemptCount: number;
  duplicate: boolean;
  evaluationVersion: number | null;
  handoff: HandoffVersion | null;
}

export const RECORDING_LIMIT_BYTES = 50 * 1024 * 1024;
export const RECORDING_LIMIT_SECONDS = 30 * 60;
export const MAX_ATTEMPTS = 5;
export const SIGNED_URL_TTL_SECONDS = 5 * 60;
