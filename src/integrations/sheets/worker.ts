import type { SheetMapping } from '../../shared/types.ts';
import { mappedOutputCells, resolveMapping, schemaFingerprint, type SheetColumn, type SheetRow } from './core.ts';

export interface SyncJob { id: string; leadId: string; desiredVersion: number; fencingToken: number; }
export interface ExportSnapshot { leadId: string; desiredVersion: number; output: Record<string, string | number | null>; }
export interface SheetsWorkerPort {
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<SyncJob[]>;
  getMapping(): Promise<SheetMapping | null>;
  discover(mapping: SheetMapping, dataStartRow?: number, maxDataRows?: number): Promise<{ columns: SheetColumn[]; rows: SheetRow[]; timeZone?: string }>;
  findRowMetadata(mapping: SheetMapping, leadId: string): Promise<{ metadataId: string; value: string } | null>;
  exportSnapshot(leadId: string, timeZone?: string): Promise<ExportSnapshot>;
  isLeaseCurrent(job: SyncJob): Promise<boolean>;
  write(mapping: SheetMapping, cells: ReturnType<typeof mappedOutputCells>, rowMetadataId: string, expectedLeadId: string, idColumnIndex: number): Promise<void>;
  mark(job: SyncJob, state: 'succeeded' | 'retrying' | 'blocked', error?: string): Promise<void>;
}

function retryable(error: unknown, writeStarted: boolean): boolean {
  const status = (error as { status?: number } | null)?.status;
  // Sheets rejects 429 before applying a write. Timeouts/5xx are safe to retry only
  // before the write call; after it starts, completion is uncertain and needs readback.
  return status === 429 || (!writeStarted && (status === undefined || status === 408 || status >= 500));
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'Unknown Google Sheets error'; }

/** Processes jobs serially. A timeout without an HTTP response is ambiguous and must be reconciled. */
export async function runSheetsWorker(port: SheetsWorkerPort, workerId: string, limit = 20): Promise<{ processed: number; blocked: number; retried: number }> {
  const jobs = await port.claim(workerId, limit, 60);
  let blocked = 0; let retried = 0;
  let mapping: SheetMapping | null = null;
  let discovered: Awaited<ReturnType<SheetsWorkerPort['discover']>> | null = null;
  let resolution: ReturnType<typeof resolveMapping> | null = null;
  let preflightError: unknown;
  try {
    mapping = await port.getMapping();
    discovered = mapping?.writesEnabled ? await port.discover(mapping, mapping.headerRow + 1, 0) : null;
    const fingerprint = discovered ? await schemaFingerprint(discovered.columns) : '';
    resolution = mapping && discovered ? resolveMapping(mapping, discovered.columns, fingerprint) : null;
  } catch (error) { preflightError = error; }
  for (const job of jobs) {
    let writeStarted = false;
    try {
      if (preflightError) throw preflightError;
      if (!mapping?.writesEnabled) throw new PermanentSyncError('No enabled Sheet mapping.');
      if (!discovered || !resolution?.valid) throw new PermanentSyncError(resolution?.errors.join(' ') || 'Could not inspect mapped Sheet.');
      const idColumn = resolution.byRole.get('lead_id');
      if (!idColumn) throw new PermanentSyncError('Stable lead ID mapping is missing.');
      let metadata: Awaited<ReturnType<SheetsWorkerPort['findRowMetadata']>>;
      try { metadata = await port.findRowMetadata(mapping, job.leadId); }
      catch (error) {
        const detail = message(error);
        if (/duplicate row developer metadata|malformed or belongs to another tab/i.test(detail)) throw new PermanentSyncError(detail);
        throw error;
      }
      if (!metadata) throw new PermanentSyncError(`Lead UUID ${job.leadId} was not found; reconcile row identity.`);
      if (metadata.value !== job.leadId) throw new PermanentSyncError('Stable row developer metadata does not match the app lead UUID.');
      const snapshot = await port.exportSnapshot(job.leadId, discovered.timeZone);
      const currentCells = mappedOutputCells(1, resolution, snapshot.output);
      if (!(await port.isLeaseCurrent(job))) throw new PermanentSyncError('Sync lease or fencing token is no longer current.');
      if (snapshot.desiredVersion < job.desiredVersion) throw new PermanentSyncError('Export snapshot is older than the claimed job.');
      if (currentCells.length) { writeStarted = true; await port.write(mapping, currentCells, metadata.metadataId, job.leadId, idColumn.index); }
      await port.mark(job, 'succeeded');
    } catch (error) {
      const kind = error instanceof PermanentSyncError || message(error).includes('sheet_identity_conflict_blocked') ? 'blocked' : retryable(error, writeStarted) ? 'retrying' : 'blocked';
      if (kind === 'blocked') blocked++; else retried++;
      await port.mark(job, kind, message(error));
    }
  }
  return { processed: jobs.length, blocked, retried };
}

export class PermanentSyncError extends Error { constructor(message: string) { super(message); this.name = 'PermanentSyncError'; } }
