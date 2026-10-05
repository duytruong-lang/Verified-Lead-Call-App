-- Keep leads_for_actor aligned with the composite row after identity barriers
-- were added, and preserve queue exclusivity for active claims.
create or replace function public.leads_for_actor(p_queue text default null)
returns setof public.leads language sql stable security definer set search_path = '' as $$
 with latest as (
  select distinct on (a.lead_id) a.lead_id,a.outcome
  from public.contact_attempts a
  where a.state='completed'
  order by a.lead_id,a.completed_at desc nulls last,a.ordinal desc
 ), classified as (
  select l.*,
   (l.claimed_by is not null and l.claim_expires_at>=now()) as active_claim,
   (l.attempt_count>=5 or l.evaluation is not null or nullif(l.legacy_source_metadata->>'legacyEvaluation','') is not null) as finished,
   coalesce(latest.outcome='callback',false) as latest_callback,
   (l.attempt_count>0 or l.legacy_source_metadata ? 'legacyOutcome') as has_history
  from public.leads l left join latest on latest.lead_id=l.id
 )
 select c.id,c.source_platform_id,c.phone,c.display_name,c.source,c.source_created_at,c.email,c.form_answers,c.notes,c.attempt_count,c.claimed_by,c.claim_expires_at,c.evaluation,c.evaluation_version,c.sheet_sync_version,c.sheet_sync_applied_version,c.sheet_sync_state,c.sheet_sync_error,c.created_at,c.updated_at,c.legacy_share_urls,c.evaluation_note,c.evaluation_at,c.legacy_source_metadata,c.sheet_identity_blocked,c.sheet_identity_conflict
 from classified c
 where public.current_actor_role() in ('admin','staff')
 and case
   when p_queue is null then true
   when p_queue='in_progress' then c.active_claim or (c.has_history and not c.finished and not c.latest_callback)
   when p_queue='finished' then c.finished and not c.active_claim
   when p_queue='callback' then not c.active_claim and not c.finished and c.latest_callback
   when p_queue='not_called' then not c.active_claim and not c.finished and not c.latest_callback and not c.has_history
   else false
 end
 order by c.source_created_at nulls last,c.created_at,c.id
$$;
