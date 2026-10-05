alter table public.leads add column if not exists sheet_identity_blocked boolean not null default false;
alter table public.leads add column if not exists sheet_identity_conflict jsonb not null default '{}'::jsonb;

create or replace function public.sheets_record_conflict(lead_id uuid,conflict jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(null,'sheet.conflict','lead',lead_id,coalesce(conflict,'{}'::jsonb));
 update public.leads set sheet_identity_blocked=true,sheet_identity_conflict=coalesce(conflict,'{}'::jsonb),sheet_sync_state='blocked',sheet_sync_error='Sheet identity or source-row conflict' where id=lead_id;
end $$;

create or replace function public.sheets_claim_jobs(worker_id text,job_limit integer default 20,lease_seconds integer default 60)
returns setof public.sheet_sync_jobs language plpgsql security definer set search_path = '' as $$
begin
 update public.sheet_sync_jobs j set state='blocked',blocked_at=coalesce(j.blocked_at,now()),last_error='Worker lease expired; Google write completion is uncertain.',lease_owner=null,lease_expires_at=null
 where j.state='running' and j.lease_expires_at<=now();
 update public.leads l set sheet_sync_state='blocked',sheet_sync_error='Worker lease expired; Google write completion is uncertain.'
 where exists(select 1 from public.sheet_sync_jobs j where j.lead_id=l.id and j.state='blocked' and j.blocked_at is not null and j.last_error='Worker lease expired; Google write completion is uncertain.' and j.desired_version=l.sheet_sync_version);
 return query with picked as (
  select j.id from public.sheet_sync_jobs j join public.leads l on l.id=j.lead_id
  where j.desired_version=l.sheet_sync_version and not l.sheet_identity_blocked
   and not exists(select 1 from public.sheet_sync_jobs barrier where barrier.lead_id=j.lead_id and (barrier.state='running' or (barrier.state='blocked' and barrier.blocked_at is not null)))
   and j.state in ('pending','retrying') and j.next_run_at<=now()
  order by j.next_run_at,j.created_at for update of j skip locked limit greatest(1,least(job_limit,100))
 ), updated as (
  update public.sheet_sync_jobs j set state='running',attempts=attempts+1,lease_owner=worker_id,
   lease_expires_at=now()+make_interval(secs=>greatest(10,least(lease_seconds,600))),fencing_token=fencing_token+1,blocked_at=null
  from picked where j.id=picked.id returning j.*
 ) select * from updated;
end $$;

create or replace function public.sheets_resolve_identity_conflict(lead_id uuid,observed_unique boolean,detail text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
 select * into l from public.leads where id=sheets_resolve_identity_conflict.lead_id for update;
 if not found or not l.sheet_identity_blocked or not observed_unique then return false; end if;
 update public.leads set sheet_identity_blocked=false,sheet_identity_conflict='{}'::jsonb,sheet_sync_error=null,
  sheet_sync_state=case when sheet_sync_applied_version>=sheet_sync_version then 'succeeded'::public.sync_state else 'pending'::public.sync_state end
 where id=l.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(auth.uid(),'sheet.identity_repaired','lead',l.id,jsonb_build_object('detail',left(detail,500)));
 return true;
end $$;

create or replace function public.sheets_export_snapshot(lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.leads;
begin
 select * into l from public.leads where id=sheets_export_snapshot.lead_id;
 if not found then return null; end if;
 if l.sheet_identity_blocked then raise exception using errcode='23514',message='sheet_identity_conflict_blocked'; end if;
 return jsonb_build_object('leadId',l.id,'sourcePlatformId',l.source_platform_id,'phone',l.phone,'displayName',l.display_name,'source',l.source,
  'createdAt',l.source_created_at,'email',l.email,'formAnswers',l.form_answers,'attemptCount',l.attempt_count,'evaluation',l.evaluation,
  'evaluationVersion',l.evaluation_version,'evaluationAt',l.evaluation_at,'desiredVersion',l.sheet_sync_version,
  'attempts',coalesce((select jsonb_agg(jsonb_build_object('ordinal',a.ordinal,'outcome',a.outcome,'note',a.note,'completedAt',a.completed_at) order by a.ordinal) from public.contact_attempts a where a.lead_id=l.id and a.state='completed'),'[]'::jsonb),
  'handoff',(select jsonb_build_object('version',h.version,'recordingId',h.recording_id,'shareId',h.share_id,'shareTokenCiphertext',s.token_ciphertext,'shareState',s.state,'recordingCode',r.recording_code) from public.current_handoffs h join public.recording_shares s on s.id=h.share_id join public.recordings r on r.id=h.recording_id where h.lead_id=l.id));
end $$;

revoke all on function public.sheets_resolve_identity_conflict(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.sheets_resolve_identity_conflict(uuid,boolean,text) to service_role;
