-- Community Store: anyone signed in can submit an extension zip; only the
-- project owner (Supabase dashboard / service role) can approve it.
-- Approved extensions are listed to everyone and only their files can be downloaded.

create table public.store_submissions (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  app_id       text not null check (app_id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name         text not null check (char_length(name) between 1 and 80),
  version      text not null check (version ~ '^[0-9]+(\.[0-9]+){0,3}$'),
  manifest     jsonb not null check (pg_column_size(manifest) <= 32768),
  file_path    text not null unique,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   integer not null check (size_bytes between 1 and 26214400),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note  text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);

create index store_submissions_user_idx on public.store_submissions (user_id, created_at desc);
create index store_submissions_app_idx on public.store_submissions (app_id, status);

alter table public.store_submissions enable row level security;

-- Users see only their own submissions (to track review status). No update/delete:
-- a submitted file can't be swapped or self-approved.
create policy "submissions: read own" on public.store_submissions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "submissions: submit own" on public.store_submissions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and file_path like ((select auth.uid())::text || '/%')
  );

-- Normalize every user insert: always pending, never pre-reviewed; an app id
-- belongs to whoever submitted it first; at most 5 pending per user.
create or replace function public.store_submissions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.status := 'pending';
    new.review_note := null;
    new.reviewed_at := null;
    if exists (
      select 1 from public.store_submissions s
      where s.app_id = new.app_id and s.user_id <> new.user_id and s.status in ('pending', 'approved')
    ) then
      raise exception 'The extension id "%" belongs to another publisher. Choose a different id.', new.app_id
        using errcode = '23505';
    end if;
    if (select count(*) from public.store_submissions s where s.user_id = new.user_id and s.status = 'pending') >= 5 then
      raise exception 'You already have 5 submissions waiting for review.' using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;

create trigger store_submissions_before_insert before insert on public.store_submissions
  for each row execute function public.store_submissions_before_insert();

-- Stamp the review time when the owner changes the status.
create or replace function public.store_submissions_reviewed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger store_submissions_reviewed before update on public.store_submissions
  for each row execute function public.store_submissions_reviewed();

-- Public listing: the newest approved version of each extension.
create or replace function public.community_listings()
returns table (app_id text, name text, version text, manifest jsonb, file_path text, sha256 text, size_bytes integer, approved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (s.app_id) s.app_id, s.name, s.version, s.manifest, s.file_path, s.sha256, s.size_bytes, s.reviewed_at
  from public.store_submissions s
  where s.status = 'approved'
  order by s.app_id, s.reviewed_at desc nulls last, s.id desc;
$$;

revoke all on function public.community_listings() from public, anon;
grant execute on function public.community_listings() to authenticated;

-- Private bucket for submitted zips (25 MB max).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 26214400,
        array['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])
on conflict (id) do nothing;

-- Upload only into your own folder; no overwrite or delete (no update/delete policy).
create policy "submissions bucket: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Download your own uploads, or any approved extension.
create policy "submissions bucket: read own or approved" on storage.objects for select to authenticated
  using (
    bucket_id = 'submissions'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.store_submissions s where s.file_path = storage.objects.name and s.status = 'approved')
    )
  );
