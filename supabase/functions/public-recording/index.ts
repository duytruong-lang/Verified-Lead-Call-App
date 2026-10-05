import { clients, fail, json, publicApiUrl, tokenHash } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, 405);
  try {
    const { service } = clients(req);
    const { token } = await req.json();
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw new Error('share_not_found');
    const hash = await tokenHash(token);
    const { data, error } = await service.rpc('resolve_share', { p_hash: hash });
    if (error || !data) throw new Error(error?.message ?? 'share_not_found');
    const { data: signed, error: signedError } = await service.storage.from('lead-recordings').createSignedUrl(data.objectKey, 300, { download: false });
    if (signedError || !signed) throw new Error('signed_playback_unavailable');
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const signedAudioUrl = signed.signedUrl.replace(/^https?:\/\/[^/]+/, publicApiUrl().replace(/\/$/, ''));
    return json({ data: { recordingCode: data.recordingCode, recordedAt: data.recordedAt, durationSeconds: data.durationSeconds, signedAudioUrl, expiresAt } });
  } catch (error) { return fail(error); }
});
