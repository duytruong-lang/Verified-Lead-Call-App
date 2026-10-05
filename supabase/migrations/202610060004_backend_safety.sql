-- Keep the four work queues a complete partition and select callback from the
-- most recent completed outcome, not any callback in the lead's history.
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
 select c.id,c.source_platform_id,c.phone,c.display_name,c.source,c.source_created_at,c.email,c.form_answers,c.notes,c.attempt_count,c.claimed_by,c.claim_expires_at,c.evaluation,c.evaluation_version,c.sheet_sync_version,c.sheet_sync_applied_version,c.sheet_sync_state,c.sheet_sync_error,c.created_at,c.updated_at,c.legacy_share_urls,c.evaluation_note,c.evaluation_at,c.legacy_source_metadata from classified c
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

-- An expired remote write has an unknown completion state. Quarantine it for
-- readback instead of blindly re-issuing it with a newer fence.
alter table public.sheet_sync_jobs add column if not exists blocked_at timestamptz;
update public.sheet_sync_jobs set blocked_at=created_at where state='blocked' and blocked_at is null;

create or replace function public.sheets_claim_jobs(worker_id text,job_limit integer default 20,lease_seconds integer default 60)
returns setof public.sheet_sync_jobs language plpgsql security definer set search_path = '' as $$
begin
 update public.sheet_sync_jobs j set state='blocked',blocked_at=coalesce(j.blocked_at,now()),last_error='Worker lease expired; Google write completion is uncertain.',lease_owner=null,lease_expires_at=null
 where j.state='running' and j.lease_expires_at<=now();
 update public.leads l set sheet_sync_state='blocked',sheet_sync_error='Worker lease expired; Google write completion is uncertain.'
 where exists(select 1 from public.sheet_sync_jobs j where j.lead_id=l.id and j.state='blocked' and j.blocked_at is not null and j.last_error='Worker lease expired; Google write completion is uncertain.' and j.desired_version=l.sheet_sync_version);
 return query with picked as (
  select j.id from public.sheet_sync_jobs j
  join public.leads l on l.id=j.lead_id
  where j.desired_version=l.sheet_sync_version
   and not exists(select 1 from public.sheet_sync_jobs barrier where barrier.lead_id=j.lead_id and (barrier.state='running' or (barrier.state='blocked' and barrier.blocked_at is not null)))
   and j.state in ('pending','retrying') and j.next_run_at<=now()
  order by j.next_run_at,j.created_at for update of j skip locked limit greatest(1,least(job_limit,100))
 ), updated as (
  update public.sheet_sync_jobs j set state='running',attempts=attempts+1,lease_owner=worker_id,
   lease_expires_at=now()+make_interval(secs=>greatest(10,least(lease_seconds,600))),fencing_token=fencing_token+1,blocked_at=null
  from picked where j.id=picked.id returning j.*
 ) select * from updated;
end $$;

create or replace function public.sheets_mark_job_result(job_id uuid,fencing_token bigint,result_state public.sync_state,error_text text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.sheet_sync_jobs;
begin
 if result_state not in ('succeeded','retrying','blocked') then raise exception using errcode='23514',message='sync_result_state_invalid'; end if;
 update public.sheet_sync_jobs set state=result_state,last_error=left(error_text,2000),blocked_at=case when result_state='blocked' then now() else null end,
  next_run_at=case when result_state='retrying' then now()+make_interval(secs=>least(3600,power(2,least(attempts,10))::integer)) else next_run_at end,
  lease_owner=null,lease_expires_at=null
 where id=job_id and state='running' and sheet_sync_jobs.fencing_token=sheets_mark_job_result.fencing_token and lease_expires_at>now() returning * into j;
 if not found then return false; end if;
 if result_state='succeeded' then
  update public.leads set sheet_sync_applied_version=greatest(coalesce(sheet_sync_applied_version,0),j.desired_version),sheet_sync_state='succeeded',sheet_sync_error=null where id=j.lead_id and sheet_sync_version=j.desired_version;
 else
  update public.leads set sheet_sync_state=result_state,sheet_sync_error=left(error_text,2000) where id=j.lead_id and sheet_sync_version=j.desired_version;
 end if;
 return true;
end $$;

drop function public.sheets_reconcile_job(uuid,bigint,boolean,text);
create or replace function public.sheets_reconcile_job(job_id uuid,fencing_token bigint,observed_matches boolean,observed_version bigint,detail text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.sheet_sync_jobs; l public.leads;
begin
 select * into j from public.sheet_sync_jobs where id=sheets_reconcile_job.job_id for update;
 if not found or j.state<>'blocked' or j.fencing_token<>sheets_reconcile_job.fencing_token then return false; end if;
 if j.blocked_at is not null and j.blocked_at>now()-interval '180 seconds' then return false; end if;
 select * into l from public.leads where id=j.lead_id for update;
 if not found or not observed_matches or observed_version is distinct from l.sheet_sync_version then
  update public.sheet_sync_jobs set last_error=left(coalesce(detail,'Sheet output did not match the latest app snapshot.'),2000) where id=j.id;
  update public.leads set sheet_sync_state='blocked',sheet_sync_error=left(coalesce(detail,'Sheet output did not match the latest app snapshot.'),2000) where id=l.id and l.sheet_sync_version=j.desired_version;
  return false;
 end if;
 update public.sheet_sync_jobs set state=case when j.desired_version<l.sheet_sync_version then 'superseded'::public.sync_state else 'succeeded'::public.sync_state end,
   last_error=case when j.desired_version<l.sheet_sync_version then 'Barrier reconciled against current Sheet version '||l.sheet_sync_version else null end,
   lease_owner=null,lease_expires_at=null where id=j.id;
 update public.leads set sheet_sync_applied_version=l.sheet_sync_version,sheet_sync_state='succeeded',sheet_sync_error=null where id=l.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(auth.uid(),'sheet.reconciled','lead',l.id,jsonb_build_object('blockedJobId',j.id,'blockedVersion',j.desired_version,'observedVersion',l.sheet_sync_version));
 return true;
end $$;

-- SaveOutcomeResult.handoff uses the same object shape as LeadDetails.handoff.
create or replace function public.save_outcome(p_claim_id uuid,p_outcome public.contact_outcome,p_note text,p_recording_id uuid,p_eval text,p_eval_recording_id uuid,p_expected bigint,p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.contact_attempts; l public.leads; r public.recordings; result jsonb; ev jsonb; actor uuid:=public.assert_staff(); saved public.operation_idempotency; fingerprint text; lead_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':save_outcome:'||p_key,0));
 fingerprint:=encode(extensions.digest(jsonb_build_object('claimId',p_claim_id,'outcome',p_outcome,'note',p_note,'recordingId',p_recording_id,'evaluation',p_eval,'evaluationRecordingId',p_eval_recording_id,'expectedVersion',p_expected)::text,'sha256'),'hex');
 select * into saved from public.operation_idempotency where actor_id=actor and action='save_outcome' and idem_key=p_key;
 if found then if saved.input_hash<>fingerprint then raise exception using errcode='23505',message='idempotency_key_reused'; end if; return saved.response; end if;
 select ca.lead_id into lead_id from public.contact_attempts ca where ca.id=p_claim_id;
 if lead_id is null then raise exception using errcode='P0002',message='claim_not_found'; end if;
 select * into l from public.leads where id=lead_id for update;
 select * into a from public.contact_attempts where id=p_claim_id for update;
 if not found then raise exception using errcode='P0002',message='claim_not_found'; end if;
 if a.state='completed' then raise exception using errcode='23505',message='attempt_already_completed'; end if;
 if a.state<>'draft' or (a.actor_id<>auth.uid() and public.current_actor_role() is distinct from 'admin') then raise exception using errcode='42501',message='active_claim_required'; end if;
 if a.claim_expires_at<now() then raise exception using errcode='40001',message='claim_expired'; end if;
 if p_outcome='other' and nullif(btrim(p_note),'') is null then raise exception using errcode='23514',message='other_note_required'; end if;
 if p_recording_id is not null then
  select * into r from public.recordings rec where rec.id=p_recording_id and rec.lead_id=a.lead_id and (rec.attempt_id is null or rec.attempt_id=a.id) and rec.state='ready' for update;
  if not found then raise exception using errcode='23514',message='ready_recording_required'; end if;
  update public.recordings set attempt_id=a.id where id=r.id;
 end if;
 update public.contact_attempts set state='completed',outcome=p_outcome,note=nullif(btrim(p_note),''),completed_at=now() where id=a.id returning * into a;
 update public.leads set attempt_count=attempt_count+1,claimed_by=null,claim_expires_at=null,sheet_sync_version=sheet_sync_version+1,sheet_sync_state='pending',sheet_sync_error=null where id=a.lead_id returning * into l;
 insert into public.sheet_sync_jobs(lead_id,desired_version,idempotency_key) values(l.id,l.sheet_sync_version,'attempt:'||a.id) on conflict do nothing;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(auth.uid(),'attempt.completed','attempt',a.id,jsonb_build_object('outcome',p_outcome,'recordingId',p_recording_id));
 if p_eval is not null then ev:=public.set_evaluation(l.id,p_eval,p_eval_recording_id,p_expected,p_key||':evaluation'); end if;
 result:=jsonb_build_object('attempt',to_jsonb(a),'attemptCount',l.attempt_count,'duplicate',false,'evaluationVersion',ev->'version',
   'handoff',(select jsonb_build_object('version',h.version,'recordingId',h.recording_id,'shareId',h.share_id,'changedAt',v.changed_at,'changedBy',v.changed_by)
     from public.current_handoffs h join public.handoff_versions v using(lead_id,version) where h.lead_id=l.id));
 insert into public.operation_idempotency(actor_id,action,idem_key,input_hash,response) values(actor,'save_outcome',p_key,fingerprint,result);
 return result;
end $$;

revoke all on function public.sheets_reconcile_job(uuid,bigint,boolean,bigint,text) from public,anon,authenticated;
grant execute on function public.sheets_reconcile_job(uuid,bigint,boolean,bigint,text) to service_role;
