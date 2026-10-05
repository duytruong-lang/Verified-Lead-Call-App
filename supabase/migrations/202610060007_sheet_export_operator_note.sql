-- Keep the general legacy note in legacy_source_metadata. The app-owned
-- Sheet note is the latest completed contact attempt note, with the dedicated
-- lead evaluation note as a fallback.
create or replace function public.sheets_export_snapshot(lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.leads;
begin
 select * into l from public.leads where id=sheets_export_snapshot.lead_id;
 if not found then return null; end if;
 if l.sheet_identity_blocked then raise exception using errcode='23514',message='sheet_identity_conflict_blocked'; end if;
 return jsonb_build_object('leadId',l.id,'sourcePlatformId',l.source_platform_id,'phone',l.phone,'displayName',l.display_name,'source',l.source,
  'createdAt',l.source_created_at,'email',l.email,'formAnswers',l.form_answers,'attemptCount',l.attempt_count,'evaluation',l.evaluation,
  'evaluationVersion',l.evaluation_version,'evaluationAt',l.evaluation_at,'evaluationNote',coalesce(
   (select nullif(a.note,'') from public.contact_attempts a where a.lead_id=l.id and a.state='completed' order by a.ordinal desc limit 1),
   nullif(l.evaluation_note,'')),
  'desiredVersion',l.sheet_sync_version,
  'attempts',coalesce((select jsonb_agg(jsonb_build_object('ordinal',a.ordinal,'outcome',a.outcome,'note',a.note,'completedAt',a.completed_at) order by a.ordinal) from public.contact_attempts a where a.lead_id=l.id and a.state='completed'),'[]'::jsonb),
  'handoff',(select jsonb_build_object('version',h.version,'recordingId',h.recording_id,'shareId',h.share_id,'shareTokenCiphertext',s.token_ciphertext,'shareState',s.state,'recordingCode',r.recording_code) from public.current_handoffs h join public.recording_shares s on s.id=h.share_id join public.recordings r on r.id=h.recording_id where h.lead_id=l.id));
end $$;

revoke all on function public.sheets_export_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.sheets_export_snapshot(uuid) to service_role;
