import type { LeadCallRepository } from '../shared/repository';
import { RepositoryError } from '../shared/repository';
import type { ContactAttempt, LeadDetails, LeadQueue, LeadSummary, Recording, RecordingShare, SaveOutcomeResult, UploadTarget, UUID } from '../shared/types';

const ACTOR = '00000000-0000-4000-8000-000000000001' as UUID;
const DB_KEY = 'verified-call-demo-v1';
const AUDIO_DB = 'verified-call-demo-audio-v1';
type State = { leads: LeadDetails[]; tokens: Record<string, { leadId: UUID; recordingId: UUID }>; saves: Record<string, SaveOutcomeResult>; sharesByKey: Record<string, { shareId: UUID; publicUrl: string }>; replacementsByKey: Record<string, { version: number; shareId: UUID }>; uploadTargets: Record<string, UploadTarget> };
const seed: LeadDetails[] = [
  ['101', 'Nguyễn Minh Anh', '+00-000-000-0001', 'Facebook Lead Ads', { nhu_cau: 'Tư vấn gói chăm sóc da', khu_vuc: 'Quận 3, TP. Hồ Chí Minh', khung_gio: 'Buổi chiều' }],
  ['102', 'Trần Quốc Bảo', '+00-000-000-0002', 'Website', { nhu_cau: 'Tìm hiểu khóa học tiếng Anh', khu_vuc: 'Bình Thạnh', khung_gio: 'Sau 18:00' }],
  ['103', 'Lê Thu Hà', '+00-000-000-0003', 'Facebook Lead Ads', { nhu_cau: 'Đăng ký nhận tư vấn', khu_vuc: 'Thủ Đức', khung_gio: 'Buổi sáng' }],
  ['104', 'Phạm Hoàng Nam', '+00-000-000-0004', 'Landing page', { nhu_cau: 'Tư vấn căn hộ 2 phòng ngủ', khu_vuc: 'TP. Hồ Chí Minh', khung_gio: 'Cuối tuần' }],
  ['105', 'Võ Ngọc Linh', '+00-000-000-0005', 'Website', { nhu_cau: 'Nhận báo giá dịch vụ', khu_vuc: 'Quận 7', khung_gio: 'Buổi chiều' }],
].map(([n, name, phone, source, answers]) => ({
  id: `00000000-0000-4000-8000-000000000${n}` as UUID, displayName: name as string, phone: phone as string, source: source as string,
  createdAt: new Date(Date.now() - Number(n) * 86_400_000).toISOString() as never, attemptCount: 0, queue: 'not_called' as LeadQueue,
  claimedBy: null, email: null, formAnswers: answers as Record<string, string>, notes: null, attempts: [], recordings: [], handoff: null,
  evaluation: null, evaluationVersion: 0, shares: [], syncStatus: null,
}));

function readState(): State {
  try { const raw = localStorage.getItem(DB_KEY); if (raw) return JSON.parse(raw) as State; } catch { /* reset malformed local demo state */ }
  return { leads: structuredClone(seed), tokens: {}, saves: {}, sharesByKey: {}, replacementsByKey: {}, uploadTargets: {} };
}
const saved = readState();
const state: State = { ...saved, saves: saved.saves ?? {}, sharesByKey: saved.sharesByKey ?? {}, replacementsByKey: saved.replacementsByKey ?? {}, uploadTargets: saved.uploadTargets ?? {} };
function persist() { localStorage.setItem(DB_KEY, JSON.stringify(state)); }
function consumeDemoFault(name: 'create-share-once' | 'save-lost-reply-once') {
  if (localStorage.getItem(`verified-call-e2e-fault:${name}`) !== 'once') return false;
  localStorage.removeItem(`verified-call-e2e-fault:${name}`); return true;
}
function addDemoLeadForE2EIfRequested() {
  if (localStorage.getItem('verified-call-e2e-add-lead-on-list') !== 'once') return;
  localStorage.removeItem('verified-call-e2e-add-lead-on-list');
  const lead = structuredClone(seed[0]); lead.id = '00000000-0000-4000-8000-000000000199' as UUID;
  lead.displayName = 'Lead mới đồng bộ'; lead.phone = '+00-000-000-0199'; lead.source = 'Demo refresh'; lead.createdAt = iso();
  state.leads.push(lead); persist();
}
function id() { return crypto.randomUUID() as UUID; }
function iso() { return new Date().toISOString() as never; }
function summary(lead: LeadDetails): LeadSummary { const { id, displayName, phone, source, createdAt, attemptCount, queue, claimedBy } = lead; return { id, displayName, phone, source, createdAt, attemptCount, queue, claimedBy }; }
function audioDb(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const req = indexedDB.open(AUDIO_DB, 1); req.onupgradeneeded = () => req.result.createObjectStore('audio'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }

export class DemoRepository implements LeadCallRepository {
  async getSession() { return { actor: { id: ACTOR, role: 'admin' as const } }; }
  async signIn() {}
  async signOut() {}
  async listLeads(queue: LeadQueue) { addDemoLeadForE2EIfRequested(); return state.leads.filter((lead) => lead.queue === queue).map(summary); }
  async getLead(leadId: UUID) { const lead = state.leads.find((x) => x.id === leadId); if (!lead) throw new RepositoryError('Không tìm thấy lead demo.', 'NOT_FOUND'); return structuredClone(lead); }
  async claimAttempt(leadId: UUID, idempotencyKey: string) {
    const lead = state.leads.find((x) => x.id === leadId); if (!lead) throw new RepositoryError('Không tìm thấy lead.', 'NOT_FOUND');
    if (lead.attemptCount >= 5) throw new RepositoryError('Lead đã đạt giới hạn 5 lượt gọi.', 'ATTEMPT_LIMIT');
    const active = lead.attempts.find((a) => a.state === 'draft'); if (active) return { claimId: active.id, ordinal: active.ordinal };
    const attempt: ContactAttempt = { id: id(), leadId, ordinal: lead.attemptCount + 1, state: 'draft', outcome: null, note: null, actorId: ACTOR, startedAt: iso(), completedAt: null, idempotencyKey, claimExpiresAt: new Date(Date.now() + 900_000).toISOString() as never };
    lead.attempts.push(attempt); lead.claimedBy = ACTOR; lead.queue = 'in_progress'; persist(); return { claimId: attempt.id, ordinal: attempt.ordinal };
  }
  async resumeAttempt(claimId: UUID) { const a = this.findAttempt(claimId); a.claimExpiresAt = new Date(Date.now() + 900_000).toISOString() as never; persist(); return { claimId, ordinal: a.ordinal, claimExpiresAt: a.claimExpiresAt }; }
  async cancelAttempt(claimId: UUID) { const a = this.findAttempt(claimId); a.state = 'canceled'; const lead = state.leads.find((x) => x.id === a.leadId)!; lead.claimedBy = null; lead.queue = lead.attemptCount ? (a.outcome === 'callback' ? 'callback' : 'finished') : 'not_called'; persist(); }
  async uploadRecordingBlob(input: { recordingId: UUID; blob: Blob }) { const db = await audioDb(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put(input.blob, input.recordingId); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  async getRecordingBlob(recordingId: UUID) { const db = await audioDb(); return new Promise<Blob | undefined>((resolve, reject) => { const req = db.transaction('audio').objectStore('audio').get(recordingId); req.onsuccess = () => resolve(req.result as Blob | undefined); req.onerror = () => reject(req.error); }); }
  async beginRecordingUpload(input: { leadId: UUID; claimId: UUID; filename: string; contentType: string; sizeBytes: number; idempotencyKey: string }) {
    const replay = state.uploadTargets[input.idempotencyKey]; if (replay) return structuredClone(replay);
    const a = this.findAttempt(input.claimId); if (a.leadId !== input.leadId || a.state !== 'draft') throw new RepositoryError('Lượt gọi không còn hiệu lực.', 'CLAIM_CONFLICT');
    const recording: Recording = { id: id(), leadId: input.leadId, attemptId: input.claimId, state: 'uploading', objectKey: input.filename, contentType: input.contentType, sizeBytes: input.sizeBytes, durationSeconds: null, recordedAt: iso(), createdBy: ACTOR, checksum: null };
    state.leads.find((x) => x.id === input.leadId)!.recordings.push(recording); const target: UploadTarget = { recordingId: recording.id, objectKey: recording.id, uploadUrl: `demo://${recording.id}`, expiresAt: new Date(Date.now() + 900_000).toISOString() as never }; state.uploadTargets[input.idempotencyKey] = target; persist(); return target;
  }
  async completeRecordingUpload(input: { recordingId: UUID; sizeBytes: number; durationSeconds: number }) {
    for (const lead of state.leads) { const recording = lead.recordings.find((x) => x.id === input.recordingId); if (recording) { recording.sizeBytes = input.sizeBytes; recording.durationSeconds = input.durationSeconds; recording.state = 'ready'; persist(); return structuredClone(recording); } }
    throw new RepositoryError('Không tìm thấy bản ghi âm.', 'NOT_FOUND');
  }
  async saveOutcome(input: import('../shared/types').SaveOutcomeInput) {
    const replay = state.saves[input.idempotencyKey]; if (replay) return { ...structuredClone(replay), duplicate: true };
    const a = this.findAttempt(input.claimId); const lead = state.leads.find((x) => x.id === a.leadId)!;
    if (a.state !== 'draft') throw new RepositoryError('Lượt gọi đã được hoàn tất.', 'ATTEMPT_CONFLICT');
    if (input.outcome === 'other' && !input.note?.trim()) throw new RepositoryError('Vui lòng nhập ghi chú cho kết quả Khác.', 'OTHER_NOTE_REQUIRED');
    if (input.recordingId && !lead.recordings.some((r) => r.id === input.recordingId && r.state === 'ready')) throw new RepositoryError('Bản ghi âm chưa sẵn sàng.', 'READY_RECORDING_REQUIRED');
    let share: RecordingShare | undefined;
    if (input.evaluation) {
      if (input.evaluation.expectedVersion !== lead.evaluationVersion) throw new RepositoryError('Đánh giá đã được cập nhật ở nơi khác.', 'VERSION_CONFLICT');
      if (input.evaluation.result === 'verified') { share = lead.shares.find((s) => s.recordingId === input.evaluation?.recordingId && s.state === 'active'); if (!share) throw new RepositoryError('Cần liên kết chia sẻ đang hoạt động cho bản ghi âm.', 'SHARE_REQUIRED'); }
    }
    a.outcome = input.outcome; a.note = input.note?.trim() ?? null; a.completedAt = iso(); a.state = 'completed'; a.idempotencyKey = input.idempotencyKey; lead.attemptCount += 1; lead.claimedBy = null;
    lead.queue = input.outcome === 'callback' ? 'callback' : 'finished';
    let handoff = lead.handoff;
    if (input.evaluation) {
      lead.evaluation = input.evaluation.result; lead.evaluationVersion += 1;
      if (share) { handoff = { version: (lead.handoff?.version ?? 0) + 1, recordingId: share.recordingId, shareId: share.id, changedAt: iso(), changedBy: ACTOR }; lead.handoff = handoff; }
    }
    const result: SaveOutcomeResult = { attempt: structuredClone(a), attemptCount: lead.attemptCount, duplicate: false, evaluationVersion: input.evaluation ? lead.evaluationVersion : null, handoff: structuredClone(handoff) };
    state.saves[input.idempotencyKey] = structuredClone(result); persist();
    if (consumeDemoFault('save-lost-reply-once')) throw new Error('Demo fault: response lost after the save committed.');
    return result;
  }
  async completeEvaluation(input: { leadId: UUID; result: 'verified' | 'unverified'; recordingId?: UUID; expectedVersion: number }) {
    const lead = state.leads.find((x) => x.id === input.leadId)!; if (input.expectedVersion !== lead.evaluationVersion) throw new RepositoryError('Đánh giá đã thay đổi. Tải lại lead.', 'VERSION_CONFLICT');
    if (input.result === 'verified') { const share = lead.shares.find((s) => s.recordingId === input.recordingId && s.state === 'active'); if (!share) throw new RepositoryError('Bản ghi âm cần có link chia sẻ đang hoạt động.', 'SHARE_REQUIRED'); lead.handoff = { version: lead.evaluationVersion + 1, recordingId: share.recordingId, shareId: share.id, changedAt: iso(), changedBy: ACTOR }; }
    lead.evaluation = input.result; lead.evaluationVersion += 1; persist(); return { version: lead.evaluationVersion };
  }
  async createShare(recordingId: UUID, idempotencyKey: string) { const replay = state.sharesByKey[idempotencyKey]; if (replay) return structuredClone(replay); if (consumeDemoFault('create-share-once')) throw new Error('Demo fault: share creation unavailable.'); const lead = state.leads.find((x) => x.recordings.some((r) => r.id === recordingId && r.state === 'ready')); if (!lead) throw new RepositoryError('Bản ghi âm chưa sẵn sàng.', 'READY_RECORDING_REQUIRED'); const token = crypto.randomUUID().replaceAll('-', ''); const share: RecordingShare = { id: id(), recordingId, state: 'active', publicUrl: `${location.origin}/r/${token}`, createdAt: iso(), createdBy: ACTOR, revokedAt: null }; lead.shares.push(share); state.tokens[token] = { leadId: lead.id, recordingId }; const result = { shareId: share.id, publicUrl: share.publicUrl }; state.sharesByKey[idempotencyKey] = result; persist(); return result; }
  async replaceHandoff(input: { leadId: UUID; recordingId: UUID; expectedVersion: number; idempotencyKey: string }) { const replay = state.replacementsByKey[input.idempotencyKey]; if (replay) return structuredClone(replay); const lead = state.leads.find((x) => x.id === input.leadId)!; if (input.expectedVersion !== (lead.handoff?.version ?? 0)) throw new RepositoryError('Link bàn giao đã thay đổi. Tải lại lead.', 'VERSION_CONFLICT'); const share = await this.createShare(input.recordingId, input.idempotencyKey); const updated = lead.shares.find((x) => x.id === share.shareId)!; const version = (lead.handoff?.version ?? 0) + 1; lead.handoff = { version, recordingId: input.recordingId, shareId: updated.id, changedAt: iso(), changedBy: ACTOR }; lead.evaluation = 'verified'; lead.evaluationVersion += 1; const result = { version, shareId: updated.id }; state.replacementsByKey[input.idempotencyKey] = result; persist(); return result; }
  async revokeShare(shareId: UUID) { for (const lead of state.leads) { const share = lead.shares.find((s) => s.id === shareId); if (share) { share.state = 'revoked'; share.revokedAt = iso(); persist(); return; } } }
  async resolveShare(token: string) { const ref = state.tokens[token]; if (!ref) throw new RepositoryError('Link không hợp lệ hoặc đã bị thu hồi.', 'NOT_FOUND'); const lead = state.leads.find((x) => x.id === ref.leadId)!; const share = lead.shares.find((x) => x.recordingId === ref.recordingId && x.publicUrl.endsWith(token)); const recording = lead.recordings.find((x) => x.id === ref.recordingId)!; if (!share || share.state !== 'active') throw new RepositoryError('Link đã bị thu hồi.', 'SHARE_REVOKED'); return { recordingCode: `REC-${recording.id.slice(-6).toUpperCase()}`, recordedAt: recording.recordedAt!, durationSeconds: recording.durationSeconds!, signedAudioUrl: URL.createObjectURL((await this.getRecordingBlob(recording.id))!), expiresAt: new Date(Date.now() + 300_000).toISOString() as never }; }
  async validateSheetMapping(mapping: import('../shared/types').SheetMapping) { return { valid: false, schemaFingerprint: mapping.schemaFingerprint, errors: ['Demo chỉ lưu cấu hình cục bộ; cần Supabase để kiểm tra Google Sheet.'], ambiguousRoles: [] }; }
  async enqueueSheetSync() { return id(); }
  private findAttempt(claimId: UUID) { for (const lead of state.leads) { const a = lead.attempts.find((x) => x.id === claimId); if (a) return a; } throw new RepositoryError('Không tìm thấy lượt gọi.', 'NOT_FOUND'); }
}
