import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsHttp, columnLabel, type FetchLike } from './google-http';

function response(data: unknown): Response { return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }

describe('Google Sheets HTTP transport with fake service', () => {
  it('discovers stable column metadata and formula cells from the tab grid', async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = vi.fn(async input => {
      const url = String(input); calls.push(url);
      if (url.includes('developerMetadata:search')) return response({ matchedDeveloperMetadata: [
        { developerMetadata: { metadataId: 77, metadataKey: 'verified_call_column', location: { dimensionRange: { sheetId: 9, dimension: 'COLUMNS', startIndex: 0 } } } },
        { developerMetadata: { metadataId: 78, metadataKey: 'verified_call_column', location: { dimensionRange: { sheetId: 9, dimension: 'COLUMNS', startIndex: 1 } } } },
      ] });
      if (url.includes('includeGridData=true')) return response({
      sheets: [{ properties: { sheetId: 9, title: 'Pilot' }, data: [{ rowData: [
        { values: [{ userEnteredValue: { stringValue: 'Phone' } }, { userEnteredValue: { stringValue: 'Attempts' } }] },
        { values: [{ userEnteredValue: { stringValue: '+84900000001' } }, { userEnteredValue: { formulaValue: '=COUNTA(A2)' }, effectiveValue: { numberValue: 1 } }] },
      ] }] }],
      });
      return response({ properties: { locale: 'vi-VN', timeZone: 'Asia/Ho_Chi_Minh' }, sheets: [{ properties: { sheetId: 9, title: 'Pilot', gridProperties: { columnCount: 2, rowCount: 2 } } }] });
    }) as FetchLike;
    const client = new GoogleSheetsHttp('fake-access-token', fetcher);
    const discovered = await client.discover('synthetic-id', 9, 1);
    expect(discovered.columns.map(c => c.metadataId)).toEqual(['77', '78']);
    expect(discovered.columns[1].formula).toBe('=COUNTA(A2)');
    expect(discovered.rows[0].rowNumber).toBe(2);
    expect(discovered.rows[0].values).toEqual(['+84900000001', '1']);
    expect(calls[1]).toContain(encodeURIComponent("'Pilot'!A1:B2"));
    expect(calls[1]).not.toContain('includeGridData=true&ranges=%27Other');
    expect(calls[2]).toContain('developerMetadata:search');
  });
  it('writes only explicitly mapped A1 cells and escapes tab names', async () => {
    const fetcher: FetchLike = vi.fn(async () => response({})) as FetchLike;
    const client = new GoogleSheetsHttp('fake-access-token', fetcher);
    await client.batchWrite('synthetic-id', "Pilot's copy", [
      { rowNumber: 3, columnIndex: 2, value: 'callback' },
      { rowNumber: 3, columnIndex: 4, value: '2026-10-06T00:00:00Z' },
    ]);
    const [url, init] = vi.mocked(fetcher).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/values:batchUpdate');
    const body = JSON.parse(String(init.body));
    expect(body.data.map((cell: { range: string }) => cell.range)).toEqual(["'Pilot''s copy'!C3", "'Pilot''s copy'!E3"]);
    expect(body.valueInputOption).toBe('RAW');
  });
  it('resolves row position by stable UUID after row reordering and rejects duplicate UUIDs', async () => {
    const fetcher: FetchLike = vi.fn(async () => response({ values: [['header'], ['other-id'], ['target-id']] })) as FetchLike;
    const client = new GoogleSheetsHttp('fake-access-token', fetcher);
    expect(await client.readRowById('synthetic-id', 'Pilot', 3, 'target-id')).toBe(3);
    vi.mocked(fetcher).mockResolvedValueOnce(response({ values: [['target-id'], ['target-id']] }));
    await expect(client.readRowById('synthetic-id', 'Pilot', 3, 'target-id')).rejects.toThrow('Duplicate stable app lead ID');
  });
  it('labels spreadsheet columns beyond Z correctly', () => {
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(77)).toBe('BZ');
  });
  it('finds the real last used phone row without treating reserved grid rows as source rows', async () => {
    let requestedUrl = '';
    const fetcher: FetchLike = vi.fn(async input => {
      requestedUrl = String(input);
      return response({ valueRanges: [{ values: [['+84900000001'], ['+84900000002']] }, { values: [['id-1'], ['']] }] });
    }) as FetchLike;
    const result = await new GoogleSheetsHttp('fake', fetcher).readIdentityColumns('synthetic-id', "Pilot's copy", 1, 4, 55);
    expect(result.lastPhoneRow).toBe(3);
    expect(result.ids).toEqual(['id-1', '']);
    expect(requestedUrl).toContain(encodeURIComponent("'Pilot''s copy'!E2:E"));
    expect(requestedUrl).toContain(encodeURIComponent("'Pilot''s copy'!BD2:BD"));
  });
});

describe('row developer metadata identity writes', () => {
  it('assigns an ID by row metadata after checking the row content and pads untouched columns', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let valueReads = 0;
    const id = '11111111-1111-4111-8111-111111111111';
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes('developerMetadata:search')) return response({ matchedDeveloperMetadata: [{ developerMetadata: { metadataId: 901, metadataKey: 'verified_call_row', metadataValue: id, location: { dimensionRange: { sheetId: 9, dimension: 'ROWS', startIndex: 6, endIndex: 7 } } } }] });
      if (url.includes('batchGetByDataFilter')) {
        valueReads++;
        return response({ valueRanges: [{ valueRange: { values: [valueReads > 1 ? ['+84900000001', 'Synthetic', '', '', '', '', '11111111-1111-4111-8111-111111111111'] : ['+84900000001', 'Synthetic']] } }] });
      }
      if (url.includes('batchUpdateByDataFilter')) return response({ totalUpdatedRows: 1 });
      return response({});
    }) as FetchLike;
    const client = new GoogleSheetsHttp('fake', fetcher);
    const row = { rowNumber: 7, rowMetadataValue: id, values: ['+84900000001', 'Synthetic', '', '', '', '', ''], formulas: {} };
    const idColumn = { index: 6, label: 'G', header: 'Verified Lead ID', metadataId: 'col-id' };
    const assigned = await client.assignStableLeadId('synthetic-id', 9, row, idColumn, row.rowMetadataValue);
    expect(assigned.leadId).toBe(id);
    const update = calls.find(call => call.url.includes('values:batchUpdateByDataFilter'));
    expect(update).toBeDefined();
    const body = JSON.parse(String(update?.init?.body));
    expect(body.data[0].dataFilter.developerMetadataLookup).toMatchObject({ metadataId: 901 });
    expect(body.data[0].values[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(body.data[0].values[0][6]).toBe(id);
  });
  it('writes by row metadata identity instead of the previously resolved A1 row number', async () => {
    const fetcher: FetchLike = vi.fn(async input => String(input).includes('batchGetByDataFilter') ? response({ valueRanges: [{ valueRange: { values: [['phone', 'id', '', '', '', '']] } }] }) : response({ totalUpdatedRows: 1 })) as FetchLike;
    const client = new GoogleSheetsHttp('fake', fetcher);
    await client.writeRowByMetadata('synthetic-id', '905', [
      { rowNumber: 4, columnIndex: 2, value: 'callback' }, { rowNumber: 4, columnIndex: 5, value: 'time' },
    ]);
    const updateCall = vi.mocked(fetcher).mock.calls.find(call => String(call[0]).includes('batchUpdateByDataFilter'));
    const body = JSON.parse(String(updateCall?.[1]?.body));
    expect(body.data[0].dataFilter.developerMetadataLookup.metadataId).toBe(905);
    expect(body.data[0].values[0]).toEqual([null, null, 'callback', null, null, 'time']);
    expect(String(updateCall?.[0])).toContain('batchUpdateByDataFilter');
    expect(String(updateCall?.[0])).not.toContain('C4');
  });
  it('rejects a row UUID that changed after discovery before overwriting it', async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = vi.fn(async input => {
      const url = String(input); calls.push(url);
      if (url.includes('developerMetadata:search')) return response({ matchedDeveloperMetadata: [{ developerMetadata: { metadataId: 905, metadataKey: 'verified_call_row', metadataValue: '11111111-1111-4111-8111-111111111111', location: { dimensionRange: { sheetId: 9, dimension: 'ROWS', startIndex: 6, endIndex: 7 } } } }] });
      if (url.includes('batchGetByDataFilter')) return response({ valueRanges: [{ valueRange: { values: [['+84900000001', 'Synthetic', '', '', '', '', '22222222-2222-4222-8222-222222222222']] } }] });
      return response({ totalUpdatedRows: 1 });
    }) as FetchLike;
    const idColumn = { index: 6, label: 'G', header: 'Verified Lead ID', metadataId: 'col-id' };
    const row = { rowNumber: 7, values: ['+84900000001', 'Synthetic', '', '', '', '', ''], formulas: {} };
    await expect(new GoogleSheetsHttp('fake', fetcher).assignStableLeadId('synthetic-id', 9, row, idColumn, '11111111-1111-4111-8111-111111111111')).rejects.toThrow('acquired a different app UUID');
    expect(calls.some(url => url.includes('batchUpdateByDataFilter'))).toBe(false);
  });
  it('rejects row metadata from a different tab or a multi-row location', async () => {
    const fetcher: FetchLike = vi.fn(async () => response({ matchedDeveloperMetadata: [{ developerMetadata: { metadataId: 17, metadataKey: 'verified_call_row', metadataValue: 'lead-uuid', location: { dimensionRange: { sheetId: 999, dimension: 'ROWS', startIndex: 4, endIndex: 6 } } } }] })) as FetchLike;
    await expect(new GoogleSheetsHttp('fake', fetcher).searchRowMetadata('synthetic-id', 9, 'lead-uuid')).rejects.toThrow('malformed or belongs to another tab');
  });
  it('preserves a formula in a mapped output cell on the specific row', async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = vi.fn(async input => {
      const url = String(input); calls.push(url);
      return url.includes('batchGetByDataFilter') ? response({ valueRanges: [{ valueRange: { values: [['phone', 'id', '=FORMULA()', '']] } }] }) : response({ totalUpdatedRows: 1 });
    }) as FetchLike;
    const client = new GoogleSheetsHttp('fake', fetcher);
    await client.writeRowByMetadata('synthetic-id', '905', [
      { rowNumber: 2, columnIndex: 2, value: 'callback' }, { rowNumber: 2, columnIndex: 3, value: 'time' },
    ]);
    const update = vi.mocked(fetcher).mock.calls.find(call => String(call[0]).includes('batchUpdateByDataFilter'));
    const body = JSON.parse(String(update?.[1]?.body));
    expect(body.data[0].values[0]).toEqual([null, null, null, 'time']);
  });
});

describe('pilot preparation retry safety', () => {
  it('preparing twice reuses the technical ID column and existing developer metadata', async () => {
    let idHeader = '';
    const metadata: Array<Record<string, unknown>> = [];
    let metadataId = 50;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes('developerMetadata:search')) return response({ matchedDeveloperMetadata: metadata.map(item => ({ developerMetadata: item })) });
      if (url.includes('includeGridData=true')) {
        const cells = [
          { userEnteredValue: { stringValue: 'Phone' }, formattedValue: 'Phone' },
          { userEnteredValue: { stringValue: 'Name' }, formattedValue: 'Name' },
          ...(idHeader ? [{ userEnteredValue: { stringValue: idHeader }, formattedValue: idHeader }] : []),
        ];
        return response({ sheets: [{ properties: { sheetId: 9, title: 'Pilot' }, data: [{ rowData: [{ values: cells }, { values: [{ formattedValue: '+84900000001' }, { formattedValue: 'Synthetic' }] }] }] }] });
      }
      if (url.includes('fields=properties(locale,timeZone)')) return response({ properties: { locale: 'vi_VN', timeZone: 'Asia/Ho_Chi_Minh' }, sheets: [{ properties: { sheetId: 9, title: 'Pilot', gridProperties: { columnCount: 6, rowCount: 10 } } }] });
      if (url.includes('?fields=sheets(properties(sheetId,gridProperties))')) return response({ sheets: [{ properties: { sheetId: 9, gridProperties: { columnCount: 6 } } }] });
      if (init?.method === 'PUT') { idHeader = 'Verified Lead ID'; return response({}); }
      if (url.includes(':batchUpdate')) {
        const body = JSON.parse(String(init?.body));
        for (const req of body.requests) {
          const dm = req.createDeveloperMetadata.developerMetadata;
          metadata.push({ metadataId: metadataId++, metadataKey: dm.metadataKey, metadataValue: dm.metadataValue, location: dm.location });
        }
        return response({});
      }
      return response({});
    }) as FetchLike;
    const client = new GoogleSheetsHttp('fake', fetcher);
    const first = await client.prepareTab('synthetic-id', 9, 1);
    const second = await client.prepareTab('synthetic-id', 9, 1);
    expect(first.leadIdColumn.index).toBe(2);
    expect(second.leadIdColumn.index).toBe(2);
    expect(calls.filter(call => call.init?.method === 'PUT')).toHaveLength(1);
    expect(calls.filter(call => call.url.includes(':batchUpdate'))).toHaveLength(1);
    expect(metadata).toHaveLength(3);
  });

  it('keeps a 40-row page to a fixed small number of API requests and scopes its grid range to the selected tab', async () => {
    const urls: string[] = [];
    const rowData = Array.from({ length: 40 }, (_, index) => ({ values: [{ formattedValue: `+8490000${String(index).padStart(4, '0')}` }] }));
    const fetcher: FetchLike = vi.fn(async input => {
      const url = String(input); urls.push(url);
      if (url.includes('developerMetadata:search')) return response({ matchedDeveloperMetadata: [] });
      if (url.includes('includeGridData=true')) return response({ sheets: [{
        properties: { sheetId: 9, title: 'Pilot' },
        data: [{ rowData: [{ values: [{ formattedValue: 'Phone' }] }] }, { rowData }],
      }] });
      return response({ properties: { locale: 'vi-VN', timeZone: 'Asia/Ho_Chi_Minh' }, sheets: [{ properties: { sheetId: 9, title: 'Pilot', gridProperties: { columnCount: 1, rowCount: 16000 } }, developerMetadata: [] }] });
    }) as FetchLike;
    const page = await new GoogleSheetsHttp('fake', fetcher).discover('synthetic-id', 9, 1, 100, 40);
    expect(page.rows).toHaveLength(40);
    expect(page.rows[0].rowNumber).toBe(100);
    expect(urls).toHaveLength(3);
    expect(urls[1]).toContain(encodeURIComponent("'Pilot'!A1:A1"));
    expect(urls[1]).toContain(encodeURIComponent("'Pilot'!A100:A139"));
    expect(urls[1]).not.toContain('16000');
  });
});
