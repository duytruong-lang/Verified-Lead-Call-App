import { describe, expect, it } from 'vitest';
import { formatIdentityConflict } from './admin-contract';

describe('Sheets admin response contract', () => {
  it('normalizes structured database conflicts to the string expected by the admin UI', () => {
    expect(formatIdentityConflict({ kind: 'duplicate_sheet_lead_uuid', source: 'google_sheet' })).toBe('duplicate sheet lead uuid');
    expect(formatIdentityConflict({ kind: 'source_row_reconciliation', error: 'row changed' })).toBe('source row reconciliation: row changed');
    expect(formatIdentityConflict('manual conflict')).toBe('manual conflict');
  });
});
