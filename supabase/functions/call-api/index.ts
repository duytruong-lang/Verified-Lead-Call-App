import { clients, fail, json, publicApiUrl, requireActor } from '../_shared/http.ts';
import { createShareToken, decryptShareToken } from '../_shared/crypto.ts';
import { detectAudio, validateAudio } from '../_shared/media.ts';

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const idKey = (v: unknown) => typeof v === 'string' && v.length > 0 ? v : crypto.randomUUID();
const read = async <T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
  const { data, error } = await promise;
  if (error) {
    console.error('Database operation failed:', error.message);
    throw new Error(error.message);
  }
  return data;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, 405);
  try {
    const { user, service } = clients(req);
    const actor = await requireActor(user);
    const body = await req.json();
    const op = body.operation ?? body.op;
    let result: unknown;
    switch (op) {
      case 'list-leads': {
        const rows = await read(user.rpc('leads_for_actor', { p_queue: body.queue ?? null }));
        result = rows.map((row: Record<string, unknown>) => summary(row, body.queue));
        break;
      }
      case 'get-lead': {
        const bundle = await read(user.rpc('get_lead_bundle', { p_lead_id: body.leadId }));
        result = await details(bundle as Record<string, unknown>);
        break;
      }
      case 'claim-attempt': result = await read(user.rpc('claim_attempt', { p_lead_id: body.leadId, p_key: idKey(body.idempotencyKey) })); break;
      case 'resume-attempt': result = await read(user.rpc('resume_attempt', { p_claim_id: body.claimId })); break;
      case 'cancel-attempt': result = await read(user.rpc('cancel_attempt', { p_claim_id: body.claimId, p_key: idKey(body.idempotencyKey) })); break;
      case 'save-outcome': {
        result = await read(user.rpc('save_outcome', {
          p_claim_id: body.claimId, p_outcome: body.outcome, p_note: body.note ?? null,
          p_recording_id: body.recordingId ?? null, p_eval: body.evaluation?.result ?? null,
          p_eval_recording_id: body.evaluation?.recordingId ?? null, p_expected: body.evaluation?.expectedVersion ?? null,
          p_key: idKey(body.idempotencyKey),
        }));
        result = saveResult(result as Record<string, unknown>);
        break;
      }
      case 'begin-recording-upload': {
        const contentType = String(body.contentType ?? '').split(';')[0].trim().toLowerCase();
        const created = await read(user.rpc('create_recording', {
          p_lead_id: body.leadId, p_claim_id: body.claimId, p_filename: body.filename ?? '',
          p_content_type: contentType, p_size: Number(body.sizeBytes), p_key: idKey(body.idempotencyKey),
        })) as { recordingId: string; objectKey: string };
        const { data, error } = await service.storage.from('lead-recordings').createSignedUploadUrl(created.objectKey, { upsert: false });
        if (error || !data) throw new Error(error?.message ?? 'upload_target_failed');
        const uploadUrl = `${publicApiUrl().replace(/\/$/, '')}/storage/v1/object/upload/sign/lead-recordings/${created.objectKey.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(data.token)}`;
        result = { ...created, uploadUrl, expiresAt: new Date(Date.now() + 600_000).toISOString() };
        break;
      }
      case 'complete-recording-upload': {
        const { data: meta, error: metaError } = await service.from('recordings').select('object_key,content_type').eq('id', body.recordingId).single();
        if (metaError || !meta) throw new Error('recording_not_found');
        const { data: file, error: downloadError } = await service.storage.from('lead-recordings').download(meta.object_key);
        if (downloadError || !file) throw new Error('recording_upload_missing');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const detected = detectAudio(bytes);
        let duration = 0;
        let validationError = false;
        try { duration = (await validateAudio(bytes, meta.content_type)).durationSeconds; } catch { validationError = true; }
        const checksum = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
        const ready = await read(service.rpc('mark_recording_ready', {
          p_recording_id: body.recordingId, p_size: bytes.byteLength, p_duration: duration,
          p_checksum: checksum, p_detected_type: detected?.mime ?? 'application/octet-stream',
        }));
        result = recording(ready as Record<string, unknown>);
        if (validationError && (result as Record<string, unknown>).state !== 'rejected') throw new Error('recording_validation_failed');
        break;
      }
      case 'complete-evaluation': {
        const ev = await read(user.rpc('set_evaluation', { p_lead_id: body.leadId, p_result: body.result, p_recording_id: body.recordingId ?? null, p_expected: body.expectedVersion, p_key: idKey(body.idempotencyKey) }));
        result = { version: ev.version };
        break;
      }
      case 'create-share': {
        const token = await createShareToken();
        const data = await read(user.rpc('issue_share', { p_recording_id: body.recordingId, p_hash: token.hash, p_ciphertext: token.ciphertext, p_key: idKey(body.idempotencyKey) }));
        const recoveredToken = await decryptShareToken(data.tokenCiphertext);
        result = { shareId: data.shareId, publicUrl: `${Deno.env.get('PUBLIC_APP_URL') ?? 'http://localhost:5173'}/r/${recoveredToken}` };
        break;
      }
      case 'replace-handoff': {
        const token = await createShareToken();
        const saved = await read(user.rpc('set_handoff', {
          p_lead_id: body.leadId, p_recording_id: body.recordingId, p_hash: token.hash,
          p_ciphertext: token.ciphertext, p_expected: body.expectedVersion, p_key: idKey(body.idempotencyKey),
        }));
        result = { version: saved.version, shareId: saved.shareId };
        break;
      }
      case 'revoke-share': result = await read(user.rpc('revoke_share', { p_share_id: body.shareId, p_key: idKey(body.idempotencyKey) })); break;
      case 'enqueue-sheet-sync': {
        result = await read(user.rpc('enqueue_sheet_job', { p_lead_id: body.leadId, p_version: body.desiredVersion, p_key: idKey(body.idempotencyKey) }));
        break;
      }
      case 'validate-sheet-mapping': {
        if (actor.role !== 'admin') throw new Error('admin_required');
        const fields = body.fields ?? [];
        const roles = fields.map((f: Record<string, unknown>) => f.role);
        const ambiguousRoles = roles.filter((v: string, i: number) => roles.indexOf(v) !== i);
        const errors: string[] = [];
        if (!fields.some((f: Record<string, unknown>) => f.role === 'phone')) errors.push('Phone mapping is required.');
        if (ambiguousRoles.length) errors.push('Mapping roles must be unique.');
        const schemaFingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(fields)))));
        result = { valid: errors.length === 0, schemaFingerprint, errors, ambiguousRoles };
        break;
      }
      case 'resolve-share': throw new Error('use_public_recording_endpoint');
      default: throw new Error('unknown_operation');
    }
    return json({ data: result });
  } catch (error) { return fail(error); }
});

function summary(row: Record<string, unknown>, queueOverride?: string) {
  const attempts = Number(row.attempt_count ?? 0);
  const queue = queueOverride ?? (row.claimed_by ? 'in_progress' : attempts >= 5 || row.evaluation ? 'finished' : attempts === 0 ? 'not_called' : 'in_progress');
  return { id: row.id, displayName: row.display_name, phone: row.phone, source: row.source, createdAt: row.source_created_at, attemptCount: attempts, queue, claimedBy: row.claimed_by };
}
function saveResult(value: Record<string, unknown>) {
  const a = value.attempt as Record<string, unknown>;
  const attempt = { id:a.id,leadId:a.lead_id,ordinal:a.ordinal,state:a.state,outcome:a.outcome,note:a.note,actorId:a.actor_id,startedAt:a.started_at,completedAt:a.completed_at,idempotencyKey:a.idempotency_key,claimExpiresAt:a.claim_expires_at };
  return { attempt, attemptCount:value.attemptCount, duplicate:value.duplicate, evaluationVersion:value.evaluationVersion, handoff:value.handoff };
}
function recording(row: Record<string, unknown>) {
  return { id: row.id, leadId: row.lead_id, attemptId: row.attempt_id, state: row.state, objectKey: row.object_key, contentType: row.content_type, sizeBytes: row.size_bytes, durationSeconds: row.duration_seconds, recordedAt: row.recorded_at, createdBy: row.created_by, checksum: row.checksum };
}
async function details(bundle: Record<string, unknown>) {
  const l = bundle.lead as Record<string, unknown>;
  const attempts = (bundle.attempts as Record<string, unknown>[]).map((a) => ({ id:a.id,leadId:a.lead_id,ordinal:a.ordinal,state:a.state,outcome:a.outcome,note:a.note,actorId:a.actor_id,startedAt:a.started_at,completedAt:a.completed_at,idempotencyKey:a.idempotency_key,claimExpiresAt:a.claim_expires_at }));
  const shares = await Promise.all((bundle.shares as Record<string, unknown>[]).map(async (s) => ({ id:s.id,recordingId:s.recordingId??s.recording_id,state:s.state,publicUrl:`${Deno.env.get('PUBLIC_APP_URL') ?? 'http://localhost:5173'}/r/${await decryptShareToken(String(s.tokenCiphertext??s.token_ciphertext))}`,createdAt:s.createdAt??s.created_at,createdBy:s.createdBy??s.created_by,revokedAt:s.revokedAt??s.revoked_at })));
  const queue = l.claimed_by ? 'in_progress' : Number(l.attempt_count)>=5 || l.evaluation ? 'finished' : attempts.at(-1)?.outcome==='callback' ? 'callback' : Number(l.attempt_count)===0 ? 'not_called' : 'in_progress';
  const legacy = (l.legacy_source_metadata ?? {}) as Record<string, unknown>;
  const legacySourceMetadata = Object.keys(legacy).length ? { outcome:legacy.legacyOutcome ?? null,evaluation:legacy.legacyEvaluation ?? null,evaluationAt:legacy.legacyEvaluationAt ?? null,note:legacy.evaluationNote ?? null,recordingLinks:Array.isArray(legacy.legacyShareUrls)?legacy.legacyShareUrls:[] } : null;
  return { ...summary(l,queue), email:l.email,formAnswers:l.form_answers,notes:l.notes,attempts,recordings:(bundle.recordings as Record<string, unknown>[]).map(recording),handoff:bundle.handoff,evaluation:l.evaluation,evaluationVersion:l.evaluation_version,shares,syncStatus:l.sheet_sync_state?{state:l.sheet_sync_state,desiredVersion:l.sheet_sync_version,appliedVersion:l.sheet_sync_applied_version,lastError:l.sheet_sync_error,updatedAt:l.updated_at}:null,legacySourceMetadata };
}
