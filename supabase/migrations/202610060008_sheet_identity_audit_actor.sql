drop function public.sheets_resolve_identity_conflict(uuid,boolean,text);

create function public.sheets_resolve_identity_conflict(lead_id uuid,observed_unique boolean,detail text default null,p_actor_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
 if p_actor_id is null or not exists(select 1 from public.profiles p where p.user_id=p_actor_id and p.role='admin') then
  raise exception using errcode='42501',message='admin_required';
 end if;
 select * into l from public.leads where id=sheets_resolve_identity_conflict.lead_id for update;
 if not found or not l.sheet_identity_blocked or not observed_unique then return false; end if;
 update public.leads set sheet_identity_blocked=false,sheet_identity_conflict='{}'::jsonb,sheet_sync_error=null,
  sheet_sync_state=case when sheet_sync_applied_version>=sheet_sync_version then 'succeeded'::public.sync_state else 'pending'::public.sync_state end
 where id=l.id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(p_actor_id,'sheet.identity_repaired','lead',l.id,jsonb_build_object('detail',left(detail,500)));
 return true;
end $$;

revoke all on function public.sheets_resolve_identity_conflict(uuid,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.sheets_resolve_identity_conflict(uuid,boolean,text,uuid) to service_role;
