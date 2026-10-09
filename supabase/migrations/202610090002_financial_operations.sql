begin;
create table public.loans (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 client_id uuid not null references public.clients(id),
 original_capital bigint not null check(original_capital between 1 and 9007199254740991),
 capital_pending bigint not null check(capital_pending between 0 and original_capital),
 interest_pending bigint not null check(interest_pending between 0 and 9007199254740991),
 rate_basis_points integer not null check(rate_basis_points >= 0),
 status text not null check(status in ('activo','liquidado')),
 created_at timestamptz not null default now()
);
create unique index one_active_loan_per_client on public.loans(client_id) where status='activo';
create table public.loan_periods (
 id uuid primary key default gen_random_uuid(),
 loan_id uuid not null references public.loans(id),
 request_id uuid not null unique,
 number integer not null,
 start_date date not null,
 end_date date not null,
 months integer not null check(months in (1,2)),
 opening_capital bigint not null check(opening_capital > 0),
 interest_generated bigint not null check(interest_generated >= 0),
 interest_settled_on date,
 is_current boolean not null default true,
 created_at timestamptz not null default now(),
 unique(loan_id,number),
 check(end_date = start_date + months * 28)
);
create unique index one_current_period on public.loan_periods(loan_id) where is_current;
create table public.installments (
 id uuid primary key default gen_random_uuid(),
 period_id uuid not null references public.loan_periods(id),
 number integer not null,
 due_date date not null,
 scheduled_cents bigint not null check(scheduled_cents >= 0),
 unique(period_id,number)
);
create table public.payments (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 loan_id uuid not null references public.loans(id),
 period_id uuid not null references public.loan_periods(id),
 amount_cents bigint not null check(amount_cents > 0),
 interest_cents bigint not null check(interest_cents >= 0),
 capital_cents bigint not null check(capital_cents >= 0),
 paid_on date not null,
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check(amount_cents = interest_cents + capital_cents)
);
create table public.payment_installments (
 payment_id uuid not null references public.payments(id),
 installment_id uuid not null references public.installments(id),
 amount_cents bigint not null check(amount_cents > 0),
 primary key(payment_id,installment_id)
);
create index periods_loan on public.loan_periods(loan_id);
create index payments_loan on public.payments(loan_id,created_at);
create index installments_due on public.installments(due_date);
create index allocations_installment on public.payment_installments(installment_id);

-- Authenticated users can read according to role. Financial writes ONLY via locked RPC.
alter table public.loans enable row level security;
alter table public.loan_periods enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_installments enable row level security;
revoke all on public.loans,public.loan_periods,public.installments,public.payments,public.payment_installments from anon,authenticated;
grant select on public.loans,public.loan_periods,public.installments,public.payments,public.payment_installments to authenticated;
create policy read_loans on public.loans for select to authenticated using((select public.current_app_role()) in ('administrador','jefe'));
create policy read_periods on public.loan_periods for select to authenticated using((select public.current_app_role()) in ('administrador','jefe'));
create policy read_installments on public.installments for select to authenticated using((select public.current_app_role()) in ('administrador','jefe'));
create policy read_payments on public.payments for select to authenticated using((select public.current_app_role()) in ('administrador','jefe'));
create policy read_allocations on public.payment_installments for select to authenticated using((select public.current_app_role()) in ('administrador','jefe'));

create function public.require_admin() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_role() is distinct from 'administrador'::public.app_role then raise exception 'Operación exclusiva del administrador'; end if;
end; $$;
revoke all on function public.require_admin() from public, anon, authenticated;

create function public.generate_installments(p_period uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.loan_periods; total bigint; count integer; remainder integer;
begin
 select * into strict p from public.loan_periods where id=p_period;
 total:=p.opening_capital+p.interest_generated; count:=p.months*4; remainder:=total%count;
 insert into public.installments(period_id,number,due_date,scheduled_cents)
 select p.id,n,p.start_date+n*7,total/count+case when n>count-remainder then 1 else 0 end
 from generate_series(1,count) n;
end; $$;
revoke all on function public.generate_installments(uuid) from public, anon, authenticated;

create function public.create_loan(p_request uuid,p_client uuid,p_capital bigint,p_rate integer,p_months integer,p_start date)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.loans; p public.loan_periods; v_interest bigint; v_loan uuid; v_period uuid;
begin
 perform public.require_admin();
 if p_request is null or p_client is null or p_start is null or p_capital is null or p_rate is null or p_months is null then raise exception 'Campos requeridos'; end if;
 -- Client lock serializes creation, including duplicate requests and the single active loan rule.
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'Cliente inexistente'; end if;
 select * into l from public.loans where request_id=p_request;
 if found then
  select * into strict p from public.loan_periods where loan_id=l.id and number=1;
  if l.client_id<>p_client or l.original_capital<>p_capital or l.rate_basis_points<>p_rate or p.months<>p_months or p.start_date<>p_start then raise exception 'Solicitud reutilizada con datos distintos'; end if;
  return l.id;
 end if;
 if p_start>(now() at time zone 'America/Lima')::date then raise exception 'El desembolso no puede tener fecha futura'; end if;
 if p_capital<1 or p_capital>9007199254740991 or p_rate<0 or p_months not in(1,2) then raise exception 'Capital, tasa o plazo inválidos'; end if;
 if not((p_capital=50000 and p_rate=700 and p_months=1) or (p_capital=100000 and p_rate=600 and p_months in(1,2))) then raise exception 'Producto de préstamo no autorizado'; end if;
 v_interest:=floor((p_capital::numeric*p_rate*p_months+5000)/10000);
 if p_capital::numeric+v_interest>9007199254740991 then raise exception 'Deuda fuera de rango'; end if;
 insert into public.loans(request_id,client_id,original_capital,capital_pending,interest_pending,rate_basis_points,status)
 values(p_request,p_client,p_capital,p_capital,v_interest,p_rate,'activo') returning id into v_loan;
 insert into public.loan_periods(loan_id,request_id,number,start_date,end_date,months,opening_capital,interest_generated,interest_settled_on)
 values(v_loan,p_request,1,p_start,p_start+p_months*28,p_months,p_capital,v_interest,case when v_interest=0 then p_start end) returning id into v_period;
 perform public.generate_installments(v_period);
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'loans.create',v_loan);
 return v_loan;
end; $$;
revoke all on function public.create_loan(uuid,uuid,bigint,integer,integer,date) from public, anon, authenticated;
grant execute on function public.create_loan(uuid,uuid,bigint,integer,integer,date) to authenticated;

create function public.record_payment(p_request uuid,p_loan uuid,p_amount bigint,p_paid_on date)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.loans; p public.loan_periods; existing public.payments; v_payment uuid; v_interest bigint; remaining bigint; part bigint; item record;
begin
 perform public.require_admin();
 if p_request is null or p_loan is null or p_amount is null or p_paid_on is null then raise exception 'Campos requeridos'; end if;
 select * into strict l from public.loans where id=p_loan for update;
 select * into existing from public.payments where request_id=p_request;
 if found then
  if existing.loan_id<>p_loan or existing.amount_cents<>p_amount or existing.paid_on<>p_paid_on then raise exception 'Solicitud reutilizada con datos distintos'; end if;
  return existing.id;
 end if;
 select * into strict p from public.loan_periods where loan_id=l.id and is_current;
 if l.status<>'activo' or p_amount<1 or p_amount::numeric>l.capital_pending::numeric+l.interest_pending then raise exception 'Pago inválido o superior a la deuda'; end if;
 if p_paid_on>(now() at time zone 'America/Lima')::date then raise exception 'El pago no puede tener fecha futura'; end if;
 if p_paid_on<p.start_date then raise exception 'El pago precede al periodo vigente'; end if;
 v_interest:=least(p_amount,l.interest_pending);
 insert into public.payments(request_id,loan_id,period_id,amount_cents,interest_cents,capital_cents,paid_on,actor_id)
 values(p_request,l.id,p.id,p_amount,v_interest,p_amount-v_interest,p_paid_on,auth.uid()) returning id into v_payment;
 update public.loans set interest_pending=interest_pending-v_interest,capital_pending=capital_pending-(p_amount-v_interest),
 status=case when capital_pending-(p_amount-v_interest)=0 and interest_pending-v_interest=0 then 'liquidado' else 'activo' end where id=l.id;
 if l.interest_pending>0 and l.interest_pending-v_interest=0 then
  update public.loan_periods set interest_settled_on=p_paid_on where id=p.id;
 end if;
 remaining:=p_amount;
 for item in
  select i.id,i.scheduled_cents-coalesce((select sum(a.amount_cents) from public.payment_installments a
   join public.payments pm on pm.id=a.payment_id
   where a.installment_id=i.id),0) pending
  from public.installments i where i.period_id=p.id order by i.number
 loop
  part:=least(remaining,item.pending);
  if part>0 then insert into public.payment_installments values(v_payment,item.id,part); remaining:=remaining-part; end if;
  exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'Cronograma inconsistente: no se aplicó íntegramente el pago'; end if;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'payments.create',v_payment);
 return v_payment;
end; $$;
revoke all on function public.record_payment(uuid,uuid,bigint,date) from public, anon, authenticated;
grant execute on function public.record_payment(uuid,uuid,bigint,date) to authenticated;

create function public.refinance_loan(p_request uuid,p_loan uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.loans; p public.loan_periods; existing public.loan_periods; v_period uuid; v_interest bigint;
begin
 perform public.require_admin();
 if p_request is null or p_loan is null then raise exception 'Campos requeridos'; end if;
 select * into strict l from public.loans where id=p_loan for update;
 select * into existing from public.loan_periods where request_id=p_request;
 if found then
  if existing.loan_id<>p_loan or existing.number=1 then raise exception 'Solicitud reutilizada con datos distintos'; end if;
  return existing.id;
 end if;
 select * into strict p from public.loan_periods where loan_id=l.id and is_current;
 if l.status<>'activo' or l.capital_pending=0 then raise exception 'Préstamo liquidado'; end if;
 if l.interest_pending<>0 or p.interest_settled_on is null then raise exception 'Intereses pendientes'; end if;
 if exists(select 1 from public.installments i where i.period_id=p.id and i.due_date<(now() at time zone 'America/Lima')::date
  and i.scheduled_cents>coalesce((select sum(a.amount_cents) from public.payment_installments a where a.installment_id=i.id),0)) then
  raise exception 'Cuotas vencidas pendientes';
 end if;
 v_interest:=floor((l.original_capital::numeric*l.rate_basis_points+5000)/10000);
 if l.capital_pending::numeric+v_interest>9007199254740991 then raise exception 'Deuda fuera de rango'; end if;
 update public.loan_periods set is_current=false where id=p.id;
 insert into public.loan_periods(loan_id,request_id,number,start_date,end_date,months,opening_capital,interest_generated,interest_settled_on)
 values(l.id,p_request,p.number+1,p.interest_settled_on,p.interest_settled_on+28,1,l.capital_pending,v_interest,case when v_interest=0 then p.interest_settled_on end) returning id into v_period;
 perform public.generate_installments(v_period);
 update public.loans set interest_pending=v_interest where id=l.id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'loans.refinance',v_period);
 return v_period;
end; $$;
revoke all on function public.refinance_loan(uuid,uuid) from public, anon, authenticated;
grant execute on function public.refinance_loan(uuid,uuid) to authenticated;

-- security_invoker preserves RLS on each underlying table.
create view public.installment_balances with(security_invoker=true) as
select i.id,i.period_id,p.loan_id,i.number,i.due_date,i.scheduled_cents,p.is_current,
 coalesce(sum(a.amount_cents),0)::bigint paid_cents,
 (i.scheduled_cents-coalesce(sum(a.amount_cents),0))::bigint pending_cents,
 case when coalesce(sum(a.amount_cents),0)>=i.scheduled_cents then 'pagado'
 when i.due_date<(now() at time zone 'America/Lima')::date then 'vencido'
 when coalesce(sum(a.amount_cents),0)>0 then 'pago parcial' else 'pendiente' end status
from public.installments i join public.loan_periods p on p.id=i.period_id
left join public.payment_installments a on a.installment_id=i.id
group by i.id,p.id;
revoke all on public.installment_balances from anon,authenticated;
grant select on public.installment_balances to authenticated;
commit;
