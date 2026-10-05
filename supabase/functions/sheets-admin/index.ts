import { authenticatedClient, json, requireAdmin, serviceClient, sheetsClient } from '../_shared/sheets-auth.ts';
import { resolveMapping, schemaFingerprint, suggestPreset } from '../../../src/integrations/sheets/core.ts';
import type { SheetMapping } from '../../../src/shared/types.ts';
import { buildOutput, stableRecordingUrl, type SheetExportSnapshot } from '../../../src/integrations/sheets/export.ts';
import { decryptShareToken } from '../_shared/crypto.ts';
import { mappedOutputCells } from '../../../src/integrations/sheets/core.ts';
import { formatIdentityConflict } from '../../../src/integrations/sheets/admin-contract.ts';

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' } });
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  try {
    const body = await request.json() as { action?: string; jobId?: string; leadId?: string; spreadsheetId?: string; tabId?: number; headerRow?: number; mapping?: SheetMapping };
    if (body.action === 'prepare') {
      if (!body.spreadsheetId || body.tabId === undefined || !body.headerRow || body.headerRow < 1) return json({ error: 'spreadsheetId, tabId, and positive headerRow are required.' }, 400);
      const prepared = await (await sheetsClient()).prepareTab(body.spreadsheetId, body.tabId, body.headerRow);
      return json({ columns: prepared.columns, leadIdColumn: prepared.leadIdColumn, preset: suggestPreset(prepared.columns), warning: 'A stable UUID header, column metadata, and row IDs will be managed on this selected sheet.' });
    }
    if (body.action === 'status') {
      const [{ data: saved, error: mappingError }, { data: jobs, error: jobsError }, { data: identityRows, error: identityError }] = await Promise.all([
        serviceClient.from('sheet_mappings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        serviceClient.from('sheet_sync_jobs').select('id,lead_id,state,last_error,blocked_at,created_at,attempts,desired_version,fencing_token').order('created_at', { ascending: false }).limit(500),
        serviceClient.from('leads').select('id,sheet_identity_conflict,sheet_sync_state').eq('sheet_identity_blocked', true).limit(100),
      ]);
      if (mappingError || jobsError || identityError) throw new Error(`Status read failed: ${mappingError?.message ?? jobsError?.message ?? identityError?.message}`);
      const states = { pending: 0, running: 0, retrying: 0, blocked: 0, succeeded: 0, superseded: 0 };
      for (const job of jobs ?? []) if (job.state in states) states[job.state as keyof typeof states]++;
      const blockedJobs = (jobs ?? []).filter(job => job.state === 'blocked');
      const identityConflicts = (identityRows ?? []).map(row => ({ leadId: row.id, conflict: formatIdentityConflict(row.sheet_identity_conflict), syncState: row.sheet_sync_state }));
      return json({ mapping: saved ? { spreadsheetId: saved.spreadsheet_id, tabId: Number(saved.tab_id), tabTitle: saved.tab_title, headerRow: saved.header_row, schemaFingerprint: saved.schema_fingerprint, fields: saved.fields, validatedAt: saved.validated_at, writesEnabled: saved.writes_enabled } : null, blockedJobs, identityConflicts, status: { writesEnabled: saved?.writes_enabled ?? false, validationErrors: [], importProgress: saved ? { cursor: saved.import_cursor ?? null, updatedAt: saved.import_cursor_updated_at ?? null, rowsPerBatch: 40, strategy: 'new rows near last used phone row plus historical refresh cursor' } : null, jobs: states, latestError: (jobs ?? []).find(job => job.last_error)?.last_error ?? null, blockedJobs, identityConflicts } });
    }
    if (body.action === 'repair-identity') {
      if (!body.leadId) return json({ error: 'leadId is required.' }, 400);
      const { data: conflict, error: conflictError } = await serviceClient.from('leads').select('id,sheet_identity_blocked').eq('id', body.leadId).maybeSingle();
      if (conflictError || !conflict?.sheet_identity_blocked) return json({ error: conflictError?.message ?? 'Identity conflict was not found.' }, 404);
      const { data: saved, error: mappingError } = await serviceClient.from('sheet_mappings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (mappingError || !saved) return json({ error: mappingError?.message ?? 'Sheet mapping was not found.' }, 409);
      const mapping: SheetMapping = { spreadsheetId: saved.spreadsheet_id, tabId: Number(saved.tab_id), tabTitle: saved.tab_title, headerRow: saved.header_row, schemaFingerprint: saved.schema_fingerprint, fields: saved.fields, validatedAt: saved.validated_at as SheetMapping['validatedAt'], writesEnabled: saved.writes_enabled };
      const google = await sheetsClient();
      const discovered = await google.discover(mapping.spreadsheetId, mapping.tabId, mapping.headerRow, mapping.headerRow + 1, 0);
      const resolution = resolveMapping(mapping, discovered.columns, await schemaFingerprint(discovered.columns));
      if (!resolution.valid) return json({ error: `Mapping needs repair before identity reconciliation: ${resolution.errors.join(' ')}` }, 409);
      const idColumn = resolution.byRole.get('lead_id');
      const phoneColumn = resolution.byRole.get('phone');
      if (!idColumn || !phoneColumn) return json({ error: 'Stable ID or phone column is not mapped.' }, 409);
      const identity = await google.readIdentityColumns(mapping.spreadsheetId, discovered.tabTitle, mapping.headerRow, phoneColumn.index, idColumn.index);
      const rowIndexes = identity.ids.flatMap((id, index) => id.trim() === body.leadId ? [index] : []);
      if (rowIndexes.length !== 1) return json({ error: `UUID must occur exactly once in the selected ID column; observed ${rowIndexes.length}. Correct duplicate or missing IDs in the sheet first.` }, 409);
      const rowNumber = mapping.headerRow + 1 + rowIndexes[0];
      if (!identity.phones[rowIndexes[0]]?.trim()) return json({ error: 'The row with this UUID has no phone value; repair its source row before clearing the barrier.' }, 409);
      const rowMetadata = await google.searchRowMetadata(mapping.spreadsheetId, mapping.tabId, body.leadId);
      if (!rowMetadata || rowMetadata.rowNumber !== rowNumber) return json({ error: 'Stable row metadata does not point to the unique UUID row. Repair the row metadata in the sheet first.' }, 409);
      const { data: repaired, error: repairError } = await serviceClient.rpc('sheets_resolve_identity_conflict', { lead_id: body.leadId, observed_unique: true, detail: 'Admin readback confirmed one selected-tab UUID row and matching row metadata.', p_actor_id: actor.userId });
      if (repairError) throw new Error(`Identity barrier repair failed: ${repairError.message}`);
      if (!repaired) return json({ error: 'Identity barrier could not be cleared; reread status and resolve the remaining conflict.' }, 409);
      return json({ repaired: true, leadId: body.leadId });
    }
    if (body.action === 'reconcile') {
      if (!body.jobId) return json({ error: 'jobId is required.' }, 400);
      const { data: job, error: jobError } = await serviceClient.from('sheet_sync_jobs').select('id,lead_id,desired_version,fencing_token,state,blocked_at').eq('id', body.jobId).maybeSingle();
      if (jobError || !job || job.state !== 'blocked') return json({ error: jobError?.message ?? 'Blocked job was not found.' }, 404);
      if (job.blocked_at && Date.now() - Date.parse(job.blocked_at) < 180_000) return json({ error: 'Wait three minutes after the ambiguous write, then reread and reconcile the latest row.' }, 409);
      const { data: saved, error: mappingError } = await serviceClient.from('sheet_mappings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (mappingError || !saved) return json({ error: mappingError?.message ?? 'Sheet mapping was not found.' }, 409);
      const mapping: SheetMapping = { spreadsheetId: saved.spreadsheet_id, tabId: Number(saved.tab_id), tabTitle: saved.tab_title, headerRow: saved.header_row, schemaFingerprint: saved.schema_fingerprint, fields: saved.fields, validatedAt: saved.validated_at as SheetMapping['validatedAt'], writesEnabled: saved.writes_enabled };
      const google = await sheetsClient();
      const { columns, timeZone } = await google.discover(mapping.spreadsheetId, mapping.tabId, mapping.headerRow, mapping.headerRow + 1, 0);
      const resolution = resolveMapping(mapping, columns, await schemaFingerprint(columns));
      if (!resolution.valid || !mapping.writesEnabled) return json({ error: `Mapping needs revalidation: ${resolution.errors.join(' ')}` }, 409);
      const idColumn = resolution.byRole.get('lead_id');
      if (!idColumn) return json({ error: 'Stable lead ID column is not mapped.' }, 409);
      const rowIdentity = await google.searchRowMetadata(mapping.spreadsheetId, mapping.tabId, job.lead_id);
      if (!rowIdentity || rowIdentity.value !== job.lead_id) return json({ error: 'Stable row identity is missing or duplicated; manual reconciliation is required.' }, 409);
      const { data: dataSnapshot, error: snapshotError } = await serviceClient.rpc('sheets_export_snapshot', { lead_id: job.lead_id });
      if (snapshotError) throw new Error(`Snapshot read failed: ${snapshotError.message}`);
      const snapshot = dataSnapshot as SheetExportSnapshot;
      let url: string | null = null;
      if (snapshot.handoff?.shareState === 'active') {
        const base = Deno.env.get('PUBLIC_APP_URL');
        if (!base) throw new Error('PUBLIC_APP_URL is missing.');
        url = stableRecordingUrl(base, await decryptShareToken(snapshot.handoff.shareTokenCiphertext));
      }
      const expected = mappedOutputCells(rowIdentity.rowNumber, resolution, buildOutput(snapshot, url, timeZone));
      const actual = await google.readValuesByRowMetadata(mapping.spreadsheetId, rowIdentity.metadataId, 'UNFORMATTED_VALUE');
      const formulas = await google.readValuesByRowMetadata(mapping.spreadsheetId, rowIdentity.metadataId, 'FORMULA');
      const differences = expected.filter(cell => !String(formulas[cell.columnIndex] ?? '').startsWith('=') && String(actual[cell.columnIndex] ?? '') !== String(cell.value)).map(cell => ({ column: cell.columnIndex, expected: cell.value, actual: actual[cell.columnIndex] ?? '' }));
      const matchesCurrent = differences.length === 0;
      const { data: reconciled, error: reconcileError } = await serviceClient.rpc('sheets_reconcile_job', { job_id: job.id, fencing_token: job.fencing_token, observed_matches: matchesCurrent, observed_version: snapshot.desiredVersion, detail: matchesCurrent ? `Sheet values match current app snapshot version ${snapshot.desiredVersion}.` : JSON.stringify({ blockedVersion: job.desired_version, currentVersion: snapshot.desiredVersion, differences }) });
      if (reconcileError) throw new Error(`Reconciliation result failed: ${reconcileError.message}`);
      return json({ reconciled: Boolean(reconciled), observedMatches: matchesCurrent, differences });
    }
    if (body.action === 'discover') {
      if (!body.spreadsheetId || body.tabId === undefined || !body.headerRow || body.headerRow < 1) return json({ error: 'spreadsheetId, tabId, and positive headerRow are required.' }, 400);
      const discovered = await (await sheetsClient()).discover(body.spreadsheetId, body.tabId, body.headerRow, body.headerRow + 1, 0);
      return json({ columns: discovered.columns, locale: discovered.locale, timeZone: discovered.timeZone, preset: suggestPreset(discovered.columns), validation: { valid: false, errors: discovered.columns.some(c => !c.metadataId) ? ['Stable column developer metadata is incomplete. Provision metadata on an approved pilot copy before enabling writes.'] : [] } });
    }
    if (body.action === 'validate' || body.action === 'save') {
      if (!body.mapping) return json({ error: 'mapping is required.' }, 400);
      const discovered = await (await sheetsClient()).discover(body.mapping.spreadsheetId, body.mapping.tabId, body.mapping.headerRow, body.mapping.headerRow + 1, 0);
      const fingerprint = await schemaFingerprint(discovered.columns);
      const validation = resolveMapping(body.mapping, discovered.columns, fingerprint);
      if (body.action === 'validate') return json({ validation: { valid: validation.valid, schemaFingerprint: fingerprint, errors: validation.errors, ambiguousRoles: validation.errors.filter(error => error.includes('more than once')) } });
      if (!validation.valid) return json({ error: 'Mapping is invalid; writes remain disabled.', validation: { valid: false, schemaFingerprint: fingerprint, errors: validation.errors } }, 409);
      const saved: SheetMapping = { ...body.mapping, schemaFingerprint: fingerprint, validatedAt: new Date().toISOString() as SheetMapping['validatedAt'], writesEnabled: true };
      const { data, error } = await authenticatedClient(request).rpc('sheets_save_mapping', { mapping: saved });
      if (error) throw new Error(`Mapping save failed: ${error.message}`);
      const row = data as Record<string, unknown> | null;
      const persistedMapping: SheetMapping = row ? { spreadsheetId: String(row.spreadsheet_id), tabId: Number(row.tab_id), tabTitle: String(row.tab_title), headerRow: Number(row.header_row), schemaFingerprint: String(row.schema_fingerprint), fields: row.fields as SheetMapping['fields'], validatedAt: row.validated_at ? String(row.validated_at) as SheetMapping['validatedAt'] : null, writesEnabled: Boolean(row.writes_enabled) } : saved;
      return json({ mapping: persistedMapping, status: 'writes_enabled' });
    }
    return json({ error: 'Unknown action. Use prepare, discover, status, validate, save, or reconcile.' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected Sheets admin error.' }, 500);
  }
});
