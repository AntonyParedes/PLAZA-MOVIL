begin;
-- Cash is global, not scoped to the borrower search. Opening capital predates all recorded lending.
create table if not exists public.cash_movements (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 kind text not null check(kind in ('apertura','aporte','retiro')),
 amount_cents bigint not null check(amount_cents between 0 and 9007199254740991 and (kind='apertura' or amount_cents>0)),
 note text not null check(length(btrim(note)) between 3 and 300),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create unique index if not exists cash_one_opening on public.cash_movements(kind) where kind='apertura';
alter table public.cash_movements enable row level security;
revoke all on public.cash_movements from public,anon,authenticated;
grant select on public.cash_movements to authenticated;
drop policy if exists read_cash on public.cash_movements;
create policy read_cash on public.cash_movements for select to authenticated
 using ((select public.current_app_role()) in ('administrador','jefe'));

create or replace function public.record_cash_movement(p_request uuid,p_kind text,p_amount bigint,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.cash_movements; movement_id uuid;
begin
 perform public.require_admin();
 if p_request is null or p_kind is null or p_kind not in ('apertura','aporte','retiro') or p_amount is null or p_amount<0 or p_amount>9007199254740991 or (p_kind<>'apertura' and p_amount=0) or p_note is null or length(btrim(p_note)) not between 3 and 300 then
  raise exception 'Revisa el tipo, el importe y el motivo del movimiento';
 end if;
 -- Serializes setup and idempotent retries, including concurrent requests from two administrators.
 perform pg_advisory_xact_lock(270009);
 select * into existing from public.cash_movements where request_id=p_request;
 if found then
  if existing.kind<>p_kind or existing.amount_cents<>p_amount or existing.note<>btrim(p_note) then raise exception 'Solicitud reutilizada con datos distintos'; end if;
  return existing.id;
 end if;
 if p_kind='apertura' and exists(select 1 from public.cash_movements where kind='apertura') then raise exception 'La caja ya tiene un monto inicial. Registra un aporte o retiro'; end if;
 if p_kind<>'apertura' and not exists(select 1 from public.cash_movements where kind='apertura') then raise exception 'Primero registra el dinero inicial'; end if;
 insert into public.cash_movements(request_id,kind,amount_cents,note,actor_id)
 values(p_request,p_kind,p_amount,btrim(p_note),auth.uid()) returning id into movement_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'cash.'||p_kind,movement_id);
 return movement_id;
end; $$;
revoke all on function public.record_cash_movement(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.record_cash_movement(uuid,text,bigint,text) to authenticated;

-- One SQL statement gives all totals the same PostgreSQL snapshot. Numeric strings preserve cents.
create or replace function public.cash_summary()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(public.current_app_role()::text,'') not in ('administrador','jefe') then raise exception 'Acceso no autorizado'; end if;
 with movements as (
  select count(*) filter(where kind='apertura')>0 configured,
   coalesce(sum(amount_cents) filter(where kind='apertura'),0) opening,
   coalesce(sum(amount_cents) filter(where kind='aporte'),0) contributions,
   coalesce(sum(amount_cents) filter(where kind='retiro'),0) withdrawals
  from public.cash_movements
 ), receipts as (
  select coalesce(sum(amount_cents),0) received,coalesce(sum(interest_cents),0) earned,
   coalesce(sum(interest_cents) filter(where date_trunc('month',paid_on::timestamp)=date_trunc('month',now() at time zone 'America/Lima')),0) earned_month
  from public.payments
 ), lending as (select coalesce(sum(original_capital),0) disbursed from public.loans)
 select jsonb_build_object('configured',configured,'opening_cents',opening::text,'contributions_cents',contributions::text,
  'withdrawals_cents',withdrawals::text,'received_cents',received::text,'disbursed_cents',disbursed::text,
  'interest_cents',earned::text,'month_interest_cents',earned_month::text,
  'balance_cents',case when configured then (opening+contributions+received-disbursed-withdrawals)::text else null end,
  'as_of',(now() at time zone 'America/Lima')::date::text)
 into result from movements cross join receipts cross join lending;
 return result;
end; $$;
revoke all on function public.cash_summary() from public,anon,authenticated;
grant execute on function public.cash_summary() to authenticated;

-- Realtime is optional; clients also refresh with the existing polling fallback.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cash_movements') then
  alter publication supabase_realtime add table public.cash_movements;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
