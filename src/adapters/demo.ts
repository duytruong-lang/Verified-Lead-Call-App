import type { LeadCallRepository } from '../shared/repository';
import { RepositoryError } from '../shared/repository';
import type { LeadDetails, LeadQueue, LeadSummary, UUID } from '../shared/types';

const DEMO_ACTOR = '00000000-0000-4000-8000-000000000001' as UUID;
const LEADS: LeadDetails[] = [
  {
    id: '00000000-0000-4000-8000-000000000101' as UUID,
    displayName: 'Lead mẫu 01',
    phone: '+00-000-000-0001',
    source: 'Dữ liệu demo',
    createdAt: null,
    attemptCount: 0,
    queue: 'not_called',
    claimedBy: null,
    email: null,
    formAnswers: { nhu_cau: 'Tư vấn sản phẩm mẫu' },
    notes: null,
    attempts: [],
    recordings: [],
    handoff: null,
    evaluation: null,
    evaluationVersion: 0,
    shares: [],
    syncStatus: null,
  },
];

export class DemoRepository implements LeadCallRepository {
  async getSession() { return { actor: { id: DEMO_ACTOR, role: 'staff' as const } }; }
  async signIn() {}
  async signOut() {}

  async listLeads(queue: LeadQueue): Promise<LeadSummary[]> {
    return LEADS.filter((lead) => lead.queue === queue).map((lead) => ({
      id: lead.id, displayName: lead.displayName, phone: lead.phone, source: lead.source,
      createdAt: lead.createdAt, attemptCount: lead.attemptCount, queue: lead.queue, claimedBy: lead.claimedBy,
    }));
  }

  async getLead(leadId: UUID): Promise<LeadDetails> {
    const lead = LEADS.find((item) => item.id === leadId);
    if (!lead) throw new RepositoryError('Demo lead not found.', 'NOT_FOUND');
    return structuredClone(lead);
  }

  async claimAttempt(leadId: UUID, idempotencyKey: string): Promise<{ claimId: UUID; ordinal: number }> {
    const lead = LEADS.find((item) => item.id === leadId);
    if (!lead) throw new RepositoryError('Demo lead not found.', 'NOT_FOUND');
    if (!idempotencyKey) throw new RepositoryError('Idempotency key is required.', 'INVALID_ARGUMENT');
    return { claimId: '00000000-0000-4000-8000-000000000201' as UUID, ordinal: lead.attemptCount + 1 };
  }

  async resumeAttempt(claimId: UUID) { return { claimId, ordinal: 1, claimExpiresAt: new Date(Date.now() + 900_000).toISOString() }; }
  async cancelAttempt() {}

  async saveOutcome(): Promise<never> {
    throw new RepositoryError(`Demo outcome persistence is not implemented. Synthetic actor ${DEMO_ACTOR}.`, 'NOT_IMPLEMENTED');
  }

  async beginRecordingUpload(): Promise<never> { throw new RepositoryError('Demo audio upload is not implemented.', 'NOT_IMPLEMENTED'); }
  async completeRecordingUpload(): Promise<never> { throw new RepositoryError('Demo audio upload is not implemented.', 'NOT_IMPLEMENTED'); }
  async completeEvaluation(): Promise<never> { throw new RepositoryError('Demo evaluation is not implemented.', 'NOT_IMPLEMENTED'); }
  async createShare(): Promise<never> { throw new RepositoryError('Demo shares are not implemented.', 'NOT_IMPLEMENTED'); }
  async replaceHandoff(): Promise<never> { throw new RepositoryError('Demo handoff is not implemented.', 'NOT_IMPLEMENTED'); }
  async revokeShare() {}
  async validateSheetMapping(): Promise<never> { throw new RepositoryError('Demo Sheet mapping is not implemented.', 'NOT_IMPLEMENTED'); }
  async enqueueSheetSync(): Promise<never> { throw new RepositoryError('Demo Sheet sync is not implemented.', 'NOT_IMPLEMENTED'); }

  async resolveShare(): Promise<never> {
    throw new RepositoryError('Demo share links are not configured.', 'NOT_FOUND');
  }
}
