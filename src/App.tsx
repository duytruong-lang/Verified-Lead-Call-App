import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRepository } from './adapters/createRepository';
import { RepositoryError, type LeadCallRepository } from './shared/repository';
import { SupabaseRepository } from './adapters/supabase';
import { SheetMappingAdmin } from './components/SheetMappingAdmin';
import { AuthCompletion } from './components/ui/auth-completion';
import { CleanMinimalSignIn } from './components/ui/clean-minimal-sign-in';
import { TeamAccessCard } from './components/ui/team-access-card';
import { Users } from 'lucide-react';
import { MAX_ATTEMPTS, RECORDING_LIMIT_BYTES, RECORDING_LIMIT_SECONDS, type Actor, type ContactOutcome, type LeadDetails, type LeadQueue, type LeadSummary, type MemberLink, type MemberRole, type Recording, type TeamMember, type UUID } from './shared/types';

const queues: { id: LeadQueue; label: string }[] = [{ id: 'not_called', label: 'Chưa gọi' }, { id: 'in_progress', label: 'Đang xử lý' }, { id: 'callback', label: 'Gọi lại' }, { id: 'finished', label: 'Đã kết thúc' }];
const outcomes: { id: ContactOutcome; label: string }[] = [{ id: 'interested', label: 'Có quan tâm' }, { id: 'unreachable', label: 'Thuê bao/máy bận' }, { id: 'callback', label: 'Gọi lại sau' }, { id: 'hung_up', label: 'Cúp máy ngang' }, { id: 'not_interested', label: 'Không có nhu cầu' }, { id: 'spam', label: 'Spam/Phá máy' }, { id: 'wrong_number', label: 'Sai số' }, { id: 'other', label: 'Khác' }];
const outcomeLabel = (key: ContactOutcome | null) => outcomes.find((item) => item.id === key)?.label ?? 'Chưa lưu';
type AppInit = { mode: 'demo' | 'supabase' | null; repository: LeadCallRepository | null; error: string };

export function App() {
  const [init] = useState<AppInit>(() => { try { return { ...createRepository(), error: '' }; } catch (e) { return { mode: null, repository: null, error: e instanceof Error ? e.message : 'Không thể khởi tạo ứng dụng.' }; } });
  const repo = init.repository;
  const [actor, setActor] = useState<Actor | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authFlow, setAuthFlow] = useState<'sign-in' | 'setup' | 'confirm'>(() => window.location.pathname === '/auth/setup' ? 'setup' : window.location.pathname === '/auth/confirm' ? 'confirm' : 'sign-in');
  const [setupReady, setSetupReady] = useState(false);
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
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [assessment, setAssessment] = useState<'verified' | 'unverified' | null>(null);
  const [expandedInfo, setExpandedInfo] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamError, setTeamError] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [sessionAccessUnknown, setSessionAccessUnknown] = useState(false);
  const sessionAccessUnknownRef = useRef(sessionAccessUnknown);
  sessionAccessUnknownRef.current = sessionAccessUnknown;
  const [mobileView, setMobileView] = useState<'queue' | 'detail'>('queue');
  const mediaRef = useRef<MediaRecorder | null>(null); const chunksRef = useRef<BlobPart[]>([]); const streamRef = useRef<MediaStream | null>(null); const timerRef = useRef<number | null>(null); const previewRef = useRef<HTMLAudioElement>(null);
  const selectedLeadRef = useRef<UUID | null>(null); const recordingLeadRef = useRef<UUID | null>(null); const discardRecordingRef = useRef(false); const recordingGenerationRef = useRef(0); const clipVersionRef = useRef(0);
  const pendingUploadRef = useRef<{ claimId: UUID; blob: Blob; idempotencyKey: string; target?: Awaited<ReturnType<LeadCallRepository['beginRecordingUpload']>>; uploaded: boolean; abortController?: AbortController } | null>(null);
  const readyRecordingRef = useRef<Recording | null>(null); const saveRequestRef = useRef<{ signature: string; key: string; shareKey: string; stage: 'preparing' | 'committing'; payload: { outcome: ContactOutcome; note: string; verified: boolean; clipVersion: number; evaluationVersion: number; recordingId?: UUID } } | null>(null);
  const operationKeysRef = useRef(new Map<string, string>());
  const actorRef = useRef(actor);
  actorRef.current = actor;
  const loseUiAccessRef = useRef<() => Promise<void>>(async () => undefined);
  const surfaceRepositoryErrorRef = useRef<(cause: unknown) => Promise<void>>(async () => undefined);
  const sessionCheckIdRef = useRef(0);
  const accessEpochRef = useRef(0);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const resetForSessionChangeRef = useRef<() => Promise<void>>(async () => undefined);
  function keyFor(operation: string) { const existing = operationKeysRef.current.get(operation); if (existing) return existing; const key = crypto.randomUUID(); operationKeysRef.current.set(operation, key); return key; }
  function clearKey(operation: string) { operationKeysRef.current.delete(operation); }
  const isDemo = init.mode === 'demo';
  const canWrite = !sessionAccessUnknown && actor?.status === 'active' && (actor.role === 'admin' || actor.role === 'staff');
  const canMutate = canWrite && !saveUncertain;
  const draftAttempt = lead?.attempts.find((attempt) => attempt.state === 'draft');
  selectedLeadRef.current = lead?.id ?? null;
  const clipPreviewUrl = useMemo(() => clip ? URL.createObjectURL(clip) : '', [clip]);
  useEffect(() => () => { if (clipPreviewUrl) URL.revokeObjectURL(clipPreviewUrl); }, [clipPreviewUrl]);

  const refresh = useCallback(async (targetQueue = queue, selectedId?: UUID) => {
    if (!repo) return;
    const epoch = accessEpochRef.current; const actorId = actorRef.current?.id;
    const current = () => epoch === accessEpochRef.current && (!actorId || actorRef.current?.id === actorId);
    const items = await repo.listLeads(targetQueue); if (!current()) return; setLeads(items);
    const preferredId = selectedId ?? lead?.id;
    const target = items.find((x) => x.id === preferredId) ?? (selectedId ? undefined : items[0]);
    if (target) { const details = await repo.getLead(target.id); if (!current()) return; setLead(details); setAssessment(details.evaluation); }
    else if (selectedId) { const details = await repo.getLead(selectedId); if (!current()) return; setLead(details); setAssessment(details.evaluation); }
    else { setLead(null); setAssessment(null); }
  }, [repo, queue, lead?.id]);
  const refreshQueueOnly = useCallback(async () => {
    if (!repo || !actor) return;
    const epoch = accessEpochRef.current; const actorId = actor.id;
    const items = await repo.listLeads(queue);
    if (epoch === accessEpochRef.current && actorRef.current?.id === actorId) setLeads(items);
  }, [repo, actor, queue]);

  useEffect(() => {
    let alive = true;
    if (!repo) { setAuthLoading(false); return; }
    const refreshSession = async () => {
      const checkId = ++sessionCheckIdRef.current;
      try {
        const { actor: current } = await repo.getSession();
        if (!alive || checkId !== sessionCheckIdRef.current) return;
        const previous = actorRef.current;
        if (!current || current.status !== 'active') {
          if (window.location.pathname !== '/auth/setup') {
            if (previous) await resetForSessionChangeRef.current();
            if (!alive || checkId !== sessionCheckIdRef.current) return;
            actorRef.current = null; setActor(null);
            if (current?.status === 'pending') setAuthError('Tài khoản đang chờ tham gia workspace. Dùng liên kết mời để hoàn tất thiết lập.');
            else if (current?.status === 'disabled') setAuthError('Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên để được hỗ trợ.');
          } else { actorRef.current = current; setActor(current); setSetupReady(Boolean(current && current.status !== 'disabled')); }
        } else {
          const sessionChanged = previous && (previous.id !== current.id || previous.memberId !== current.memberId || previous.role !== current.role || previous.status !== current.status);
          if (sessionChanged) await resetForSessionChangeRef.current();
          if (!alive || checkId !== sessionCheckIdRef.current) return;
          setSessionAccessUnknown(false);
          sessionAccessUnknownRef.current = false;
          if (!sameActor(previous, current)) { actorRef.current = current; setActor(current); }
          else { actorRef.current = previous; }
          if (window.location.pathname === '/auth/setup') setSetupReady(true);
        }
        if (current?.status === 'active') setAuthError('');
      } catch (cause) {
        if (!alive || checkId !== sessionCheckIdRef.current) return;
        if (isAccessError(cause)) {
          if (actorRef.current) await resetForSessionChangeRef.current();
          if (!alive || checkId !== sessionCheckIdRef.current) return;
          actorRef.current = null; setActor(null); setAuthError(errorText(cause));
        } else {
          accessEpochRef.current += 1;
          sessionAccessUnknownRef.current = true;
          setSessionAccessUnknown(true);
          pendingUploadRef.current?.abortController?.abort();
          if (recordingRef.current) stopRecording();
          setError('Không thể kiểm tra quyền truy cập. Đã tạm dừng thao tác; dữ liệu chưa lưu được giữ lại.');
        }
      } finally { if (alive && checkId === sessionCheckIdRef.current) setAuthLoading(false); }
    };
    void refreshSession();
    const unsubscribe = repo.onAuthChange(() => { window.setTimeout(() => { if (alive) void refreshSession(); }, 0); });
    const onFocus = () => { if (document.visibilityState === 'visible') void refreshSession(); };
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshSession(); }, 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { alive = false; window.clearInterval(poll); unsubscribe(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [repo]);
  useEffect(() => {
    const callback = new URL(window.location.href);
    if (callback.pathname !== '/auth/confirm') return;
    setAuthFlow('confirm');
    sessionCheckIdRef.current += 1;
    accessEpochRef.current += 1;
    actorRef.current = null; setActor(null);
    const tokenHash = callback.searchParams.get('token_hash');
    const type = callback.searchParams.get('type');
    window.history.replaceState({}, '', '/');
    if (!repo || !tokenHash || (type !== 'invite' && type !== 'recovery')) {
      setAuthError('Liên kết không hợp lệ hoặc đã hết hạn. Liên hệ quản trị viên để nhận liên kết mới.');
      setAuthFlow('sign-in'); setAuthLoading(false);
      return;
    }
    setBusy(true);
    void repo.acceptAuthLink(tokenHash, type).then(() => {
      window.history.replaceState({}, '', '/auth/setup');
      setAuthFlow('setup'); setSetupReady(true); setAuthError('');
    }).catch((cause) => {
      void repo.signOut().catch(() => undefined).finally(() => {
        actorRef.current = null; setActor(null); setSetupReady(false);
        setAuthError(`${errorText(cause)} Liên hệ quản trị viên để nhận liên kết mới.`);
        window.history.replaceState({}, '', '/'); setAuthFlow('sign-in');
      });
    }).finally(() => setBusy(false));
  }, [repo]);
  // Lead selection is intentionally retained while the queue refreshes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (actor?.status === 'active' && window.location.pathname !== '/auth/setup' && window.location.pathname !== '/auth/confirm') void refresh().catch((e) => setError(e.message)); }, [actor, queue]);
  useEffect(() => {
    if (!actor) return;
    const poll = () => { if (document.visibilityState === 'visible') void refreshQueueOnly().catch((e) => setError(errorText(e))); };
    const timer = window.setInterval(poll, 60_000);
    window.addEventListener('focus', poll); document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', poll); document.removeEventListener('visibilitychange', poll); };
  }, [actor, canWrite, refreshQueueOnly]);
  useEffect(() => () => { recordingGenerationRef.current += 1; if (timerRef.current) window.clearInterval(timerRef.current); mediaRef.current?.stop(); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (!claimId || !repo) return; const timer = window.setInterval(() => { void repo.resumeAttempt(claimId).catch(async (e) => { if (!(e instanceof RepositoryError) || !['UNAUTHENTICATED', 'AUTH_REQUIRED', 'AUTH_ERROR', 'FORBIDDEN', 'ACCESS_DENIED', 'MEMBER_DISABLED', 'MEMBER_INACTIVE', 'ROLE_REQUIRED', 'PERMISSION_DENIED'].includes(e.code)) setError(`Không thể gia hạn lượt gọi: ${errorText(e)}`); await surfaceRepositoryErrorRef.current(e); }); }, 5 * 60_000); return () => window.clearInterval(timer); }, [claimId, repo]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (recording || clip || claimId || busy) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [recording, clip, claimId, busy]);

  async function discardActiveRecorder() {
    const media = mediaRef.current; const stream = streamRef.current;
    discardRecordingRef.current = true; recordingGenerationRef.current += 1; invalidateAudioIntent();
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (media && media.state !== 'inactive') await new Promise<void>((resolve) => {
      media.addEventListener('stop', () => resolve(), { once: true });
      try { media.stop(); } catch { resolve(); }
    });
    stream?.getTracks().forEach((track) => track.stop());
    if (mediaRef.current === media) mediaRef.current = null;
    if (streamRef.current === stream) streamRef.current = null;
    chunksRef.current = []; recordingLeadRef.current = null; setRecording(false);
  }
  async function loseUiAccess() {
    accessEpochRef.current += 1;
    await discardActiveRecorder();
    setClaimId(null); resetComposer(); setTeamOpen(false); setAdminOpen(false);
  }
  loseUiAccessRef.current = loseUiAccess;
  async function resetForSessionChange() {
    accessEpochRef.current += 1;
    pendingUploadRef.current?.abortController?.abort();
    await discardActiveRecorder();
    setClaimId(null); resetComposer(); setLead(null); setLeads([]); setAssessment(null);
    setTeamOpen(false); setAdminOpen(false); setTeamMembers([]);
  }
  resetForSessionChangeRef.current = resetForSessionChange;
  function hasCurrentWriteAccess(epoch: number, actorId: UUID) {
    const current = actorRef.current;
    return epoch === accessEpochRef.current && !sessionAccessUnknownRef.current && current?.id === actorId && current.status === 'active' && (current.role === 'admin' || current.role === 'staff');
  }
  async function surfaceRepositoryError(cause: unknown) {
    setError(errorText(cause));
    if (!repo || !(cause instanceof RepositoryError) || !['UNAUTHENTICATED', 'AUTH_REQUIRED', 'AUTH_ERROR', 'FORBIDDEN', 'ACCESS_DENIED', 'MEMBER_DISABLED', 'MEMBER_INACTIVE', 'ROLE_REQUIRED', 'PERMISSION_DENIED'].includes(cause.code)) return;
    const checkId = ++sessionCheckIdRef.current;
    const epoch = accessEpochRef.current;
    const previous = actorRef.current;
    try {
      const { actor: current } = await repo.getSession();
      if (checkId !== sessionCheckIdRef.current || epoch !== accessEpochRef.current) return;
      if (!current || current.status !== 'active') {
        await resetForSessionChange();
        if (checkId !== sessionCheckIdRef.current) return;
        actorRef.current = null; setActor(null);
        setAuthError(current?.status === 'disabled' ? 'Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên để được hỗ trợ.' : 'Phiên đăng nhập không còn quyền truy cập. Vui lòng đăng nhập lại.');
      } else {
        const changed = previous && (previous.id !== current.id || previous.memberId !== current.memberId || previous.role !== current.role || previous.status !== current.status);
        if (changed) await resetForSessionChange();
        if (checkId !== sessionCheckIdRef.current) return;
        actorRef.current = current; setActor(current); sessionAccessUnknownRef.current = false; setSessionAccessUnknown(false);
      }
    } catch (cause) {
      if (checkId !== sessionCheckIdRef.current || epoch !== accessEpochRef.current) return;
      if (!isAccessError(cause)) {
        accessEpochRef.current += 1;
        sessionAccessUnknownRef.current = true; setSessionAccessUnknown(true);
        pendingUploadRef.current?.abortController?.abort();
        if (recordingRef.current) stopRecording();
        setError('Không thể xác minh lại quyền do dịch vụ tạm thời gián đoạn. Thao tác đã tạm dừng; dữ liệu chưa lưu được giữ lại.');
        return;
      }
      accessEpochRef.current += 1;
      await resetForSessionChange();
      if (checkId !== sessionCheckIdRef.current) return;
      actorRef.current = null; setActor(null); setAuthError('Phiên đăng nhập không còn quyền truy cập. Vui lòng đăng nhập lại.');
    }
  }
  surfaceRepositoryErrorRef.current = surfaceRepositoryError;
  async function abandonCurrentWork() {
    if (saveUncertain) return false;
    if (!(recording || clip || claimId)) return true;
    if (!window.confirm('Rời lead này sẽ hủy lượt gọi hoặc bản ghi chưa lưu. Bạn muốn tiếp tục?')) return false;
    await discardActiveRecorder();
    if (claimId && repo) { try { await repo.cancelAttempt(claimId, keyFor(`cancel:${claimId}`)); clearKey(`cancel:${claimId}`); } catch { /* expired draft may already be released */ } }
    setClaimId(null); resetComposer(); setError(''); setMessage('');
    return true;
  }
  async function openLead(item: LeadSummary) {
    if (busy || !(await abandonCurrentWork())) return;
    const epoch = accessEpochRef.current; const actorId = actorRef.current?.id;
    const details = await repo!.getLead(item.id);
    if (epoch !== accessEpochRef.current || actorRef.current?.id !== actorId) return;
    setLead(details); setAssessment(details.evaluation);
  }
  async function resumeDraft(attemptId: UUID) {
    if (!repo || !canMutate || !actor) return;
    const epoch = accessEpochRef.current; const actorId = actor.id;
    try { const result = await repo.resumeAttempt(attemptId); if (!hasCurrentWriteAccess(epoch, actorId)) return; setClaimId(result.claimId); setOrdinal(result.ordinal); setMessage('Đã tiếp tục lượt gọi đang dở.'); }
    catch (cause) { await surfaceRepositoryError(cause); }
  }
  function invalidateAudioIntent() { clipVersionRef.current += 1; pendingUploadRef.current?.abortController?.abort(); pendingUploadRef.current = null; readyRecordingRef.current = null; saveRequestRef.current = null; setShareUrl(''); setSaveUncertain(false); }
  function resetComposer() { invalidateAudioIntent(); setClip(null); setClipName(''); setClipDuration(0); setOutcome(''); setNote(''); setVerified(false); setSeconds(0); }
  async function beginCall() {
    if (!repo || !lead || !canMutate || !actor) return;
    const epoch = accessEpochRef.current; const actorId = actor!.id;
    try { setBusy(true); setError(''); const key = `claim:${lead.id}`; const result = await repo.claimAttempt(lead.id, keyFor(key)); if (!hasCurrentWriteAccess(epoch, actorId)) return; clearKey(key); setClaimId(result.claimId); setOrdinal(result.ordinal); setMessage(`Đã giữ lượt gọi ${result.ordinal}/5 cho bạn.`); await refresh(queue, lead.id); }
    catch (e) { await surfaceRepositoryError(e); } finally { setBusy(false); }
  }
  async function startRecording() {
    if (!canMutate || !actor) return;
    const epoch = accessEpochRef.current; const actorId = actor.id;
    invalidateAudioIntent(); setClip(null); setClipName(''); setClipDuration(0); discardRecordingRef.current = false;
    const generation = ++recordingGenerationRef.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Trình duyệt không hỗ trợ ghi âm micro. Hãy tải file âm thanh lên.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== recordingGenerationRef.current || !hasCurrentWriteAccess(epoch, actorId)) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream; chunksRef.current = [];
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported(x));
      const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); mediaRef.current = media;
      discardRecordingRef.current = false; recordingLeadRef.current = lead?.id ?? null;
      media.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      media.onstop = () => { const blob = new Blob(chunksRef.current, { type: media.mimeType || 'audio/webm' }); stream.getTracks().forEach((t) => t.stop()); if (streamRef.current === stream) streamRef.current = null; if (mediaRef.current === media) mediaRef.current = null; setRecording(false); if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } if (generation !== recordingGenerationRef.current || discardRecordingRef.current || recordingLeadRef.current !== selectedLeadRef.current) return; if (blob.size) void acceptClip(blob, `Ghi âm ${new Date().toLocaleTimeString('vi-VN')}`); else setError('Bản ghi trống, vui lòng ghi lại.'); };
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
    const audioContext = new AudioContext();
    try { const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer()); duration = decoded.duration; }
    catch { throw new Error('Trình duyệt không giải mã được audio này. Hãy chọn file có thể phát.'); }
    finally { await audioContext.close(); }
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio không có thời lượng hợp lệ.'); if (duration > RECORDING_LIMIT_SECONDS) throw new Error('Audio vượt giới hạn 30 phút.'); return duration;
  }
  async function acceptClip(blob: Blob, name: string) { invalidateAudioIntent(); const version = clipVersionRef.current; setClip(null); setClipName(''); setClipDuration(0); try { const duration = await inspectAudio(blob); if (version !== clipVersionRef.current) return; setClip(blob); setClipName(name); setClipDuration(duration); setError(''); setMessage('Audio hợp lệ và đang được giữ trên trang này cho đến khi lưu.'); } catch (e) { if (version === clipVersionRef.current) setError(errorText(e)); } }
  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) await acceptClip(file, file.name); event.target.value = ''; }
  async function uploadClip(): Promise<Recording | undefined> {
    if (!canWrite || !actor) throw new Error('Quyền ghi nhận đã thay đổi. Hãy đăng nhập lại để tiếp tục.');
    const epoch = accessEpochRef.current; const actorId = actor.id;
    const assertCurrent = () => { if (!hasCurrentWriteAccess(epoch, actorId)) throw new Error('Quyền truy cập đã thay đổi. Hãy thử lại sau khi đăng nhập.'); };
    if (!clip || !lead || !claimId || !repo) return readyRecordingRef.current ?? undefined;
    if (readyRecordingRef.current?.attemptId === claimId) return readyRecordingRef.current;
    let pending = pendingUploadRef.current;
    if (!pending || pending.claimId !== claimId || pending.blob !== clip) { pending = { claimId, blob: clip, idempotencyKey: crypto.randomUUID(), uploaded: false }; pendingUploadRef.current = pending; }
    const beginTarget = () => repo.beginRecordingUpload({ leadId: lead.id, claimId, filename: clipName, contentType: clip.type || 'audio/webm', sizeBytes: clip.size, idempotencyKey: pending!.idempotencyKey });
    let renewedTarget = false;
    if (!pending.target || Date.parse(pending.target.expiresAt) <= Date.now() + 5_000) { renewedTarget = Boolean(pending.target); pending.target = await beginTarget(); assertCurrent(); }
    if (!pending.uploaded && Date.parse(pending.target.expiresAt) <= Date.now() + 5_000) {
      pending.target = await beginTarget(); assertCurrent(); renewedTarget = true;
      if (Date.parse(pending.target.expiresAt) <= Date.now()) throw new Error('URL tải audio vẫn hết hạn sau khi làm mới. Hãy thử lưu lại.');
    }
    if (!pending.uploaded) {
      if (isDemo && 'uploadRecordingBlob' in repo) { await (repo as typeof repo & { uploadRecordingBlob(input: { recordingId: UUID; blob: Blob }): Promise<void> }).uploadRecordingBlob({ recordingId: pending.target.recordingId, blob: clip }); assertCurrent(); }
      else {
        const controller = new AbortController(); pending.abortController = controller;
        const put = (url: string) => fetch(url, { method: 'PUT', headers: { 'Content-Type': clip.type || 'audio/webm', 'x-upsert': 'false' }, body: clip, signal: controller.signal });
        let response = await put(pending.target.uploadUrl);
        assertCurrent();
        if ((response.status === 401 || response.status === 403) && !renewedTarget) {
          pending.target = await beginTarget(); assertCurrent(); renewedTarget = true; response = await put(pending.target.uploadUrl); assertCurrent();
        }
        if (!response.ok && response.status !== 409) throw new Error(`Tải audio lên thất bại (${response.status}). Bạn có thể bấm lưu lại để thử lại.`);
      }
      pending.uploaded = true;
    }
    const ready = await repo.completeRecordingUpload({ recordingId: pending.target.recordingId, sizeBytes: clip.size, durationSeconds: Math.round(clipDuration) }); assertCurrent();
    if (ready.state !== 'ready') throw new Error('Máy chủ từ chối bản ghi âm này. Hãy chọn audio khác hoặc xóa audio để chỉ lưu kết quả cuộc gọi.');
    readyRecordingRef.current = ready; pendingUploadRef.current = null; setClip(null); return ready;
  }
  async function save() {
    if (!canWrite) { setError('Quyền ghi nhận đã thay đổi. Hãy đăng nhập lại để tiếp tục.'); return; }
    if (!repo || !lead || !claimId || !outcome) { setError('Chọn lượt gọi và kết quả trước khi lưu.'); return; }
    if (outcome === 'other' && !note.trim()) { setError('Vui lòng nhập ghi chú cho kết quả Khác.'); return; }
    if (verified && !clip && readyRecordingRef.current?.state !== 'ready' && !lead.recordings.some((r) => r.state === 'ready' && r.id === lead.handoff?.recordingId)) { setError('Đánh dấu Đã xác minh cần bản ghi âm hợp lệ trong lượt này.'); return; }
    const signature = JSON.stringify([claimId, outcome, note.trim(), verified, clipVersionRef.current]);
    if (!saveRequestRef.current || saveRequestRef.current.signature !== signature) saveRequestRef.current = { signature, key: crypto.randomUUID(), shareKey: crypto.randomUUID(), stage: 'preparing', payload: { outcome, note: note.trim(), verified, clipVersion: clipVersionRef.current, evaluationVersion: lead.evaluationVersion, recordingId: readyRecordingRef.current?.id } };
    const request = saveRequestRef.current;
    const epoch = accessEpochRef.current; const actorId = actor!.id;
    let completedLead: UUID | null = null; let savedShareUrl = '';
    try {
      setBusy(true); setError(''); setMessage(''); const ready = await uploadClip();
      if (!hasCurrentWriteAccess(epoch, actorId)) return;
      request.payload.recordingId ??= ready?.id ?? readyRecordingRef.current?.id;
      let evaluation: { result: 'verified'; recordingId: UUID; expectedVersion: number } | undefined;
      if (request.payload.verified) { const recordingId = request.payload.recordingId ?? lead.handoff?.recordingId; if (!recordingId) throw new Error('Chọn bản ghi âm để xác minh.'); const share = await repo.createShare(recordingId, request.shareKey); if (!hasCurrentWriteAccess(epoch, actorId)) return; savedShareUrl = share.publicUrl; evaluation = { result: 'verified', recordingId, expectedVersion: request.payload.evaluationVersion }; }
      request.stage = 'committing';
      await repo.saveOutcome({ claimId, outcome: request.payload.outcome, note: request.payload.note || undefined, recordingId: request.payload.recordingId, evaluation, idempotencyKey: request.key });
      if (!hasCurrentWriteAccess(epoch, actorId)) return;
      completedLead = lead.id; setClaimId(null); resetComposer(); setShareUrl(savedShareUrl); setMessage(request.payload.verified ? 'Đã lưu kết quả và bàn giao bản ghi.' : 'Đã lưu kết quả. Sheet sẽ đồng bộ nền.');
    } catch (e) { if (request.stage === 'committing') setSaveUncertain(true); await surfaceRepositoryError(e); } finally { setBusy(false); }
    if (completedLead) {
      try { await advanceAfterSave(completedLead, epoch, actorId); }
      catch { if (hasCurrentWriteAccess(epoch, actorId)) setMessage('Đã lưu kết quả. Không thể tải lead tiếp theo lúc này; dữ liệu đã được ghi nhận.'); }
    }
  }
  async function advanceAfterSave(completedLeadId: UUID, epoch: number, actorId: UUID) {
    if (!repo) return;
    const items = await repo.listLeads(queue);
    if (!hasCurrentWriteAccess(epoch, actorId)) return;
    setLeads(items);
    const next = items.find((item) => item.id !== completedLeadId);
    if (next) {
      const details = await repo.getLead(next.id);
      if (!hasCurrentWriteAccess(epoch, actorId)) return;
      setLead(details); setAssessment(details.evaluation);
    } else { setLead(null); setAssessment(null); }
  }
  async function assess(result: 'verified' | 'unverified', recordingId?: UUID) {
    if (!repo || !lead || !canMutate) return;
    const epoch = accessEpochRef.current; const actorId = actor?.id; if (!actorId) return;
    try { setBusy(true); setError(''); let selectedId = recordingId; if (result === 'verified' && !selectedId) { const ready = lead.recordings.filter((r) => r.state === 'ready'); selectedId = ready.at(-1)?.id; } const shareOperation = `eval-share:${lead.id}:${lead.evaluationVersion}:${selectedId ?? ''}`; if (result === 'verified' && selectedId && !lead.shares.some((s) => s.recordingId === selectedId && s.state === 'active')) { await repo.createShare(selectedId, keyFor(shareOperation)); if (!hasCurrentWriteAccess(epoch, actorId)) return; } const operation = `evaluate:${lead.id}:${lead.evaluationVersion}:${result}:${selectedId ?? ''}`; await repo.completeEvaluation({ leadId: lead.id, result, recordingId: selectedId, expectedVersion: lead.evaluationVersion, idempotencyKey: keyFor(operation) }); if (!hasCurrentWriteAccess(epoch, actorId)) return; clearKey(operation); clearKey(shareOperation); await refresh(queue, lead.id); setMessage(result === 'verified' ? 'Đã xác minh và tạo link bàn giao.' : 'Đã lưu đánh giá chưa xác minh.'); }
    catch (e) { await surfaceRepositoryError(e); } finally { setBusy(false); }
  }
  async function cancelDraft(claim: UUID) { if (!repo || !lead || !canMutate) return; const epoch = accessEpochRef.current; const actorId = actor!.id; const operation = `cancel:${claim}`; try { setBusy(true); await discardActiveRecorder(); if (!hasCurrentWriteAccess(epoch, actorId)) return; await repo.cancelAttempt(claim, keyFor(operation)); if (!hasCurrentWriteAccess(epoch, actorId)) return; clearKey(operation); setClaimId(null); resetComposer(); const details = await repo.getLead(lead.id); if (!hasCurrentWriteAccess(epoch, actorId)) return; setLead(details); await refresh(queue, lead.id); } catch (e) { await surfaceRepositoryError(e); } finally { setBusy(false); } }
  async function replaceHandoff(recordingId: UUID) { if (!repo || !lead || !canMutate) return; const epoch = accessEpochRef.current; const actorId = actor!.id; const version = lead.handoff?.version ?? 0; const operation = `replace:${lead.id}:${version}:${recordingId}`; try { setBusy(true); await repo.replaceHandoff({ leadId: lead.id, recordingId, expectedVersion: version, idempotencyKey: keyFor(operation) }); if (!hasCurrentWriteAccess(epoch, actorId)) return; clearKey(operation); await refresh(queue, lead.id); setMessage('Đã thay bản ghi bàn giao. Link cũ vẫn gắn với bản ghi trước.'); } catch (e) { await surfaceRepositoryError(e); } finally { setBusy(false); } }
  async function revokeRecordingShare(shareId: UUID) { if (!repo || !lead || !canMutate) return; const epoch = accessEpochRef.current; const actorId = actor!.id; const operation = `revoke:${shareId}`; try { setBusy(true); await repo.revokeShare(shareId, keyFor(operation)); if (!hasCurrentWriteAccess(epoch, actorId)) return; clearKey(operation); await refresh(queue, lead.id); setMessage('Đã thu hồi link.'); } catch (e) { await surfaceRepositoryError(e); } finally { setBusy(false); } }
  async function changeQueue(id: LeadQueue) { if (id === queue || busy || !(await abandonCurrentWork())) return; setQueue(id); setLead(null); setError(''); setMessage(''); }
  async function authSubmit(nextEmail: string, nextPassword: string) {
    if (!repo) return;
    const epoch = accessEpochRef.current;
    setBusy(true); setAuthError(''); setAuthSuccess('');
    try {
      await repo.signIn(nextEmail, nextPassword);
      const session = await repo.getSession();
      if (epoch !== accessEpochRef.current) return;
      if (session.actor?.status !== 'active') throw new Error('Tài khoản chưa được kích hoạt. Liên hệ quản trị viên.');
      actorRef.current = session.actor; setActor(session.actor); setAuthLoading(false);
    } catch (cause) { const message = signInErrorText(cause); setAuthError(message); throw new Error(message); }
    finally { setBusy(false); }
  }
  async function completeOnboarding(nextPassword: string) {
    if (!repo) return;
    if (!setupReady) throw new Error('Liên kết thiết lập đã hết hạn. Hãy quay lại đăng nhập và yêu cầu liên kết mới.');
    setBusy(true); setAuthError(''); setAuthSuccess('');
    try {
      await repo.completeOnboarding(nextPassword);
      try { await repo.signOut(); } catch { /* server-side password update already succeeded; the local session may have been revoked */ }
      sessionCheckIdRef.current += 1;
      await resetForSessionChange();
      actorRef.current = null; setActor(null); setSessionAccessUnknown(false); sessionAccessUnknownRef.current = false;
      setAuthFlow('sign-in'); setSetupReady(false); setAuthSuccess('Mật khẩu đã được cập nhật. Đăng nhập bằng mật khẩu mới để tiếp tục.'); window.history.replaceState({}, '', '/');
    } catch (cause) { setAuthError(errorText(cause)); throw cause; }
    finally { setBusy(false); }
  }
  async function logout() {
    if (!repo || busy || !(await abandonCurrentWork())) return;
    try { sessionCheckIdRef.current += 1; await repo.signOut(); await loseUiAccess(); actorRef.current = null; setActor(null); } catch (cause) { setError(errorText(cause)); }
  }
  async function openTeam() {
    if (!repo || actor?.role !== 'admin' || busy || recording || clip || claimId) return;
    const epoch = accessEpochRef.current; const actorId = actor.id;
    setTeamOpen(true); setTeamBusy(true); setTeamError('');
    try { const members = await repo.listMembers(); if (epoch === accessEpochRef.current && actorRef.current?.id === actorId && actorRef.current.role === 'admin') setTeamMembers(members); } catch (cause) { if (epoch === accessEpochRef.current) setTeamError(errorText(cause)); }
    finally { setTeamBusy(false); }
  }
  async function inviteMember(email: string, role: MemberRole): Promise<MemberLink> {
    if (!repo || actor?.role !== 'admin') throw new Error('Chỉ quản trị viên mới được mời thành viên.');
    const epoch = accessEpochRef.current; const actorId = actor.id;
    const op = `team-invite:${email.trim().toLowerCase()}:${role}`;
    try { const link = await repo.inviteMember({ email: email.trim().toLowerCase(), role, idempotencyKey: keyFor(op) }); if (epoch !== accessEpochRef.current || actorRef.current?.id !== actorId || actorRef.current.role !== 'admin') throw new Error('Quyền quản trị đã thay đổi. Hãy kiểm tra danh sách thành viên trước khi thử lại.'); clearKey(op); void repo.listMembers().then((members) => { if (epoch === accessEpochRef.current && actorRef.current?.id === actorId && actorRef.current.role === 'admin') setTeamMembers(members); }).catch((cause) => { if (epoch === accessEpochRef.current) setTeamError(`Đã tạo liên kết mời. Không tải lại được danh sách: ${errorText(cause)}`); }); return link; }
    catch (cause) {
      if (cause instanceof RepositoryError && ['LINK_EXPIRED', 'LINK_REPLACED'].includes(cause.code)) {
        clearKey(op);
        void repo.listMembers().then((members) => { if (epoch === accessEpochRef.current && actorRef.current?.id === actorId && actorRef.current.role === 'admin') setTeamMembers(members); }).catch(() => undefined);
      }
      setTeamError(errorText(cause)); throw cause;
    }
  }
  async function changeMemberRole(memberId: UUID, role: MemberRole): Promise<TeamMember> {
    if (!repo || actor?.role !== 'admin') throw new Error('Chỉ quản trị viên mới được cập nhật quyền.');
    const epoch = accessEpochRef.current; const actorId = actor.id;
    const member = teamMembers.find((item) => item.id === memberId);
    if (!member) throw new Error('Thành viên không còn trong danh sách. Hãy tải lại danh sách.');
    const op = `team-role:${memberId}:${member.version}:${role}`;
    try { const updated = await repo.setMemberRole({ memberId, role, expectedVersion: member.version, idempotencyKey: keyFor(op) }); if (epoch !== accessEpochRef.current || actorRef.current?.id !== actorId || actorRef.current.role !== 'admin') throw new Error('Quyền quản trị đã thay đổi. Tải lại danh sách thành viên.'); clearKey(op); setTeamMembers((items) => items.map((item) => item.id === memberId ? updated : item)); return updated; }
    catch (cause) { setTeamError(errorText(cause)); throw cause; }
  }
  async function changeMemberStatus(memberId: UUID, status: 'active' | 'disabled'): Promise<TeamMember> {
    if (!repo || actor?.role !== 'admin') throw new Error('Chỉ quản trị viên mới được cập nhật trạng thái.');
    const epoch = accessEpochRef.current; const actorId = actor.id;
    const member = teamMembers.find((item) => item.id === memberId);
    if (!member) throw new Error('Thành viên không còn trong danh sách. Hãy tải lại danh sách.');
    const op = `team-status:${memberId}:${member.version}:${status}`;
    try { const updated = await repo.setMemberStatus({ memberId, status, expectedVersion: member.version, idempotencyKey: keyFor(op) }); if (epoch !== accessEpochRef.current || actorRef.current?.id !== actorId || actorRef.current.role !== 'admin') throw new Error('Quyền quản trị đã thay đổi. Tải lại danh sách thành viên.'); clearKey(op); setTeamMembers((items) => items.map((item) => item.id === memberId ? updated : item)); return updated; }
    catch (cause) { setTeamError(errorText(cause)); throw cause; }
  }
  async function issueMemberLink(memberId: UUID, kind: MemberLink['kind']): Promise<MemberLink> {
    if (!repo || actor?.role !== 'admin') throw new Error('Chỉ quản trị viên mới được tạo liên kết.');
    const epoch = accessEpochRef.current; const actorId = actor.id;
    const op = `team-link:${memberId}:${kind}`;
    try { const link = await repo.issueMemberLink({ memberId, kind, idempotencyKey: keyFor(op) }); if (epoch !== accessEpochRef.current || actorRef.current?.id !== actorId || actorRef.current.role !== 'admin') throw new Error('Quyền quản trị đã thay đổi. Hãy thử lại sau khi xác nhận thành viên.'); clearKey(op); return link; }
    catch (cause) {
      if (cause instanceof RepositoryError && ['LINK_EXPIRED', 'LINK_REPLACED'].includes(cause.code)) clearKey(op);
      setTeamError(errorText(cause)); throw cause;
    }
  }
  async function selectLead(item: LeadSummary) { await openLead(item); setMobileView('detail'); }

  const pathname = window.location.pathname;
  if (import.meta.env.DEV && pathname === '/__e2e/sheets-admin') return <SheetMappingAdmin repo={e2eSheetRepository as unknown as SupabaseRepository} onClose={() => { window.location.href = '/'; }} />;
  if (pathname.startsWith('/r/')) return <PublicRecording repo={repo} token={decodeURIComponent(pathname.slice(3))} />;
  if (!repo) return <main className="setup"><span className="brand-symbol">V</span><h1>Chưa thể mở workspace</h1><p>{init.error}</p><code>Chạy <b>npm run dev:demo</b> để dùng dữ liệu mẫu cục bộ, hoặc cấu hình VITE_APP_MODE=supabase.</code></main>;
  if (authLoading) return <main className="auth-screen"><section className="auth-card auth-loading" role="status">Đang kiểm tra phiên đăng nhập…</section></main>;
  if (authFlow === 'confirm') return <main className="auth-screen"><section className="auth-card auth-loading" role="status">Đang xác nhận liên kết bảo mật…</section></main>;
  if (authFlow === 'setup' || pathname === '/auth/setup') return setupReady ? <AuthCompletion busy={busy} error={authError} onComplete={completeOnboarding} /> : <main className="auth-screen"><section className="auth-card auth-card-clean"><span className="brand-symbol" aria-hidden="true">✳</span><h1>Liên kết đã hết hạn</h1><p className="auth-intro">Bạn cần một liên kết mời hoặc khôi phục mật khẩu còn hiệu lực. Liên hệ quản trị viên để nhận liên kết mới.</p><button className="primary auth-submit" onClick={() => { setAuthFlow('sign-in'); setAuthError(''); window.history.replaceState({}, '', '/'); }}>Quay lại đăng nhập</button></section></main>;
  if (!actor || actor.status !== 'active') return <CleanMinimalSignIn demo={isDemo} busy={busy} error={authError} success={authSuccess} onSignIn={authSubmit} />;

  return <main className="app-shell" data-mobile-view={mobileView}>
    <header className="app-header"><div className="brand-symbol" aria-hidden="true">✳</div><div className="brand-copy"><span className="overline">1990 AGENCY · VERIFIED CALL WORKSPACE</span><h1>Xác minh lead</h1></div><div className="header-spacer" />{isDemo && <span className="local-banner compact">DEMO · CHỈ TRÊN MÁY NÀY</span>}{actor.role === 'admin' && <button className="team-open-button" disabled={busy || recording || Boolean(clip) || Boolean(claimId)} onClick={() => void openTeam()}><Users size={18} aria-hidden="true" /> <span>Thành viên</span></button>}<button className="user-button" disabled={busy || saveUncertain} onClick={() => void logout()} aria-label="Đăng xuất"><span className="user-avatar">{actor.displayName?.slice(0, 1).toUpperCase() ?? (isDemo ? 'D' : 'N')}</span><span>{actor.displayName || actor.email || (isDemo ? 'Nhân viên demo' : 'Nhân viên')}</span><b>↗</b></button></header>
    {init.error && <div className="alert error" role="alert">{init.error}</div>}
    {sessionAccessUnknown && <div className="alert error" role="alert">Không thể xác minh quyền truy cập. Thao tác đã tạm dừng; dữ liệu chưa lưu vẫn được giữ trên trang này.</div>}
    <div className="workbench">
      <aside className="queue-column" aria-label="Hàng đợi lead">
        <div className="section-title"><div><span className="overline">HÀNG ĐỢI</span><h2>Lead cần gọi</h2></div><span className="queue-count">{leads.length}</span></div>
        <nav className="queue-tabs" aria-label="Nhóm lead">{queues.map((item) => <button key={item.id} disabled={busy || saveUncertain} className={queue === item.id ? 'selected' : ''} onClick={() => void changeQueue(item.id)}>{item.label}</button>)}</nav>
        <div className="queue-scroll">{leads.length ? leads.map((item) => <button key={item.id} disabled={busy || saveUncertain} className={`lead-row ${lead?.id === item.id ? 'active' : ''}`} onClick={() => void selectLead(item)}><span className="lead-initial">{item.displayName?.slice(0, 1) ?? 'L'}</span><span className="lead-row-copy"><b>{item.displayName ?? 'Chưa có tên'}</b><small>{item.phone}</small><small className="lead-source">{item.source}</small></span><span className="attempt-mini">{item.attemptCount}/{MAX_ATTEMPTS}</span></button>) : <div className="queue-empty"><span>✓</span><b>Chưa có lead</b><small>Lead từ Sheet sẽ xuất hiện ở nhóm này.</small></div>}</div>
        {actor.role === 'admin' && <button className="admin-link" disabled={busy || recording || Boolean(clip) || Boolean(claimId)} onClick={() => setAdminOpen(true)}>⚙ Cấu hình Sheet</button>}
      </aside>

      <section className="detail-column" aria-label="Chi tiết và thao tác cuộc gọi">
        {lead ? <>
          <button className="mobile-back" onClick={() => setMobileView('queue')}>← <span>Quay lại hàng đợi</span></button>
          <div className="lead-heading"><div className="lead-title"><span className="overline">THÔNG TIN LEAD</span><h2>{lead.displayName ?? 'Chưa có tên'}</h2><div className="phone-line">{canWrite ? <><a href={`tel:${lead.phone}`} aria-label={`Gọi ${lead.phone}`}>☎ {lead.phone}</a><button onClick={() => void navigator.clipboard?.writeText(lead.phone).then(() => setMessage('Đã sao chép số điện thoại.'))}>Sao chép</button></> : <span aria-label="Số điện thoại">☎ {lead.phone}</span>}</div></div><span className="attempt-chip">{lead.attemptCount}/{MAX_ATTEMPTS} lượt</span></div>
          {Object.keys(lead.formAnswers).length > 0 && <div className="answer-grid">{Object.entries(lead.formAnswers).map(([key, value]) => <div key={key}><small>{key.replaceAll('_', ' ')}</small><b>{value || '—'}</b></div>)}</div>}
          <button className="info-toggle" aria-expanded={expandedInfo} onClick={() => setExpandedInfo(!expandedInfo)}><span>{expandedInfo ? '⌃' : '⌄'}</span> Thông tin khác</button>
          {expandedInfo && <div className="answer-grid"><div><small>Nguồn lead</small><b>{lead.source ?? '—'}</b></div><div><small>Ngày tạo</small><b>{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('vi-VN') : '—'}</b></div><div><small>Email</small><b>{lead.email ?? '—'}</b></div><div><small>Ghi chú nhập</small><b>{lead.notes ?? '—'}</b></div></div>}

          {canWrite ? <div className="call-card">
            <div className="call-card-top"><div><span className="overline">LƯỢT GỌI {claimId ? ordinal : Math.min(draftAttempt?.ordinal ?? lead.attemptCount + 1, MAX_ATTEMPTS)}/{MAX_ATTEMPTS}</span><h3>{claimId ? 'Đang xử lý lead' : draftAttempt ? 'Có lượt gọi đang dở' : 'Ghi nhận cuộc gọi'}</h3></div>{claimId ? <span className="live-state"><i /> Đang giữ lượt gọi</span> : draftAttempt ? <div className="draft-actions"><button className="primary" disabled={busy || saveUncertain} onClick={() => void resumeDraft(draftAttempt.id)}>Tiếp tục lượt {draftAttempt.ordinal}</button><button className="cancel-call" disabled={busy} onClick={() => void cancelDraft(draftAttempt.id)}>Hủy lượt dở</button></div> : lead.attemptCount >= MAX_ATTEMPTS ? <span className="muted-state">Đã đủ 5 lượt</span> : <button className="primary start-call" disabled={busy} onClick={() => void beginCall()}>Bắt đầu gọi <span>→</span></button>}</div>
            {claimId && <>
              <div className="recorder"><div className="rec-icon">{recording ? <span className="pulse" /> : '◉'}</div><div className="rec-copy"><b>{recording ? 'Đang ghi âm cuộc gọi' : clip ? 'Audio đã sẵn sàng' : 'Ghi âm qua micro máy tính'}</b><small>{recording ? 'Điện thoại để loa ngoài để thu được hai chiều.' : clip ? `${clipName} · ${formatDuration(clipDuration)} · ${formatSize(clip?.size ?? 0)}` : 'Chỉ bắt đầu khi khách hàng đồng ý ghi âm.'}</small>{clip && !recording && <audio ref={previewRef} controls src={clipPreviewUrl} />}</div><div className="rec-actions">{recording ? <><time>{formatDuration(seconds)}</time><button className="stop-button" disabled={busy || saveUncertain} onClick={stopRecording} aria-label="Dừng ghi âm">■ Dừng</button></> : <><button disabled={busy || saveUncertain} className={clip ? 'outline-button' : 'record-button'} onClick={() => void startRecording()}>{clip ? 'Ghi lại' : '● Ghi âm'}</button><label className="upload-button">Tải audio<input disabled={busy || saveUncertain} type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" onChange={(e) => void selectFile(e)} /></label>{clip && <button className="remove-audio" disabled={busy || saveUncertain} onClick={() => { invalidateAudioIntent(); setClip(null); setClipName(''); setClipDuration(0); }}>Xóa audio</button>}</>}</div></div>
              <div className="outcome-head"><b>Kết quả cuộc gọi</b><small>Chọn một kết quả để lưu lượt này</small></div><div className="outcome-grid">{outcomes.map((item) => <button key={item.id} disabled={busy || saveUncertain} className={outcome === item.id ? 'chosen' : ''} onClick={() => setOutcome(item.id)}>{outcome === item.id && <span>✓</span>}{item.label}</button>)}</div>
              <label className="note-field">Ghi chú cuộc gọi {outcome === 'other' && <b>(bắt buộc với Khác)</b>}<textarea disabled={busy || saveUncertain} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú thêm nếu cần..." rows={2} /></label>
              <label className="verify-check"><input type="checkbox" disabled={busy || saveUncertain} checked={verified} onChange={(e) => setVerified(e.target.checked)} /><span><b>Đã xác minh</b><small>Cần audio hợp lệ và tạo link bàn giao cho khách.</small></span></label>
            <div className="save-row"><button className="cancel-call" disabled={busy || saveUncertain} onClick={() => { if (window.confirm('Hủy lượt gọi này? Lượt sẽ không tính vào giới hạn.')) void cancelDraft(claimId); }}>Hủy lượt</button><button className="primary save-button" disabled={busy || recording || !outcome} onClick={() => void save()}>{busy ? 'Đang lưu…' : saveUncertain ? 'Thử lại cùng yêu cầu lưu' : 'Lưu kết quả & tiếp tục'} <span>→</span></button></div>
            </>}
          </div> : <aside className="viewer-note" role="note"><strong>Chế độ chỉ xem</strong><span>Bạn có thể xem thông tin lead, lịch sử cuộc gọi và các link bàn giao đã có.</span></aside>}

          <div className="history-section"><div className="section-title small-title"><div><span className="overline">LỊCH SỬ</span><h3>Các lượt gọi & bàn giao</h3></div>{lead.syncStatus && <span className={`sync-pill ${lead.syncStatus.state === 'blocked' ? 'bad' : ''}`}>Sheet: {lead.syncStatus.state === 'succeeded' ? 'Đã đồng bộ' : lead.syncStatus.state === 'blocked' ? 'Cần xử lý' : 'Đang chờ'}</span>}</div>
            {lead.attempts.length === 0 ? <p className="history-empty">Chưa có lượt gọi nào được lưu.</p> : <div className="history-list">{[...lead.attempts].reverse().map((attempt) => <article className="history-item" key={attempt.id}><span className={`history-mark ${attempt.state}`}>{attempt.state === 'completed' ? '✓' : '·'}</span><div className="history-copy"><b>Lượt {attempt.ordinal} · {outcomeLabel(attempt.outcome)}</b><small>{new Date(attempt.completedAt ?? attempt.startedAt).toLocaleString('vi-VN')}{attempt.note ? ` · ${attempt.note}` : ''}</small>{canWrite && attempt.state === 'draft' && <button disabled={busy || saveUncertain} onClick={() => void resumeDraft(attempt.id)}>Tiếp tục lượt đang dở</button>}</div></article>)}</div>}
            {lead.legacySourceMetadata && <article className="legacy-history"><div><span className="overline">KẾT QUẢ ĐÃ CÓ TRONG SHEET</span><b>{lead.legacySourceMetadata.outcome ?? 'Chưa có kết quả'}</b><small>{lead.legacySourceMetadata.evaluation ? `Đánh giá cũ: ${lead.legacySourceMetadata.evaluation === 'verified' ? 'Đã xác minh' : 'Chưa xác minh'}` : 'Chưa có đánh giá cũ'}{lead.legacySourceMetadata.evaluationAt ? ` · ${new Date(lead.legacySourceMetadata.evaluationAt).toLocaleString('vi-VN')}` : ''}</small>{lead.legacySourceMetadata.note && <small>{lead.legacySourceMetadata.note}</small>}</div>{lead.legacySourceMetadata.recordingLinks.map((url, index) => <a href={safeLink(url)} key={`${url}-${index}`} target="_blank" rel="noreferrer">Link cũ {index + 1} ↗</a>)}</article>}
            {lead.recordings.length > 0 && <div className="recording-library"><span className="overline">BẢN GHI ÂM</span>{[...lead.recordings].reverse().map((item) => { const activeShare = lead.shares.find((share) => share.recordingId === item.id && share.state === 'active'); return <article className="recording-row" key={item.id}><div><b>REC-{item.id.slice(-6).toUpperCase()}</b><small>{item.state === 'ready' ? `${formatDuration(item.durationSeconds ?? 0)} · ${new Date(item.recordedAt ?? '').toLocaleString('vi-VN')}` : `Audio ${item.state}`}</small></div><div className="recording-actions">{activeShare && <a href={activeShare.publicUrl} target="_blank" rel="noreferrer">Nghe ↗</a>}{canWrite && item.state === 'ready' && lead.handoff?.recordingId !== item.id && <button disabled={busy} onClick={() => void replaceHandoff(item.id)}>Dùng làm bản bàn giao…</button>}{canWrite && activeShare && (actor.role === 'admin' || item.createdBy === actor.id) && <button className="revoke-button" disabled={busy} onClick={() => { if (window.confirm('Thu hồi link này? Người dùng sẽ không thể mở link để lấy URL phát mới.')) void revokeRecordingShare(activeShare.id); }}>Thu hồi link</button>}</div></article>; })}</div>}
            <div className="assessment"><div><b>Đánh giá cuối</b><small>{assessment ? `Trạng thái hiện tại: ${assessment === 'verified' ? 'Đã xác minh' : 'Chưa xác minh'}` : 'Được phép đánh giá sau tối đa 5 lượt.'}</small></div>{canWrite && <div className="assessment-actions"><button className={assessment === 'verified' ? 'assess-active' : ''} disabled={busy || saveUncertain} onClick={() => void assess('verified')}>Đã xác minh</button><button className={assessment === 'unverified' ? 'assess-active' : ''} disabled={busy || saveUncertain} onClick={() => void assess('unverified')}>Chưa xác minh</button></div>}</div>
            {lead.handoff && <div className="handoff-card"><div><span className="overline">LINK BÀN GIAO · PHIÊN BẢN {lead.handoff.version}</span><a href={lead.shares.find((s) => s.id === lead.handoff?.shareId)?.publicUrl} target="_blank" rel="noreferrer">Mở trang nghe bản ghi ↗</a><small>{new Date(lead.handoff.changedAt).toLocaleString('vi-VN')} · Link gắn với một bản ghi cụ thể</small></div></div>}
          </div>
        </> : <div className="blank-state"><span className="blank-icon">☎</span><span className="overline">SẴN SÀNG BẮT ĐẦU</span><h2>Chọn một lead trong hàng đợi</h2><p>Gọi bằng điện thoại thật ở chế độ loa ngoài, ghi âm qua micro máy tính và lưu kết quả ngay tại đây.</p><div className="mini-steps"><span><b>01</b> Chọn lead</span><i>→</i><span><b>02</b> Gọi & ghi âm</span><i>→</i><span><b>03</b> Lưu kết quả</span></div></div>}
        {error && <div className="toast error" role="alert"><span>!</span>{error}<button aria-label="Đóng thông báo" onClick={() => setError('')}>×</button></div>}{message && <div className="toast success" role="status"><span>✓</span><span>{message}{shareUrl && <> <a href={shareUrl} target="_blank" rel="noreferrer">Mở link nghe</a> <button aria-label="Sao chép link bàn giao" onClick={() => void navigator.clipboard?.writeText(new URL(shareUrl, location.origin).toString())}>Sao chép link</button></>}</span><button aria-label="Đóng thông báo" onClick={() => { setMessage(''); setShareUrl(''); }}>×</button></div>}
        <footer className="status-footer"><span className="status-led" /> App lưu trạng thái trước · Sheet đồng bộ nền{lead?.syncStatus?.lastError && <small> · {lead.syncStatus.lastError}</small>}</footer>
      </section>
    </div>
    {adminOpen && init.mode === 'supabase' && <SheetMappingAdmin repo={repo as SupabaseRepository} onClose={() => setAdminOpen(false)} />}
    {adminOpen && isDemo && <div className="admin-backdrop" role="presentation"><section className="demo-admin" role="dialog" aria-modal="true"><button onClick={() => setAdminOpen(false)}>Đóng</button><h2>Cấu hình Sheet không có trong demo</h2><p>Demo chỉ thao tác với dữ liệu giả cục bộ. Hãy chọn chế độ Supabase và dùng tài khoản admin để khám phá, kiểm tra và lưu mapping.</p></section></div>}
    {teamOpen && <TeamAccessCard members={teamMembers} currentMemberId={actor.memberId} currentMemberEmail={actor.email} busy={teamBusy} error={teamError} onInvite={inviteMember} onRoleChange={changeMemberRole} onStatusChange={changeMemberStatus} onIssueLink={issueMemberLink} onClose={() => setTeamOpen(false)} />}
  </main>;
}

const e2eSheetColumns = [
  { index: 0, label: 'Lead ID', header: 'lead_id', metadataId: 'stable-lead-id' },
  { index: 1, label: 'Phone', header: 'phone', metadataId: 'stable-phone' },
  { index: 2, label: 'Name', header: 'name', metadataId: 'stable-name' },
  { index: 3, label: 'Legacy outcome', header: 'legacy_outcome', metadataId: 'stable-legacy-outcome' },
  { index: 4, label: 'Outcome 1', header: 'outcome_1', metadataId: 'stable-outcome-1' },
];
let e2eIdentityConflict = true;
const e2eSheetRepository = {
  async adminSheet<T>(input: { action?: string; leadId?: string }): Promise<T> {
    if (input.action === 'status') return { mapping: null, status: { writesEnabled: false, validationErrors: [], jobs: { pending: 0, running: 0, retrying: 0, blocked: 0, succeeded: 0, latestError: null } }, blockedJobs: [], identityConflicts: e2eIdentityConflict ? [{ leadId: 'abcdef12-3456-7890-abcd-ef1234567890', conflict: 'UUID thiếu hoặc trùng trong cột đã ánh xạ', syncState: 'blocked' }] : [] } as T;
    if (input.action === 'repair-identity') { e2eIdentityConflict = false; return { repaired: true, leadId: input.leadId } as T; }
    return { columns: e2eSheetColumns, preset: { lead_id: e2eSheetColumns[0], phone: e2eSheetColumns[1], name: e2eSheetColumns[2], legacy_outcome: e2eSheetColumns[3], outcome_1: e2eSheetColumns[4] } } as T;
  },
};

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
      const audio = await response.blob(); const objectUrl = URL.createObjectURL(audio); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = `${info.recordingCode}.${audioExtension(audio.type)}`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (e) { setError(errorText(e)); } finally { setDownloading(false); }
  }
  return <main className="public-page"><div className="public-card"><span className="brand-symbol">V</span><span className="overline">BẢN GHI CUỘC GỌI</span>{error ? <><h1>Không mở được bản ghi</h1><p>{error}</p>{repo && <button className="outline-button" onClick={() => void refresh().catch((e) => setError(errorText(e)))}>Thử tải lại</button>}</> : info ? <><h1>{info.recordingCode}</h1><p>Ghi lúc {new Date(info.recordedAt).toLocaleString('vi-VN')} · {formatDuration(info.durationSeconds)}</p>{repo && 'getRecordingBlob' in repo && info.signedAudioUrl.startsWith('blob:') && <div className="local-public-note">Link demo chỉ nghe được trên trình duyệt này.</div>}<audio controls autoPlay src={info.signedAudioUrl} onError={() => void refresh().catch((e) => setError(errorText(e)))}>Trình duyệt không hỗ trợ phát audio.</audio><button className="download-link" disabled={downloading} onClick={() => void download()}>{downloading ? 'Đang tải…' : 'Tải bản ghi xuống ↓'}</button><small>Link này chỉ hiển thị thông tin của bản ghi âm.</small></> : <p>Đang tải bản ghi…</p>}</div></main>;
}
function formatDuration(value: number) { const seconds = Math.floor(value || 0); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function formatSize(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function audioExtension(contentType: string) { const type = contentType.split(';')[0].trim().toLowerCase(); return ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/aac': 'aac' } as Record<string, string>)[type] ?? 'audio'; }
function safeLink(value: string) { try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.'; }
function signInErrorText(error: unknown) {
  const message = errorText(error).toLowerCase();
  if (message.includes('invalid login credentials') || message.includes('invalid_credentials')) return 'Email hoặc mật khẩu chưa chính xác.';
  if (message.includes('email not confirmed') || message.includes('email_not_confirmed')) return 'Tài khoản chưa được xác nhận. Liên hệ quản trị viên để được hỗ trợ.';
  if (message.includes('too many requests') || message.includes('rate limit')) return 'Đăng nhập tạm thời bị giới hạn. Vui lòng đợi một chút rồi thử lại.';
  if (message.includes('fetch failed') || message.includes('network') || message.includes('failed to fetch')) return 'Không thể kết nối để đăng nhập. Kiểm tra mạng rồi thử lại.';
  return 'Không thể đăng nhập. Kiểm tra email và mật khẩu rồi thử lại.';
}
function sameActor(left: Actor | null, right: Actor | null) { return left?.id === right?.id && left?.memberId === right?.memberId && left?.role === right?.role && left?.status === right?.status; }
function isAccessError(error: unknown) { return error instanceof RepositoryError && ['UNAUTHENTICATED', 'AUTH_REQUIRED', 'AUTH_ERROR', 'FORBIDDEN', 'ACCESS_DENIED', 'MEMBER_DISABLED', 'MEMBER_INACTIVE', 'ROLE_REQUIRED', 'PERMISSION_DENIED'].includes(error.code); }
