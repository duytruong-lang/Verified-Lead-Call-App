import { runSheetsWorker, type SheetsWorkerPort, type SyncJob } from '../../../src/integrations/sheets/worker.ts';
import { duplicateStableIds, importPageStarts, importRow, resolveMapping, schemaFingerprint, SHEETS_IMPORT_PAGE_SIZE, SHEETS_NEW_ID_BUDGET, SHEETS_OUTBOX_LIMIT } from '../../../src/integrations/sheets/core.ts';
import type { SheetMapping } from '../../../src/shared/types.ts';
import { buildOutput, stableRecordingUrl, type SheetExportSnapshot } from '../../../src/integrations/sheets/export.ts';
import { decryptShareToken } from '../_shared/crypto.ts';
import { json, serviceClient, serviceKey, sheetsClient } from '../_shared/sheets-auth.ts';

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || token !== serviceKey) return json({ error: 'Service authorization required.' }, 401);
  const workerId = `sheets-${crypto.randomUUID()}`;
  const inbound = { imported: 0, skipped: 0, conflicts: 0 };
  let hasLease = false;
  let googleClient: Awaited<ReturnType<typeof sheetsClient>> | null = null;
  const getGoogle = async () => googleClient ??= await sheetsClient();
  try {
    const { data: acquired, error: leaseError } = await serviceClient.rpc('sheets_claim_worker', { worker_id: workerId, lease_seconds: 120 });
    if (leaseError) throw new Error(`Worker lease failed: ${leaseError.message}`);
    hasLease = Boolean(acquired);
    if (!hasLease) return json({ ...inbound, processed: 0, blocked: 0, retried: 0, skipped: true, reason: 'another worker holds the single-sheet lease' });
    const { data: savedMapping, error: mappingError } = await serviceClient.from('sheet_mappings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (mappingError) throw new Error(`Mapping read failed: ${mappingError.message}`);
    if (savedMapping) {
      const mapping: SheetMapping = { spreadsheetId: savedMapping.spreadsheet_id, tabId: Number(savedMapping.tab_id), tabTitle: savedMapping.tab_title, headerRow: savedMapping.header_row, schemaFingerprint: savedMapping.schema_fingerprint, fields: savedMapping.fields, validatedAt: savedMapping.validated_at, writesEnabled: savedMapping.writes_enabled };
      const google = await getGoogle();
      const { data: cursorResult, error: cursorError } = await serviceClient.rpc('sheets_get_import_cursor', { mapping_id: savedMapping.id });
      if (cursorError) throw new Error(`Import cursor read failed: ${cursorError.message}`);
      const cursor = typeof cursorResult?.cursor === 'string' ? cursorResult.cursor : null;
      const initial = await google.discover(mapping.spreadsheetId, mapping.tabId, mapping.headerRow, mapping.headerRow + 1, 0);
      const { columns, locale, timeZone } = initial;
      const fingerprint = await schemaFingerprint(columns);
      const resolution = resolveMapping(mapping, columns, fingerprint);
      if (!mapping.writesEnabled || !resolution.valid) throw new Error(`Sheet import is disabled until mapping is revalidated: ${resolution.errors.join(' ')}`);
      const phoneColumn = resolution.byRole.get('phone');
      const idColumn = resolution.byRole.get('lead_id');
      if (!phoneColumn || !idColumn) throw new Error('Required stable ID or phone mapping is missing.');
      const identity = await google.readIdentityColumns(mapping.spreadsheetId, initial.tabTitle, mapping.headerRow, phoneColumn.index, idColumn.index);
      const duplicateIds = duplicateStableIds(identity.ids);
      for (const id of duplicateIds) {
        if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) await serviceClient.rpc('sheets_record_conflict', { lead_id: id, conflict: { kind: 'duplicate_sheet_lead_uuid', source: 'google_sheet' } });
        inbound.conflicts++;
      }
      const { backgroundStart, tailStart } = importPageStarts(mapping.headerRow, cursor, identity.lastPhoneRow);
      const { rows: backgroundRows } = await google.discover(mapping.spreadsheetId, mapping.tabId, mapping.headerRow, backgroundStart, SHEETS_IMPORT_PAGE_SIZE);
      const { rows: tailRows } = await google.discover(mapping.spreadsheetId, mapping.tabId, mapping.headerRow, tailStart, SHEETS_IMPORT_PAGE_SIZE);
      const discovered = { columns, rows: [...tailRows, ...backgroundRows].filter((row, index, all) => all.findIndex(other => other.rowNumber === row.rowNumber) === index), locale, timeZone };
      const newTailRows = tailRows.filter(row => {
        const id = row.values[idColumn.index]?.trim() ?? '';
        return row.rowMetadataConflict || !id || !row.rowMetadataId || row.rowMetadataValue !== id;
      }).slice(0, SHEETS_NEW_ID_BUDGET);
      const selectedRows = [...newTailRows, ...backgroundRows].filter((row, index, all) => all.findIndex(other => other.rowNumber === row.rowNumber) === index);
      const discoveredRows = { ...discovered, rows: selectedRows };
      const missingRowHashes = new Map<string, number>();
      for (const row of discoveredRows.rows) {
        const id = row.values[idColumn.index]?.trim() ?? '';
        if (!id && row.values[phoneColumn.index]?.trim()) {
          const hash = JSON.stringify(row.values.map((v, i) => i === idColumn.index ? '' : v));
          missingRowHashes.set(hash, (missingRowHashes.get(hash) ?? 0) + 1);
        }
      }
      const nextCursor = backgroundRows.length ? String(backgroundRows[backgroundRows.length - 1].rowNumber + 1) : null;
      let provisionedCount = 0;
      let importBatchComplete = true;
      for (const sourceRow of discoveredRows.rows) {
        const { data: renewed, error: renewError } = await serviceClient.rpc('sheets_claim_worker', { worker_id: workerId, lease_seconds: 120 });
        if (renewError || !renewed) throw new Error(`Worker lease renewal failed: ${renewError?.message ?? 'lease was taken by another worker'}`);
        const phone = sourceRow.values[phoneColumn.index]?.trim() ?? '';
        if (!phone) { inbound.skipped++; continue; }
        let leadId = sourceRow.values[idColumn.index]?.trim() ?? '';
        if (sourceRow.rowMetadataConflict) { inbound.conflicts++; importBatchComplete = false; continue; }
        const needsProvision = !leadId || !sourceRow.rowMetadataId || sourceRow.rowMetadataValue !== leadId;
        if (needsProvision && provisionedCount >= SHEETS_NEW_ID_BUDGET) {
          importBatchComplete = false;
          break;
        }
        const rowHash = JSON.stringify(sourceRow.values.map((v, i) => i === idColumn.index ? '' : v));
        if (!leadId && (missingRowHashes.get(rowHash) ?? 0) > 1) { inbound.conflicts++; importBatchComplete = false; continue; }
        if (leadId && duplicateIds.has(leadId)) { inbound.skipped++; continue; }
        if (leadId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId)) { inbound.conflicts++; continue; }
        try {
          if (!leadId || !sourceRow.rowMetadataId || sourceRow.rowMetadataValue !== leadId) {
            const assigned = await google.assignStableLeadId(mapping.spreadsheetId, mapping.tabId, sourceRow, idColumn, sourceRow.rowMetadataValue ?? undefined);
            leadId = assigned.leadId;
            provisionedCount++;
          }
          const importable = { ...sourceRow, values: [...sourceRow.values] };
          importable.values[idColumn.index] = leadId;
          const lead = importRow(importable, resolution, { locale: discovered.locale, timeZone: discovered.timeZone });
          if (!lead) { inbound.skipped++; continue; }
          const payload = { leadId: lead.leadId, sourcePlatformId: lead.platformLeadId, phone: lead.phone, displayName: lead.displayName, source: lead.source, createdAt: lead.createdAt, email: lead.email, formAnswers: lead.formAnswers, legacyAttempts: lead.historicalAttempts, legacyAttemptCount: lead.legacyAttemptCount, legacyOutcome: lead.legacyOutcome, legacyVerifiedAt: lead.legacyVerifiedAt, legacyEvaluation: lead.legacyEvaluation, evaluationNote: lead.evaluationNote, legacyShareUrls: lead.legacyRecordingUrl ? [lead.legacyRecordingUrl] : [] };
          const { error } = await serviceClient.rpc('sheets_import_row', { row: payload });
          if (error) throw new Error(`Lead import failed: ${error.message}`);
          inbound.imported++;
        } catch (error) {
          importBatchComplete = false;
          const text = error instanceof Error ? error.message : 'Import conflict';
          if (leadId) await serviceClient.rpc('sheets_record_conflict', { lead_id: leadId, conflict: { kind: 'source_row_reconciliation', rowNumber: sourceRow.rowNumber, error: text } });
          inbound.conflicts++;
        }
      }
      if (backgroundRows.length && !importBatchComplete) {
        const nextUnprocessed = discoveredRows.rows.find(row => (row.values[idColumn.index]?.trim() ?? '') === '' || !row.rowMetadataId || row.rowMetadataValue !== row.values[idColumn.index]?.trim());
        if (nextUnprocessed && nextUnprocessed.rowNumber >= backgroundStart && nextUnprocessed.rowNumber <= Number(nextCursor)) {
          const { error } = await serviceClient.rpc('sheets_advance_import_cursor', { mapping_id: savedMapping.id, expected_cursor: cursor, next_cursor: String(nextUnprocessed.rowNumber) });
          if (error) throw new Error(`Import cursor advance failed: ${error.message}`);
        }
      } else if (backgroundRows.length && importBatchComplete) {
        const { error } = await serviceClient.rpc('sheets_advance_import_cursor', { mapping_id: savedMapping.id, expected_cursor: cursor, next_cursor: nextCursor && Number(nextCursor) > identity.lastPhoneRow ? null : nextCursor });
        if (error) throw new Error(`Import cursor advance failed: ${error.message}`);
      }
    }
    const port: SheetsWorkerPort = {
      async claim(id, limit, leaseSeconds) {
        const { data, error } = await serviceClient.rpc('sheets_claim_jobs', { worker_id: id, job_limit: limit, lease_seconds: leaseSeconds });
        if (error) throw new Error(`Outbox claim failed: ${error.message}`);
        return (data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), leadId: String(row.lead_id), desiredVersion: Number(row.desired_version), fencingToken: Number(row.fencing_token) }));
      },
      async getMapping() {
        const { data, error } = await serviceClient.from('sheet_mappings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (error) throw new Error(`Mapping read failed: ${error.message}`);
        if (!data) return null;
        return { spreadsheetId: data.spreadsheet_id, tabId: Number(data.tab_id), tabTitle: data.tab_title, headerRow: data.header_row, schemaFingerprint: data.schema_fingerprint, fields: data.fields, validatedAt: data.validated_at, writesEnabled: data.writes_enabled } as SheetMapping;
      },
      async discover(mapping, start, count) { return (await getGoogle()).discover(mapping.spreadsheetId, mapping.tabId, mapping.headerRow, start, count); },
      async findRowMetadata(mapping, leadId) {
        const match = await (await getGoogle()).searchRowMetadata(mapping.spreadsheetId, mapping.tabId, leadId);
        return match ? { metadataId: match.metadataId, value: match.value } : null;
      },
      async exportSnapshot(leadId, timeZone) {
        const { data, error } = await serviceClient.rpc('sheets_export_snapshot', { lead_id: leadId });
        if (error) throw new Error(`Snapshot export failed: ${error.message}`);
        const value = data as SheetExportSnapshot | null;
        if (!value || value.leadId !== leadId) throw new Error('Export snapshot is incomplete or belongs to a different lead.');
        let publicUrl: string | null = null;
        if (value.handoff?.shareState === 'active') {
          const baseUrl = Deno.env.get('PUBLIC_APP_URL');
          if (!baseUrl) throw new Error('PUBLIC_APP_URL is missing; a stable recording URL cannot be generated.');
          publicUrl = stableRecordingUrl(baseUrl, await decryptShareToken(value.handoff.shareTokenCiphertext));
        }
        return { leadId: value.leadId, desiredVersion: value.desiredVersion, output: buildOutput(value, publicUrl, timeZone) };
      },
      async isLeaseCurrent(job: SyncJob) {
        const { data: renewed, error: renewError } = await serviceClient.rpc('sheets_claim_worker', { worker_id: workerId, lease_seconds: 120 });
        if (renewError || !renewed) return false;
        const { data, error } = await serviceClient.from('sheet_sync_jobs').select('state,lease_owner,lease_expires_at,fencing_token').eq('id', job.id).maybeSingle();
        if (error) throw new Error(`Lease check failed: ${error.message}`);
        return Boolean(data && data.state === 'running' && data.lease_owner === workerId && Number(data.fencing_token) === job.fencingToken && data.lease_expires_at && Date.parse(data.lease_expires_at) > Date.now());
      },
      async write(mapping, cells, rowMetadataId) { await (await getGoogle()).writeRowByMetadata(mapping.spreadsheetId, rowMetadataId, cells); },
      async mark(job, state, errorText) {
        const { error } = await serviceClient.rpc('sheets_mark_job_result', { job_id: job.id, fencing_token: job.fencingToken, result_state: state, error_text: errorText ?? null });
        if (error) throw new Error(`Outbox result update failed: ${error.message}`);
      },
    };
    return json({ ...inbound, ...(await runSheetsWorker(port, workerId, SHEETS_OUTBOX_LIMIT)), budgets: { importPageRows: SHEETS_IMPORT_PAGE_SIZE, newIdsPerRun: SHEETS_NEW_ID_BUDGET, outputJobsPerRun: SHEETS_OUTBOX_LIMIT }, workerId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected worker failure.' }, 500);
  } finally {
    if (hasLease) await serviceClient.rpc('sheets_release_worker', { worker_id: workerId });
  }
});
