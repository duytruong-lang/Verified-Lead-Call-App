import type { ContactOutcome, SheetColumnRef, SheetFieldMapping, SheetMapping } from '../../shared/types';

export const SHEETS_IMPORT_PAGE_SIZE = 40;
export const SHEETS_NEW_ID_BUDGET = 5;
export const SHEETS_OUTBOX_LIMIT = 3;

export interface SheetColumn {
  index: number;
  label: string;
  header: string;
  metadataId: string | null;
  formula?: string | null;
}

export type SheetRole =
  | 'lead_id' | 'phone' | 'name' | 'email' | 'source' | 'created_at'
  | 'form_answer_1' | 'form_answer_2' | 'form_answer_3' | 'form_answer_4'
  | `outcome_${1 | 2 | 3 | 4 | 5}` | `attempt_time_${1 | 2 | 3 | 4 | 5}`
  | 'evaluation' | 'evaluation_time' | 'evaluation_note' | 'recording_link'
  | 'legacy_outcome' | 'legacy_attempt_count' | 'legacy_evaluation' | 'legacy_verified_time'
  | 'legacy_recording_link' | 'legacy_pic' | 'platform_lead_id';

export interface SheetRow {
  rowNumber: number;
  values: string[];
  formulas?: Record<number, string>;
  rowMetadataId?: string | null;
  rowMetadataValue?: string | null;
  rowMetadataConflict?: boolean;
}

export interface ImportedLead {
  leadId: string;
  phone: string;
  displayName: string | null;
  email: string | null;
  source: string | null;
  createdAt: string | null;
  formAnswers: Record<string, string | null>;
  historicalAttempts: Array<{ ordinal: number; outcome: ContactOutcome | null; occurredAt: string | null; note?: string | null }>;
  legacyAttemptCount: number;
  legacyOutcome: string | null;
  legacyVerifiedAt: string | null;
  legacyEvaluation: 'verified' | 'unverified' | null;
  evaluationNote: string | null;
  legacyRecordingUrl: string | null;
  platformLeadId: string | null;
  requeue: boolean;
  sourceRow: number;
}

export interface MappingCheck { valid: boolean; errors: string[]; fingerprint: string; byRole: Map<string, SheetColumn>; inputRoles: Set<string>; outputRoles: Set<string>; }

export async function schemaFingerprint(columns: SheetColumn[]): Promise<string> {
  const stable = columns.map(c => ({ id: c.metadataId, header: c.header.trim(), index: c.index }));
  const bytes = new TextEncoder().encode(JSON.stringify(stable));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function resolveMapping(mapping: Pick<SheetMapping, 'fields' | 'schemaFingerprint' | 'writesEnabled'>, columns: SheetColumn[], currentFingerprint: string): MappingCheck {
  const errors: string[] = [];
  const byRole = new Map<string, SheetColumn>();
  const seenMetadata = new Set<string>();
  for (const c of columns) {
    if (c.metadataId && seenMetadata.has(c.metadataId)) errors.push(`Duplicate column metadata ID ${c.metadataId}.`);
    else if (c.metadataId) seenMetadata.add(c.metadataId);
  }
  if (mapping.schemaFingerprint !== currentFingerprint) errors.push('Sheet schema changed since mapping validation.');
  const refs = new Map(columns.map(c => [c.metadataId, c]));
  const roles = new Set<string>();
  const assignedColumns = new Set<string>();
  const inputRoles = new Set<string>();
  const outputRoles = new Set<string>();
  const sourceOwned = new Set<string>(['phone', 'name', 'email', 'source', 'created_at', 'form_answer_1', 'form_answer_2', 'form_answer_3', 'form_answer_4', 'legacy_outcome', 'legacy_attempt_count', 'legacy_evaluation', 'legacy_verified_time', 'legacy_recording_link', 'legacy_pic', 'platform_lead_id']);
  const appOwned = new Set<string>(['outcome_1', 'outcome_2', 'outcome_3', 'outcome_4', 'outcome_5', 'attempt_time_1', 'attempt_time_2', 'attempt_time_3', 'attempt_time_4', 'attempt_time_5', 'evaluation', 'evaluation_time', 'evaluation_note', 'recording_link']);
  for (const field of mapping.fields) {
    if (roles.has(field.role)) errors.push(`Role ${field.role} is mapped more than once.`);
    roles.add(field.role);
    if (assignedColumns.has(field.column.metadataId)) errors.push(`Column metadata ${field.column.metadataId} is assigned to multiple roles.`);
    assignedColumns.add(field.column.metadataId);
    if (field.direction !== 'output') inputRoles.add(field.role);
    if (field.direction !== 'input') outputRoles.add(field.role);
    if (sourceOwned.has(field.role) && field.direction === 'output') errors.push(`Source-owned role ${field.role} cannot be output-only.`);
    if (appOwned.has(field.role) && field.direction === 'input') errors.push(`App-owned role ${field.role} must allow output after cutover.`);
    if (field.role === 'lead_id' && field.direction !== 'both') errors.push('Stable lead ID must be mapped in both directions.');
    const column = refs.get(field.column.metadataId);
    if (!column) errors.push(`Mapped column for ${field.role} is missing.`);
    else if (column.header.trim() !== field.column.header.trim()) errors.push(`Mapped header for ${field.role} changed.`);
    else byRole.set(field.role, column);
  }
  if (!roles.has('phone')) errors.push('Phone mapping is required.');
  if (!inputRoles.has('phone')) errors.push('Phone must be mapped as an input.');
  if (!roles.has('lead_id')) errors.push('Stable app lead ID mapping is required.');
  return { valid: errors.length === 0, errors, fingerprint: currentFingerprint, byRole, inputRoles, outputRoles };
}

const norm = (value: string) => value.trim().toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const aliases: Partial<Record<SheetRole, string[]>> = {
  lead_id: ['app lead id', 'verified lead id', 'system lead id'], phone: ['phone', 'phone number', 'sdt', 'so dien thoai'],
  name: ['name', 'full name', 'fullname', 'dname', 'ten'], email: ['email'], source: ['source', 'lead source'], created_at: ['created time', 'created at', 'createdtime', 'ngay tao'],
  form_answer_1: ['flexible 1'], form_answer_2: ['flexible 2'], form_answer_3: ['flexible 3'], form_answer_4: ['flexible 4'],
  evaluation: ['danh gia lead round1', 'evaluation'], evaluation_time: ['thoi gian verified auto', 'verified time'],
  evaluation_note: ['note', 'evaluation note'], recording_link: ['recording link', 'record link'],
  legacy_outcome: ['last outcome'], legacy_attempt_count: ['attempt count'], legacy_evaluation: ['legacy evaluation'],
  legacy_verified_time: ['legacy verified time'], legacy_recording_link: ['record', 'recording'], legacy_pic: ['pic'], platform_lead_id: ['platform lead id', 'platformleadid'],
};

export function suggestPreset(columns: SheetColumn[]): Partial<Record<SheetRole, SheetColumn>> {
  const result: Partial<Record<SheetRole, SheetColumn>> = {};
  const normalized = columns.map(c => ({ c, h: norm(c.header) }));
  for (const [role, names] of Object.entries(aliases) as Array<[SheetRole, string[]]>) {
    const matches = normalized.filter(x => names.includes(x.h));
    if (matches.length === 1) result[role] = matches[0].c;
  }
  for (let i = 1; i <= 5; i++) {
    const ordinalPattern = new RegExp(`(^|\\D)${i}($|\\D)`);
    const outcome = normalized.filter(x => ordinalPattern.test(x.h) && /outcome|ket qua|result/.test(x.h));
    const time = normalized.filter(x => ordinalPattern.test(x.h) && /time|thoi gian|date/.test(x.h));
    const ordinal = i as 1 | 2 | 3 | 4 | 5;
    if (outcome.length === 1) result[`outcome_${ordinal}`] = outcome[0].c;
    if (time.length === 1) result[`attempt_time_${ordinal}`] = time[0].c;
  }
  return result;
}

function valueFor(row: SheetRow, mapping: MappingCheck, role: string): string {
  if (!mapping.inputRoles.has(role)) return '';
  const col = mapping.byRole.get(role);
  return col ? (row.values[col.index] ?? '').trim() : '';
}
function outcome(value: string): ContactOutcome | null {
  const v = norm(value);
  const known: Record<string, ContactOutcome> = {
    interested: 'interested', unreachable: 'unreachable', callback: 'callback', 'hung up': 'hung_up', 'spam pha may': 'spam',
    'not interested': 'not_interested', spam: 'spam', 'wrong number': 'wrong_number', other: 'other', 'no answer': 'unreachable', 'khong nghe may': 'unreachable',
    'co quan tam': 'interested', 'thue bao may ban': 'unreachable', 'goi lai sau': 'callback',
    'cup may ngang': 'hung_up', 'khong co nhu cau': 'not_interested', 'sai so': 'wrong_number', khac: 'other',
  };
  if (v.startsWith('khac ')) return 'other';
  return known[v] ?? null;
}
function evaluation(value: string): 'verified' | 'unverified' | null {
  const v = norm(value);
  if (v === 'verified' || v === 'da xac minh') return 'verified';
  if (v === 'unverified' || v === 'chua xac minh') return 'unverified';
  return null;
}

export function importRow(row: SheetRow, mapping: MappingCheck, dateContext: { locale?: string; timeZone?: string } = {}): ImportedLead | null {
  const phone = valueFor(row, mapping, 'phone');
  if (!phone) return null;
  const parseDate = (value: string) => parseSheetDate(value, dateContext.locale ?? 'vi-VN', dateContext.timeZone ?? 'Asia/Ho_Chi_Minh');
  const attempts: ImportedLead['historicalAttempts'] = [];
  for (let i = 1; i <= 5; i++) {
    const rawOutcome = valueFor(row, mapping, `outcome_${i}`);
    const result = outcome(rawOutcome);
    if (rawOutcome && !result) throw new Error(`Unrecognized legacy outcome at attempt ${i}: ${rawOutcome}`);
    if (result) attempts.push({ ordinal: i, outcome: result, occurredAt: parseDate(valueFor(row, mapping, `attempt_time_${i}`)) });
  }
  const legacyCount = Number(valueFor(row, mapping, 'legacy_attempt_count'));
  const legacyOutcome = valueFor(row, mapping, 'legacy_outcome') || null;
  const verifiedTimeRole = mapping.inputRoles.has('legacy_verified_time') ? 'legacy_verified_time' : 'evaluation_time';
  const legacyVerifiedAt = parseDate(valueFor(row, mapping, verifiedTimeRole));
  const legacyPic = valueFor(row, mapping, 'legacy_pic');
  if (legacyCount > 5) throw new Error(`Legacy attempt count exceeds the five-attempt limit: ${legacyCount}`);
  const evaluationRole = mapping.inputRoles.has('legacy_evaluation') ? 'legacy_evaluation' : 'evaluation';
  const rawEvaluation = valueFor(row, mapping, evaluationRole);
  const legacyEval = evaluation(rawEvaluation);
  if (rawEvaluation && !legacyEval) throw new Error(`Unrecognized legacy evaluation: ${rawEvaluation}`);
  const formAnswers: Record<string, string | null> = {};
  for (let i = 1; i <= 4; i++) formAnswers[`answer_${i}`] = valueFor(row, mapping, `form_answer_${i}`) || null;
  if (legacyPic) formAnswers.pic = legacyPic;
  const id = valueFor(row, mapping, 'lead_id');
  return {
    leadId: id, phone, displayName: valueFor(row, mapping, 'name') || null, email: valueFor(row, mapping, 'email') || null,
    source: valueFor(row, mapping, 'source') || null, createdAt: parseDate(valueFor(row, mapping, 'created_at')),
    formAnswers, historicalAttempts: attempts, legacyAttemptCount: Number.isFinite(legacyCount) ? Math.max(0, legacyCount) : 0, legacyOutcome, legacyVerifiedAt, legacyEvaluation: legacyEval,
    evaluationNote: valueFor(row, mapping, 'evaluation_note') || null,
    legacyRecordingUrl: valueFor(row, mapping, 'recording_link') || valueFor(row, mapping, 'legacy_recording_link') || null,
    platformLeadId: valueFor(row, mapping, 'platform_lead_id') || null,
    requeue: attempts.length === 0 && !(legacyCount > 0) && legacyEval === null && legacyOutcome === null && legacyVerifiedAt === null && !(valueFor(row, mapping, 'recording_link') || valueFor(row, mapping, 'legacy_recording_link')),
    sourceRow: row.rowNumber,
  };
}


export function parseSheetDate(value: string, locale = 'vi-VN', timeZone = 'Asia/Ho_Chi_Minh'): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (iso && explicitZone) {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw new Error(`Malformed Sheet date: ${raw}`);
    return date.toISOString();
  }
  const localized = raw.match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(?:(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})))(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!localized) throw new Error(`Malformed Sheet date: ${raw}`);
  let year: number; let month: number; let day: number;
  if (localized[1]) { year = Number(localized[1]); month = Number(localized[2]); day = Number(localized[3]); }
  else {
    const dmy = /^(vi|en[-_]GB|en[-_]AU|fr|de|es|it|pt|nl)/i.test(locale);
    const first = Number(localized[4]); const second = Number(localized[5]);
    day = dmy ? first : second; month = dmy ? second : first; year = Number(localized[6]);
  }
  const hour = Number(localized[7] ?? 0); const minute = Number(localized[8] ?? 0); const second = Number(localized[9] ?? 0);
  const wallDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (wallDate.getUTCFullYear() !== year || wallDate.getUTCMonth() !== month - 1 || wallDate.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error(`Malformed Sheet date: ${raw}`);
  const offsetAt = (instant: Date) => new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant).find(field => field.type === 'timeZoneName')?.value.replace('GMT', '') ?? '+00:00';
  let offset = offsetAt(wallDate);
  const adjusted = offsetAt(new Date(wallDate.getTime() - parseOffset(offset)));
  if (adjusted !== offset) offset = adjusted;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${offset || '+00:00'}`;
}
function parseOffset(offset: string): number {
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const ms = (Number(m[2]) * 60 + Number(m[3])) * 60_000;
  return m[1] === '+' ? ms : -ms;
}

export interface WriteCell { rowNumber: number; columnIndex: number; value: string | number; }
export function importPageStarts(headerRow: number, cursor: string | null, lastUsedPhoneRow: number, pageSize = 40): { backgroundStart: number; tailStart: number } {
  const firstLeadRow = headerRow + 1;
  const parsed = cursor ? Number(cursor) : firstLeadRow;
  const backgroundStart = Number.isInteger(parsed) && parsed >= firstLeadRow && parsed <= lastUsedPhoneRow ? parsed : firstLeadRow;
  return { backgroundStart, tailStart: Math.max(firstLeadRow, lastUsedPhoneRow - pageSize + 1) };
}
export function duplicateStableIds(values: string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values.map(item => item.trim()).filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return duplicates;
}

export function mappedOutputCells(rowNumber: number, mapping: MappingCheck, output: Record<string, string | number | null>): WriteCell[] {
  const cells: WriteCell[] = [];
  for (const [role, value] of Object.entries(output)) {
    const col = mapping.byRole.get(role);
    if (!col || !mapping.outputRoles.has(role)) continue;
    cells.push({ rowNumber, columnIndex: col.index, value: value ?? '' });
  }
  return cells;
}

export function makeColumnRef(column: SheetColumn): SheetColumnRef {
  if (!column.metadataId) throw new Error(`Column ${column.label} has no stable metadata identity`);
  return { metadataId: column.metadataId, currentLabel: column.label, header: column.header };
}
export function makeMapping(fields: Array<{ role: string; column: SheetColumn; required: boolean; direction: 'input' | 'output' | 'both' }>, sheet: Omit<SheetMapping, 'fields' | 'validatedAt' | 'writesEnabled' | 'schemaFingerprint'>, fingerprint: string): SheetMapping {
  const mapped: SheetFieldMapping[] = fields.map(field => ({ ...field, column: makeColumnRef(field.column) }));
  return { ...sheet, fields: mapped, schemaFingerprint: fingerprint, validatedAt: null, writesEnabled: false };
}
