import { describe, expect, it, vi } from 'vitest';
import { schemaFingerprint, type SheetColumn } from './core';
import { runSheetsWorker, type SheetsWorkerPort, type SyncJob } from './worker';

const cols: SheetColumn[] = [
  { index: 0, label: 'A', header: 'Phone', metadataId: 'p' },
  { index: 1, label: 'B', header: 'App Lead ID', metadataId: 'id' },
  { index: 2, label: 'C', header: 'Attempt outcome', metadataId: 'o' },
  { index: 3, label: 'D', header: 'Attempt time', metadataId: 't' },
];
const mapping = async () => ({ spreadsheetId: 'fake', tabId: 7, tabTitle: 'Synthetic', headerRow: 1, schemaFingerprint: await schemaFingerprint(cols), fields: [
  { role: 'phone', column: { metadataId: 'p', currentLabel: 'A', header: 'Phone' }, required: true, direction: 'input' as const },
  { role: 'lead_id', column: { metadataId: 'id', currentLabel: 'B', header: 'App Lead ID' }, required: true, direction: 'both' as const },
  { role: 'outcome_1', column: { metadataId: 'o', currentLabel: 'C', header: 'Attempt outcome' }, required: false, direction: 'output' as const },
  { role: 'attempt_time_1', column: { metadataId: 't', currentLabel: 'D', header: 'Attempt time' }, required: false, direction: 'output' as const },
], validatedAt: null, writesEnabled: true });
const job: SyncJob = { id: 'job-1', leadId: '11111111-1111-4111-8111-111111111111', desiredVersion: 2, fencingToken: 9 };
async function fake(): Promise<SheetsWorkerPort> {
  const m = await mapping();
  return {
    claim: vi.fn(async () => [job]), getMapping: vi.fn(async () => m),
    discover: vi.fn(async () => ({ columns: cols, rows: [] })),
    findRowMetadata: vi.fn(async () => ({ metadataId: '905', value: job.leadId })),
    exportSnapshot: vi.fn(async () => ({ leadId: job.leadId, desiredVersion: 2, output: { outcome_1: 'callback', attempt_time_1: '2026-10-06T00:00:00Z' } })),
    isLeaseCurrent: vi.fn(async () => true), write: vi.fn(async () => undefined), mark: vi.fn(async () => undefined),
  };
}

describe('Sheets worker retry and fencing', () => {
  it('re-resolves the row by stable ID after sorting and writes output cells', async () => {
    const port = await fake();
    expect(await runSheetsWorker(port, 'worker')).toEqual({ processed: 1, blocked: 0, retried: 0 });
    expect(port.write).toHaveBeenCalledWith(expect.anything(), [
      { rowNumber: 1, columnIndex: 2, value: 'callback' }, { rowNumber: 1, columnIndex: 3, value: '2026-10-06T00:00:00Z' },
    ], '905', job.leadId, 1);
    expect(port.mark).toHaveBeenCalledWith(job, 'succeeded');
  });
  it('blocks ambiguous timeout instead of resending a possibly completed write', async () => {
    const port = await fake();
    vi.mocked(port.write).mockRejectedValueOnce(new TypeError('Network timeout without response'));
    expect(await runSheetsWorker(port, 'worker')).toEqual({ processed: 1, blocked: 1, retried: 0 });
    expect(port.mark).toHaveBeenCalledWith(job, 'blocked', 'Network timeout without response');
  });
  it('retries bounded-status failures and blocks stale fencing tokens', async () => {
    const port = await fake();
    vi.mocked(port.write).mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }));
    expect(await runSheetsWorker(port, 'worker')).toEqual({ processed: 1, blocked: 0, retried: 1 });
    const stale = await fake(); vi.mocked(stale.isLeaseCurrent).mockResolvedValueOnce(false);
    expect(await runSheetsWorker(stale, 'worker')).toEqual({ processed: 1, blocked: 1, retried: 0 });
    expect(stale.write).not.toHaveBeenCalled();
  });
  it('blocks server errors whose write completion is uncertain', async () => {
    for (const status of [408, 503]) {
      const port = await fake();
      vi.mocked(port.write).mockRejectedValueOnce(Object.assign(new Error(`write ${status}`), { status }));
      expect(await runSheetsWorker(port, 'worker')).toEqual({ processed: 1, blocked: 1, retried: 0 });
      expect(port.mark).toHaveBeenCalledWith(job, 'blocked', `write ${status}`);
    }
  });
  it('retries transient read failures before entering the write phase', async () => {
    for (const status of [429, 503]) {
      const port = await fake();
      vi.mocked(port.discover).mockRejectedValueOnce(Object.assign(new Error(`read ${status}`), { status }));
      expect(await runSheetsWorker(port, 'worker')).toEqual({ processed: 1, blocked: 0, retried: 1 });
      expect(port.write).not.toHaveBeenCalled();
      expect(port.mark).toHaveBeenCalledWith(job, 'retrying', `read ${status}`);
    }
  });
  it('blocks duplicate IDs, missing IDs, and stale exports', async () => {
    const dup = await fake(); vi.mocked(dup.findRowMetadata).mockRejectedValueOnce(new Error('Duplicate row developer metadata'));
    expect((await runSheetsWorker(dup, 'worker')).blocked).toBe(1);
    const stale = await fake(); vi.mocked(stale.exportSnapshot).mockResolvedValueOnce({ leadId: job.leadId, desiredVersion: 1, output: {} });
    expect((await runSheetsWorker(stale, 'worker')).blocked).toBe(1);
    expect(stale.write).not.toHaveBeenCalled();
  });
});
