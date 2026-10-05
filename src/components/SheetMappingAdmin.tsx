import { useEffect, useState } from 'react';
import type { SheetColumnRef, SheetFieldMapping, SheetMapping } from '../shared/types';
import type { SupabaseRepository } from '../adapters/supabase';

type Column = SheetColumnRef & { index: number; formula?: string | null };
type RawColumn = { index: number; label: string; header: string; metadataId: string | null; formula?: string | null };
type Validation = { valid: boolean; schemaFingerprint?: string; errors: string[]; ambiguousRoles?: string[] };
type DiscoverResult = { columns: RawColumn[]; preset: Record<string, RawColumn | null>; validation?: Validation };
type BlockedJob = { id: string; lead_id: string; state: string; last_error: string | null; created_at: string; attempts: number; desired_version: number; fencing_token: number };
type IdentityConflict = { leadId: string; conflict: string; syncState: string };
type SheetAdminResult = { validation?: Validation; mapping?: SheetMapping | null; status?: string | { writesEnabled: boolean; validationErrors: string[]; jobs: { pending: number; running: number; retrying: number; blocked: number; succeeded: number; latestError: string | null }; identityConflicts?: IdentityConflict[] }; jobs?: { pending: number; retrying: number; blocked: number; latestError: string | null; updatedAt: string | null }; blockedJobs?: BlockedJob[]; identityConflicts?: IdentityConflict[] };
const requiredRoles = new Set(['phone', 'lead_id']);
const outputRoles = new Set([
  'outcome_1', 'outcome_2', 'outcome_3', 'outcome_4', 'outcome_5',
  'attempt_time_1', 'attempt_time_2', 'attempt_time_3', 'attempt_time_4', 'attempt_time_5',
  'evaluation', 'evaluation_time', 'evaluation_note', 'recording_link',
]);
const fieldRoles = ['lead_id', 'phone', 'name', 'email', 'source', 'created_at', 'form_answer_1', 'form_answer_2', 'form_answer_3', 'form_answer_4', 'outcome_1', 'outcome_2', 'outcome_3', 'outcome_4', 'outcome_5', 'attempt_time_1', 'attempt_time_2', 'attempt_time_3', 'attempt_time_4', 'attempt_time_5', 'evaluation', 'evaluation_time', 'evaluation_note', 'recording_link', 'legacy_outcome', 'legacy_attempt_count', 'legacy_evaluation', 'legacy_verified_time', 'legacy_recording_link', 'legacy_pic', 'platform_lead_id'];
function extractSpreadsheetId(value: string) { return value.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] ?? value.trim(); }
function statusJobs(result: SheetAdminResult) { return result.jobs ?? (typeof result.status === 'object' ? result.status.jobs : undefined); }
function writesEnabled(result: SheetAdminResult) { return result.mapping?.writesEnabled ?? (typeof result.status === 'object' ? result.status.writesEnabled : false); }
function mapPreset(result: DiscoverResult, saved?: SheetMapping | null) {
  const stableColumns = result.columns.filter((column): column is RawColumn & { metadataId: string } => Boolean(column.metadataId)).map((column) => ({ metadataId: column.metadataId, currentLabel: column.label, header: column.header, index: column.index, formula: column.formula }));
  const byId = new Map(stableColumns.map((column) => [column.metadataId, column]));
  const presetFields: SheetFieldMapping[] = Object.entries(result.preset).flatMap(([role, column]) => {
    const stable = column?.metadataId ? byId.get(column.metadataId) : undefined;
    return stable && !(outputRoles.has(role) && stable.formula) ? [{ role, column: stable, required: requiredRoles.has(role), direction: role === 'lead_id' ? 'both' : outputRoles.has(role) ? 'output' : 'input' }] : [];
  });
  const savedFields = saved ? saved.fields.flatMap((field) => { const column = byId.get(field.column.metadataId); return column ? [{ ...field, column }] : []; }) : [];
  const selected = new Map((savedFields.length ? savedFields : presetFields).map((field) => [field.role, field]));
  const fields: SheetFieldMapping[] = fieldRoles.map((role) => selected.get(role) ?? { role, column: { metadataId: '', currentLabel: '', header: '' }, required: requiredRoles.has(role), direction: role === 'lead_id' ? 'both' : outputRoles.has(role) ? 'output' : 'input' });
  return { columns: stableColumns, fields };
}

export function SheetMappingAdmin({ repo, onClose }: { repo: SupabaseRepository; onClose: () => void }) {
  const [spreadsheetId, setSpreadsheetId] = useState(''); const [tabId, setTabId] = useState('0'); const [tabTitle, setTabTitle] = useState(''); const [headerRow, setHeaderRow] = useState('1');
  const [columns, setColumns] = useState<Column[]>([]); const [fields, setFields] = useState<SheetFieldMapping[]>([]); const [validation, setValidation] = useState<Validation | null>(null); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [savedStatus, setSavedStatus] = useState<SheetAdminResult | null>(null);
  const jobs = savedStatus ? statusJobs(savedStatus) : undefined;
  const [reconciling, setReconciling] = useState<string | null>(null);
  const identityConflicts = savedStatus?.identityConflicts ?? (typeof savedStatus?.status === 'object' ? savedStatus.status.identityConflicts : undefined) ?? [];
  useEffect(() => { let active = true; void repo.adminSheet<SheetAdminResult>({ action: 'status' }).then((result) => { if (!active) return; setSavedStatus(result); if (result.mapping) { setSpreadsheetId(result.mapping.spreadsheetId); setTabId(String(result.mapping.tabId)); setTabTitle(result.mapping.tabTitle); setHeaderRow(String(result.mapping.headerRow)); } }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Không đọc được trạng thái đồng bộ.'); }); return () => { active = false; }; }, [repo]);
  async function discover(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setStatus('');
    try {
      const resolvedId = extractSpreadsheetId(spreadsheetId); setSpreadsheetId(resolvedId);
      const result = await repo.adminSheet<DiscoverResult>({ action: 'discover', spreadsheetId: resolvedId, tabId: Number(tabId), headerRow: Number(headerRow) });
      const stored = savedStatus?.mapping;
      const sameTab = stored?.spreadsheetId === resolvedId && stored.tabId === Number(tabId) && stored.headerRow === Number(headerRow);
      const mapped = mapPreset(result, sameTab ? stored : null);
      if (sameTab && stored) setTabTitle(stored.tabTitle);
      setColumns(mapped.columns); setValidation(result.validation ?? null);
      setFields(mapped.fields); setStatus(`Đã đọc ${result.columns.length} cột. Hãy rà soát mapping trước khi lưu.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể đọc cấu trúc Sheet.'); } finally { setBusy(false); }
  }
  async function preparePilot() {
    if (!spreadsheetId.trim() || !window.confirm('Thao tác này sẽ thêm cột ID hệ thống và metadata vào Google Sheet. Chỉ tiếp tục nếu đây là bản pilot được phép thay đổi. Bạn xác nhận cho phép ghi cấu trúc Sheet này?')) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const resolvedId = extractSpreadsheetId(spreadsheetId); setSpreadsheetId(resolvedId);
      const result = await repo.adminSheet<{ columns: RawColumn[]; preset: Record<string, RawColumn | null>; warning: string }>({ action: 'prepare', spreadsheetId: resolvedId, tabId: Number(tabId), headerRow: Number(headerRow) });
      const mapped = mapPreset(result);
      setColumns(mapped.columns); setFields(mapped.fields); setValidation(null); setStatus(`${result.warning} Kiểm tra mapping trước khi bật ghi.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể chuẩn bị bản pilot.'); }
    finally { setBusy(false); }
  }
  function changeColumn(role: string, metadataId: string) { setValidation(null); setFields((current) => current.map((field) => field.role === role ? { ...field, column: metadataId ? columns.find((column) => column.metadataId === metadataId) ?? { metadataId: '', currentLabel: '', header: '' } : { metadataId: '', currentLabel: '', header: '' } } : field)); }
  function mapping(): SheetMapping { return { spreadsheetId: spreadsheetId.trim(), tabId: Number(tabId), tabTitle, headerRow: Number(headerRow), schemaFingerprint: validation?.schemaFingerprint ?? '', fields: fields.filter((field) => Boolean(field.column.metadataId)), validatedAt: null, writesEnabled: false }; }
  async function validate() {
    setBusy(true); setError(''); setStatus('');
    try { const result = await repo.adminSheet<SheetAdminResult>({ action: 'validate', mapping: mapping() }); setValidation(result.validation ?? null); setStatus(result.validation?.valid ? 'Mapping hợp lệ, có thể lưu để bật đồng bộ.' : 'Mapping có lỗi, vui lòng sửa các cột được báo.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thể kiểm tra mapping.'); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(''); setStatus('');
    try { const current = mapping(); const result = await repo.adminSheet<SheetAdminResult>({ action: 'save', mapping: { ...current, writesEnabled: true, validatedAt: new Date().toISOString() } }); setValidation(result.mapping ? { valid: result.mapping.writesEnabled, schemaFingerprint: result.mapping.schemaFingerprint, errors: [] } : validation); setSavedStatus((saved) => ({ ...result, jobs: result.jobs ?? saved?.jobs })); setStatus(result.status === 'writes_enabled' ? 'Đã bật đồng bộ Sheet.' : 'Đã lưu mapping.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thể lưu mapping.'); }
    finally { setBusy(false); }
  }
  async function reconcile(job: BlockedJob) {
    setReconciling(job.id); setError(''); setStatus('');
    try {
      const result = await repo.adminSheet<{ matched?: boolean; message?: string; status?: string }>({ action: 'reconcile', jobId: job.id });
      const next = await repo.adminSheet<SheetAdminResult>({ action: 'status' }); setSavedStatus(next);
      setStatus(result.message ?? (result.matched ? 'Đối soát khớp dữ liệu mới nhất.' : 'Đối soát hoàn tất; tác vụ vẫn bị chặn để kiểm tra tiếp.'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể đối soát tác vụ.'); }
    finally { setReconciling(null); }
  }
  async function repairIdentity(conflict: IdentityConflict) {
    setReconciling(conflict.leadId); setError(''); setStatus('');
    try {
      const result = await repo.adminSheet<{ repaired: boolean; leadId: string }>({ action: 'repair-identity', leadId: conflict.leadId });
      const next = await repo.adminSheet<SheetAdminResult>({ action: 'status' }); setSavedStatus(next);
      setStatus(result.repaired ? `Đã xác minh và gỡ chặn định danh lead ${result.leadId.slice(0, 8)}…` : 'Định danh chưa được xác minh; vẫn giữ chặn đồng bộ.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể đối soát định danh lead.'); }
    finally { setReconciling(null); }
  }
  return <div className="admin-backdrop" role="presentation"><section className="admin-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-admin-title"><header><div><span className="overline">QUẢN TRỊ · GOOGLE SHEETS</span><h2 id="sheet-admin-title">Cấu hình nguồn lead</h2></div><button onClick={onClose} aria-label="Đóng cấu hình">×</button></header>
    <p className="admin-intro">Dán link Google Sheets hoặc Spreadsheet ID. Chọn một tab, rồi rà soát từng trường trước khi bật đồng bộ.</p>
    {savedStatus && <div className={`mapping-status-card ${jobs?.blocked ? 'blocked' : writesEnabled(savedStatus) ? 'enabled' : ''}`}><b>{writesEnabled(savedStatus) ? 'Đồng bộ đang bật' : 'Chưa bật ghi lên Sheet'}</b><span>{jobs ? `${jobs.pending} chờ · ${('running' in jobs ? jobs.running : 0)} đang chạy · ${jobs.retrying} đang thử lại · ${jobs.blocked} bị chặn` : 'Chưa có trạng thái tác vụ.'}</span>{savedStatus.mapping?.spreadsheetId && <small>{savedStatus.mapping.tabTitle || `Tab ${savedStatus.mapping.tabId}`} · dòng tiêu đề {savedStatus.mapping.headerRow}</small>}{jobs?.latestError && <small className="mapping-latest-error">Lỗi gần nhất: {jobs.latestError}</small>}{jobs?.blocked ? <small>Có tác vụ cần đối soát. Mở cấu hình để đọc lại cột và xác thực mapping. Không ghi đè tác vụ đang bị chặn.</small> : null}</div>}
    {savedStatus?.blockedJobs?.map((job) => <div className="blocked-job" key={job.id}><div><b>Đối soát lead {job.lead_id.slice(0, 8)}…</b><small>{job.last_error ?? 'Tác vụ bị chặn'} · phiên bản {job.desired_version}</small></div><button disabled={busy || reconciling !== null} onClick={() => void reconcile(job)}>{reconciling === job.id ? 'Đang đối soát…' : 'Đối soát an toàn'}</button></div>)}
    {identityConflicts.map((conflict) => <div className="blocked-job identity-conflict" key={conflict.leadId}><div><b>Xung đột ID lead {conflict.leadId.slice(0, 8)}…</b><small>{conflict.conflict} · trạng thái {conflict.syncState}</small><small>Hệ thống chỉ gỡ chặn sau khi máy chủ xác nhận ID duy nhất và metadata hàng khớp.</small></div><button disabled={busy || reconciling !== null} onClick={() => void repairIdentity(conflict)}>{reconciling === conflict.leadId ? 'Đang kiểm tra…' : 'Đối soát ID an toàn'}</button></div>)}
    {typeof savedStatus?.status === 'object' && savedStatus.status.validationErrors.map((item) => <p className="admin-error" key={item}>• {item}</p>)}
    <form className="sheet-discover" onSubmit={(event) => void discover(event)}><label>Spreadsheet ID hoặc link<input value={spreadsheetId} onChange={(e) => { setSpreadsheetId(e.target.value); const gid = e.target.value.match(/[?&#]gid=(\d+)/); if (gid) setTabId(gid[1]); }} required placeholder="https://docs.google.com/spreadsheets/d/…" /></label><label>Tab ID<input type="number" min="0" value={tabId} onChange={(e) => setTabId(e.target.value)} required /></label><label>Tên tab<input value={tabTitle} onChange={(e) => setTabTitle(e.target.value)} placeholder="Ví dụ: Leads" /></label><label>Dòng tiêu đề<input type="number" min="1" value={headerRow} onChange={(e) => setHeaderRow(e.target.value)} required /></label><div className="discover-actions"><button className="outline-button" type="button" disabled={busy || !spreadsheetId.trim()} onClick={() => void preparePilot()}>Chuẩn bị bản pilot</button><button className="primary" disabled={busy}>Đọc cấu trúc Sheet</button></div></form>
    {columns.length > 0 && <><div className="mapping-toolbar"><div><b>Ánh xạ cột</b><small>{columns.length} cột có metadata ID · chọn theo định danh ổn định</small></div><span>{validation?.schemaFingerprint ? `Schema ${validation.schemaFingerprint.slice(0, 10)}` : 'Chưa kiểm tra'}</span></div><div className="mapping-list">{fields.map((field) => <label className="mapping-row" key={field.role}><span><b>{field.role.replaceAll('_', ' ')}</b><small>{field.direction === 'input' ? 'Lead input' : field.direction === 'both' ? 'App và Sheet' : 'Kết quả từ app'}{field.required ? ' · bắt buộc' : ' · tùy chọn'}</small></span><select aria-label={`Cột cho ${field.role}`} required={field.required} value={field.column.metadataId} onChange={(e) => changeColumn(field.role, e.target.value)}><option value="">Không ánh xạ</option>{columns.map((column) => <option key={column.metadataId} value={column.metadataId} disabled={Boolean(column.formula && field.direction !== 'input')}>{column.currentLabel} · {column.header || '(không tiêu đề)'}{column.formula ? ' · công thức' : ''}</option>)}</select></label>)}{fields.length === 0 && <p className="mapping-empty">Không có cột mang metadata ổn định để ánh xạ.</p>}</div><div className="admin-actions"><button className="outline-button" disabled={busy || fields.length === 0} onClick={() => void validate()}>Kiểm tra mapping</button><button className="primary" disabled={busy || !validation?.valid || fields.length === 0} onClick={() => void save()}>Lưu & bật đồng bộ</button></div></>}
    {validation?.errors.map((item) => <p className="admin-error" key={item}>• {item}</p>)}{validation?.ambiguousRoles?.map((role) => <p className="admin-error" key={role}>Cột mơ hồ: {role}</p>)}{error && <p className="admin-error" role="alert">{error}</p>}{status && <p className="admin-status" role="status">{status}</p>}
    <footer>Ứng dụng không lưu access token hoặc thông tin đăng nhập Google trong trình duyệt.</footer>
  </section></div>;
}
