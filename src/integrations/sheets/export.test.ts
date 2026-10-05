import { describe, expect, it } from 'vitest';
import { buildOutput, sheetsDateSerial, stableRecordingUrl, type SheetExportSnapshot } from './export';

const snapshot: SheetExportSnapshot = {
  leadId: '11111111-1111-4111-8111-111111111111', phone: '+84900000001', displayName: 'Synthetic', source: 'fixture', createdAt: null, email: null,
  formAnswers: {}, attemptCount: 1, evaluation: 'verified', evaluationVersion: 4, desiredVersion: 6,
  attempts: [{ ordinal: 1, outcome: 'interested', note: 'Synthetic latest attempt note', completedAt: '2026-10-06T00:00:00+07:00' }],
  handoff: { version: 1, recordingId: 'rec', shareId: 'share', shareTokenCiphertext: 'ciphertext', shareState: 'active', recordingCode: 'ABC123' },
};

describe('Sheets export safety', () => {
  it('exports only the stable app listen URL and per-attempt outcomes', () => {
    const output = buildOutput(snapshot, 'https://calls.example/r/stable-token');
    expect(output.recording_link).toBe('https://calls.example/r/stable-token');
    expect(output.outcome_1).toBe('Có quan tâm');
    expect(output.evaluation).toBe('Verified');
    expect(output.evaluation_note).toBe('Synthetic latest attempt note');
    expect(output.attempt_time_1).toBeCloseTo(46301, 8);
    expect(output.recording_link).not.toContain('signed');
  });
  it('blocks verified export if share is revoked, absent, or has no stable URL', () => {
    expect(() => buildOutput({ ...snapshot, handoff: { ...snapshot.handoff!, shareState: 'revoked' } }, null)).toThrow('active playable share link');
    expect(() => buildOutput({ ...snapshot, handoff: null }, null)).toThrow('active playable share link');
  });
  it('writes all canonical Vietnamese outcomes, preserves Sheet datetime values, and clears a withdrawn handoff', () => {
    const outcomes = [
      ['interested', 'Có quan tâm'], ['unreachable', 'Thuê bao/máy bận'], ['callback', 'Gọi lại sau'], ['hung_up', 'Cúp máy ngang'],
      ['not_interested', 'Không có nhu cầu'], ['spam', 'Spam/Phá máy'], ['wrong_number', 'Sai Số'], ['other', 'Khác (fill bên cột M)'],
    ] as const;
    for (const [value, label] of outcomes) {
      const output = buildOutput({ ...snapshot, attempts: [{ ordinal: 1, outcome: value, completedAt: null }] }, 'https://calls.example/r/token');
      expect(output.outcome_1).toBe(label);
    }
    const unverified = buildOutput({ ...snapshot, evaluation: 'unverified' }, null);
    expect(unverified.evaluation).toBe('Unverified');
    expect(unverified.recording_link).toBe('');
    expect(sheetsDateSerial('2026-10-05T17:00:00Z')).toBeCloseTo(46301.0, 8);
  });
  it('constructs a stable public route from a configured app origin', () => {
    expect(stableRecordingUrl('https://calls.example/app', 'safe-token')).toBe('https://calls.example/r/safe-token');
    expect(() => stableRecordingUrl('javascript:alert(1)', 'token')).toThrow('HTTP or HTTPS');
  });
});
