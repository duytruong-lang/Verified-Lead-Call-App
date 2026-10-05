import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRepository } from './adapters/createRepository';
import type { LeadCallRepository } from './shared/repository';
import { SupabaseRepository } from './adapters/supabase';
import { SheetMappingAdmin } from './components/SheetMappingAdmin';
import { MAX_ATTEMPTS, RECORDING_LIMIT_BYTES, RECORDING_LIMIT_SECONDS, type ContactOutcome, type LeadDetails, type LeadQueue, type LeadSummary, type Recording, type UUID } from './shared/types';

const queues: { id: LeadQueue; label: string }[] = [{ id: 'not_called', label: 'Chưa gọi' }, { id: 'in_progress', label: 'Đang xử lý' }, { id: 'callback', label: 'Gọi lại' }, { id: 'finished', label: 'Đã kết thúc' }];
const outcomes: { id: ContactOutcome; label: string }[] = [{ id: 'interested', label: 'Có quan tâm' }, { id: 'unreachable', label: 'Thuê bao/máy bận' }, { id: 'callback', label: 'Gọi lại sau' }, { id: 'hung_up', label: 'Cúp máy ngang' }, { id: 'not_interested', label: 'Không có nhu cầu' }, { id: 'spam', label: 'Spam/Phá máy' }, { id: 'wrong_number', label: 'Sai số' }, { id: 'other', label: 'Khác' }];
const outcomeLabel = (key: ContactOutcome | null) => outcomes.find((item) => item.id === key)?.label ?? 'Chưa lưu';
type AppInit = { mode: 'demo' | 'supabase' | null; repository: LeadCallRepository | null; error: string };

export function App() {
  const [init] = useState<AppInit>(() => { try { return { ...createRepository(), error: '' }; } catch (e) { return { mode: null, repository: null, error: e instanceof Error ? e.message : 'Không thể khởi tạo ứng dụng.' }; } });
  const repo = init.repository;
  const [actor, setActor] = useState<{ id: UUID; role: string } | null>(null);
  const [queue, setQueue] = useState<LeadQueue>('not_called');
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [lead, setLead] = useState<LeadDetails | null>(null);
  const [claimId, setClaimId] = useState<UUID | null>(null);
  const [ordinal, setOrdinal] = useState(0);
  const [outcome, setOutcome] = useState<ContactOutcome | ''>('');
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [clip, setClip] = useState<Blob | null>(null);
  const [clipName, setClipName] = useState('');
  const [clipDuration, setClipDuration] = useState(0);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [assessment, setAssessment] = useState<'verified' | 'unverified' | null>(null);
  const [expandedInfo, setExpandedInfo] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const mediaRef = useRef<MediaRecorder | null>(null); const chunksRef = useRef<BlobPart[]>([]); const streamRef = useRef<MediaStream | null>(null); const timerRef = useRef<number | null>(null); const previewRef = useRef<HTMLAudioElement>(null);
  const selectedLeadRef = useRef<UUID | null>(null); const recordingLeadRef = useRef<UUID | null>(null); const discardRecordingRef = useRef(false);
  const pendingUploadRef = useRef<{ claimId: UUID; blob: Blob; idempotencyKey: string; target?: Awaited<ReturnType<LeadCallRepository['beginRecordingUpload']>>; uploaded: boolean } | null>(null);
  const readyRecordingRef = useRef<Recording | null>(null); const saveRequestRef = useRef<{ signature: string; key: string; shareKey: string } | null>(null);
  const operationKeysRef = useRef(new Map<string, string>());
  function keyFor(operation: string) { const existing = operationKeysRef.current.get(operation); if (existing) return existing; const key = crypto.randomUUID(); operationKeysRef.current.set(operation, key); return key; }
  function clearKey(operation: string) { operationKeysRef.current.delete(operation); }
  const isDemo = init.mode === 'demo';
  const draftAttempt = lead?.attempts.find((attempt) => attempt.state === 'draft');
  selectedLeadRef.current = lead?.id ?? null;
  const clipPreviewUrl = useMemo(() => clip ? URL.createObjectURL(clip) : '', [clip]);
  useEffect(() => () => { if (clipPreviewUrl) URL.revokeObjectURL(clipPreviewUrl); }, [clipPreviewUrl]);

  const refresh = useCallback(async (targetQueue = queue, selectedId?: UUID) => {
    if (!repo) return;
    const items = await repo.listLeads(targetQueue); setLeads(items);
    const preferredId = selectedId ?? lead?.id;
    const target = items.find((x) => x.id === preferredId) ?? (selectedId ? undefined : items[0]);
    if (target) { const details = await repo.getLead(target.id); setLead(details); setAssessment(details.evaluation); }
    else if (selectedId) { const details = await repo.getLead(selectedId); setLead(details); setAssessment(details.evaluation); }
    else { setLead(null); setAssessment(null); }
  }, [repo, queue, lead?.id]);

  useEffect(() => { let alive = true; if (!repo) return; void repo.getSession().then(({ actor: current }) => { if (alive) setActor(current); }).catch((e) => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [repo]);
  // Lead selection is intentionally retained while the queue refreshes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (actor) void refresh().catch((e) => setError(e.message)); }, [actor, queue]);
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (!claimId || !repo) return; const timer = window.setInterval(() => { void repo.resumeAttempt(claimId).catch((e) => setError(`Không thể gia hạn lượt gọi: ${errorText(e)}`)); }, 5 * 60_000); return () => window.clearInterval(timer); }, [claimId, repo]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (recording || clip || claimId || busy) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [recording, clip, claimId, busy]);

  async function abandonCurrentWork() {
    if (!(recording || clip || claimId)) return true;
    if (!window.confirm('Rời lead này sẽ hủy lượt gọi hoặc bản ghi chưa lưu. Bạn muốn tiếp tục?')) return false;
    discardRecordingRef.current = true;
    if (recording) stopRecording();
    if (claimId && repo) { try { await repo.cancelAttempt(claimId, keyFor(`cancel:${claimId}`)); clearKey(`cancel:${claimId}`); } catch { /* expired draft may already be released */ } }
    setClaimId(null); resetComposer(); setError(''); setMessage('');
    return true;
  }
  async function openLead(item: LeadSummary) {
    if (busy || !(await abandonCurrentWork())) return;
    const details = await repo!.getLead(item.id); setLead(details); setAssessment(details.evaluation);
  }
  function resetComposer() { setClip(null); setClipName(''); setClipDuration(0); setOutcome(''); setNote(''); setVerified(false); setSeconds(0); pendingUploadRef.current = null; readyRecordingRef.current = null; saveRequestRef.current = null; setShareUrl(''); }
  async function beginCall() {
    if (!repo || !lead) return;
    try { setBusy(true); setError(''); const key = `claim:${lead.id}`; const result = await repo.claimAttempt(lead.id, keyFor(key)); clearKey(key); setClaimId(result.claimId); setOrdinal(result.ordinal); setMessage(`Đã giữ lượt gọi ${result.ordinal}/5 cho bạn.`); await refresh(queue, lead.id); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function startRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Trình duyệt không hỗ trợ ghi âm micro. Hãy tải file âm thanh lên.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); streamRef.current = stream; chunksRef.current = [];
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported(x));
      const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); mediaRef.current = media;
      discardRecordingRef.current = false; recordingLeadRef.current = lead?.id ?? null;
      media.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      media.onstop = () => { const blob = new Blob(chunksRef.current, { type: media.mimeType || 'audio/webm' }); stream.getTracks().forEach((t) => t.stop()); streamRef.current = null; setRecording(false); if (timerRef.current) clearInterval(timerRef.current); if (discardRecordingRef.current || recordingLeadRef.current !== selectedLeadRef.current) return; if (blob.size) void acceptClip(blob, `Ghi âm ${new Date().toLocaleTimeString('vi-VN')}`); else setError('Bản ghi trống, vui lòng ghi lại.'); };
      media.start(500); setRecording(true); setSeconds(0); timerRef.current = window.setInterval(() => setSeconds((s) => { if (s + 1 >= RECORDING_LIMIT_SECONDS) { mediaRef.current?.stop(); return RECORDING_LIMIT_SECONDS; } return s + 1; }), 1000);
    } catch (e) { setError(errorText(e)); }
  }
  function stopRecording() { if (mediaRef.current?.state === 'recording') mediaRef.current.stop(); }
  async function inspectAudio(blob: Blob): Promise<number> {
    if (blob.size === 0) throw new Error('File âm thanh đang trống.');
    if (blob.size > RECORDING_LIMIT_BYTES) throw new Error('File vượt giới hạn 50 MB.');
    const probe = document.createElement('audio'); probe.preload = 'metadata'; const src = URL.createObjectURL(blob);
    let duration = await new Promise<number>((resolve, reject) => { probe.onloadedmetadata = () => resolve(probe.duration); probe.onerror = () => reject(new Error('Trình duyệt không đọc được file này. Hãy chọn audio có thể phát.')); probe.src = src; }).catch(() => NaN);
    URL.revokeObjectURL(src);
    if (!Number.isFinite(duration) || duration <= 0) {
      const audioContext = new AudioContext();
      try { const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer()); duration = decoded.duration; }
      catch { throw new Error('Trình duyệt không giải mã được audio này. Hãy chọn file có thể phát.'); }
      finally { await audioContext.close(); }
    }
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio không có thời lượng hợp lệ.'); if (duration > RECORDING_LIMIT_SECONDS) throw new Error('Audio vượt giới hạn 30 phút.'); return duration;
  }
  async function acceptClip(blob: Blob, name: string) { try { const duration = await inspectAudio(blob); setClip(blob); setClipName(name); setClipDuration(duration); setError(''); setMessage('Audio hợp lệ và đang được giữ trên trang này cho đến khi lưu.'); } catch (e) { setClip(null); setError(errorText(e)); } }
  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) await acceptClip(file, file.name); event.target.value = ''; }
  async function uploadClip(): Promise<Recording | undefined> {
    if (!clip || !lead || !claimId || !repo) return readyRecordingRef.current ?? undefined;
    if (readyRecordingRef.current?.attemptId === claimId) return readyRecordingRef.current;
    let pending = pendingUploadRef.current;
    if (!pending || pending.claimId !== claimId || pending.blob !== clip) { pending = { claimId, blob: clip, idempotencyKey: crypto.randomUUID(), uploaded: false }; pendingUploadRef.current = pending; }
    if (!pending.target) pending.target = await repo.beginRecordingUpload({ leadId: lead.id, claimId, filename: clipName, contentType: clip.type || 'audio/webm', sizeBytes: clip.size, idempotencyKey: pending.idempotencyKey });
    if (!pending.uploaded) {
      if (isDemo && 'uploadRecordingBlob' in repo) await (repo as typeof repo & { uploadRecordingBlob(input: { recordingId: UUID; blob: Blob }): Promise<void> }).uploadRecordingBlob({ recordingId: pending.target.recordingId, blob: clip });
      else { const response = await fetch(pending.target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': clip.type || 'audio/webm', 'x-upsert': 'false' }, body: clip }); if (!response.ok && response.status !== 409) throw new Error(`Tải audio lên thất bại (${response.status}). Bạn có thể bấm lưu lại để thử lại.`); }
      pending.uploaded = true;
    }
    const ready = await repo.completeRecordingUpload({ recordingId: pending.target.recordingId, sizeBytes: clip.size, durationSeconds: Math.round(clipDuration) });
    if (ready.state !== 'ready') throw new Error('Máy chủ từ chối bản ghi âm này. Hãy chọn audio khác hoặc xóa audio để chỉ lưu kết quả cuộc gọi.');
    readyRecordingRef.current = ready; pendingUploadRef.current = null; setClip(null); return ready;
  }
  async function save() {
    if (!repo || !lead || !claimId || !outcome) { setError('Chọn lượt gọi và kết quả trước khi lưu.'); return; }
    if (outcome === 'other' && !note.trim()) { setError('Vui lòng nhập ghi chú cho kết quả Khác.'); return; }
    if (verified && !clip && readyRecordingRef.current?.state !== 'ready' && !lead.recordings.some((r) => r.state === 'ready' && r.id === lead.handoff?.recordingId)) { setError('Đánh dấu Đã xác minh cần bản ghi âm hợp lệ trong lượt này.'); return; }
    const signature = JSON.stringify([claimId, outcome, note.trim(), verified, readyRecordingRef.current?.id ?? clipName]);
    if (!saveRequestRef.current || saveRequestRef.current.signature !== signature) saveRequestRef.current = { signature, key: crypto.randomUUID(), shareKey: crypto.randomUUID() };
    const request = saveRequestRef.current;
    try {
      setBusy(true); setError(''); setMessage(''); const ready = await uploadClip();
      let evaluation: { result: 'verified'; recordingId: UUID; expectedVersion: number } | undefined;
      let savedShareUrl = '';
      if (verified) { const recordingId = ready?.id ?? readyRecordingRef.current?.id ?? lead.handoff?.recordingId; if (!recordingId) throw new Error('Chọn bản ghi âm để xác minh.'); const share = await repo.createShare(recordingId, request.shareKey); savedShareUrl = share.publicUrl; evaluation = { result: 'verified', recordingId, expectedVersion: lead.evaluationVersion }; }
      await repo.saveOutcome({ claimId, outcome, note: note.trim() || undefined, recordingId: ready?.id ?? readyRecordingRef.current?.id, evaluation, idempotencyKey: request.key });
      const completedLead = lead.id; setClaimId(null); resetComposer(); setShareUrl(savedShareUrl); setMessage(verified ? 'Đã lưu kết quả và bàn giao bản ghi.' : 'Đã lưu kết quả. Sheet sẽ đồng bộ nền.'); await advanceAfterSave(completedLead);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function advanceAfterSave(completedLeadId: UUID) { if (!repo) return; const items = await repo.listLeads(queue); setLeads(items); const next = items.find((item) => item.id !== completedLeadId); if (next) { setLead(await repo.getLead(next.id)); setAssessment(next.queue === 'finished' ? (await repo.getLead(next.id)).evaluation : null); } else { setLead(null); setAssessment(null); } }
  async function assess(result: 'verified' | 'unverified', recordingId?: UUID) {
    if (!repo || !lead) return;
    try { setBusy(true); setError(''); let selectedId = recordingId; if (result === 'verified' && !selectedId) { const ready = lead.recordings.filter((r) => r.state === 'ready'); selectedId = ready.at(-1)?.id; } const shareOperation = `eval-share:${lead.id}:${lead.evaluationVersion}:${selectedId ?? ''}`; if (result === 'verified' && selectedId && !lead.shares.some((s) => s.recordingId === selectedId && s.state === 'active')) await repo.createShare(selectedId, keyFor(shareOperation)); const operation = `evaluate:${lead.id}:${lead.evaluationVersion}:${result}:${selectedId ?? ''}`; await repo.completeEvaluation({ leadId: lead.id, result, recordingId: selectedId, expectedVersion: lead.evaluationVersion, idempotencyKey: keyFor(operation) }); clearKey(operation); clearKey(shareOperation); await refresh(queue, lead.id); setMessage(result === 'verified' ? 'Đã xác minh và tạo link bàn giao.' : 'Đã lưu đánh giá chưa xác minh.'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function cancelDraft(claim: UUID) { if (!repo || !lead) return; const operation = `cancel:${claim}`; try { setBusy(true); await repo.cancelAttempt(claim, keyFor(operation)); clearKey(operation); setClaimId(null); resetComposer(); await refresh(queue, lead.id); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function replaceHandoff(recordingId: UUID) { if (!repo || !lead) return; const version = lead.handoff?.version ?? 0; const operation = `replace:${lead.id}:${version}:${recordingId}`; try { setBusy(true); await repo.replaceHandoff({ leadId: lead.id, recordingId, expectedVersion: version, idempotencyKey: keyFor(operation) }); clearKey(operation); await refresh(queue, lead.id); setMessage('Đã thay bản ghi bàn giao. Link cũ vẫn gắn với bản ghi trước.'); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function revokeRecordingShare(shareId: UUID) { if (!repo || !lead) return; const operation = `revoke:${shareId}`; try { setBusy(true); await repo.revokeShare(shareId, keyFor(operation)); clearKey(operation); await refresh(queue, lead.id); setMessage('Đã thu hồi link.'); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function changeQueue(id: LeadQueue) { if (id === queue || busy || !(await abandonCurrentWork())) return; setQueue(id); setLead(null); setError(''); setMessage(''); }
  async function authSubmit(event: React.FormEvent) { event.preventDefault(); if (!repo) return; try { setBusy(true); await repo.signIn(email, password); const session = await repo.getSession(); setActor(session.actor); setError(''); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function logout() { if (!repo || busy || !(await abandonCurrentWork())) return; try { discardRecordingRef.current = true; if (recording) stopRecording(); await repo.signOut(); setActor(null); setClaimId(null); resetComposer(); } catch (e) { setError(errorText(e)); } }

  const pathname = window.location.pathname;
  if (pathname.startsWith('/r/')) return <PublicRecording repo={repo} token={decodeURIComponent(pathname.slice(3))} />;
  if (!repo) return <main className="setup"><span className="brand-symbol">V</span><h1>Chưa thể mở workspace</h1><p>{init.error}</p><code>Chạy <b>npm run dev:demo</b> để dùng dữ liệu mẫu cục bộ, hoặc cấu hình VITE_APP_MODE=supabase.</code></main>;
  if (!actor) return <main className="auth-screen"><div className="auth-card"><span className="brand-symbol">V</span><p className="overline">VERIFIED CALL WORKSPACE</p><h1>Đăng nhập</h1><p>Đăng nhập tài khoản nhân viên để mở hàng đợi lead.</p>{isDemo && <div className="local-banner">Demo cục bộ · dữ liệu tổng hợp, lưu trên trình duyệt này</div>}<form onSubmit={authSubmit}><label>Email công việc<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="ten@congty.vn" /></label><label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button className="primary" disabled={busy}>Đăng nhập</button></form>{error && <p className="error-text" role="alert">{error}</p>}</div></main>;

  return <main className="app-shell">
    <header className="app-header"><div className="brand-symbol">V</div><div className="brand-copy"><span className="overline">VERIFIED CALL WORKSPACE</span><h1>Xác minh lead</h1></div><div className="header-spacer" />{isDemo && <span className="local-banner compact">DEMO · CHỈ TRÊN MÁY NÀY</span>}<button className="user-button" onClick={() => void logout()} aria-label="Đăng xuất"><span className="user-avatar">{isDemo ? 'D' : 'NV'}</span><span>{isDemo ? 'Nhân viên demo' : email || 'Nhân viên'}</span><b>↗</b></button></header>
    {init.error && <div className="alert error" role="alert">{init.error}</div>}
    <div className="workbench">
      <aside className="queue-column" aria-label="Hàng đợi lead">
        <div className="section-title"><div><span className="overline">HÀNG ĐỢI</span><h2>Lead cần gọi</h2></div><span className="queue-count">{leads.length}</span></div>
        <nav className="queue-tabs" aria-label="Nhóm lead">{queues.map((item) => <button key={item.id} className={queue === item.id ? 'selected' : ''} onClick={() => void changeQueue(item.id)}>{item.label}</button>)}</nav>
        <div className="queue-scroll">{leads.length ? leads.map((item) => <button key={item.id} className={`lead-row ${lead?.id === item.id ? 'active' : ''}`} onClick={() => void openLead(item)}><span className="lead-initial">{item.displayName?.slice(0, 1) ?? 'L'}</span><span className="lead-row-copy"><b>{item.displayName ?? 'Chưa có tên'}</b><small>{item.phone}</small><small className="lead-source">{item.source}</small></span><span className="attempt-mini">{item.attemptCount}/{MAX_ATTEMPTS}</span></button>) : <div className="queue-empty"><span>✓</span><b>Chưa có lead</b><small>Lead từ Sheet sẽ xuất hiện ở nhóm này.</small></div>}</div>
        {actor.role === 'admin' && <button className="admin-link" disabled={busy || recording || Boolean(clip) || Boolean(claimId)} onClick={() => setAdminOpen(true)}>⚙ Cấu hình Sheet</button>}
      </aside>

      <section className="detail-column" aria-label="Chi tiết và thao tác cuộc gọi">
        {lead ? <>
          <div className="lead-heading"><div className="lead-title"><span className="overline">THÔNG TIN LEAD</span><h2>{lead.displayName ?? 'Chưa có tên'}</h2><div className="phone-line"><a href={`tel:${lead.phone}`} aria-label={`Gọi ${lead.phone}`}>☎ {lead.phone}</a><button onClick={() => void navigator.clipboard?.writeText(lead.phone).then(() => setMessage('Đã sao chép số điện thoại.'))}>Sao chép</button></div></div><span className="attempt-chip">{lead.attemptCount}/{MAX_ATTEMPTS} lượt</span></div>
          {Object.keys(lead.formAnswers).length > 0 && <div className="answer-grid">{Object.entries(lead.formAnswers).map(([key, value]) => <div key={key}><small>{key.replaceAll('_', ' ')}</small><b>{value || '—'}</b></div>)}</div>}
          <button className="info-toggle" aria-expanded={expandedInfo} onClick={() => setExpandedInfo(!expandedInfo)}><span>{expandedInfo ? '⌃' : '⌄'}</span> Thông tin khác</button>
          {expandedInfo && <div className="answer-grid"><div><small>Nguồn lead</small><b>{lead.source ?? '—'}</b></div><div><small>Ngày tạo</small><b>{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('vi-VN') : '—'}</b></div><div><small>Email</small><b>{lead.email ?? '—'}</b></div><div><small>Ghi chú nhập</small><b>{lead.notes ?? '—'}</b></div></div>}

          <div className="call-card">
            <div className="call-card-top"><div><span className="overline">LƯỢT GỌI {claimId ? ordinal : Math.min(draftAttempt?.ordinal ?? lead.attemptCount + 1, MAX_ATTEMPTS)}/{MAX_ATTEMPTS}</span><h3>{claimId ? 'Đang xử lý lead' : draftAttempt ? 'Có lượt gọi đang dở' : 'Ghi nhận cuộc gọi'}</h3></div>{claimId ? <span className="live-state"><i /> Đang giữ lượt gọi</span> : draftAttempt ? <div className="draft-actions"><button className="primary" disabled={busy} onClick={() => void repo.resumeAttempt(draftAttempt.id).then((result) => { setClaimId(result.claimId); setOrdinal(result.ordinal); setMessage('Đã tiếp tục lượt gọi đang dở.'); }).catch((e) => setError(errorText(e)))}>Tiếp tục lượt {draftAttempt.ordinal}</button><button className="cancel-call" disabled={busy} onClick={() => void cancelDraft(draftAttempt.id)}>Hủy lượt dở</button></div> : lead.attemptCount >= MAX_ATTEMPTS ? <span className="muted-state">Đã đủ 5 lượt</span> : <button className="primary start-call" disabled={busy} onClick={() => void beginCall()}>Bắt đầu gọi <span>→</span></button>}</div>
            {claimId && <>
              <div className="recorder"><div className="rec-icon">{recording ? <span className="pulse" /> : '◉'}</div><div className="rec-copy"><b>{recording ? 'Đang ghi âm cuộc gọi' : clip ? 'Audio đã sẵn sàng' : 'Ghi âm qua micro máy tính'}</b><small>{recording ? 'Điện thoại để loa ngoài để thu được hai chiều.' : clip ? `${clipName} · ${formatDuration(clipDuration)} · ${formatSize(clip?.size ?? 0)}` : 'Chỉ bắt đầu khi khách hàng đồng ý ghi âm.'}</small>{clip && !recording && <audio ref={previewRef} controls src={clipPreviewUrl} />}</div><div className="rec-actions">{recording ? <><time>{formatDuration(seconds)}</time><button className="stop-button" onClick={stopRecording} aria-label="Dừng ghi âm">■ Dừng</button></> : <><button className={clip ? 'outline-button' : 'record-button'} onClick={() => void startRecording()}>{clip ? 'Ghi lại' : '● Ghi âm'}</button><label className="upload-button">Tải audio<input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" onChange={(e) => void selectFile(e)} /></label>{clip && <button className="remove-audio" onClick={() => { setClip(null); setClipName(''); setClipDuration(0); pendingUploadRef.current = null; }}>Xóa audio</button>}</>}</div></div>
              <div className="outcome-head"><b>Kết quả cuộc gọi</b><small>Chọn một kết quả để lưu lượt này</small></div><div className="outcome-grid">{outcomes.map((item) => <button key={item.id} className={outcome === item.id ? 'chosen' : ''} onClick={() => setOutcome(item.id)}>{outcome === item.id && <span>✓</span>}{item.label}</button>)}</div>
              <label className="note-field">Ghi chú cuộc gọi {outcome === 'other' && <b>(bắt buộc với Khác)</b>}<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú thêm nếu cần..." rows={2} /></label>
              <label className="verify-check"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /><span><b>Đã xác minh</b><small>Cần audio hợp lệ và tạo link bàn giao cho khách.</small></span></label>
              <div className="save-row"><button className="cancel-call" disabled={busy} onClick={() => { if (window.confirm('Hủy lượt gọi này? Lượt sẽ không tính vào giới hạn.')) void cancelDraft(claimId); }}>Hủy lượt</button><button className="primary save-button" disabled={busy || recording || !outcome} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu kết quả & tiếp tục'} <span>→</span></button></div>
            </>}
          </div>

          <div className="history-section"><div className="section-title small-title"><div><span className="overline">LỊCH SỬ</span><h3>Các lượt gọi & bàn giao</h3></div>{lead.syncStatus && <span className={`sync-pill ${lead.syncStatus.state === 'blocked' ? 'bad' : ''}`}>Sheet: {lead.syncStatus.state === 'succeeded' ? 'Đã đồng bộ' : lead.syncStatus.state === 'blocked' ? 'Cần xử lý' : 'Đang chờ'}</span>}</div>
            {lead.attempts.length === 0 ? <p className="history-empty">Chưa có lượt gọi nào được lưu.</p> : <div className="history-list">{[...lead.attempts].reverse().map((attempt) => <article className="history-item" key={attempt.id}><span className={`history-mark ${attempt.state}`}>{attempt.state === 'completed' ? '✓' : '·'}</span><div className="history-copy"><b>Lượt {attempt.ordinal} · {outcomeLabel(attempt.outcome)}</b><small>{new Date(attempt.completedAt ?? attempt.startedAt).toLocaleString('vi-VN')}{attempt.note ? ` · ${attempt.note}` : ''}</small>{attempt.state === 'draft' && <button onClick={() => { void repo.resumeAttempt(attempt.id).then((res) => { setClaimId(res.claimId); setOrdinal(res.ordinal); }); }}>Tiếp tục lượt đang dở</button>}</div></article>)}</div>}
            {lead.legacySourceMetadata && <article className="legacy-history"><div><span className="overline">KẾT QUẢ ĐÃ CÓ TRONG SHEET</span><b>{lead.legacySourceMetadata.outcome ?? 'Chưa có kết quả'}</b><small>{lead.legacySourceMetadata.evaluation ? `Đánh giá cũ: ${lead.legacySourceMetadata.evaluation === 'verified' ? 'Đã xác minh' : 'Chưa xác minh'}` : 'Chưa có đánh giá cũ'}{lead.legacySourceMetadata.evaluationAt ? ` · ${new Date(lead.legacySourceMetadata.evaluationAt).toLocaleString('vi-VN')}` : ''}</small>{lead.legacySourceMetadata.note && <small>{lead.legacySourceMetadata.note}</small>}</div>{lead.legacySourceMetadata.recordingLinks.map((url, index) => <a href={safeLink(url)} key={`${url}-${index}`} target="_blank" rel="noreferrer">Link cũ {index + 1} ↗</a>)}</article>}
            {lead.recordings.length > 0 && <div className="recording-library"><span className="overline">BẢN GHI ÂM</span>{[...lead.recordings].reverse().map((item) => { const activeShare = lead.shares.find((share) => share.recordingId === item.id && share.state === 'active'); return <article className="recording-row" key={item.id}><div><b>REC-{item.id.slice(-6).toUpperCase()}</b><small>{item.state === 'ready' ? `${formatDuration(item.durationSeconds ?? 0)} · ${new Date(item.recordedAt ?? '').toLocaleString('vi-VN')}` : `Audio ${item.state}`}</small></div><div className="recording-actions">{activeShare && <a href={activeShare.publicUrl} target="_blank" rel="noreferrer">Nghe ↗</a>}{item.state === 'ready' && lead.handoff?.recordingId !== item.id && <button disabled={busy} onClick={() => void replaceHandoff(item.id)}>Dùng làm bản bàn giao…</button>}{activeShare && (actor?.role === 'admin' || item.createdBy === actor?.id) && <button className="revoke-button" disabled={busy} onClick={() => { if (window.confirm('Thu hồi link này? Người dùng sẽ không thể mở link để lấy URL phát mới.')) void revokeRecordingShare(activeShare.id); }}>Thu hồi link</button>}</div></article>; })}</div>}
            <div className="assessment"><div><b>Đánh giá cuối</b><small>{assessment ? `Trạng thái hiện tại: ${assessment === 'verified' ? 'Đã xác minh' : 'Chưa xác minh'}` : 'Được phép đánh giá sau tối đa 5 lượt.'}</small></div><div className="assessment-actions"><button className={assessment === 'verified' ? 'assess-active' : ''} disabled={busy} onClick={() => void assess('verified')}>Đã xác minh</button><button className={assessment === 'unverified' ? 'assess-active' : ''} disabled={busy} onClick={() => void assess('unverified')}>Chưa xác minh</button></div></div>
            {lead.handoff && <div className="handoff-card"><div><span className="overline">LINK BÀN GIAO · PHIÊN BẢN {lead.handoff.version}</span><a href={lead.shares.find((s) => s.id === lead.handoff?.shareId)?.publicUrl} target="_blank" rel="noreferrer">Mở trang nghe bản ghi ↗</a><small>{new Date(lead.handoff.changedAt).toLocaleString('vi-VN')} · Link gắn với một bản ghi cụ thể</small></div></div>}
          </div>
        </> : <div className="blank-state"><span className="blank-icon">☎</span><span className="overline">SẴN SÀNG BẮT ĐẦU</span><h2>Chọn một lead trong hàng đợi</h2><p>Gọi bằng điện thoại thật ở chế độ loa ngoài, ghi âm qua micro máy tính và lưu kết quả ngay tại đây.</p><div className="mini-steps"><span><b>01</b> Chọn lead</span><i>→</i><span><b>02</b> Gọi & ghi âm</span><i>→</i><span><b>03</b> Lưu kết quả</span></div></div>}
        {error && <div className="toast error" role="alert"><span>!</span>{error}<button aria-label="Đóng thông báo" onClick={() => setError('')}>×</button></div>}{message && <div className="toast success" role="status"><span>✓</span><span>{message}{shareUrl && <> <a href={shareUrl} target="_blank" rel="noreferrer">Mở link nghe</a> <button aria-label="Sao chép link bàn giao" onClick={() => void navigator.clipboard?.writeText(new URL(shareUrl, location.origin).toString())}>Sao chép link</button></>}</span><button aria-label="Đóng thông báo" onClick={() => { setMessage(''); setShareUrl(''); }}>×</button></div>}
        <footer className="status-footer"><span className="status-led" /> App lưu trạng thái trước · Sheet đồng bộ nền{lead?.syncStatus?.lastError && <small> · {lead.syncStatus.lastError}</small>}</footer>
      </section>
    </div>
    {adminOpen && init.mode === 'supabase' && <SheetMappingAdmin repo={repo as SupabaseRepository} onClose={() => setAdminOpen(false)} />}
    {adminOpen && isDemo && <div className="admin-backdrop" role="presentation"><section className="demo-admin" role="dialog" aria-modal="true"><button onClick={() => setAdminOpen(false)}>Đóng</button><h2>Cấu hình Sheet không có trong demo</h2><p>Demo chỉ thao tác với dữ liệu giả cục bộ. Hãy chọn chế độ Supabase và dùng tài khoản admin để khám phá, kiểm tra và lưu mapping.</p></section></div>}
  </main>;
}

function PublicRecording({ repo, token }: { repo: LeadCallRepository | null; token: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<LeadCallRepository['resolveShare']>> | null>(null); const [error, setError] = useState(''); const [downloading, setDownloading] = useState(false);
  const refresh = useCallback(async () => { if (!repo) throw new Error('Không thể mở bản ghi này.'); const next = await repo.resolveShare(token); setInfo(next); setError(''); return next; }, [repo, token]);
  useEffect(() => { void refresh().catch((e) => setError(errorText(e))); }, [refresh]);
  async function download() {
    if (!info || !repo) return;
    setDownloading(true); setError('');
    try {
      let response = await fetch(info.signedAudioUrl);
      if (response.status === 401 || response.status === 403) { const refreshed = await refresh(); response = await fetch(refreshed.signedAudioUrl); }
      if (!response.ok) throw new Error('Không thể tải bản ghi. Link có thể đã hết hạn hoặc bị thu hồi.');
      const objectUrl = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = `${info.recordingCode}.webm`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (e) { setError(errorText(e)); } finally { setDownloading(false); }
  }
  return <main className="public-page"><div className="public-card"><span className="brand-symbol">V</span><span className="overline">BẢN GHI CUỘC GỌI</span>{error ? <><h1>Không mở được bản ghi</h1><p>{error}</p>{repo && <button className="outline-button" onClick={() => void refresh().catch((e) => setError(errorText(e)))}>Thử tải lại</button>}</> : info ? <><h1>{info.recordingCode}</h1><p>Ghi lúc {new Date(info.recordedAt).toLocaleString('vi-VN')} · {formatDuration(info.durationSeconds)}</p>{repo && 'getRecordingBlob' in repo && info.signedAudioUrl.startsWith('blob:') && <div className="local-public-note">Link demo chỉ nghe được trên trình duyệt này.</div>}<audio controls autoPlay src={info.signedAudioUrl} onError={() => void refresh().catch((e) => setError(errorText(e)))}>Trình duyệt không hỗ trợ phát audio.</audio><button className="download-link" disabled={downloading} onClick={() => void download()}>{downloading ? 'Đang tải…' : 'Tải bản ghi xuống ↓'}</button><small>Link này chỉ hiển thị thông tin của bản ghi âm.</small></> : <p>Đang tải bản ghi…</p>}</div></main>;
}
function formatDuration(value: number) { const seconds = Math.floor(value || 0); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function formatSize(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function safeLink(value: string) { try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.'; }
