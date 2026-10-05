/* global process, console, fetch */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const cwd = process.cwd();
const status = execFileSync('npx', ['supabase', 'status', '--output', 'env'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const env = Object.fromEntries(status.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]));
const rootUrl = env.API_URL;
const anonKey = env.ANON_KEY;
const serviceKey = env.SERVICE_ROLE_KEY;
if (!rootUrl || !anonKey || !serviceKey) throw new Error('Start the local Supabase project before running this check.');
const service = createClient(rootUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(rootUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = randomUUID().slice(0, 8);
const password = randomBytes(24).toString('base64url');
const users = {};

async function createUser(label, withProfile = true, role = 'staff') {
  const email = `${label}-${tag}@example.invalid`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Synthetic ${label}` } });
  if (error) throw error;
  if (withProfile) {
    const profile = await service.from('profiles').insert({ user_id: data.user.id, role, display_name: `Synthetic ${label}` });
    if (profile.error) throw profile.error;
  }
  users[label] = { id: data.user.id, email, password };
  return data.user.id;
}

async function login(label) {
  const client = createClient(rootUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: users[label].email, password: users[label].password });
  if (error) throw error;
  return client;
}

async function invoke(client, operation, args = {}) {
  const { data, error } = await client.functions.invoke('call-api', { body: { operation, ...args } });
  if (error) {
    let detail = error.message;
    try { detail = (await error.context.clone().json()).error?.message ?? detail; } catch { /* no JSON response */ }
    return { error: { message: detail }, data: null };
  }
  return { data, error: null };
}

function assert(condition, message) { if (!condition) throw new Error(`FAIL: ${message}`); console.log(`PASS ${message}`); }
function wav(seconds = 1) {
  const sampleRate = 8000; const samples = seconds * sampleRate; const bytes = new Uint8Array(44 + samples * 2); const view = new DataView(bytes.buffer);
  const str = (offset, value) => [...value].forEach((c, i) => bytes[offset + i] = c.charCodeAt(0));
  str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 6000), true);
  return bytes;
}

const adminId = await createUser('admin', true, 'admin');
await createUser('staff-a'); await createUser('staff-b'); await createUser('no-profile', false);
const leadId = randomUUID(); const contentionLeadId = randomUUID(); const otherLeadId = randomUUID();
for (const [id, phone, name] of [[leadId, '+00000000001', 'Synthetic Lead A'], [contentionLeadId, '+00000000002', 'Synthetic Lead B'], [otherLeadId, '+00000000003', 'Synthetic Lead C']]) {
  const { error } = await service.from('leads').insert({ id, phone, display_name: name, source: 'local-fixture', form_answers: { campaign: 'backend-check' } });
  if (error) throw error;
}
const admin = await login('admin'); const a = await login('staff-a'); const b = await login('staff-b'); const noProfile = await login('no-profile');

const anonymousRead = await anon.from('leads').select('id');
assert(!anonymousRead.error && anonymousRead.data.length === 0, 'anon cannot read leads through REST/RLS');
const anonymousRpc = await anon.rpc('claim_attempt', { p_lead_id: leadId, p_key: 'anon-key' });
assert(Boolean(anonymousRpc.error), 'anon cannot execute claim mutation RPC');
const anonymousWorkerRpc = await anon.rpc('sheets_claim_worker', { worker_id: `anon-worker-${tag}`, lease_seconds: 120 });
assert(Boolean(anonymousWorkerRpc.error), 'anon cannot acquire service-only Sheet worker lease');
const noProfileList = await invoke(noProfile, 'list-leads', { queue: 'not_called' });
assert(Boolean(noProfileList.error), 'authenticated user without profile cannot use staff API');
const staffRead = await a.from('leads').select('id').eq('id', leadId).single();
assert(!staffRead.error && staffRead.data.id === leadId, 'staff profile can read lead through RLS');
const forbiddenWrite = await a.from('leads').update({ phone: '+00000000999' }).eq('id', leadId).select('id');
assert(Boolean(forbiddenWrite.error), 'staff cannot mutate lead rows directly');
const forbiddenMapping = await invoke(a, 'validate-sheet-mapping', { fields: [{ role: 'phone' }] });
assert(Boolean(forbiddenMapping.error), 'staff cannot validate or change admin Sheet mapping');
const allowedMapping = await invoke(admin, 'validate-sheet-mapping', { fields: [{ role: 'phone', column: { metadataId: 'synthetic-1' }, required: true, direction: 'input' }] });
assert(!allowedMapping.error && allowedMapping.data.data.valid, 'admin can validate Sheet field mapping');
const mappingId = randomUUID();
const savedMapping = await service.from('sheet_mappings').insert({ id: mappingId, spreadsheet_id: `synthetic-sheet-${tag}`, tab_id: 1, tab_title: 'Leads', header_row: 1, schema_fingerprint: 'fingerprint-v1', fields: [{ role: 'phone', column: { metadataId: 'synthetic-1' } }], updated_by: users.admin.id }).select('id').single();
if (savedMapping.error) throw savedMapping.error;
const initialCursor = await service.rpc('sheets_get_import_cursor', { mapping_id: mappingId });
assert(!initialCursor.error && initialCursor.data.cursor === null, 'new Sheet mapping starts with no import cursor');
const advancedCursor = await service.rpc('sheets_advance_import_cursor', { mapping_id: mappingId, expected_cursor: null, next_cursor: 'synthetic-cursor-1' });
const staleCursor = await service.rpc('sheets_advance_import_cursor', { mapping_id: mappingId, expected_cursor: null, next_cursor: 'stale-cursor' });
assert(!advancedCursor.error && advancedCursor.data && !staleCursor.error && !staleCursor.data, 'Sheet import cursor advances with compare-and-swap semantics');
const mappingChange = await admin.rpc('sheets_save_mapping', { mapping: { spreadsheetId: `synthetic-sheet-${tag}`, tabId: 1, tabTitle: 'Leads', headerRow: 1, schemaFingerprint: 'fingerprint-v2', fields: [{ role: 'phone', column: { metadataId: 'synthetic-2' } }], writesEnabled: false } });
if (mappingChange.error) throw mappingChange.error;
const resetCursor = await service.rpc('sheets_get_import_cursor', { mapping_id: mappingId });
assert(!resetCursor.error && resetCursor.data.cursor === null, 'changing mapping fingerprint clears its stale import cursor');
const workerClaims = await Promise.all([
  service.rpc('sheets_claim_worker', { worker_id: `worker-one-${tag}`, lease_seconds: 120 }),
  service.rpc('sheets_claim_worker', { worker_id: `worker-two-${tag}`, lease_seconds: 120 }),
]);
assert(workerClaims.filter((r) => !r.error && r.data === true).length === 1, 'overlapping Sheet workers acquire only one global lease');
const lockOwner = workerClaims[0].data ? `worker-one-${tag}` : `worker-two-${tag}`;
const wrongRelease = await service.rpc('sheets_release_worker', { worker_id: `not-owner-${tag}` });
const releasedWorker = await service.rpc('sheets_release_worker', { worker_id: lockOwner });
assert(!wrongRelease.error && wrongRelease.data === false && !releasedWorker.error && releasedWorker.data === true, 'Sheet worker lease can only be released by its owner');

const concurrent = await Promise.all([
  invoke(a, 'claim-attempt', { leadId: contentionLeadId, idempotencyKey: `claim-a-${tag}` }),
  invoke(b, 'claim-attempt', { leadId: contentionLeadId, idempotencyKey: `claim-b-${tag}` }),
]);
assert(concurrent.filter((r) => !r.error).length === 1, 'concurrent staff claims produce exactly one winner');
assert(concurrent.filter((r) => r.error).length === 1, 'losing concurrent claim receives a conflict');

const claim = await invoke(a, 'claim-attempt', { leadId, idempotencyKey: `claim-${tag}` });
if (claim.error) throw claim.error;
const claimId = claim.data.data.claimId;
const audio = wav();
const malformed = await invoke(a, 'begin-recording-upload', { leadId, claimId, filename: 'bad.wav', contentType: 'audio/wav', sizeBytes: 64, idempotencyKey: `bad-upload-${tag}` });
if (malformed.error) throw malformed.error;
const malformedTarget = malformed.data.data;
await fetch(malformedTarget.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/wav', 'x-upsert': 'false' }, body: new Uint8Array(64).fill(1) });
const malformedResult = await invoke(a, 'complete-recording-upload', { recordingId: malformedTarget.recordingId, sizeBytes: 64, durationSeconds: 1 });
assert(!malformedResult.error && malformedResult.data.data.state === 'rejected', 'malformed audio cannot be marked ready using client claims');
const browserWebmPath = '/tmp/verified-call-fake-mic.webm';
if (existsSync(browserWebmPath)) {
  const webm = readFileSync(browserWebmPath);
  const webmTarget = await invoke(a, 'begin-recording-upload', { leadId, claimId, filename: 'browser-capture.webm', contentType: 'audio/webm', sizeBytes: webm.byteLength, idempotencyKey: `webm-upload-${tag}` });
  if (webmTarget.error) throw webmTarget.error;
  const targetData = webmTarget.data.data;
  const uploadWebm = await fetch(targetData.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/webm', 'x-upsert': 'false' }, body: webm });
  assert(uploadWebm.ok, 'browser-generated WebM upload accepts private signed target');
  const checkedWebm = await invoke(a, 'complete-recording-upload', { recordingId: targetData.recordingId, sizeBytes: 1, durationSeconds: 1 });
  assert(!checkedWebm.error && checkedWebm.data.data.state === 'ready', 'server parser validates browser-generated WebM without client duration metadata');
}
const uploadInput = { leadId, claimId, filename: 'fixture.wav', contentType: 'audio/wav', sizeBytes: audio.byteLength, idempotencyKey: `wav-upload-${tag}` };
const upload = await invoke(a, 'begin-recording-upload', uploadInput);
if (upload.error) throw upload.error;
const uploadRetry = await invoke(a, 'begin-recording-upload', uploadInput);
assert(!uploadRetry.error && uploadRetry.data.data.recordingId === upload.data.data.recordingId, 'repeated upload start returns same recording identity');
const keyReuse = await invoke(a, 'begin-recording-upload', { ...uploadInput, sizeBytes: uploadInput.sizeBytes + 1 });
assert(Boolean(keyReuse.error), 'upload idempotency key cannot be reused with different payload');
const target = upload.data.data;
assert(target.uploadUrl.startsWith(rootUrl), 'signed upload URL uses browser reachable local API origin');
const put = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/wav', 'x-upsert': 'false' }, body: audio });
assert(put.ok, 'private signed upload accepts synthetic playable WAV');
const complete = await invoke(a, 'complete-recording-upload', { recordingId: target.recordingId, sizeBytes: 1, durationSeconds: 1799 });
if (complete.error) throw complete.error;
const recording = complete.data.data;
assert(recording.state === 'ready' && recording.durationSeconds === 1 && recording.sizeBytes === audio.byteLength, 'server parses stored WAV and ignores client size/duration');
const noShareVerification = await invoke(a, 'complete-evaluation', { leadId, result: 'verified', recordingId: recording.id, expectedVersion: 0, idempotencyKey: `verify-no-share-${tag}` });
assert(Boolean(noShareVerification.error), 'Verified requires a ready playable recording and an active share');
const privateDownload = await anon.storage.from('lead-recordings').download(recording.objectKey);
assert(Boolean(privateDownload.error), 'private recording object cannot be downloaded without signed URL');

const share1 = await invoke(a, 'create-share', { recordingId: recording.id, idempotencyKey: `share-${tag}` });
if (share1.error) throw share1.error;
const share2 = await invoke(a, 'create-share', { recordingId: recording.id, idempotencyKey: `share-${tag}` });
if (share2.error) throw share2.error;
assert(share1.data.data.shareId === share2.data.data.shareId && share1.data.data.publicUrl === share2.data.data.publicUrl, 'share creation retry returns same pinned opaque link');
const token = share1.data.data.publicUrl.split('/r/')[1];
const publicResponse = await fetch(`${rootUrl}/functions/v1/public-recording`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: JSON.stringify({ token }) });
assert(publicResponse.ok, 'public token resolves without staff authentication');
const publicData = (await publicResponse.json()).data;
assert(publicData.recordingCode && publicData.signedAudioUrl.startsWith(rootUrl), 'public result exposes recording only and browser reachable short URL');
assert(!('phone' in publicData) && !('displayName' in publicData), 'public share response omits lead identity fields');
assert((await fetch(publicData.signedAudioUrl)).ok, 'five-minute signed playback URL serves private audio');

const saveKey = `save-${tag}`;
const saved = await invoke(a, 'save-outcome', { claimId, outcome: 'interested', recordingId: recording.id, evaluation: { result: 'verified', recordingId: recording.id, expectedVersion: 0 }, idempotencyKey: saveKey });
if (saved.error) throw saved.error;
assert(saved.data.data.attemptCount === 1 && saved.data.data.attempt.state === 'completed' && saved.data.data.handoff?.recordingId === recording.id && saved.data.data.handoff.version === 1, 'outcome and verified handoff save atomically with the typed handoff object');
const replay = await invoke(a, 'save-outcome', { claimId, outcome: 'interested', recordingId: recording.id, evaluation: { result: 'verified', recordingId: recording.id, expectedVersion: 0 }, idempotencyKey: saveKey });
assert(!replay.error && replay.data.data.attemptCount === 1, 'outcome retry is idempotent and does not increment count twice');

const detail = await invoke(a, 'get-lead', { leadId });
if (detail.error) throw detail.error;
assert(detail.data.data.handoff?.recordingId === recording.id && detail.data.data.shares[0].publicUrl === share1.data.data.publicUrl, 'staff history reconstructs stable public URL from encrypted token');
const unauthorizedRevoke = await invoke(b, 'revoke-share', { shareId: share1.data.data.shareId, idempotencyKey: `forbidden-revoke-${tag}` });
assert(Boolean(unauthorizedRevoke.error), 'unrelated staff cannot revoke another recording owner share');
const revoked = await invoke(a, 'revoke-share', { shareId: share1.data.data.shareId, idempotencyKey: `revoke-${tag}` });
if (revoked.error) throw revoked.error;
const blockedPlayback = await fetch(`${rootUrl}/functions/v1/public-recording`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: JSON.stringify({ token }) });
assert(!blockedPlayback.ok, 'revoked share blocks new signed playback');

for (let ordinal = 2; ordinal <= 5; ordinal++) {
  const next = await invoke(a, 'claim-attempt', { leadId, idempotencyKey: `claim-${ordinal}-${tag}` });
  if (next.error) throw next.error;
  const outcome = await invoke(a, 'save-outcome', { claimId: next.data.data.claimId, outcome: 'unreachable', idempotencyKey: `save-${ordinal}-${tag}` });
  if (outcome.error) throw outcome.error;
  assert(outcome.data.data.attemptCount === ordinal, `attempt ${ordinal} increments once`);
}
const sixth = await invoke(a, 'claim-attempt', { leadId, idempotencyKey: `claim-six-${tag}` });
assert(Boolean(sixth.error), 'sixth contact attempt is blocked');

const otherClaim = await invoke(a, 'claim-attempt', { leadId: otherLeadId, idempotencyKey: `other-${tag}` });
if (otherClaim.error) throw otherClaim.error;
const missingOtherNote = await invoke(a, 'save-outcome', { claimId: otherClaim.data.data.claimId, outcome: 'other', idempotencyKey: `other-save-${tag}` });
assert(Boolean(missingOtherNote.error), 'other outcome without a note is rejected');
const untouched = await service.from('leads').select('attempt_count').eq('id', otherLeadId).single();
assert(!untouched.error && untouched.data.attempt_count === 0, 'failed outcome leaves attempt count unchanged');

const legacyLeadId = randomUUID();
const legacyPayload = { leadId: legacyLeadId, sourcePlatformId: 'synthetic-platform-id', phone: '+00000000004', displayName: 'Synthetic Imported', source: 'local-import', createdAt: new Date().toISOString(), formAnswers: {}, legacyAttempts: [{ ordinal: 1, outcome: 'unreachable', occurredAt: new Date().toISOString() }, { ordinal: 2, outcome: 'callback', occurredAt: new Date().toISOString() }], legacyAttemptCount: 2, legacyEvaluation: 'verified', legacyVerifiedAt: new Date().toISOString(), legacyOutcome: 'interested', evaluationNote: 'Synthetic history', legacyShareUrls: ['https://example.invalid/old-recording'] };
const imported = await service.rpc('sheets_import_row', { row: legacyPayload });
if (imported.error) throw imported.error;
const changedPoll = await service.rpc('sheets_import_row', { row: { ...legacyPayload, phone: '+00000000005', legacyEvaluation: 'unverified', legacyAttemptCount: 5, legacyAttempts: [] } });
if (changedPoll.error) throw changedPoll.error;
const importedSnapshot = await service.from('leads').select('phone,attempt_count,evaluation,evaluation_version,legacy_share_urls,legacy_source_metadata').eq('id', legacyLeadId).single();
assert(!importedSnapshot.error && importedSnapshot.data.phone === '+00000000005' && importedSnapshot.data.attempt_count === 2 && importedSnapshot.data.evaluation === null && importedSnapshot.data.evaluation_version === 0 && importedSnapshot.data.legacy_share_urls.length === 1 && importedSnapshot.data.legacy_source_metadata.legacyEvaluation === 'verified', 'repeated sheet import updates source columns without overwriting app history or evaluation');
const distinctUuid = await service.rpc('sheets_import_row', { row: { ...legacyPayload, leadId: randomUUID(), displayName: 'Distinct UUID' } });
assert(!distinctUuid.error, 'Sheet identity uses stable UUID and does not merge by phone');
const legacyDetail = await invoke(a, 'get-lead', { leadId: legacyLeadId });
assert(!legacyDetail.error && legacyDetail.data.data.evaluation === null && legacyDetail.data.data.legacySourceMetadata.evaluation === 'verified' && legacyDetail.data.data.legacySourceMetadata.recordingLinks.length === 1, 'legacy evaluation and links remain separate from app verification');
const retryLeadId = randomUUID();
const retryLead = await service.rpc('sheets_import_row', { row: { ...legacyPayload, leadId: retryLeadId, sourcePlatformId: null, phone: '+00000000006', displayName: 'Synthetic Retry Lead', legacyAttempts: [{ ordinal: 1, outcome: 'unreachable', occurredAt: new Date().toISOString() }], legacyAttemptCount: 1, legacyEvaluation: null, legacyOutcome: 'unreachable', legacyVerifiedAt: null, legacyShareUrls: [] } });
if (retryLead.error) throw retryLead.error;
const callbackLeadId = randomUUID();
const callbackLead = await service.rpc('sheets_import_row', { row: { ...legacyPayload, leadId: callbackLeadId, sourcePlatformId: null, phone: '+00000000008', displayName: 'Synthetic Callback Lead', legacyAttempts: [{ ordinal: 1, outcome: 'callback', occurredAt: new Date().toISOString() }], legacyAttemptCount: 1, legacyEvaluation: null, legacyOutcome: null, legacyVerifiedAt: null, legacyShareUrls: [] } });
if (callbackLead.error) throw callbackLead.error;
const staleCallbackLeadId = randomUUID();
const staleCallbackLead = await service.rpc('sheets_import_row', { row: { ...legacyPayload, leadId: staleCallbackLeadId, sourcePlatformId: null, phone: '+00000000007', displayName: 'Synthetic Latest Outcome Lead', legacyAttempts: [{ ordinal: 1, outcome: 'callback', occurredAt: '2025-01-01T00:00:00Z' }, { ordinal: 2, outcome: 'unreachable', occurredAt: '2025-01-02T00:00:00Z' }], legacyAttemptCount: 2, legacyEvaluation: null, legacyOutcome: null, legacyVerifiedAt: null, legacyShareUrls: [] } });
if (staleCallbackLead.error) throw staleCallbackLead.error;
const notCalledQueue = await a.rpc('leads_for_actor', { p_queue: 'not_called' });
const inProgressQueue = await a.rpc('leads_for_actor', { p_queue: 'in_progress' });
const callbackQueue = await a.rpc('leads_for_actor', { p_queue: 'callback' });
const finishedQueue = await a.rpc('leads_for_actor', { p_queue: 'finished' });
assert(!notCalledQueue.error && !notCalledQueue.data.some((lead) => lead.id === retryLeadId) && !inProgressQueue.error && inProgressQueue.data.some((lead) => lead.id === retryLeadId), 'saved unreachable lead without evaluation remains in the in-progress queue');
assert(!callbackQueue.error && callbackQueue.data.some((lead) => lead.id === callbackLeadId) && !callbackQueue.data.some((lead) => lead.id === retryLeadId) && !callbackQueue.data.some((lead) => lead.id === staleCallbackLeadId), 'callback queue uses only the latest completed outcome');
assert(!finishedQueue.error && finishedQueue.data.some((lead) => lead.id === leadId) && finishedQueue.data.some((lead) => lead.id === legacyLeadId), 'app-evaluated and legacy-evaluated leads belong to the finished queue');

const currentLead = await service.from('leads').select('sheet_sync_version').eq('id', leadId).single();
const claimedJobs = await service.rpc('sheets_claim_jobs', { worker_id: `worker-${tag}`, job_limit: 100, lease_seconds: 60 });
if (claimedJobs.error) throw claimedJobs.error;
const currentJob = claimedJobs.data.find((job) => job.lead_id === leadId);
assert(Boolean(currentJob) && currentJob.desired_version === currentLead.data.sheet_sync_version, 'worker claims only latest outbox version for each lead');
const blockedJob = await service.rpc('sheets_mark_job_result', { job_id: currentJob.id, fencing_token: currentJob.fencing_token, result_state: 'blocked', error_text: 'Synthetic ambiguous write' });
assert(!blockedJob.error && blockedJob.data === true, 'worker can block ambiguous Sheet write with fencing token');
const evaluation = await invoke(a, 'complete-evaluation', { leadId, result: 'unverified', expectedVersion: 2, idempotencyKey: `final-evaluation-${tag}` });
if (evaluation.error) throw evaluation.error;
const blockedClaim = await service.rpc('sheets_claim_jobs', { worker_id: `worker-next-${tag}`, job_limit: 100, lease_seconds: 60 });
assert(!blockedClaim.error && !blockedClaim.data.some((job) => job.lead_id === leadId), 'blocked ambiguous write holds later output until reconciliation');
const latestVersion = await service.from('leads').select('sheet_sync_version').eq('id', leadId).single();
const tooSoon = await service.rpc('sheets_reconcile_job', { job_id: currentJob.id, fencing_token: currentJob.fencing_token, observed_matches: true, observed_version: latestVersion.data.sheet_sync_version, detail: 'Synthetic early readback' });
assert(!tooSoon.error && tooSoon.data === false, 'ambiguous blocked job cannot reconcile inside the quarantine window');
await service.from('sheet_sync_jobs').update({ blocked_at: new Date(Date.now() - 181_000).toISOString() }).eq('id', currentJob.id);
const mismatch = await service.rpc('sheets_reconcile_job', { job_id: currentJob.id, fencing_token: currentJob.fencing_token, observed_matches: false, observed_version: latestVersion.data.sheet_sync_version, detail: 'Synthetic row differs' });
assert(!mismatch.error && mismatch.data === false, 'mismatched Sheet row remains blocked');
const reconciled = await service.rpc('sheets_reconcile_job', { job_id: currentJob.id, fencing_token: currentJob.fencing_token, observed_matches: true, observed_version: latestVersion.data.sheet_sync_version, detail: 'Synthetic row now matches latest snapshot' });
assert(!reconciled.error && reconciled.data === true, 'verified reconciliation supersedes old barrier against the latest app version');
const releasedClaim = await service.rpc('sheets_claim_jobs', { worker_id: `worker-released-${tag}`, job_limit: 100, lease_seconds: 60 });
const releasedJob = releasedClaim.data?.find((job) => job.lead_id === leadId && job.desired_version === latestVersion.data.sheet_sync_version);
assert(!releasedClaim.error && Boolean(releasedJob), 'current outbox version becomes claimable after exact latest-row reconciliation');
const releasedResult = await service.rpc('sheets_mark_job_result', { job_id: releasedJob.id, fencing_token: releasedJob.fencing_token, result_state: 'succeeded', error_text: null });
assert(!releasedResult.error && releasedResult.data === true, 'latest output version can finish after old barrier is superseded');

const expiringVersion = await invoke(a, 'complete-evaluation', { leadId, result: 'unverified', expectedVersion: 3, idempotencyKey: `expiry-evaluation-${tag}` });
if (expiringVersion.error) throw expiringVersion.error;
const expiryClaim = await service.rpc('sheets_claim_jobs', { worker_id: `worker-expiry-${tag}`, job_limit: 100, lease_seconds: 60 });
const expiryJob = expiryClaim.data?.find((job) => job.lead_id === leadId);
assert(Boolean(expiryJob), 'current Sheet job can be leased for expiry test');
await service.from('sheet_sync_jobs').update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', expiryJob.id);
const staleResult = await service.rpc('sheets_mark_job_result', { job_id: expiryJob.id, fencing_token: expiryJob.fencing_token, result_state: 'succeeded', error_text: null });
assert(!staleResult.error && staleResult.data === false, 'expired worker fence cannot report a late success');
await service.rpc('sheets_claim_jobs', { worker_id: `worker-quarantine-${tag}`, job_limit: 100, lease_seconds: 60 });
const quarantined = await service.from('sheet_sync_jobs').select('state,last_error').eq('id', expiryJob.id).single();
assert(!quarantined.error && quarantined.data.state === 'blocked' && quarantined.data.last_error.includes('completion is uncertain'), 'expired write is quarantined for reconciliation instead of blind retry');

const identityLeadId = retryLeadId;
const identityVersion = await invoke(a, 'complete-evaluation', { leadId: identityLeadId, result: 'unverified', expectedVersion: 0, idempotencyKey: `identity-evaluation-${tag}` });
if (identityVersion.error) throw identityVersion.error;
const identityConflict = await service.rpc('sheets_record_conflict', { lead_id: identityLeadId, conflict: { reason: 'duplicate_stable_id', synthetic: true } });
assert(!identityConflict.error, 'identity conflict is persisted as an export barrier');
const identitySnapshot = await service.rpc('sheets_export_snapshot', { lead_id: identityLeadId });
assert(Boolean(identitySnapshot.error) && identitySnapshot.error.message.includes('sheet_identity_conflict_blocked'), 'identity-blocked leads cannot be exported');
const identityClaim = await service.rpc('sheets_claim_jobs', { worker_id: `worker-identity-blocked-${tag}`, job_limit: 100, lease_seconds: 60 });
assert(!identityClaim.error && !identityClaim.data.some((job) => job.lead_id === identityLeadId), 'identity conflict prevents pending output from being claimed');
const identityDenied = await service.rpc('sheets_resolve_identity_conflict', { lead_id: identityLeadId, observed_unique: false, detail: 'Still duplicated' });
assert(!identityDenied.error && identityDenied.data === false, 'identity barrier stays until a unique identity is observed');
const identityResolved = await service.rpc('sheets_resolve_identity_conflict', { lead_id: identityLeadId, observed_unique: true, detail: 'Synthetic identity verified' });
assert(!identityResolved.error && identityResolved.data === true, 'verified identity repair clears the persisted barrier');
const identityReleased = await service.rpc('sheets_claim_jobs', { worker_id: `worker-identity-repaired-${tag}`, job_limit: 100, lease_seconds: 60 });
assert(!identityReleased.error && identityReleased.data.some((job) => job.lead_id === identityLeadId && job.desired_version === 1), 'current output becomes claimable only after identity repair');

const credentials = { localOnly: true, users, leadIds: { primary: leadId, contention: contentionLeadId, other: otherLeadId }, createdBy: adminId };
mkdirSync(join(cwd, '.supabase'), { recursive: true });
writeFileSync(join(cwd, '.supabase/backend-test-users.json'), JSON.stringify(credentials, null, 2), { mode: 0o600 });
console.log('Synthetic local identities are saved in ignored .supabase/backend-test-users.json; they are not printed.');
