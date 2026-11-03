begin;
do $$ begin
 if to_regclass('public.cash_movements') is null or to_regclass('public.client_deletions') is null then
  raise exception 'Aplica primero las migraciones 008 (eliminar clientes) y 009 (caja)';
 end if;
end $$;
-- A penalty is optional, manual and collected only with a full overdue settlement.
alter table public.payments add column if not exists penalty_cents bigint not null default 0 check(penalty_cents between 0 and 9007199254740991);
alter table public.payments add column if not exists penalty_reason text;

create or replace function public.settle_loan_with_penalty(p_request uuid,p_loan uuid,p_expected_balance bigint,p_penalty bigint,p_reason text,p_paid_on date)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.loans; p public.loan_periods; existing public.payments; payment_id uuid;
begin
 perform public.require_admin();
 if p_request is null or p_loan is null or p_expected_balance is null or p_penalty is null or p_paid_on is null or p_expected_balance<1 or p_penalty<1 or p_expected_balance::numeric+p_penalty>9007199254740991 or p_reason is null or length(btrim(p_reason)) not between 3 and 300 then raise exception 'Revisa el saldo, el monto de penalidad y el motivo'; end if;
 select * into strict l from public.loans where id=p_loan for update;
 select * into existing from public.payments where request_id=p_request;
 if found then
  if existing.loan_id<>p_loan or existing.amount_cents<>p_expected_balance or existing.penalty_cents<>p_penalty or existing.penalty_reason is distinct from btrim(p_reason) or existing.paid_on<>p_paid_on then raise exception 'Solicitud reutilizada con datos distintos'; end if;
  return existing.id;
 end if;
 select * into strict p from public.loan_periods where loan_id=p_loan and is_current;
 if l.status<>'activo' then raise exception 'El préstamo ya está liquidado'; end if;
 if (now() at time zone 'America/Lima')::date<=p.end_date or p_paid_on<=p.end_date then raise exception 'La penalidad solo se cobra después de vencer el plazo del préstamo'; end if;
 if l.capital_pending::numeric+l.interest_pending<>p_expected_balance then raise exception 'El saldo cambió. Actualiza el préstamo y revisa el total antes de liquidar'; end if;
 -- Existing payment logic applies only capital + interest to installments. Both writes roll back together.
 payment_id:=public.record_payment(p_request,p_loan,p_expected_balance,p_paid_on);
 update public.payments set penalty_cents=p_penalty,penalty_reason=btrim(p_reason) where id=payment_id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'payments.penalty',payment_id);
 return payment_id;
end; $$;
revoke all on function public.settle_loan_with_penalty(uuid,uuid,bigint,bigint,text,date) from public,anon,authenticated;
grant execute on function public.settle_loan_with_penalty(uuid,uuid,bigint,bigint,text,date) to authenticated;

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
  select coalesce(sum(amount_cents::numeric+penalty_cents),0) received,coalesce(sum(penalty_cents),0) penalties,coalesce(sum(interest_cents),0) earned,
   coalesce(sum(interest_cents) filter(where date_trunc('month',paid_on::timestamp)=date_trunc('month',now() at time zone 'America/Lima')),0) earned_month
  from public.payments
 ), lending as (select coalesce(sum(original_capital),0) disbursed from public.loans)
 select jsonb_build_object('configured',configured,'opening_cents',opening::text,'contributions_cents',contributions::text,
  'withdrawals_cents',withdrawals::text,'received_cents',received::text,'disbursed_cents',disbursed::text,
  'penalty_cents',penalties::text,'interest_cents',earned::text,'month_interest_cents',earned_month::text,
  'balance_cents',case when configured then (opening+contributions+received-disbursed-withdrawals)::text else null end,
  'as_of',(now() at time zone 'America/Lima')::date::text)
 into result from movements cross join receipts cross join lending;
 return result;
end; $$;
revoke all on function public.cash_summary() from public,anon,authenticated;
grant execute on function public.cash_summary() to authenticated;


create or replace function public.client_deletion_snapshot(p_client uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clients; state jsonb;
begin
 perform public.require_admin();
 select * into strict c from public.clients where id=p_client;
 state:=jsonb_build_object(
  'client',to_jsonb(c),
  'loans',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.loans l where l.client_id=p_client),'[]'::jsonb),
  'periods',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.loan_periods p join public.loans l on l.id=p.loan_id where l.client_id=p_client),'[]'::jsonb),
  'installments',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.installments i join public.loan_periods p on p.id=i.period_id join public.loans l on l.id=p.loan_id where l.client_id=p_client),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p join public.loans l on l.id=p.loan_id where l.client_id=p_client),'[]'::jsonb),
  'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.payment_id,a.installment_id) from public.payment_installments a join public.payments p on p.id=a.payment_id join public.loans l on l.id=p.loan_id where l.client_id=p_client),'[]'::jsonb)
 );
 return jsonb_build_object('client_id',c.id,'full_name',c.full_name,'dni',c.dni,
  'stand_code',to_jsonb(c)->>'stand_code',
  'loans_count',(select count(*) from public.loans where client_id=p_client),
  'payments_count',(select count(*) from public.payments p join public.loans l on l.id=p.loan_id where l.client_id=p_client),
  'balance_cents',(select coalesce(sum(capital_pending::numeric+interest_pending),0)::text from public.loans where client_id=p_client),
  'paid_cents',(select coalesce(sum(p.amount_cents::numeric+p.penalty_cents),0)::text from public.payments p join public.loans l on l.id=p.loan_id where l.client_id=p_client),
  'confirmation_token',md5(state::text));
end; $$;
revoke all on function public.client_deletion_snapshot(uuid) from public,anon,authenticated;

-- Independent register backed by the immutable receipt; no second entry can double-count income.
create or replace view public.penalty_register with(security_invoker=true) as
 select p.id as payment_id,p.loan_id,l.client_id,p.paid_on,p.penalty_cents as amount_cents,p.penalty_reason as reason,p.actor_id,p.created_at
 from public.payments p join public.loans l on l.id=p.loan_id where p.penalty_cents>0;
revoke all on public.penalty_register from public,anon,authenticated;
grant select on public.penalty_register to authenticated;
notify pgrst,'reload schema';
commit;
