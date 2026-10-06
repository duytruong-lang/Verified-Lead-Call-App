-- Serialize admin mapping writes with membership changes.
-- Browser writes must pass through this guarded SECURITY DEFINER RPC.
create or replace function public.sheets_save_mapping(mapping jsonb)
returns public.sheet_mappings language plpgsql security definer set search_path = '' as $$
declare m public.sheet_mappings; actor uuid:=auth.uid();
begin
 perform public.team_assert_admin(actor);
 insert into public.sheet_mappings(spreadsheet_id,tab_id,tab_title,header_row,schema_fingerprint,fields,validated_at,writes_enabled,updated_by)
 values(mapping->>'spreadsheetId',(mapping->>'tabId')::bigint,mapping->>'tabTitle',(mapping->>'headerRow')::integer,mapping->>'schemaFingerprint',coalesce(mapping->'fields','[]'::jsonb),
  nullif(mapping->>'validatedAt','')::timestamptz,coalesce((mapping->>'writesEnabled')::boolean,false),actor)
 on conflict(spreadsheet_id,tab_id) do update set tab_title=excluded.tab_title,header_row=excluded.header_row,
  import_cursor=case when public.sheet_mappings.schema_fingerprint<>excluded.schema_fingerprint then null else public.sheet_mappings.import_cursor end,
  import_cursor_updated_at=case when public.sheet_mappings.schema_fingerprint<>excluded.schema_fingerprint then null else public.sheet_mappings.import_cursor_updated_at end,
  schema_fingerprint=excluded.schema_fingerprint,fields=excluded.fields,validated_at=excluded.validated_at,writes_enabled=excluded.writes_enabled,updated_by=actor,updated_at=now()
 returning * into m;
 return m;
end $$;

revoke insert,update,delete on public.sheet_mappings from public,anon,authenticated;
