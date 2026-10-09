begin;
create type public.app_role as enum ('administrador', 'jefe');
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  role public.app_role not null,
  created_at timestamptz not null default now()
);
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 3 and 150),
  dni text not null unique check (dni ~ '^[0-9]{8}$'),
  phone text not null check (phone ~ '^9[0-9]{8}$'),
  address text not null check (length(trim(address)) between 3 and 300),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  entity_id uuid not null,
  happened_at timestamptz not null default now()
);
-- No raw personal data in audit payloads. Users cannot create or edit roles.
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()); $$;
revoke all on function public.current_app_role() from public, anon, authenticated;
grant execute on function public.current_app_role() to authenticated;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.profiles, public.clients, public.audit_events from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select on public.audit_events to authenticated;
create policy own_profile on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy read_clients on public.clients for select to authenticated
using ((select public.current_app_role()) in ('administrador', 'jefe'));
create policy insert_clients on public.clients for insert to authenticated
with check ((select public.current_app_role()) = 'administrador');
create policy update_clients on public.clients for update to authenticated
using ((select public.current_app_role()) = 'administrador')
with check ((select public.current_app_role()) = 'administrador');
create policy read_audit on public.audit_events for select to authenticated
using ((select public.current_app_role()) in ('administrador', 'jefe'));
create function public.audit_client_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_id, action, entity_id)
  values (auth.uid(), 'clients.' || lower(tg_op), new.id);
  return new;
end;
$$;
revoke all on function public.audit_client_change() from public, anon, authenticated;
create trigger audit_clients after insert or update on public.clients
for each row execute function public.audit_client_change();
commit;
