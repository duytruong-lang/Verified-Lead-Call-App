-- Transactional business operations. Browser clients receive read access only;
-- mutations are exposed through authenticated Edge Functions using service role.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
create table public.operation_idempotency (
 actor_id uuid not null references public.profiles(user_id), action text not null, idem_key text not null,
 input_hash text not null, response jsonb, created_at timestamptz not null default now(),
 primary key(actor_id,action,idem_key)
);
alter table public.operation_idempotency enable row level security;
revoke all on public.operation_idempotency from anon,authenticated;
alter table public.leads add column if not exists legacy_share_urls jsonb not null default '[]'::jsonb;
alter table public.leads add column if not exists evaluation_note text;
alter table public.leads add column if not exists evaluation_at timestamptz;
alter table public.leads add column if not exists legacy_source_metadata jsonb not null default '{}'::jsonb;
alter table public.sheet_mappings add column if not exists import_cursor text;
alter table public.sheet_mappings add column if not exists import_cursor_updated_at timestamptz;

create or replace function public.assert_staff() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles where user_id=actor and role in ('admin','staff')) then
  raise exception using errcode='42501',message='staff_required';
 end if;
 return actor;
end $$;

create or replace function public.leads_for_actor(p_queue text default null)
returns setof public.leads language sql stable security definer set search_path = '' as $$
 select l.* from public.leads l
 where public.current_actor_role() in ('admin','staff')
 and (p_queue is null or
   (p_queue = 'not_called' and l.attempt_count = 0 and (l.claimed_by is null or l.claim_expires_at < now())) or
   (p_queue = 'in_progress' and l.claimed_by is not null and l.claim_expires_at >= now()) or
   (p_queue = 'callback' and exists(select 1 from public.contact_attempts a where a.lead_id=l.id and a.state='completed' and a.outcome='callback')) or
   (p_queue = 'finished' and (l.attempt_count >= 5 or l.evaluation is not null)))
 order by l.source_created_at nulls last, l.created_at, l.id
$$;

create or replace function public.claim_attempt(p_lead_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; a public.contact_attempts; actor uuid := auth.uid(); role public.actor_role;
begin
 perform public.assert_staff();
 select p.role into role from public.profiles p where p.user_id=actor;
 if role is null then raise exception using errcode='42501', message='profile_required'; end if;
 select * into l from public.leads where id=p_lead_id for update;
 if not found then raise exception using errcode='P0002', message='lead_not_found'; end if;
 select * into a from public.contact_attempts where lead_id=p_lead_id and idempotency_key=p_key;
 if found then return jsonb_build_object('claimId',a.id,'ordinal',a.ordinal,'claimExpiresAt',a.claim_expires_at,'duplicate',true); end if;
 select * into a from public.contact_attempts where lead_id=p_lead_id and state='draft' for update;
 if found then
   if a.claim_expires_at >= now() and a.actor_id <> actor and role <> 'admin' then raise exception using errcode='40001', message='claim_active'; end if;
   if a.claim_expires_at < now() then
     if a.actor_id <> actor and role <> 'admin' then raise exception using errcode='40001', message='claim_expired_owner_only'; end if;
   end if;
   update public.contact_attempts set actor_id=actor, claim_expires_at=now()+interval '15 minutes' where id=a.id returning * into a;
   update public.leads set claimed_by=actor, claim_expires_at=a.claim_expires_at where id=p_lead_id;
   return jsonb_build_object('claimId',a.id,'ordinal',a.ordinal,'claimExpiresAt',a.claim_expires_at,'duplicate',false);
 end if;
 if l.attempt_count >= 5 then raise exception using errcode='23514', message='attempt_limit_reached'; end if;
 insert into public.contact_attempts(lead_id,ordinal,actor_id,idempotency_key)
 values(p_lead_id,l.attempt_count+1,actor,p_key) returning * into a;
 update public.leads set claimed_by=actor,claim_expires_at=a.claim_expires_at where id=p_lead_id;
 return jsonb_build_object('claimId',a.id,'ordinal',a.ordinal,'claimExpiresAt',a.claim_expires_at,'duplicate',false);
end $$;

create or replace function public.resume_attempt(p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.contact_attempts; role public.actor_role; actor uuid := auth.uid(); lead_id uuid;
begin
 perform public.assert_staff();
 select ca.lead_id into lead_id from public.contact_attempts ca where ca.id=p_claim_id;
 if lead_id is null then raise exception using errcode='P0002',message='draft_not_found'; end if;
 perform 1 from public.leads where id=lead_id for update;
 select * into a from public.contact_attempts where id=p_claim_id for update;
 if not found or a.state <> 'draft' then raise exception using errcode='P0002', message='draft_not_found'; end if;
 select p.role into role from public.profiles p where p.user_id=actor;
 if actor <> a.actor_id and role is distinct from 'admin' then raise exception using errcode='42501', message='claim_owner_required'; end if;
 update public.contact_attempts set claim_expires_at=now()+interval '15 minutes' where id=a.id returning * into a;
 update public.leads set claimed_by=a.actor_id,claim_expires_at=a.claim_expires_at where id=a.lead_id;
 return jsonb_build_object('claimId',a.id,'ordinal',a.ordinal,'claimExpiresAt',a.claim_expires_at);
end $$;

create or replace function public.cancel_attempt(p_claim_id uuid,p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.contact_attempts; role public.actor_role; lead_id uuid;
begin
 perform public.assert_staff();
 select ca.lead_id into lead_id from public.contact_attempts ca where ca.id=p_claim_id;
 if lead_id is null then return; end if;
 perform 1 from public.leads where id=lead_id for update;
 select * into a from public.contact_attempts where id=p_claim_id for update;
 if not found then return; end if;
 select p.role into role from public.profiles p where p.user_id=auth.uid();
 if a.actor_id <> auth.uid() and role is distinct from 'admin' then raise exception using errcode='42501', message='claim_owner_required'; end if;
 if a.state='completed' then raise exception using errcode='23514', message='completed_attempt_cannot_cancel'; end if;
 update public.contact_attempts set state='canceled',claim_expires_at=now() where id=a.id and state='draft';
 update public.leads set claimed_by=null,claim_expires_at=null where id=a.lead_id and claimed_by=a.actor_id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(auth.uid(),'attempt.canceled','attempt',a.id,jsonb_build_object('idempotencyKey',p_key));
end $$;

create or replace function public.create_recording(p_lead_id uuid,p_claim_id uuid,p_filename text,p_content_type text,p_size bigint,p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.contact_attempts; r public.recordings; actor uuid:=public.assert_staff(); object_name text; saved public.operation_idempotency; fingerprint text; response jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':begin_upload:'||p_key,0));
 fingerprint:=encode(extensions.digest(jsonb_build_object('leadId',p_lead_id,'claimId',p_claim_id,'filename',p_filename,'contentType',p_content_type,'sizeBytes',p_size)::text,'sha256'),'hex');
 select * into saved from public.operation_idempotency where actor_id=actor and action='begin_upload' and idem_key=p_key;
 if found then if saved.input_hash<>fingerprint then raise exception using errcode='23505',message='idempotency_key_reused'; end if; return saved.response; end if;
 perform public.assert_staff();
 if p_size < 1 or p_size > 52428800 then raise exception using errcode='23514',message='recording_size_invalid'; end if;
 if p_content_type not in ('audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/aac') then raise exception using errcode='23514',message='recording_type_invalid'; end if;
 select * into a from public.contact_attempts where id=p_claim_id and lead_id=p_lead_id and state='draft' for update;
 if not found or (a.actor_id<>actor and public.current_actor_role() is distinct from 'admin') then raise exception using errcode='42501',message='active_claim_required'; end if;
 object_name := p_lead_id::text||'/'||p_claim_id::text||'/'||gen_random_uuid()::text;
 insert into public.recordings(lead_id,attempt_id,object_key,content_type,size_bytes,created_by)
 values(p_lead_id,p_claim_id,object_name,p_content_type,p_size,actor) returning * into r;
 response:=jsonb_build_object('recordingId',r.id,'objectKey',r.object_key);
 insert into public.operation_idempotency(actor_id,action,idem_key,input_hash,response) values(actor,'begin_upload',p_key,fingerprint,response);
 return response;
end $$;

create or replace function public.mark_recording_ready(p_recording_id uuid,p_size bigint,p_duration integer,p_checksum text,p_detected_type text)
returns public.recordings language plpgsql security definer set search_path = '' as $$
declare r public.recordings;
begin
 select * into r from public.recordings where id=p_recording_id for update;
 if not found then raise exception using errcode='P0002',message='recording_not_found'; end if;
 if p_size < 12 or p_size > 52428800 or p_duration < 1 or p_duration > 1800 or p_detected_type not like 'audio/%' then
  update public.recordings set state='rejected' where id=p_recording_id returning * into r; return r;
 end if;
 if r.content_type<>p_detected_type and not (r.content_type='audio/x-wav' and p_detected_type='audio/wav') then
  update public.recordings set state='rejected' where id=p_recording_id returning * into r; return r;
 end if;
 update public.recordings set state='ready',size_bytes=p_size,duration_seconds=p_duration,recorded_at=now(),checksum=p_checksum where id=p_recording_id returning * into r;
 return r;
end $$;

create or replace function public.set_evaluation(p_lead_id uuid,p_result text,p_recording_id uuid,p_expected bigint,p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; r public.recordings; h public.current_handoffs; sh public.recording_shares; nextv bigint; actor uuid:=public.assert_staff(); saved public.operation_idempotency; fingerprint text; response jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':evaluation:'||p_key,0));
 fingerprint:=encode(extensions.digest(jsonb_build_object('leadId',p_lead_id,'result',p_result,'recordingId',p_recording_id,'expectedVersion',p_expected)::text,'sha256'),'hex');
 select * into saved from public.operation_idempotency where actor_id=actor and action='evaluation' and idem_key=p_key;
 if found then if saved.input_hash<>fingerprint then raise exception using errcode='23505',message='idempotency_key_reused'; end if; return saved.response; end if;
 select * into l from public.leads where id=p_lead_id for update;
 if not found then raise exception using errcode='P0002',message='lead_not_found'; end if;
 if l.evaluation_version<>p_expected then raise exception using errcode='40001',message='stale_evaluation_version'; end if;
 if p_result not in ('verified','unverified') then raise exception using errcode='23514',message='evaluation_invalid'; end if;
 if p_result='verified' then
  select * into r from public.recordings where id=p_recording_id and lead_id=p_lead_id and state='ready';
  if not found then raise exception using errcode='23514',message='ready_recording_required'; end if;
  select * into sh from public.recording_shares where recording_id=p_recording_id and state='active' order by created_at desc limit 1;
  if not found then raise exception using errcode='23514',message='active_share_required'; end if;
  select * into h from public.current_handoffs where lead_id=p_lead_id;
  if h.lead_id is null or h.recording_id<>p_recording_id or h.share_id is distinct from sh.id then
    nextv:=coalesce(h.version,0)+1;
    insert into public.handoff_versions(lead_id,version,recording_id,share_id,changed_by) values(p_lead_id,nextv,p_recording_id,sh.id,auth.uid());
    insert into public.current_handoffs(lead_id,version,recording_id,share_id) values(p_lead_id,nextv,p_recording_id,sh.id)
    on conflict(lead_id) do update set version=excluded.version,recording_id=excluded.recording_id,share_id=excluded.share_id,updated_at=now();
    insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(auth.uid(),'handoff.changed','lead',p_lead_id,jsonb_build_object('version',nextv,'recordingId',p_recording_id,'shareId',sh.id));
  end if;
 end if;
 update public.leads set evaluation=p_result,evaluation_version=evaluation_version+1,evaluation_at=now(),sheet_sync_version=sheet_sync_version+1,sheet_sync_state='pending',sheet_sync_error=null where id=p_lead_id returning * into l;
 insert into public.sheet_sync_jobs(lead_id,desired_version,idempotency_key) values(p_lead_id,l.sheet_sync_version,'evaluation:'||p_lead_id||':'||l.sheet_sync_version)
 on conflict do nothing;
 response:=jsonb_build_object('version',l.evaluation_version,'handoffVersion',(select version from public.current_handoffs where lead_id=p_lead_id));
 insert into public.operation_idempotency(actor_id,action,idem_key,input_hash,response) values(actor,'evaluation',p_key,fingerprint,response);
 return response;
end $$;

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
 if a.state='completed' then
  if exists(select 1 from public.operation_idempotency where actor_id=actor and action='save_outcome' and idem_key=p_key) then return (select response from public.operation_idempotency where actor_id=actor and action='save_outcome' and idem_key=p_key); end if;
  raise exception using errcode='23505',message='attempt_already_completed';
 end if;
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
 result:=jsonb_build_object('attempt',to_jsonb(a),'attemptCount',l.attempt_count,'duplicate',false,'evaluationVersion',ev->'version','handoff',ev->'handoffVersion');
 insert into public.operation_idempotency(actor_id,action,idem_key,input_hash,response) values(actor,'save_outcome',p_key,fingerprint,result);
 return result;
end $$;

create or replace function public.issue_share(p_recording_id uuid,p_hash text,p_ciphertext text,p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.recordings; sh public.recording_shares; actor uuid:=public.assert_staff(); saved public.operation_idempotency; fingerprint text; response jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':create_share:'||p_key,0));
 fingerprint:=encode(extensions.digest(jsonb_build_object('recordingId',p_recording_id)::text,'sha256'),'hex');
 select * into saved from public.operation_idempotency where actor_id=actor and action='create_share' and idem_key=p_key;
 if found then if saved.input_hash<>fingerprint then raise exception using errcode='23505',message='idempotency_key_reused'; end if; return saved.response; end if;
 select * into r from public.recordings where id=p_recording_id and state='ready';
 if not found then raise exception using errcode='23514',message='ready_recording_required'; end if;
 insert into public.recording_shares(recording_id,token_hash,token_ciphertext,created_by)
 values(p_recording_id,p_hash,p_ciphertext,auth.uid()) returning * into sh;
 response:=jsonb_build_object('shareId',sh.id,'tokenCiphertext',sh.token_ciphertext);
 insert into public.operation_idempotency(actor_id,action,idem_key,input_hash,response) values(actor,'create_share',p_key,fingerprint,response);
 return response;
end $$;

create or replace function public.resolve_share(p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sh public.recording_shares; r public.recordings;
begin
 select * into sh from public.recording_shares where token_hash=p_hash and state='active';
 if not found then raise exception using errcode='P0002',message='share_not_found'; end if;
 select * into r from public.recordings where id=sh.recording_id and state='ready';
 if not found then raise exception using errcode='P0002',message='recording_not_ready'; end if;
 return jsonb_build_object('shareId',sh.id,'recordingId',r.id,'objectKey',r.object_key,'recordingCode',r.recording_code,'recordedAt',r.recorded_at,'durationSeconds',r.duration_seconds);
end $$;

create or replace function public.revoke_share(p_share_id uuid,p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare sh public.recording_shares; role public.actor_role; target_lead_id uuid; recording_owner uuid; l public.leads;
begin
 perform public.assert_staff();
 select r.lead_id,r.created_by into target_lead_id,recording_owner from public.recording_shares s join public.recordings r on r.id=s.recording_id where s.id=p_share_id;
 if target_lead_id is null then return; end if;
 select * into l from public.leads where id=target_lead_id for update;
 select * into sh from public.recording_shares where id=p_share_id for update;
 if not found or sh.state='revoked' then return; end if;
 select p.role into role from public.profiles p where p.user_id=auth.uid();
 if sh.created_by<>auth.uid() and recording_owner<>auth.uid() and role is distinct from 'admin' then raise exception using errcode='42501',message='share_owner_or_admin_required'; end if;
 update public.recording_shares set state='revoked',revoked_by=auth.uid(),revoked_at=now() where id=p_share_id;
 if exists(select 1 from public.current_handoffs h where h.lead_id=target_lead_id and h.share_id=p_share_id) and l.evaluation='verified' then
  update public.leads set evaluation='unverified',evaluation_version=evaluation_version+1,evaluation_at=now(),sheet_sync_version=sheet_sync_version+1,sheet_sync_state='pending',sheet_sync_error=null where id=target_lead_id returning * into l;
  insert into public.sheet_sync_jobs(lead_id,desired_version,idempotency_key) values(target_lead_id,l.sheet_sync_version,'share-revoked:'||p_share_id||':'||l.evaluation_version) on conflict do nothing;
 end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(auth.uid(),'share.revoked','share',p_share_id,jsonb_build_object('idempotencyKey',p_key));
end $$;

create or replace function public.set_handoff(p_lead_id uuid,p_recording_id uuid,p_hash text,p_ciphertext text,p_expected bigint,p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.leads; r public.recordings; h public.current_handoffs; sh public.recording_shares; v bigint; actor uuid:=public.assert_staff(); saved public.operation_idempotency; fingerprint text; response jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':replace_handoff:'||p_key,0));
 fingerprint:=encode(extensions.digest(jsonb_build_object('leadId',p_lead_id,'recordingId',p_recording_id,'expectedVersion',p_expected)::text,'sha256'),'hex');
 select * into saved from public.operation_idempotency where actor_id=actor and action='replace_handoff' and idem_key=p_key;
 if found then if saved.input_hash<>fingerprint then raise exception using errcode='23505',message='idempotency_key_reused'; end if; return saved.response; end if;
 select * into l from public.leads where id=p_lead_id for update;
 select * into r from public.recordings where id=p_recording_id and lead_id=p_lead_id and state='ready';
 if not found then raise exception using errcode='23514',message='ready_recording_required'; end if;
 select * into h from public.current_handoffs where lead_id=p_lead_id;
 if coalesce(h.version,0)<>p_expected then raise exception using errcode='40001',message='stale_handoff_version'; end if;
 insert into public.recording_shares(recording_id,token_hash,token_ciphertext,created_by) values(p_recording_id,p_hash,p_ciphertext,auth.uid()) returning * into sh;
 v:=coalesce(h.version,0)+1;
 insert into public.handoff_versions(lead_id,version,recording_id,share_id,changed_by) values(p_lead_id,v,p_recording_id,sh.id,auth.uid());
 insert into public.current_handoffs(lead_id,version,recording_id,share_id) values(p_lead_id,v,p_recording_id,sh.id)
 on conflict(lead_id) do update set version=excluded.version,recording_id=excluded.recording_id,share_id=excluded.share_id,updated_at=now();
 update public.leads set sheet_sync_version=sheet_sync_version+1,sheet_sync_state='pending',sheet_sync_error=null where id=p_lead_id returning * into l;
 insert into public.sheet_sync_jobs(lead_id,desired_version,idempotency_key) values(l.id,l.sheet_sync_version,'handoff:'||p_lead_id||':'||v) on conflict do nothing;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(actor,'handoff.changed','lead',p_lead_id,jsonb_build_object('version',v,'recordingId',p_recording_id,'shareId',sh.id,'key',p_key));
 response:=jsonb_build_object('version',v,'shareId',sh.id,'tokenCiphertext',sh.token_ciphertext);
 insert into public.operation_idempotency(actor_id,action,idem_key,input_hash,response) values(actor,'replace_handoff',p_key,fingerprint,response);
 return response;
end $$;

create or replace function public.enqueue_sheet_job(p_lead_id uuid,p_version bigint,p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid:=public.assert_staff(); job public.sheet_sync_jobs; current_version bigint;
begin
 select sheet_sync_version into current_version from public.leads where id=p_lead_id;
 if current_version is null or p_version>current_version then raise exception using errcode='23514',message='sync_version_invalid'; end if;
 insert into public.sheet_sync_jobs(lead_id,desired_version,idempotency_key) values(p_lead_id,p_version,p_key)
 on conflict(lead_id,desired_version) do update set lead_id=excluded.lead_id returning * into job;
 return job.id;
end $$;

create or replace function public.get_lead_bundle(p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.leads;
begin
 perform public.assert_staff();
 select * into l from public.leads where id=p_lead_id;
 if not found then raise exception using errcode='P0002',message='lead_not_found'; end if;
 return jsonb_build_object('lead',to_jsonb(l),'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.ordinal) from public.contact_attempts a where a.lead_id=l.id),'[]'::jsonb),
  'recordings',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.recordings r where r.lead_id=l.id),'[]'::jsonb),
  'handoff',(select jsonb_build_object('version',h.version,'recordingId',h.recording_id,'shareId',h.share_id,'changedAt',v.changed_at,'changedBy',v.changed_by) from public.current_handoffs h join public.handoff_versions v using(lead_id,version) where h.lead_id=l.id),
  'shares',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'recordingId',s.recording_id,'state',s.state,'tokenCiphertext',s.token_ciphertext,'createdAt',s.created_at,'createdBy',s.created_by,'revokedAt',s.revoked_at)) from public.recording_shares s join public.recordings r on r.id=s.recording_id where r.lead_id=l.id),'[]'::jsonb));
end $$;

-- Sheet worker fencing: every reclaimed lease advances a monotonic token.
create or replace function public.sheets_claim_jobs(worker_id text, job_limit integer default 20, lease_seconds integer default 60)
returns setof public.sheet_sync_jobs language plpgsql security definer set search_path = '' as $$
begin
 return query with picked as (
  select j.id from public.sheet_sync_jobs j
  join public.leads l on l.id=j.lead_id
  where j.desired_version=l.sheet_sync_version
  and not exists(select 1 from public.sheet_sync_jobs live where live.lead_id=j.lead_id and live.state in ('running','blocked'))
  and ((j.state in ('pending','retrying') and j.next_run_at<=now()) or (j.state='running' and j.lease_expires_at<now()))
  order by j.next_run_at,j.created_at for update of j skip locked limit greatest(1,least(job_limit,100))
 ), updated as (
  update public.sheet_sync_jobs j set state='running',attempts=attempts+1,lease_owner=worker_id,
   lease_expires_at=now()+make_interval(secs=>greatest(10,least(lease_seconds,600))),fencing_token=fencing_token+1
  from picked where j.id=picked.id returning j.*
 ) select * from updated;
end $$;

create or replace function public.sheets_mark_job_result(job_id uuid,fencing_token bigint,result_state public.sync_state,error_text text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.sheet_sync_jobs;
begin
 if result_state not in ('succeeded','retrying','blocked') then raise exception using errcode='23514',message='sync_result_state_invalid'; end if;
 update public.sheet_sync_jobs set state=result_state,last_error=left(error_text,2000),
  next_run_at=case when result_state='retrying' then now()+make_interval(secs=>least(3600,power(2,least(attempts,10))::integer)) else next_run_at end,
  lease_owner=null,lease_expires_at=null
 where id=job_id and state='running' and sheet_sync_jobs.fencing_token=sheets_mark_job_result.fencing_token returning * into j;
 if not found then return false; end if;
 if result_state='succeeded' then
  update public.leads set sheet_sync_applied_version=greatest(coalesce(sheet_sync_applied_version,0),j.desired_version),sheet_sync_state='succeeded',sheet_sync_error=null
  where id=j.lead_id and sheet_sync_version=j.desired_version;
 else
  update public.leads set sheet_sync_state=result_state,sheet_sync_error=left(error_text,2000) where id=j.lead_id and sheet_sync_version=j.desired_version;
 end if;
 return true;
end $$;

-- Serialize overlapping cron invocations that could otherwise write Sheets concurrently.
create table if not exists public.sheet_worker_lock (
 singleton boolean primary key default true check(singleton), worker_id text, expires_at timestamptz
);
insert into public.sheet_worker_lock(singleton) values(true) on conflict(singleton) do nothing;
alter table public.sheet_worker_lock enable row level security;
revoke all on public.sheet_worker_lock from public,anon,authenticated;

create or replace function public.sheets_claim_worker(worker_id text,lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_owner text; current_expiry timestamptz;
begin
 if sheets_claim_worker.worker_id is null or length(sheets_claim_worker.worker_id)=0 or sheets_claim_worker.lease_seconds not between 10 and 600 then raise exception 'invalid_worker_lease' using errcode='22023'; end if;
 select sheet_worker_lock.worker_id,sheet_worker_lock.expires_at into current_owner,current_expiry from public.sheet_worker_lock where singleton=true for update;
 if current_owner is not null and current_expiry>now() and current_owner<>sheets_claim_worker.worker_id then return false; end if;
 update public.sheet_worker_lock set worker_id=sheets_claim_worker.worker_id,expires_at=now()+make_interval(secs=>sheets_claim_worker.lease_seconds) where singleton=true;
 return true;
end $$;

create or replace function public.sheets_release_worker(worker_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare released integer;
begin
 update public.sheet_worker_lock set worker_id=null,expires_at=null where singleton=true and sheet_worker_lock.worker_id=sheets_release_worker.worker_id;
 get diagnostics released=row_count;
 return released=1;
end $$;

create or replace function public.sheets_reconcile_job(job_id uuid,fencing_token bigint,observed_matches boolean,detail text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.sheet_sync_jobs;
begin
 select * into j from public.sheet_sync_jobs where id=sheets_reconcile_job.job_id for update;
 if not found or j.state<>'blocked' or j.fencing_token<>sheets_reconcile_job.fencing_token then return false; end if;
 if not observed_matches then
  update public.sheet_sync_jobs set last_error=left(coalesce(detail,'Sheet output still differs from latest app snapshot.'),2000) where id=j.id;
  update public.leads set sheet_sync_state='blocked',sheet_sync_error=left(coalesce(detail,'Sheet output still differs from latest app snapshot.'),2000) where id=j.lead_id and sheet_sync_version=j.desired_version;
  return false;
 end if;
 update public.sheet_sync_jobs set state='succeeded',last_error=null,lease_owner=null,lease_expires_at=null where id=j.id returning * into j;
 update public.leads set sheet_sync_applied_version=sheet_sync_version,sheet_sync_state='succeeded',sheet_sync_error=null where id=j.lead_id;
 return true;
end $$;

create or replace function public.sheets_record_conflict(lead_id uuid,conflict jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(null,'sheet.conflict','lead',lead_id,coalesce(conflict,'{}'::jsonb));
 update public.leads set sheet_sync_state='blocked',sheet_sync_error='Sheet identity or schema conflict' where id=lead_id;
end $$;

create or replace function public.sheets_export_snapshot(lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.leads;
begin
 select * into l from public.leads where id=lead_id;
 if not found then return null; end if;
 return jsonb_build_object('leadId',l.id,'sourcePlatformId',l.source_platform_id,'phone',l.phone,'displayName',l.display_name,'source',l.source,
  'createdAt',l.source_created_at,'email',l.email,'formAnswers',l.form_answers,'attemptCount',l.attempt_count,'evaluation',l.evaluation,
  'evaluationVersion',l.evaluation_version,'evaluationAt',l.evaluation_at,'desiredVersion',l.sheet_sync_version,
  'attempts',coalesce((select jsonb_agg(jsonb_build_object('ordinal',a.ordinal,'outcome',a.outcome,'note',a.note,'completedAt',a.completed_at) order by a.ordinal) from public.contact_attempts a where a.lead_id=l.id and a.state='completed'),'[]'::jsonb),
  'handoff',(select jsonb_build_object('version',h.version,'recordingId',h.recording_id,'shareId',h.share_id,'shareTokenCiphertext',s.token_ciphertext,'shareState',s.state,'recordingCode',r.recording_code) from public.current_handoffs h join public.recording_shares s on s.id=h.share_id join public.recordings r on r.id=h.recording_id where h.lead_id=sheets_export_snapshot.lead_id));
end $$;

create or replace function public.sheets_import_row("row" jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lead_id uuid; existing public.leads; attempt jsonb; inserted integer:=0; historical_count integer:=0; mapped_attempts jsonb; is_new boolean:=false; next_ordinal smallint;
begin
 lead_id:=nullif("row"->>'leadId','')::uuid;
 if lead_id is null then raise exception using errcode='23514',message='stable_lead_uuid_required'; end if;
 select * into existing from public.leads where id=lead_id for update;
 if not found then
  is_new:=true;
  insert into public.leads(id,source_platform_id,phone,display_name,source,source_created_at,email,form_answers)
  values(lead_id,nullif("row"->>'sourcePlatformId',''),coalesce("row"->>'phone',''),nullif("row"->>'displayName',''),nullif("row"->>'source',''),nullif("row"->>'createdAt','')::timestamptz,nullif("row"->>'email',''),coalesce("row"->'formAnswers','{}'::jsonb)) returning * into existing;
 else
  update public.leads set phone=coalesce(nullif("row"->>'phone',''),phone),display_name=coalesce(nullif("row"->>'displayName',''),display_name),source=coalesce(nullif("row"->>'source',''),source),source_created_at=coalesce(nullif("row"->>'createdAt','')::timestamptz,source_created_at),email=coalesce(nullif("row"->>'email',''),email),form_answers=coalesce("row"->'formAnswers',form_answers) where id=existing.id returning * into existing;
 end if;
 mapped_attempts:=coalesce("row"->'legacyAttempts','[]'::jsonb);
 if is_new then
 for attempt in select value from jsonb_array_elements(mapped_attempts) loop
  if inserted>=5 then exit; end if;
  next_ordinal:=coalesce(nullif(attempt->>'ordinal','')::smallint,inserted+1);
  if nullif(attempt->>'outcome','') in ('interested','unreachable','callback','hung_up','not_interested','spam','wrong_number','other') and next_ordinal between 1 and 5 and not exists(select 1 from public.contact_attempts ca where ca.lead_id=existing.id and ca.ordinal=next_ordinal and ca.state<>'canceled') then
   insert into public.contact_attempts(lead_id,ordinal,state,outcome,note,actor_id,started_at,completed_at,idempotency_key)
   values(existing.id,next_ordinal,'completed',(attempt->>'outcome')::public.contact_outcome,
    case when attempt->>'outcome'='other' then coalesce(nullif(attempt->>'note',''),'Imported historical attempt') else nullif(attempt->>'note','') end,
    (select user_id from public.profiles where role='admin' order by created_at limit 1),coalesce(nullif(attempt->>'occurredAt','')::timestamptz,now()),coalesce(nullif(attempt->>'occurredAt','')::timestamptz,now()),'sheet-import:'||existing.id||':'||next_ordinal);
   inserted:=inserted+1;
  end if;
 end loop;
 select coalesce(max(ca.ordinal),0) into historical_count from public.contact_attempts ca where ca.lead_id=existing.id and ca.state='completed';
 update public.leads set attempt_count=least(5,greatest(historical_count,least(5,coalesce(("row"->>'legacyAttemptCount')::integer,0)))),
  legacy_share_urls=coalesce("row"->'legacyShareUrls','[]'::jsonb),legacy_source_metadata=jsonb_strip_nulls(jsonb_build_object(
   'legacyOutcome',"row"->>'legacyOutcome','legacyEvaluation',"row"->>'legacyEvaluation','legacyEvaluationAt',"row"->>'legacyVerifiedAt',
   'evaluationNote',"row"->>'evaluationNote','legacyShareUrls',"row"->'legacyShareUrls')) where id=existing.id returning * into existing;
 else
  update public.leads set source_platform_id=coalesce(nullif("row"->>'sourcePlatformId',''),source_platform_id),phone=coalesce(nullif("row"->>'phone',''),phone),display_name=coalesce(nullif("row"->>'displayName',''),display_name),source=coalesce(nullif("row"->>'source',''),source),source_created_at=coalesce(nullif("row"->>'createdAt','')::timestamptz,source_created_at),email=coalesce(nullif("row"->>'email',''),email),form_answers=coalesce("row"->'formAnswers',form_answers) where id=existing.id returning * into existing;
 end if;
 return jsonb_build_object('leadId',existing.id,'attemptCount',existing.attempt_count,'evaluation',existing.evaluation);
end $$;

create or replace function public.sheets_save_mapping(mapping jsonb)
returns public.sheet_mappings language plpgsql security definer set search_path = '' as $$
declare m public.sheet_mappings; actor uuid:=auth.uid();
begin
 if public.current_actor_role() is distinct from 'admin' then raise exception using errcode='42501',message='admin_required'; end if;
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

create unique index if not exists sheet_mappings_one_per_tab on public.sheet_mappings(spreadsheet_id,tab_id);

create or replace function public.sheets_get_import_cursor(mapping_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.sheet_mappings;
begin
 select * into m from public.sheet_mappings where id=sheets_get_import_cursor.mapping_id;
 if not found then return null; end if;
 return jsonb_build_object('mappingId',m.id,'cursor',m.import_cursor,'updatedAt',m.import_cursor_updated_at);
end $$;

create or replace function public.sheets_advance_import_cursor(mapping_id uuid,expected_cursor text,next_cursor text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 update public.sheet_mappings set import_cursor=next_cursor,import_cursor_updated_at=now(),updated_at=now()
 where id=sheets_advance_import_cursor.mapping_id and import_cursor is not distinct from sheets_advance_import_cursor.expected_cursor;
 return found;
end $$;

-- No browser write access. Security definer entry points enforce actor roles.
revoke all on function public.assert_staff(),public.claim_attempt(uuid,text), public.resume_attempt(uuid), public.cancel_attempt(uuid,text), public.create_recording(uuid,uuid,text,text,bigint,text), public.mark_recording_ready(uuid,bigint,integer,text,text), public.save_outcome(uuid,public.contact_outcome,text,uuid,text,uuid,bigint,text), public.set_evaluation(uuid,text,uuid,bigint,text), public.issue_share(uuid,text,text,text), public.resolve_share(text), public.revoke_share(uuid,text), public.set_handoff(uuid,uuid,text,text,bigint,text),public.enqueue_sheet_job(uuid,bigint,text), public.get_lead_bundle(uuid), public.leads_for_actor(text),public.sheets_claim_jobs(text,integer,integer),public.sheets_mark_job_result(uuid,bigint,public.sync_state,text),public.sheets_reconcile_job(uuid,bigint,boolean,text),public.sheets_import_row(jsonb),public.sheets_export_snapshot(uuid),public.sheets_record_conflict(uuid,jsonb),public.sheets_save_mapping(jsonb),public.sheets_get_import_cursor(uuid),public.sheets_advance_import_cursor(uuid,text,text),public.sheets_claim_worker(text,integer),public.sheets_release_worker(text) from public, anon, authenticated;
grant execute on function public.leads_for_actor(text),public.get_lead_bundle(uuid),public.claim_attempt(uuid,text),public.resume_attempt(uuid),public.cancel_attempt(uuid,text),public.create_recording(uuid,uuid,text,text,bigint,text),public.save_outcome(uuid,public.contact_outcome,text,uuid,text,uuid,bigint,text),public.set_evaluation(uuid,text,uuid,bigint,text),public.issue_share(uuid,text,text,text),public.revoke_share(uuid,text),public.set_handoff(uuid,uuid,text,text,bigint,text),public.enqueue_sheet_job(uuid,bigint,text),public.sheets_save_mapping(jsonb) to authenticated, service_role;
grant execute on function public.mark_recording_ready(uuid,bigint,integer,text,text),public.resolve_share(text),public.sheets_claim_jobs(text,integer,integer),public.sheets_mark_job_result(uuid,bigint,public.sync_state,text),public.sheets_reconcile_job(uuid,bigint,boolean,text),public.sheets_import_row(jsonb),public.sheets_export_snapshot(uuid),public.sheets_record_conflict(uuid,jsonb) to service_role;
grant execute on function public.sheets_get_import_cursor(uuid),public.sheets_advance_import_cursor(uuid,text,text),public.sheets_claim_worker(text,integer),public.sheets_release_worker(text) to service_role;

-- Admin/staff can read RLS protected rows. Role assignments are service-only.
create policy "admin reads shares" on public.recording_shares for select to authenticated using (public.current_actor_role()='admin');
create policy "staff reads evaluations and sync status" on public.leads for select to authenticated using (public.current_actor_role() in ('admin','staff'));
create policy "admin reads sync jobs" on public.sheet_sync_jobs for select to authenticated using (public.current_actor_role()='admin');
create policy "admin reads handoff history" on public.handoff_versions for select to authenticated using (public.current_actor_role()='admin');
revoke insert,update,delete on public.profiles from anon,authenticated;
revoke insert,update,delete on public.leads,public.contact_attempts,public.recordings,public.recording_shares,public.handoff_versions,public.current_handoffs,public.sheet_sync_jobs,public.audit_events from anon,authenticated;
