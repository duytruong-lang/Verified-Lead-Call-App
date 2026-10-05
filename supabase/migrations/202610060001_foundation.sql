create extension if not exists pgcrypto with schema extensions;

create type public.actor_role as enum ('admin', 'staff');
create type public.attempt_state as enum ('draft', 'completed', 'canceled');
create type public.contact_outcome as enum (
  'interested', 'unreachable', 'callback', 'hung_up',
  'not_interested', 'spam', 'wrong_number', 'other'
);
create type public.recording_state as enum ('uploading', 'validating', 'ready', 'rejected', 'failed');
create type public.share_state as enum ('active', 'revoked');
create type public.sync_state as enum ('pending', 'running', 'succeeded', 'retrying', 'blocked');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.actor_role not null default 'staff',
  display_name text,
  created_at timestamptz not null default now()
);

create function public.current_actor_role() returns public.actor_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id = (select auth.uid())
$$;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  source_platform_id text,
  phone text not null,
  display_name text,
  source text,
  source_created_at timestamptz,
  email text,
  form_answers jsonb not null default '{}'::jsonb,
  notes text,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  claimed_by uuid references public.profiles(user_id),
  claim_expires_at timestamptz,
  evaluation text check (evaluation in ('verified', 'unverified')),
  evaluation_version bigint not null default 0,
  sheet_sync_version bigint not null default 0,
  sheet_sync_applied_version bigint,
  sheet_sync_state public.sync_state,
  sheet_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_queue_idx on public.leads(attempt_count, source_created_at);

create table public.contact_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 5),
  state public.attempt_state not null default 'draft',
  outcome public.contact_outcome,
  note text,
  actor_id uuid not null references public.profiles(user_id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  claim_expires_at timestamptz not null default (now() + interval '15 minutes'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (lead_id, idempotency_key),
  check ((state = 'completed') = (completed_at is not null)),
  check (state <> 'completed' or outcome is not null),
  check (outcome <> 'other' or nullif(btrim(note), '') is not null)
);
create unique index one_non_canceled_attempt_per_ordinal on public.contact_attempts(lead_id, ordinal) where state <> 'canceled';
create unique index one_open_attempt_per_lead on public.contact_attempts(lead_id) where state = 'draft';
create index contact_attempts_lead_idx on public.contact_attempts(lead_id, ordinal desc);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  attempt_id uuid references public.contact_attempts(id),
  state public.recording_state not null default 'uploading',
  object_key text unique,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  duration_seconds integer check (duration_seconds between 1 and 1800),
  recorded_at timestamptz,
  created_by uuid not null references public.profiles(user_id),
  checksum text,
  recording_code text not null unique default upper(encode(gen_random_bytes(5), 'hex')),
  created_at timestamptz not null default now()
);
create index recordings_lead_idx on public.recordings(lead_id, created_at desc);

create table public.recording_shares (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id),
  token_hash text not null unique,
  token_ciphertext text not null,
  state public.share_state not null default 'active',
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(user_id),
  revoked_at timestamptz
);

create table public.handoff_versions (
  lead_id uuid not null references public.leads(id) on delete cascade,
  version bigint not null,
  recording_id uuid not null references public.recordings(id),
  share_id uuid not null references public.recording_shares(id),
  changed_by uuid not null references public.profiles(user_id),
  changed_at timestamptz not null default now(),
  primary key (lead_id, version)
);
create table public.current_handoffs (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  version bigint not null,
  recording_id uuid not null references public.recordings(id),
  share_id uuid not null references public.recording_shares(id),
  updated_at timestamptz not null default now()
);

create table public.sheet_mappings (
  id uuid primary key default gen_random_uuid(),
  spreadsheet_id text not null,
  tab_id bigint not null,
  tab_title text not null,
  header_row integer not null check (header_row > 0),
  schema_fingerprint text not null,
  fields jsonb not null,
  validated_at timestamptz,
  writes_enabled boolean not null default false,
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now()
);

create table public.sheet_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  desired_version bigint not null,
  idempotency_key text not null unique,
  state public.sync_state not null default 'pending',
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  last_error text,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (lead_id, desired_version)
);
create index sheet_sync_jobs_claim_idx on public.sheet_sync_jobs(state, next_run_at, lease_expires_at);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(user_id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-recordings', 'lead-recordings', false, 52428800,
        array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac']);

alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.contact_attempts enable row level security;
alter table public.recordings enable row level security;
alter table public.recording_shares enable row level security;
alter table public.handoff_versions enable row level security;
alter table public.current_handoffs enable row level security;
alter table public.sheet_mappings enable row level security;
alter table public.sheet_sync_jobs enable row level security;
alter table public.audit_events enable row level security;

create policy "users read own profile" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "staff read leads" on public.leads for select to authenticated using (public.current_actor_role() in ('admin', 'staff'));
create policy "staff read attempts" on public.contact_attempts for select to authenticated using (public.current_actor_role() in ('admin', 'staff'));
create policy "staff read recordings" on public.recordings for select to authenticated using (public.current_actor_role() in ('admin', 'staff'));
create policy "staff read handoffs" on public.current_handoffs for select to authenticated using (public.current_actor_role() in ('admin', 'staff'));
create policy "admin manages sheet mappings" on public.sheet_mappings for all to authenticated using (public.current_actor_role() = 'admin') with check (public.current_actor_role() = 'admin');
create policy "users read own audit events" on public.audit_events for select to authenticated using (actor_id = (select auth.uid()) or public.current_actor_role() = 'admin');

-- Writes and public share resolution go through Edge Functions using server-only secrets.
-- No direct client table mutation or public storage read policy is intentionally created.
