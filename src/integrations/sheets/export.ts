import type { ContactOutcome } from '../../shared/types';

export interface SheetAttemptSnapshot { ordinal: number; outcome: ContactOutcome | null; note?: string | null; completedAt: string | null; }
export interface SheetExportSnapshot {
  leadId: string; phone: string; displayName: string | null; source: string | null; createdAt: string | null; email: string | null;
  formAnswers: Record<string, string | null>; attemptCount: number; evaluation: 'verified' | 'unverified' | null; evaluationVersion: number; evaluationAt?: string | null; evaluationNote?: string | null;
  desiredVersion: number; attempts: SheetAttemptSnapshot[];
  handoff: { version: number; recordingId: string; shareId: string; shareTokenCiphertext: string; shareState: 'active' | 'revoked'; recordingCode: string } | null;
}

const SHEET_OUTCOME_LABELS: Record<ContactOutcome, string> = {
  interested: 'Có quan tâm', unreachable: 'Thuê bao/máy bận', callback: 'Gọi lại sau', hung_up: 'Cúp máy ngang',
  not_interested: 'Không có nhu cầu', spam: 'Spam/Phá máy', wrong_number: 'Sai Số', other: 'Khác (fill bên cột M)',
};

export function sheetsDateSerial(value: string | null, timeZone = 'Asia/Ho_Chi_Minh'): number | null {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid app timestamp for Sheet export: ${value}`);
  const fields = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: string) => Number(fields.find(field => field.type === type)?.value);
  const wallClock = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (wallClock - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export function buildOutput(snapshot: SheetExportSnapshot, activeRecordingUrl: string | null, timeZone = 'Asia/Ho_Chi_Minh'): Record<string, string | number | null> {
  if (snapshot.evaluation === 'verified' && (!snapshot.handoff || snapshot.handoff.shareState !== 'active' || !activeRecordingUrl)) {
    throw new Error('Verified output has no active playable share link; reconcile the handoff before syncing.');
  }
  const output: Record<string, string | number | null> = {
    lead_id: snapshot.leadId, evaluation: snapshot.evaluation === 'verified' ? 'Verified' : snapshot.evaluation === 'unverified' ? 'Unverified' : '', evaluation_time: sheetsDateSerial(snapshot.evaluationAt ?? null, timeZone),
    evaluation_note: snapshot.evaluationNote ?? [...snapshot.attempts].sort((a, b) => b.ordinal - a.ordinal).find(attempt => attempt.note)?.note ?? null, recording_link: snapshot.evaluation === 'verified' ? activeRecordingUrl : '',
  };
  for (let i = 1; i <= 5; i++) {
    const attempt = snapshot.attempts.find(item => item.ordinal === i);
    output[`outcome_${i}`] = attempt?.outcome ? SHEET_OUTCOME_LABELS[attempt.outcome] : '';
    output[`attempt_time_${i}`] = sheetsDateSerial(attempt?.completedAt ?? null, timeZone);
  }
  return output;
}

export function stableRecordingUrl(baseUrl: string, token: string): string {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Public app base URL must use HTTP or HTTPS.');
  return new URL(`/r/${encodeURIComponent(token)}`, base).toString();
}
