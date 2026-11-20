-- WebDeck Cloud: device profiles (caller numbers), presence and signaling.
-- Every device signs in anonymously. Users can't list each other; they can only
-- look up a single exact number, and only read signals addressed to them.

create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  number      text not null,
  number_key  text not null unique check (number_key ~ '^[0-9]{4,20}$'),
  name        text not null default 'WebDeck' check (char_length(name) <= 60),
  platform    text not null default '' check (char_length(platform) <= 20),
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "own profile: read"   on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "own profile: insert" on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own profile: delete" on public.profiles for delete to authenticated using (user_id = (select auth.uid()));

-- Look up one user by exact number. Never exposes the full table.
create or replace function public.lookup_number(p_number text)
returns table (user_id uuid, name text, number text, platform text, online boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.name, p.number, p.platform, p.last_seen > now() - interval '75 seconds'
  from public.profiles p
  where p.number_key = regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g')
    and p.user_id <> (select auth.uid())
  limit 1;
$$;

revoke all on function public.lookup_number(text) from public, anon;
grant execute on function public.lookup_number(text) to authenticated;

-- Is a number free? (true when unused or already mine)
create or replace function public.number_available(p_number text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles p
    where p.number_key = regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g')
      and p.user_id <> (select auth.uid())
  );
$$;

revoke all on function public.number_available(text) from public, anon;
grant execute on function public.number_available(text) to authenticated;

-- Signals: call setup (invite / answer / SDP / ICE / hangup) and small messages.
create table public.signals (
  id          bigint generated always as identity primary key,
  from_user   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  to_user     uuid not null references auth.users (id) on delete cascade,
  app         text not null check (char_length(app) between 1 and 64),
  channel     text not null check (char_length(channel) between 1 and 64),
  payload     jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 65536),
  created_at  timestamptz not null default now()
);

create index signals_to_user_idx on public.signals (to_user, created_at);
create index signals_created_idx on public.signals (created_at);

alter table public.signals enable row level security;

create policy "signals: send as myself" on public.signals for insert to authenticated
  with check (from_user = (select auth.uid()) and to_user <> from_user);
create policy "signals: read mine" on public.signals for select to authenticated
  using (to_user = (select auth.uid()) or from_user = (select auth.uid()));
create policy "signals: delete received" on public.signals for delete to authenticated
  using (to_user = (select auth.uid()));

-- Live delivery of new signals (Realtime respects the RLS policies above).
alter publication supabase_realtime add table public.signals;

-- Signals are short-lived; drop anything older than a day whenever new ones arrive.
create or replace function public.prune_signals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if random() < 0.02 then
    delete from public.signals where created_at < now() - interval '1 day';
  end if;
  return null;
end;
$$;

create trigger signals_prune after insert on public.signals
  for each statement execute function public.prune_signals();
