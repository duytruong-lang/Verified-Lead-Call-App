-- Follow-up to the isolated viewer enum migration.
-- Additive membership enforcement; preserve existing users and call history.

create type public.member_status as enum ('pending', 'active', 'disabled');

alter table public.profiles
  add column status public.member_status not null default 'active',
  add column email text,
  add column activated_at timestamptz;

-- Profiles remain the fast authorization source; team_members is the canonical
-- admin roster and also represents an invitation before its Auth identity exists.
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  normalized_email text not null unique,
  display_name text,
  role public.actor_role not null,
  status public.member_status not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  invited_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  check (normalized_email = lower(btrim(email)))
);
create index team_members_status_role_idx on public.team_members(status, role);

-- Backfill existing users as active memberships. Keep profiles/user IDs stable.
insert into public.team_members(auth_user_id,email,normalized_email,display_name,role,status,created_at,activated_at)
select p.user_id, u.email, lower(btrim(u.email)), p.display_name, p.role, 'active', p.created_at, p.created_at
from public.profiles p
join auth.users u on u.id=p.user_id
where nullif(btrim(u.email),'') is not null
on conflict (normalized_email) do update
set auth_user_id=excluded.auth_user_id, role=excluded.role, status='active';
update public.profiles p set email=u.email
from auth.users u where u.id=p.user_id;

create table public.team_admin_operations (
  actor_id uuid not null references auth.users(id),
  action text not null,
  idempotency_key text not null,
  input_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key(actor_id,action,idempotency_key)
);

-- A generated Auth token hash is a bearer secret. Persist only AES-GCM ciphertext
-- so a lost HTTP response can be replayed with the same idempotency key.
create table public.team_member_link_operations (
  actor_id uuid not null references auth.users(id),
  member_id uuid not null references public.team_members(id),
  kind text not null check (kind in ('invite','recovery')),
  idempotency_key text not null,
  input_hash text not null,
  token_ciphertext text,
  expires_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(actor_id,kind,idempotency_key)
);

-- One durable, member-wide gate serializes invite/recovery links across admins
-- and idempotency keys. If Auth may have completed a timed-out request, keep
-- the member gated until that link's configured lifetime has elapsed.
create table public.team_member_link_locks (
  member_id uuid primary key references public.team_members(id) on delete cascade,
  owner_actor_id uuid references auth.users(id),
  kind text not null check (kind in ('invite','recovery')),
  idempotency_key text not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  uncertain_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.team_members enable row level security;
alter table public.team_admin_operations enable row level security;
alter table public.team_member_link_operations enable row level security;
alter table public.team_member_link_locks enable row level security;
revoke all on public.team_members, public.team_admin_operations, public.team_member_link_operations, public.team_member_link_locks from public, anon, authenticated;
grant select,insert,update,delete on public.team_members, public.team_admin_operations, public.team_member_link_operations, public.team_member_link_locks to service_role;

create or replace function public.current_actor_role() returns public.actor_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p join public.team_members m on m.auth_user_id=p.user_id
  where p.user_id=(select auth.uid()) and p.status='active' and m.status='active'
    and p.role=m.role
$$;

create or replace function public.assert_member() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception using errcode='42501', message='active_member_required'; end if;
  perform 1 from public.team_members m where m.auth_user_id=actor and m.status='active' for share;
  if not found then raise exception using errcode='42501', message='active_member_required'; end if;
  perform 1 from public.profiles p join public.team_members m on m.auth_user_id=p.user_id
  where p.user_id=actor and p.status='active' and m.status='active' and p.role=m.role for share of p;
  if not found then raise exception using errcode='42501', message='active_member_required'; end if;
  return actor;
end $$;

create or replace function public.assert_staff() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then
    raise exception using errcode='42501', message='staff_required';
  end if;
  -- Share-lock serializes an in-flight staff mutation against soft disable.
  perform 1 from public.team_members m where m.auth_user_id=actor and m.status='active' and m.role in ('admin','staff') for share;
  if not found then raise exception using errcode='42501', message='staff_required'; end if;
  perform 1 from public.profiles p join public.team_members m on m.auth_user_id=p.user_id
  where p.user_id=actor and p.status='active' and m.status='active' and p.role=m.role and p.role in ('admin','staff') for share of p;
  if not found then raise exception using errcode='42501', message='staff_required'; end if;
  return actor;
end $$;

create or replace function public.team_assert_admin(p_actor_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform 1 from public.team_members m where m.auth_user_id=p_actor_id and m.status='active' and m.role='admin' for share;
  if not found then raise exception using errcode='42501', message='admin_required'; end if;
  perform 1 from public.profiles p join public.team_members m on m.auth_user_id=p.user_id
  where p.user_id=p_actor_id and p.status='active' and p.role='admin' and m.status='active' and m.role='admin'
  for share of p;
  if not found then raise exception using errcode='42501', message='admin_required'; end if;
end $$;


create or replace function public.team_active_admin_count() returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.team_members m join public.profiles p on p.user_id=m.auth_user_id
  join auth.users u on u.id=m.auth_user_id
  where m.role='admin' and m.status='active' and p.role='admin' and p.status='active'
    and lower(btrim(coalesce(u.email,'')))=m.normalized_email
$$;

-- Edge-only identity lookup for an Auth user whose membership is pending/active.
create or replace function public.team_auth_context(p_auth_user_id uuid)
returns table(member_id uuid,email text,role public.actor_role,status public.member_status,version bigint,display_name text,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id,m.email,m.role,m.status,m.version,m.display_name,m.created_at
  from public.team_members m join public.profiles p on p.user_id=m.auth_user_id
  where m.auth_user_id=p_auth_user_id and p.email is not null
    and lower(btrim(p.email))=m.normalized_email and p.role=m.role and p.status=m.status
    and exists(select 1 from auth.users u where u.id=m.auth_user_id and lower(btrim(coalesce(u.email,'')))=m.normalized_email)
$$;

create or replace function public.team_list_members(p_actor_id uuid)
returns setof public.team_members
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.team_assert_admin(p_actor_id);
  return query select m.* from public.team_members m order by m.created_at,m.normalized_email;
end $$;

create or replace function public.team_reserve_invitation(p_actor_id uuid,p_email text,p_role text,p_key text,p_input_hash text)
returns public.team_members
language plpgsql security definer set search_path = '' as $$
declare email_norm text:=lower(btrim(p_email)); saved public.team_admin_operations; m public.team_members; response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('team-admin-mutations',0));
  perform public.team_assert_admin(p_actor_id);
  if email_norm='' or position('@' in email_norm)=0 or length(email_norm)>320 then raise exception using errcode='22023',message='email_invalid'; end if;
  if p_role not in ('admin','staff','viewer') then raise exception using errcode='22023',message='member_role_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('team-email:'||email_norm,0));
  select * into saved from public.team_admin_operations where actor_id=p_actor_id and action='invite-member' and idempotency_key=p_key for update;
  if found then
    if saved.input_hash<>p_input_hash then raise exception using errcode='23505',message='idempotency_key_reused'; end if;
    select * into m from public.team_members where id=(saved.response->>'memberId')::uuid;
    return m;
  end if;
  select * into m from public.team_members where normalized_email=email_norm for update;
  if found then
    if m.status='pending' and m.auth_user_id is null and m.role=p_role then
      -- Recover an interrupted first invite. Reuse the reserved membership row.
      null;
    else
      raise exception using errcode='23505',message='member_email_already_exists';
    end if;
  else
    insert into public.team_members(email,normalized_email,role,status)
    values(btrim(p_email),email_norm,p_role::public.actor_role,'pending') returning * into m;
  end if;
  response:=jsonb_build_object('memberId',m.id);
  insert into public.team_admin_operations(actor_id,action,idempotency_key,input_hash,response)
  values(p_actor_id,'invite-member',p_key,p_input_hash,response);
  return m;
end $$;

-- Service-only helper to recover the Auth side if generateLink created an
-- invited user but the Edge Function lost its response before binding it.
create or replace function public.team_find_auth_user(p_email text)
returns table(user_id uuid,created_at timestamptz) language sql stable security definer set search_path = '' as $$
  select u.id,u.created_at from auth.users u where lower(btrim(u.email))=lower(btrim(p_email)) order by u.created_at limit 1
$$;

create or replace function public.team_bind_auth_user(p_actor_id uuid,p_member_id uuid,p_auth_user_id uuid)
returns public.team_members
language plpgsql security definer set search_path = '' as $$
declare m public.team_members; auth_email text;
begin
  perform pg_advisory_xact_lock(hashtextextended('team-admin-mutations',0));
  perform public.team_assert_admin(p_actor_id);
  select lower(btrim(u.email)) into auth_email from auth.users u where u.id=p_auth_user_id;
  if auth_email is null then raise exception using errcode='P0002',message='auth_user_not_found'; end if;
  select * into m from public.team_members where id=p_member_id for update;
  if not found or m.normalized_email<>auth_email then raise exception using errcode='42501',message='invitation_identity_mismatch'; end if;
  if m.auth_user_id is not null and m.auth_user_id<>p_auth_user_id then raise exception using errcode='23505',message='member_auth_identity_conflict'; end if;
  if m.status<>'pending' then
    if m.status='active' and m.auth_user_id=p_auth_user_id then return m; end if;
    raise exception using errcode='42501',message='member_not_pending';
  end if;
  if m.auth_user_id=p_auth_user_id then return m; end if;
  if exists(select 1 from public.profiles p where p.user_id=p_auth_user_id) then
    raise exception using errcode='23505',message='auth_user_already_member';
  end if;
  update public.team_members set auth_user_id=p_auth_user_id,invited_at=coalesce(invited_at,now()),updated_at=now() where id=p_member_id returning * into m;
  insert into public.profiles(user_id,role,display_name,status,email,activated_at)
  values(p_auth_user_id,m.role,m.display_name,'pending',m.email,null)
  on conflict(user_id) do nothing;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,payload)
  values(p_actor_id,'team.member.invited','team_member',m.id,jsonb_build_object('role',m.role));
  return m;
end $$;

-- Cancel draft attempts and clear lead claims in the same lead-then-attempt lock
-- order used by normal call writes. Completed history/counts are untouched.
create or replace function public.team_cancel_member_drafts(p_member_auth_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform l.id from public.leads l
  join public.contact_attempts a on a.lead_id=l.id
  where a.actor_id=p_member_auth_user_id and a.state='draft'
  order by l.id for update of l;
  update public.contact_attempts set state='canceled',claim_expires_at=now()
    where actor_id=p_member_auth_user_id and state='draft';
  update public.leads set claimed_by=null,claim_expires_at=null
    where claimed_by=p_member_auth_user_id;
end $$;

create or replace function public.team_begin_member_link(p_actor_id uuid,p_member_id uuid,p_kind text,p_key text,p_input_hash text,p_lease_token uuid,p_uncertain_until timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.team_members; op public.team_member_link_operations; issuance public.team_member_link_locks;
begin
  perform pg_advisory_xact_lock(hashtextextended('team-admin-mutations',0));
  perform public.team_assert_admin(p_actor_id);
  if p_kind not in ('invite','recovery') then raise exception using errcode='22023',message='member_link_kind_invalid'; end if;
  select * into m from public.team_members where id=p_member_id for update;
  if not found or (p_kind='invite' and m.status<>'pending') or (p_kind='recovery' and m.status<>'active') then raise exception using errcode='42501',message='member_link_not_allowed'; end if;
  -- Create an unlocked row first; only reserve after the replay/conflict checks.
  insert into public.team_member_link_locks(member_id,kind,idempotency_key)
  values(p_member_id,p_kind,p_key)
  on conflict(member_id) do nothing;
  select * into issuance from public.team_member_link_locks where member_id=p_member_id for update;
  insert into public.team_member_link_operations(actor_id,member_id,kind,idempotency_key,input_hash)
  values(p_actor_id,p_member_id,p_kind,p_key,p_input_hash) on conflict do nothing;
  select * into op from public.team_member_link_operations where actor_id=p_actor_id and kind=p_kind and idempotency_key=p_key for update;
  if op.input_hash<>p_input_hash or op.member_id<>p_member_id then raise exception using errcode='23505',message='idempotency_key_reused'; end if;
  if op.token_ciphertext is not null and op.expires_at>now() then
    if issuance.owner_actor_id is distinct from p_actor_id or issuance.kind<>p_kind or issuance.idempotency_key<>p_key then
      raise exception using errcode='40001',message='member_link_replaced';
    end if;
    return jsonb_build_object('state','ready','ciphertext',op.token_ciphertext,'expiresAt',op.expires_at);
  end if;
  if op.token_ciphertext is not null and op.expires_at<=now() then raise exception using errcode='22023',message='member_link_expired'; end if;
  if issuance.lease_expires_at>now() then raise exception using errcode='40001',message='member_link_in_progress'; end if;
  if issuance.member_id=p_member_id and issuance.uncertain_until>now() then raise exception using errcode='40001',message='member_link_uncertain'; end if;
  if op.lease_expires_at>now() and op.lease_token is distinct from p_lease_token then
    raise exception using errcode='40001',message='member_link_in_progress';
  end if;
  update public.team_member_link_operations set token_ciphertext=null,expires_at=null,lease_token=p_lease_token,lease_expires_at=now()+interval '2 minutes'
  where actor_id=p_actor_id and kind=p_kind and idempotency_key=p_key;
  insert into public.team_member_link_locks(member_id,owner_actor_id,kind,idempotency_key,lease_token,lease_expires_at,uncertain_until)
  values(p_member_id,p_actor_id,p_kind,p_key,p_lease_token,now()+interval '2 minutes',p_uncertain_until)
  on conflict(member_id) do update set owner_actor_id=excluded.owner_actor_id,kind=excluded.kind,idempotency_key=excluded.idempotency_key,
    lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,uncertain_until=excluded.uncertain_until,updated_at=now();
  return jsonb_build_object('state','generate');
end $$;

create or replace function public.team_save_member_link(p_actor_id uuid,p_member_id uuid,p_kind text,p_key text,p_input_hash text,p_lease_token uuid,p_ciphertext text,p_expires_at timestamptz)
returns public.team_members
language plpgsql security definer set search_path = '' as $$
declare m public.team_members;
begin
  perform pg_advisory_xact_lock(hashtextextended('team-admin-mutations',0));
  perform public.team_assert_admin(p_actor_id);
  select * into m from public.team_members where id=p_member_id for update;
  if not found or (p_kind='invite' and m.status<>'pending') or (p_kind='recovery' and m.status<>'active') then raise exception using errcode='42501',message='member_link_not_allowed'; end if;
  update public.team_member_link_operations set token_ciphertext=p_ciphertext,expires_at=p_expires_at,lease_token=null,lease_expires_at=null
  where actor_id=p_actor_id and member_id=p_member_id and kind=p_kind and idempotency_key=p_key and input_hash=p_input_hash and lease_token=p_lease_token;
  if not found then raise exception using errcode='40001',message='member_link_reservation_lost'; end if;
  update public.team_member_link_locks set lease_token=null,lease_expires_at=null,uncertain_until=null,updated_at=now()
  where member_id=p_member_id and owner_actor_id=p_actor_id and kind=p_kind and idempotency_key=p_key and lease_token=p_lease_token;
  if not found then raise exception using errcode='40001',message='member_link_reservation_lost'; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,payload)
  values(p_actor_id,'team.member.link_issued','team_member',m.id,jsonb_build_object('kind',p_kind));
  return m;
end $$;

create or replace function public.team_get_member_link(p_actor_id uuid,p_member_id uuid,p_kind text,p_key text,p_input_hash text)
returns table(member public.team_members,token_ciphertext text,expires_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare op public.team_member_link_operations;
begin
  perform public.team_assert_admin(p_actor_id);
  select * into op from public.team_member_link_operations where actor_id=p_actor_id and member_id=p_member_id and kind=p_kind and idempotency_key=p_key;
  if not found then return; end if;
  if op.input_hash<>p_input_hash then raise exception using errcode='23505',message='idempotency_key_reused'; end if;
  if (p_kind='invite' and not exists(select 1 from public.team_members m where m.id=p_member_id and m.status='pending'))
    or (p_kind='recovery' and not exists(select 1 from public.team_members m where m.id=p_member_id and m.status='active')) then
    raise exception using errcode='42501',message='member_link_not_allowed';
  end if;
  if op.token_ciphertext is null or op.expires_at<=now() then raise exception using errcode='22023',message='member_link_expired'; end if;
  if not exists(select 1 from public.team_member_link_locks i where i.member_id=p_member_id
    and i.owner_actor_id=p_actor_id and i.kind=p_kind and i.idempotency_key=p_key and i.lease_token is null) then
    raise exception using errcode='40001',message='member_link_replaced';
  end if;
  return query select m,op.token_ciphertext,op.expires_at from public.team_members m where m.id=p_member_id;
end $$;

create or replace function public.team_set_member_role(p_actor_id uuid,p_member_id uuid,p_role text,p_expected_version bigint,p_key text,p_input_hash text)
returns public.team_members
language plpgsql security definer set search_path = '' as $$
declare m public.team_members; saved public.team_admin_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended('team-admin-mutations',0));
  perform public.team_assert_admin(p_actor_id);
  if p_role not in ('admin','staff','viewer') then raise exception using errcode='22023',message='member_role_invalid'; end if;
  select * into saved from public.team_admin_operations where actor_id=p_actor_id and action='set-member-role' and idempotency_key=p_key for update;
  if found then if saved.input_hash<>p_input_hash then raise exception using errcode='23505',message='idempotency_key_reused'; end if; select * into m from public.team_members where id=(saved.response->>'memberId')::uuid; return m; end if;
  select * into m from public.team_members where id=p_member_id for update;
  if not found then raise exception using errcode='P0002',message='member_not_found'; end if;
  if p_actor_id=m.auth_user_id then raise exception using errcode='42501',message='self_role_change_forbidden'; end if;
  if m.version<>p_expected_version then raise exception using errcode='40001',message='member_version_conflict'; end if;
  if m.role='admin' and m.status='active' and p_role<>'admin' and public.team_active_admin_count()<=1 then raise exception using errcode='23514',message='last_admin_required'; end if;
  update public.team_members set role=p_role::public.actor_role,version=version+1,updated_at=now() where id=m.id returning * into m;
  if m.auth_user_id is not null then update public.profiles set role=m.role where user_id=m.auth_user_id; end if;
  if m.auth_user_id is not null and p_role='viewer' then
    perform public.team_cancel_member_drafts(m.auth_user_id);
  end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(p_actor_id,'team.member.role_changed','team_member',m.id,jsonb_build_object('role',m.role,'version',m.version));
  insert into public.team_admin_operations(actor_id,action,idempotency_key,input_hash,response) values(p_actor_id,'set-member-role',p_key,p_input_hash,jsonb_build_object('memberId',m.id));
  return m;
end $$;

create or replace function public.team_set_member_status(p_actor_id uuid,p_member_id uuid,p_status text,p_expected_version bigint,p_key text,p_input_hash text)
returns public.team_members
language plpgsql security definer set search_path = '' as $$
declare m public.team_members; saved public.team_admin_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended('team-admin-mutations',0));
  perform public.team_assert_admin(p_actor_id);
  if p_status not in ('active','disabled') then raise exception using errcode='22023',message='member_status_invalid'; end if;
  select * into saved from public.team_admin_operations where actor_id=p_actor_id and action='set-member-status' and idempotency_key=p_key for update;
  if found then if saved.input_hash<>p_input_hash then raise exception using errcode='23505',message='idempotency_key_reused'; end if; select * into m from public.team_members where id=(saved.response->>'memberId')::uuid; return m; end if;
  select * into m from public.team_members where id=p_member_id for update;
  if not found then raise exception using errcode='P0002',message='member_not_found'; end if;
  if p_actor_id=m.auth_user_id then raise exception using errcode='42501',message='self_status_change_forbidden'; end if;
  if m.version<>p_expected_version then raise exception using errcode='40001',message='member_version_conflict'; end if;
  if p_status='active' and m.status='pending' then raise exception using errcode='42501',message='invitation_acceptance_required'; end if;
  if p_status='active' and m.activated_at is null then raise exception using errcode='42501',message='invitation_acceptance_required'; end if;
  if p_status='disabled' and m.status='active' and m.role='admin' and public.team_active_admin_count()<=1 then raise exception using errcode='23514',message='last_admin_required'; end if;
  update public.team_members set status=p_status::public.member_status,version=version+1,activated_at=case when p_status='active' then coalesce(activated_at,now()) else activated_at end,updated_at=now() where id=m.id returning * into m;
  if m.auth_user_id is not null then update public.profiles set status=m.status,activated_at=m.activated_at where user_id=m.auth_user_id; end if;
  if m.status='disabled' and m.auth_user_id is not null then
    perform public.team_cancel_member_drafts(m.auth_user_id);
  end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(p_actor_id,'team.member.status_changed','team_member',m.id,jsonb_build_object('status',m.status,'version',m.version));
  insert into public.team_admin_operations(actor_id,action,idempotency_key,input_hash,response) values(p_actor_id,'set-member-status',p_key,p_input_hash,jsonb_build_object('memberId',m.id));
  return m;
end $$;

create or replace function public.team_activate_pending_member(p_auth_user_id uuid)
returns public.team_members
language plpgsql security definer set search_path = '' as $$
declare m public.team_members; auth_email text; auth_invited_at timestamptz; auth_confirmed_at timestamptz;
begin
  select lower(btrim(u.email)),u.invited_at,u.email_confirmed_at
    into auth_email,auth_invited_at,auth_confirmed_at from auth.users u where u.id=p_auth_user_id;
  select * into m from public.team_members where auth_user_id=p_auth_user_id for update;
  if not found or m.normalized_email is distinct from auth_email then raise exception using errcode='42501',message='invitation_identity_mismatch'; end if;
  if m.status='active' and m.activated_at is not null then return m; end if;
  if m.status<>'pending' then raise exception using errcode='42501',message='member_disabled'; end if;
  if auth_invited_at is null or auth_confirmed_at is null then raise exception using errcode='42501',message='invitation_not_verified'; end if;
  update public.team_members set status='active',activated_at=coalesce(activated_at,now()),version=version+1,updated_at=now() where id=m.id returning * into m;
  update public.profiles set status='active',activated_at=m.activated_at where user_id=p_auth_user_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,payload) values(p_auth_user_id,'team.member.activated','team_member',m.id,jsonb_build_object('version',m.version));
  return m;
end $$;

-- Remove the earlier service-only overload that could mark any recording ready.
drop function public.mark_recording_ready(uuid,bigint,integer,text,text);

-- This runs under service_role after HTTP auth.getUser and role lookup. It takes a
-- row lock shared with member disable so finalize and disable serialize. The
-- attempt owner and active, unexpired claim are rechecked after byte inspection.
create or replace function public.mark_recording_ready(p_recording_id uuid,p_actor_id uuid,p_size bigint,p_duration integer,p_checksum text,p_detected_type text)
returns public.recordings language plpgsql security definer set search_path = '' as $$
declare r public.recordings; a public.contact_attempts; l public.leads; actor_role public.actor_role; initial public.recordings;
begin
  -- Read immutable association first, then take locks in the same lead -> attempt
  -- -> recording order used by save_outcome and disable cancellation.
  select * into initial from public.recordings where id=p_recording_id;
  if not found then raise exception using errcode='P0002',message='recording_not_found'; end if;
  select m.role into actor_role from public.team_members m
   join public.profiles p on p.user_id=m.auth_user_id
   where m.auth_user_id=p_actor_id and m.status='active' and p.status='active'
     and m.role=p.role and m.role in ('admin','staff') for share of m,p;
  if not found then raise exception using errcode='42501',message='staff_required'; end if;
  select * into l from public.leads where id=initial.lead_id for update;
  if not found then raise exception using errcode='P0002',message='lead_not_found'; end if;
  if initial.attempt_id is null then raise exception using errcode='42501',message='recording_owner_required'; end if;
  select * into a from public.contact_attempts where id=initial.attempt_id and lead_id=initial.lead_id for update;
  if not found then raise exception using errcode='42501',message='active_claim_required'; end if;
  select * into r from public.recordings where id=p_recording_id for update;
  if not found or r.lead_id<>l.id or r.attempt_id<>a.id then raise exception using errcode='42501',message='recording_owner_required'; end if;
  if r.created_by<>p_actor_id and actor_role<>'admin' then raise exception using errcode='42501',message='recording_owner_required'; end if;
  -- Retries after a successful finalize (including after the attempt was saved) are
  -- safe because a ready recording is immutable and belongs to this uploader/admin.
  if r.state='ready' then return r; end if;
  if a.actor_id<>p_actor_id and actor_role<>'admin' then
    raise exception using errcode='42501',message='active_claim_required';
  end if;
  if r.state not in ('uploading','validating') then raise exception using errcode='23514',message='recording_not_uploadable'; end if;
  if a.state<>'draft' or l.claimed_by<>a.actor_id or l.claim_expires_at<now() or a.claim_expires_at<now() then
    raise exception using errcode='42501',message='active_claim_required';
  end if;
  if p_size < 12 or p_size > 52428800 or p_duration < 1 or p_duration > 1800 or p_detected_type not like 'audio/%' then
    update public.recordings set state='rejected' where id=p_recording_id returning * into r; return r;
  end if;
  if r.content_type<>p_detected_type and not (r.content_type='audio/x-wav' and p_detected_type='audio/wav') then
    update public.recordings set state='rejected' where id=p_recording_id returning * into r; return r;
  end if;
  update public.recordings set state='ready',size_bytes=p_size,duration_seconds=p_duration,recorded_at=now(),checksum=p_checksum where id=p_recording_id returning * into r;
  return r;
end $$;

-- Read-only role includes viewers; active-member RPC is used for bundle reads.
drop policy if exists "staff read leads" on public.leads;
drop policy if exists "staff read attempts" on public.contact_attempts;
drop policy if exists "staff read recordings" on public.recordings;
drop policy if exists "staff read handoffs" on public.current_handoffs;
create policy "active members read leads" on public.leads for select to authenticated using (public.current_actor_role() is not null);
create policy "active members read attempts" on public.contact_attempts for select to authenticated using (public.current_actor_role() is not null);
create policy "active members read recordings" on public.recordings for select to authenticated using (public.current_actor_role() is not null);
create policy "active members read handoffs" on public.current_handoffs for select to authenticated using (public.current_actor_role() is not null);

drop policy if exists "users read own profile" on public.profiles;
create policy "active users read own profile" on public.profiles for select to authenticated
  using (user_id=(select auth.uid()) and status='active');
drop policy if exists "users read own audit events" on public.audit_events;
create policy "active users read own audit events" on public.audit_events for select to authenticated
  using ((actor_id=(select auth.uid()) and public.current_actor_role() is not null) or public.current_actor_role()='admin');

create or replace function public.leads_for_actor(p_queue text default null)
returns setof public.leads language sql stable security definer set search_path = '' as $$
 with latest as (
  select distinct on (a.lead_id) a.lead_id,a.outcome from public.contact_attempts a
  where a.state='completed' order by a.lead_id,a.completed_at desc nulls last,a.ordinal desc
 ), classified as (
  select l.*,(l.claimed_by is not null and l.claim_expires_at>=now()) as active_claim,
   (l.attempt_count>=5 or l.evaluation is not null or nullif(l.legacy_source_metadata->>'legacyEvaluation','') is not null) as finished,
   coalesce(latest.outcome='callback',false) as latest_callback,
   (l.attempt_count>0 or l.legacy_source_metadata ? 'legacyOutcome') as has_history
  from public.leads l left join latest on latest.lead_id=l.id
 )
 select c.id,c.source_platform_id,c.phone,c.display_name,c.source,c.source_created_at,c.email,c.form_answers,c.notes,c.attempt_count,c.claimed_by,c.claim_expires_at,c.evaluation,c.evaluation_version,c.sheet_sync_version,c.sheet_sync_applied_version,c.sheet_sync_state,c.sheet_sync_error,c.created_at,c.updated_at,c.legacy_share_urls,c.evaluation_note,c.evaluation_at,c.legacy_source_metadata,c.sheet_identity_blocked,c.sheet_identity_conflict
 from classified c where public.current_actor_role() is not null
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

create or replace function public.get_lead_bundle(p_lead_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare l public.leads; result jsonb;
begin
  perform public.assert_member();
  select * into l from public.leads where id=p_lead_id;
  if not found then raise exception using errcode='P0002',message='lead_not_found'; end if;
  select jsonb_build_object(
    'lead',to_jsonb(l),
    'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.ordinal) from public.contact_attempts a where a.lead_id=l.id),'[]'::jsonb),
    'recordings',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.recordings r where r.lead_id=l.id),'[]'::jsonb),
    'handoff',(select jsonb_build_object('version',h.version,'recordingId',h.recording_id,'shareId',h.share_id,'changedAt',v.changed_at,'changedBy',v.changed_by) from public.current_handoffs h join public.handoff_versions v using(lead_id,version) where h.lead_id=l.id),
    'shares',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'recordingId',s.recording_id,'state',s.state,'tokenCiphertext',s.token_ciphertext,'createdAt',s.created_at,'createdBy',s.created_by,'revokedAt',s.revoked_at)) from public.recording_shares s join public.recordings r on r.id=s.recording_id where r.lead_id=l.id),'[]'::jsonb)
  ) into result;
  return result;
end $$;

-- Revoke default PUBLIC execute on all newly-created SECURITY DEFINER helpers.
revoke all on function public.team_assert_admin(uuid),public.team_auth_context(uuid),public.team_list_members(uuid),public.team_reserve_invitation(uuid,text,text,text,text),public.team_find_auth_user(text),public.team_bind_auth_user(uuid,uuid,uuid),public.team_cancel_member_drafts(uuid),public.team_active_admin_count(),public.team_begin_member_link(uuid,uuid,text,text,text,uuid,timestamptz),public.team_save_member_link(uuid,uuid,text,text,text,uuid,text,timestamptz),public.team_get_member_link(uuid,uuid,text,text,text),public.team_set_member_role(uuid,uuid,text,bigint,text,text),public.team_set_member_status(uuid,uuid,text,bigint,text,text),public.team_activate_pending_member(uuid) from public,anon,authenticated;
grant execute on function public.team_assert_admin(uuid),public.team_auth_context(uuid),public.team_list_members(uuid),public.team_reserve_invitation(uuid,text,text,text,text),public.team_find_auth_user(text),public.team_bind_auth_user(uuid,uuid,uuid),public.team_cancel_member_drafts(uuid),public.team_active_admin_count(),public.team_begin_member_link(uuid,uuid,text,text,text,uuid,timestamptz),public.team_save_member_link(uuid,uuid,text,text,text,uuid,text,timestamptz),public.team_get_member_link(uuid,uuid,text,text,text),public.team_set_member_role(uuid,uuid,text,bigint,text,text),public.team_set_member_status(uuid,uuid,text,bigint,text,text),public.team_activate_pending_member(uuid) to service_role;
revoke all on function public.assert_member(),public.assert_staff() from public,anon,authenticated;
grant execute on function public.assert_member(),public.assert_staff() to service_role;
grant execute on function public.assert_member() to authenticated;
revoke all on function public.current_actor_role() from public,anon;
grant execute on function public.current_actor_role() to authenticated,service_role;
revoke all on function public.team_cancel_member_drafts(uuid) from public,anon,authenticated;
revoke all on function public.mark_recording_ready(uuid,uuid,bigint,integer,text,text) from public,anon,authenticated;
grant execute on function public.mark_recording_ready(uuid,uuid,bigint,integer,text,text) to service_role;

-- Existing authenticated read RPCs remain callable for active roles; writers are
-- still restricted by assert_staff and active status. Keep all privileged helpers
-- inaccessible from browser roles.

-- Recheck canonical active-admin membership at the identity-repair transaction.
create or replace function public.sheets_resolve_identity_conflict(lead_id uuid,observed_unique boolean,detail text default null,p_actor_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
 if p_actor_id is null then raise exception using errcode='42501',message='admin_required'; end if;
 perform public.team_assert_admin(p_actor_id);
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
