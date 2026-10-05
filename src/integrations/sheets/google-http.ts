import type { SheetColumn, SheetRow, WriteCell } from './core.ts';

export interface FetchLike { (input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }
export interface ServiceAccountCredentials { client_email: string; private_key: string; token_uri?: string; }

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const utf8b64url = (text: string) => b64url(new TextEncoder().encode(text));

export async function createServiceAccountToken(credentials: ServiceAccountCredentials, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = utf8b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = utf8b64url(JSON.stringify({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token', iat: nowSeconds, exp: nowSeconds + 3600 }));
  const unsigned = `${header}.${claims}`;
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google OAuth failed (${response.status}): ${body.error_description ?? 'token missing'}`);
  return body.access_token;
}

export class GoogleSheetsHttp {
  constructor(private readonly accessToken: string, private readonly fetcher: FetchLike = fetch) {}
  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(url, { ...init, headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json', ...init.headers } });
    const text = await response.text();
    if (!response.ok) throw Object.assign(new Error(`Google Sheets API ${response.status}: ${text.slice(0, 300)}`), { status: response.status });
    return (text ? JSON.parse(text) : {}) as T;
  }
  async discover(spreadsheetId: string, tabId: number, headerRow: number, dataStartRow = headerRow + 1, maxDataRows?: number): Promise<{ columns: SheetColumn[]; rows: SheetRow[]; locale: string; timeZone: string; tabTitle: string; rowCount: number }> {
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
    const book = await this.request<{ properties?: { locale?: string; timeZone?: string }; sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { columnCount?: number; rowCount?: number } } }> }>(`${base}?fields=properties(locale,timeZone),sheets(properties(sheetId,title,gridProperties))`);
    const target = book.sheets?.find(sheet => sheet.properties?.sheetId === tabId);
    if (!target) throw new Error(`Sheet tab ${tabId} was not found.`);
    const tabTitle = target.properties?.title ?? '';
    const rowCount = target.properties?.gridProperties?.rowCount ?? headerRow;
    const columnCount = target.properties?.gridProperties?.columnCount ?? 26;
    const tab = `'${tabTitle.replace(/'/g, "''")}'!`;
    const lastColumn = columnLabel(columnCount - 1);
    const dataEndRow = maxDataRows === undefined ? rowCount : Math.min(rowCount, dataStartRow + maxDataRows - 1);
    const ranges = maxDataRows === undefined
      ? [`${tab}A1:${lastColumn}${rowCount}`]
      : [`${tab}A${headerRow}:${lastColumn}${headerRow}`, ...(dataEndRow >= dataStartRow ? [`${tab}A${dataStartRow}:${lastColumn}${dataEndRow}`] : [])];
    const rangeQuery = ranges.map(range => `ranges=${encodeURIComponent(range)}`).join('&');
    const gridResponse = await this.request<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string }; data?: Array<{ rowData?: Array<{ values?: Array<{ userEnteredValue?: { formulaValue?: string; stringValue?: string; numberValue?: number }; effectiveValue?: { stringValue?: string; numberValue?: number }; userEnteredFormat?: unknown; formattedValue?: string }> }> }> }> }>(`${base}?includeGridData=true&${rangeQuery}&fields=sheets(properties(sheetId,title),data(rowData(values(userEnteredValue,effectiveValue,userEnteredFormat,formattedValue))))`);
    const selected = gridResponse.sheets?.find(sheet => sheet.properties?.sheetId === tabId);
    if (!selected) throw new Error(`Could not read selected tab ${tabId}.`);
    const grid = selected.data?.[0]?.rowData ?? [];
    const dataGrid = maxDataRows === undefined ? grid.slice(headerRow) : selected.data?.[1]?.rowData ?? [];
    const headerValues = maxDataRows === undefined ? grid[headerRow - 1]?.values ?? [] : grid[0]?.values ?? [];
    const metadataResult = await this.request<{ matchedDeveloperMetadata?: Array<{ developerMetadata?: { metadataId?: number; metadataKey?: string; metadataValue?: string; location?: { dimensionRange?: { sheetId?: number; dimension?: string; startIndex?: number; endIndex?: number } } } }> }>(`${base}/developerMetadata:search`, { method: 'POST', body: JSON.stringify({ dataFilters: [{ developerMetadataLookup: { metadataKey: 'verified_call_column', visibility: 'DOCUMENT' } }, { developerMetadataLookup: { metadataKey: 'verified_call_row', visibility: 'DOCUMENT' } }] }) });
    const metadata = (metadataResult.matchedDeveloperMetadata ?? []).flatMap(match => match.developerMetadata ? [match.developerMetadata] : []);
    const identities = new Map<number, string>();
    for (const entry of metadata) {
      const range = entry.location?.dimensionRange;
      if (entry.metadataKey === 'verified_call_column' && range?.sheetId === tabId && range.dimension === 'COLUMNS' && range.startIndex !== undefined && entry.metadataId !== undefined) identities.set(range.startIndex, String(entry.metadataId));
    }
    const count = Math.max(target.properties?.gridProperties?.columnCount ?? 0, headerValues.length);
    const columns: SheetColumn[] = Array.from({ length: count }, (_, index) => ({ index, label: columnLabel(index), header: cellValue(headerValues[index]), metadataId: identities.get(index) ?? null, formula: grid.find(row => row.values?.[index]?.userEnteredValue?.formulaValue)?.values?.[index]?.userEnteredValue?.formulaValue ?? null }));
    const rowMetadata = new Map<number, { id: string; value: string; conflict?: boolean }>();
    for (const entry of metadata) {
      const range = entry.location?.dimensionRange;
      if (entry.metadataKey === 'verified_call_row' && range?.sheetId === tabId && range.dimension === 'ROWS' && range.startIndex !== undefined && range.endIndex === range.startIndex + 1 && entry.metadataId !== undefined) {
        const prior = rowMetadata.get(range.startIndex);
        rowMetadata.set(range.startIndex, prior ? { id: prior.id, value: prior.value, conflict: true } : { id: String(entry.metadataId), value: entry.metadataValue ?? '' });
      }
    }
    const rows = dataGrid.map((r, i) => ({ rowNumber: maxDataRows === undefined ? headerRow + i + 1 : dataStartRow + i, rowMetadataId: rowMetadata.get((maxDataRows === undefined ? headerRow + i : dataStartRow + i) - 1)?.id ?? null, rowMetadataValue: rowMetadata.get((maxDataRows === undefined ? headerRow + i : dataStartRow + i) - 1)?.value ?? null, rowMetadataConflict: rowMetadata.get((maxDataRows === undefined ? headerRow + i : dataStartRow + i) - 1)?.conflict ?? false, values: (r.values ?? []).map(cellValue), formulas: Object.fromEntries((r.values ?? []).flatMap((v, n) => v.userEnteredValue?.formulaValue ? [[n, v.userEnteredValue.formulaValue]] : [])) }));
    return { columns, rows, locale: book.properties?.locale ?? 'vi-VN', timeZone: book.properties?.timeZone ?? 'Asia/Ho_Chi_Minh', tabTitle, rowCount };
  }
  async batchWrite(spreadsheetId: string, tabTitle: string, cells: WriteCell[]): Promise<void> {
    if (cells.length === 0) return;
    const groups = new Map<string, Array<string | number>>();
    for (const cell of cells) {
      const range = `'${tabTitle.replace(/'/g, "''")}'!${columnLabel(cell.columnIndex)}${cell.rowNumber}`;
      groups.set(range, [cell.value]);
    }
    await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: [...groups].map(([range, values]) => ({ range, values: [values] })) }) });
  }

  async prepareTab(spreadsheetId: string, tabId: number, headerRow: number): Promise<{ leadIdColumn: SheetColumn; columns: SheetColumn[] }> {
    const { columns, tabTitle } = await this.discover(spreadsheetId, tabId, headerRow, headerRow + 1, 0);
    const usedValues = await this.readUsedValues(spreadsheetId, tabTitle, columns.length);
    const existingId = columns.find(column => ['app lead id', 'verified lead id', 'system lead id'].includes(column.header.trim().toLocaleLowerCase('en-US')));
    const usedIndex = Math.max(-1, ...columns.filter((column, index) => column.header.trim() || usedValues.some(row => Boolean(row[index]?.trim()))).map(column => column.index));
    const leadIdIndex = existingId?.index ?? usedIndex + 1;
    const current = await this.request<{ sheets?: Array<{ properties?: { sheetId?: number; gridProperties?: { columnCount?: number } } }> }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,gridProperties))`);
    const target = current.sheets?.find(sheet => sheet.properties?.sheetId === tabId);
    if (target && leadIdIndex >= (target.properties?.gridProperties?.columnCount ?? 0)) {
      await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: leadIdIndex, endIndex: leadIdIndex + 1 }, inheritFromBefore: true } }] }) });
    }
    if (!existingId) await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${tabTitle.replace(/'/g, "''")}'!${columnLabel(leadIdIndex)}${headerRow}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [['Verified Lead ID']] }) });
    const after = await this.discover(spreadsheetId, tabId, headerRow);
    const requests = after.columns.filter(column => column.index <= leadIdIndex && !column.metadataId).map(column => ({ createDeveloperMetadata: { developerMetadata: { metadataKey: 'verified_call_column', metadataValue: `column:${column.index}`, visibility: 'DOCUMENT', location: { dimensionRange: { sheetId: tabId, dimension: 'COLUMNS', startIndex: column.index, endIndex: column.index + 1 } } } } }));
    if (requests.length) await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    const final = await this.discover(spreadsheetId, tabId, headerRow);
    const leadIdColumn = final.columns[leadIdIndex];
    if (!leadIdColumn?.metadataId) throw new Error('Could not assign stable metadata to the app lead ID column.');
    return { leadIdColumn, columns: final.columns };
  }

  async attachRowMetadata(spreadsheetId: string, tabId: number, rowNumber: number, leadId: string): Promise<void> {
    const lookup = await this.readRowMetadata(spreadsheetId, tabId, leadId);
    if (lookup) return;
    await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ createDeveloperMetadata: { developerMetadata: { metadataKey: 'verified_call_row', metadataValue: leadId, visibility: 'DOCUMENT', location: { dimensionRange: { sheetId: tabId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } } } }] }) });
  }

  async readRowMetadata(spreadsheetId: string, tabId: number, leadId: string): Promise<{ metadataId: string; rowNumber: number } | null> {
    const match = await this.searchRowMetadata(spreadsheetId, tabId, leadId);
    return match ? { metadataId: match.metadataId, rowNumber: match.rowNumber } : null;
  }

  async searchRowMetadata(spreadsheetId: string, tabId: number, leadId: string): Promise<{ metadataId: string; rowNumber: number; value: string } | null> {
    const result = await this.request<{ matchedDeveloperMetadata?: Array<{ developerMetadata?: { metadataId?: number; metadataKey?: string; metadataValue?: string; location?: { dimensionRange?: { sheetId?: number; dimension?: string; startIndex?: number; endIndex?: number } } } }> }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/developerMetadata:search`, { method: 'POST', body: JSON.stringify({ dataFilters: [{ developerMetadataLookup: { metadataKey: 'verified_call_row', metadataValue: leadId, visibility: 'DOCUMENT' } }] }) });
    const found = result.matchedDeveloperMetadata ?? [];
    if (found.length > 1) throw new Error(`Duplicate row developer metadata for lead UUID ${leadId}.`);
    const match = found[0]?.developerMetadata;
    if (!match) return null;
    const range = match.location?.dimensionRange;
    if (match.metadataKey !== 'verified_call_row' || match.metadataValue !== leadId || !range || range.sheetId !== tabId || range.dimension !== 'ROWS' || range.startIndex === undefined || range.endIndex !== range.startIndex + 1 || match.metadataId === undefined) {
      throw new Error(`Row developer metadata for lead UUID ${leadId} is malformed or belongs to another tab.`);
    }
    return { metadataId: String(match.metadataId), rowNumber: range.startIndex + 1, value: match.metadataValue };
  }

  async readValuesByRowMetadata(spreadsheetId: string, metadataId: string, valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA' = 'FORMATTED_VALUE'): Promise<Array<string | number>> {
    const result = await this.request<{ valueRanges?: Array<{ valueRange?: { values?: Array<Array<string | number>> } }> }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGetByDataFilter`, { method: 'POST', body: JSON.stringify({ dataFilters: [{ developerMetadataLookup: { metadataId: Number(metadataId), visibility: 'DOCUMENT' } }], majorDimension: 'ROWS', valueRenderOption }) });
    const ranges = result.valueRanges ?? [];
    if (ranges.length !== 1) throw new Error(`Row metadata lookup ${metadataId} returned ${ranges.length} rows.`);
    return ranges[0].valueRange?.values?.[0] ?? [];
  }

  async writeRowByMetadata(spreadsheetId: string, metadataId: string, expectedLeadId: string, idColumnIndex: number, cells: WriteCell[]): Promise<void> {
    if (!cells.length) return;
    const formulaRead = await this.request<{ valueRanges?: Array<{ valueRange?: { values?: string[][] } }> }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGetByDataFilter`, { method: 'POST', body: JSON.stringify({ dataFilters: [{ developerMetadataLookup: { metadataId: Number(metadataId), visibility: 'DOCUMENT' } }], majorDimension: 'ROWS', valueRenderOption: 'FORMULA' }) });
    if (formulaRead.valueRanges?.length !== 1) throw new Error(`Row metadata ${metadataId} returned ${formulaRead.valueRanges?.length ?? 0} rows before sync.`);
    const formulas = formulaRead.valueRanges[0].valueRange?.values?.[0] ?? [];
    if (String(formulas[idColumnIndex] ?? '').trim() !== expectedLeadId) throw new Error('Stable UUID cell no longer matches the expected app lead; output was not written.');
    const writable = cells.filter(cell => !formulas[cell.columnIndex]?.startsWith('='));
    if (!writable.length) return;
    const last = Math.max(...writable.map(cell => cell.columnIndex));
    const values: Array<string | number | null> = Array.from({ length: last + 1 }, () => null);
    for (const cell of writable) values[cell.columnIndex] = cell.value;
    const response = await this.request<{ totalUpdatedRows?: number }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdateByDataFilter`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: [{ dataFilter: { developerMetadataLookup: { metadataId: Number(metadataId), visibility: 'DOCUMENT' } }, majorDimension: 'ROWS', values: [values] }] }) });
    if (response.totalUpdatedRows !== 1) throw new Error(`Row metadata ${metadataId} matched ${response.totalUpdatedRows ?? 0} rows during sync.`);
  }

  async assignStableLeadId(spreadsheetId: string, tabId: number, row: SheetRow, idColumn: SheetColumn, expectedId?: string): Promise<{ leadId: string; metadataId: string }> {
    const priorCell = row.values[idColumn.index]?.trim() ?? '';
    const leadId = priorCell || expectedId || crypto.randomUUID();
    if (priorCell && expectedId && priorCell !== expectedId) throw new Error('Row metadata UUID does not match the app ID cell.');
    await this.attachRowMetadata(spreadsheetId, tabId, row.rowNumber, leadId);
    if (row.rowMetadataConflict) throw new Error('Source row has multiple row developer metadata identities.');
    const metadata = await this.readRowMetadata(spreadsheetId, tabId, leadId);
    if (!metadata) throw new Error('Row metadata was not created or was lost before lead ID assignment.');
    const observed = (await this.readValuesByRowMetadata(spreadsheetId, metadata.metadataId)).map(String);
    const width = Math.max(observed.length, row.values.length);
    for (let index = 0; index < width; index++) {
      if (index === idColumn.index) {
        const observedId = (observed[index] ?? '').trim();
        if (observedId && observedId !== leadId) throw new Error('Source row acquired a different app UUID before assignment; reconcile the row identity.');
        continue;
      }
      if ((observed[index] ?? '') !== (row.values[index] ?? '')) throw new Error('Source row changed before ID assignment; reconcile the row identity.');
    }
    if (!priorCell) {
      const padded: Array<string | number | null> = Array.from({ length: idColumn.index + 1 }, () => null);
      padded[idColumn.index] = leadId;
      const update = await this.request<{ totalUpdatedRows?: number }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdateByDataFilter`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: [{ dataFilter: { developerMetadataLookup: { metadataId: Number(metadata.metadataId), visibility: 'DOCUMENT' } }, majorDimension: 'ROWS', values: [padded] }] }) });
      if (update.totalUpdatedRows !== 1) throw new Error(`Row metadata ${metadata.metadataId} matched ${update.totalUpdatedRows ?? 0} rows during ID assignment.`);
    }
    const after = (await this.readValuesByRowMetadata(spreadsheetId, metadata.metadataId)).map(String);
    if ((after[idColumn.index] ?? '').trim() !== leadId) throw new Error('App lead ID could not be verified after assignment.');
    return { leadId, metadataId: metadata.metadataId };
  }

  async readRowById(spreadsheetId: string, tabTitle: string, idColumnIndex: number, leadId: string): Promise<number | null> {
    const range = `'${tabTitle.replace(/'/g, "''")}'!${columnLabel(idColumnIndex)}:${columnLabel(idColumnIndex)}`;
    const result = await this.request<{ values?: string[][] }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
    const matches = (result.values ?? []).flatMap((row, i) => (row[0] === leadId ? [i + 1] : []));
    if (matches.length > 1) throw new Error(`Duplicate stable app lead ID ${leadId} in the source tab.`);
    return matches[0] ?? null;
  }

  async readIdentityColumns(spreadsheetId: string, tabTitle: string, headerRow: number, phoneColumnIndex: number, idColumnIndex: number): Promise<{ phones: string[]; ids: string[]; lastPhoneRow: number }> {
    const tab = `'${tabTitle.replace(/'/g, "''")}'!`;
    const start = headerRow + 1;
    const ranges = [`${tab}${columnLabel(phoneColumnIndex)}${start}:${columnLabel(phoneColumnIndex)}`, `${tab}${columnLabel(idColumnIndex)}${start}:${columnLabel(idColumnIndex)}`];
    const result = await this.request<{ valueRanges?: Array<{ values?: string[][] }> }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges.map(range => `ranges=${encodeURIComponent(range)}`).join('&')}&valueRenderOption=FORMATTED_VALUE`);
    if (result.valueRanges?.length !== 2) throw new Error('Identity column scan did not return both phone and app ID columns.');
    const phones = (result.valueRanges[0].values ?? []).map(row => row[0] ?? '');
    const ids = (result.valueRanges[1].values ?? []).map(row => row[0] ?? '');
    let lastIndex = -1;
    for (let index = phones.length - 1; index >= 0; index--) if (phones[index].trim()) { lastIndex = index; break; }
    return { phones, ids, lastPhoneRow: lastIndex < 0 ? headerRow : start + lastIndex };
  }

  async readUsedValues(spreadsheetId: string, tabTitle: string, columnCount: number): Promise<string[][]> {
    const range = `'${tabTitle.replace(/'/g, "''")}'!A:${columnLabel(columnCount - 1)}`;
    const result = await this.request<{ values?: string[][] }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`);
    return result.values ?? [];
  }
}

export function columnLabel(index: number): string {
  let n = index + 1; let out = '';
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
function cellValue(cell?: { formattedValue?: string; userEnteredValue?: { formulaValue?: string; stringValue?: string; numberValue?: number }; effectiveValue?: { stringValue?: string; numberValue?: number } }): string {
  if (!cell) return '';
  if (cell.formattedValue !== undefined) return cell.formattedValue;
  const v = cell.effectiveValue ?? cell.userEnteredValue;
  if (v?.stringValue !== undefined) return v.stringValue;
  if (v?.numberValue !== undefined) return String(v.numberValue);
  return cell.userEnteredValue?.formulaValue ?? '';
}
