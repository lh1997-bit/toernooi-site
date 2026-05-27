create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.program_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.program_state replica identity full;
alter table public.admin_users replica identity full;

create or replace function public.touch_program_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists program_state_touch_updated_at on public.program_state;
create trigger program_state_touch_updated_at
before update on public.program_state
for each row
execute function public.touch_program_state_updated_at();

create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = uid
      and a.active = true
  );
$$;

alter table public.program_state enable row level security;
alter table public.admin_users enable row level security;

drop policy if exists "Public can read program state" on public.program_state;
create policy "Public can read program state"
on public.program_state
for select
using (true);

drop policy if exists "Admins can manage program state" on public.program_state;
create policy "Admins can manage program state"
on public.program_state
for all
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

drop policy if exists "Admins can inspect admin users" on public.admin_users;
create policy "Admins can inspect admin users"
on public.admin_users
for select
using (auth.uid() = user_id or public.is_admin_user(auth.uid()));

drop policy if exists "Admins can manage admin users" on public.admin_users;
create policy "Admins can manage admin users"
on public.admin_users
for all
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

insert into public.program_state (id, payload)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'program_state'
  ) then
    alter publication supabase_realtime add table public.program_state;
  end if;
end;
$$;

-- After creating your Supabase Auth admin accounts, add them here:
-- insert into public.admin_users (user_id, email, active)
-- values ('00000000-0000-0000-0000-000000000000', 'admin@example.com', true);
