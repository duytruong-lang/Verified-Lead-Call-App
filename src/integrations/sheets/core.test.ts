import { describe, expect, it } from 'vitest';
import { duplicateStableIds, importPageStarts, importRow, mappedOutputCells, resolveMapping, schemaFingerprint, suggestPreset, type SheetColumn, type SheetRow } from './core';

const columns: SheetColumn[] = [
  { index: 0, label: 'A', header: 'CreatedTime', metadataId: '11', formula: null },
  { index: 1, label: 'B', header: 'Phone', metadataId: '12', formula: null },
  { index: 2, label: 'C', header: 'DName', metadataId: '13', formula: null },
  { index: 3, label: 'D', header: 'Attempt 1 Outcome', metadataId: '14', formula: null },
  { index: 4, label: 'E', header: 'Attempt 1 Time', metadataId: '15', formula: null },
  { index: 5, label: 'F', header: 'Attempt count', metadataId: '16', formula: '=COUNTA(D2:L2)' },
  { index: 6, label: 'G', header: 'App Lead ID', metadataId: '17', formula: null },
];
const fields = columns.filter(c => [1, 3, 4, 5, 6].includes(c.index)).map(c => ({ role: c.index === 1 ? 'phone' : c.index === 6 ? 'lead_id' : c.index === 3 ? 'outcome_1' : c.index === 4 ? 'attempt_time_1' : 'legacy_attempt_count', column: { metadataId: c.metadataId!, currentLabel: c.label, header: c.header }, required: c.index === 1 || c.index === 6, direction: 'both' as const }));

async function mapping() { return { schemaFingerprint: await schemaFingerprint(columns), writesEnabled: true, fields }; }

describe('Sheets core', () => {
  it('prioritizes an appended lead from used phone values even when the saved cursor is far behind reserved grid rows', () => {
    // The actual workbook grid may be 15,512 rows, while the last used phone row is 1,689.
    expect(importPageStarts(1, '850', 1689, 40)).toEqual({ backgroundStart: 850, tailStart: 1650 });
  });
  it('detects duplicate stable IDs across the full identity-column scan', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(duplicateStableIds(['', id, ...Array.from({ length: 1600 }, () => ''), id])).toEqual(new Set([id]));
  });
  it('suggests roles by header instead of hard-coded letters', () => {
    const preset = suggestPreset(columns);
    expect(preset.phone?.metadataId).toBe('12');
    expect(preset.lead_id?.metadataId).toBe('17');
    expect(preset.outcome_1?.metadataId).toBe('14');
  });
  it('fails closed on metadata gaps and schema drift', async () => {
    const m = await mapping();
    const drift = [...columns, { index: 7, label: 'H', header: 'Phone', metadataId: null }];
    const check = resolveMapping(m, drift, await schemaFingerprint(drift));
    expect(check.valid).toBe(false);
    expect(check.errors.some(e => e.includes('schema changed'))).toBe(true);
    expect(check.errors.some(e => e.includes('changed'))).toBe(true);
  });
  it('rejects source/output direction mistakes and an output-only stable ID', async () => {
    const invalid = { schemaFingerprint: 'x', writesEnabled: true, fields: [
      { ...fields[0], direction: 'output' as const },
      { ...fields[fields.length - 1], direction: 'output' as const },
      { ...fields.find(field => field.role === 'outcome_1')!, direction: 'input' as const },
    ] };
    const check = resolveMapping(invalid, columns, 'x');
    expect(check.valid).toBe(false);
    expect(check.errors).toContain('Phone must be mapped as an input.');
    expect(check.errors).toContain('Stable lead ID must be mapped in both directions.');
    expect(check.errors.some(error => error.includes('App-owned role outcome_1'))).toBe(true);
  });
  it('imports history and keeps same-phone leads distinct without requeueing finished leads', async () => {
    const m = await mapping();
    const check = resolveMapping(m, columns, m.schemaFingerprint);
    const first: SheetRow = { rowNumber: 2, values: ['2025-01-01', '+84900000001', 'Synthetic A', 'interested', '2025-01-02', '1', '11111111-1111-4111-8111-111111111111'] };
    const second: SheetRow = { rowNumber: 3, values: ['2025-01-02', '+84900000001', 'Synthetic B', '', '', '0', '22222222-2222-4222-8222-222222222222'] };
    expect(importRow(first, check)?.requeue).toBe(false);
    expect(importRow(first, check)?.historicalAttempts[0]?.outcome).toBe('interested');
    expect(importRow(second, check)?.requeue).toBe(true);
    expect(importRow(second, check)?.leadId).not.toBe(importRow(first, check)?.leadId);
  });
  it('emits mapped output roles only and delegates per-row formula protection to HTTP writer', () => {
    const m = { schemaFingerprint: 'x', writesEnabled: true, fields };
    const check = resolveMapping(m, columns, 'x');
    const cells = mappedOutputCells(2, check, { legacy_attempt_count: '2', outcome_1: 'callback', unknown: 'ignored' });
    expect(cells).toEqual([{ rowNumber: 2, columnIndex: 5, value: '2' }, { rowNumber: 2, columnIndex: 3, value: 'callback' }]);
    expect(mappedOutputCells(2, check, {}).length).toBe(0);
  });
});

describe('Vietnamese legacy outcomes', () => {
  it.each([
    ['Có quan tâm', 'interested'], ['Thuê bao/máy bận', 'unreachable'], ['Gọi lại sau', 'callback'],
    ['Cúp máy ngang', 'hung_up'], ['Không có nhu cầu', 'not_interested'], ['Spam/Phá máy', 'spam'],
    ['Sai Số', 'wrong_number'], ['Khác (fill bên cột M)', 'other'],
  ])('maps legacy label %s to %s', async (label, expected) => {
    const m = await mapping();
    const check = resolveMapping(m, columns, m.schemaFingerprint);
    const row: SheetRow = { rowNumber: 9, values: ['', '+84900000009', '', label, '', '1', '99999999-9999-4999-8999-999999999999'] };
    expect(importRow(row, check)?.historicalAttempts[0]?.outcome).toBe(expected);
  });
});
