begin;
-- Discounts are debt forgiveness, never cash received. Preserve original schedules.
alter table public.payments add column interest_discount_cents bigint not null default 0
 check(interest_discount_cents between 0 and 9007199254740991);
create table public.installment_discounts (
 payment_id uuid not null references public.payments(id),
 installment_id uuid not null references public.installments(id),
 amount_cents bigint not null check(amount_cents>0),
 primary key(payment_id,installment_id)
);
alter table public.installment_discounts enable row level security;
revoke all on public.installment_discounts from public,anon,authenticated;
grant select on public.installment_discounts to authenticated;
create policy read_discounts on public.installment_discounts for select to authenticated
 using((select public.current_app_role()) in ('administrador','jefe'));
create index discounts_installment on public.installment_discounts(installment_id);

create function public.settle_loan_early(p_request uuid,p_loan uuid,p_amount bigint,p_discount bigint,p_paid_on date)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.loans; p public.loan_periods; existing public.payments;
 v_payment uuid; remaining bigint; part bigint; item record;
begin
 perform public.require_admin();
 if p_request is null or p_loan is null or p_amount is null or p_discount is null or p_paid_on is null then raise exception 'Campos requeridos'; end if;
 select * into strict l from public.loans where id=p_loan for update;
 select * into existing from public.payments where request_id=p_request;
 if found then
  if existing.loan_id<>p_loan or existing.amount_cents<>p_amount or existing.interest_discount_cents<>p_discount or existing.paid_on<>p_paid_on or existing.interest_discount_cents=0 then
   raise exception 'Solicitud reutilizada con datos distintos';
  end if;
  return existing.id;
 end if;
 select * into strict p from public.loan_periods where loan_id=l.id and is_current;
 if l.status<>'activo' or l.capital_pending=0 then raise exception 'Préstamo liquidado'; end if;
 if p_paid_on<p.start_date or p_paid_on>=p.end_date or p_paid_on>(now() at time zone 'America/Lima')::date or (now() at time zone 'America/Lima')::date>=p.end_date then
  raise exception 'La cancelación anticipada debe ser anterior al vencimiento y no tener fecha futura';
 end if;
 if exists(select 1 from public.payments where loan_id=l.id and paid_on>p_paid_on) then raise exception 'La cancelación no puede preceder a un pago registrado'; end if;
 if p_discount<=0 or p_discount>l.interest_pending then raise exception 'El descuento debe ser mayor que cero y no superar el interés pendiente'; end if;
 if p_amount::numeric<>l.capital_pending::numeric+l.interest_pending-p_discount then
  raise exception 'El saldo cambió: revisa el total de cancelación';
 end if;
 update public.loans set interest_pending=interest_pending-p_discount where id=l.id;
 -- Reuse the existing transactional payment, allocations and audit path.
 v_payment:=public.record_payment(p_request,p_loan,p_amount,p_paid_on);
 update public.payments set interest_discount_cents=p_discount where id=v_payment;
 update public.loan_periods set interest_settled_on=p_paid_on where id=p.id;
 remaining:=p_discount;
 for item in
  select i.id,i.scheduled_cents-coalesce((select sum(a.amount_cents) from public.payment_installments a where a.installment_id=i.id),0) pending
  from public.installments i where i.period_id=p.id order by i.number
 loop
  part:=least(remaining,item.pending);
  if part>0 then insert into public.installment_discounts values(v_payment,item.id,part); remaining:=remaining-part; end if;
  exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'Cronograma inconsistente: no se aplicó íntegramente el descuento'; end if;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'loans.settle_early',v_payment);
 return v_payment;
end; $$;
revoke all on function public.settle_loan_early(uuid,uuid,bigint,bigint,date) from public,anon,authenticated;
grant execute on function public.settle_loan_early(uuid,uuid,bigint,bigint,date) to authenticated;

create or replace view public.installment_balances with(security_invoker=true) as
select i.id,i.period_id,p.loan_id,i.number,i.due_date,i.scheduled_cents,p.is_current,
 coalesce(a.paid,0)::bigint paid_cents,
 (i.scheduled_cents-coalesce(a.paid,0)-coalesce(d.discounted,0))::bigint pending_cents,
 case when coalesce(a.paid,0)+coalesce(d.discounted,0)>=i.scheduled_cents then 'pagado'
 when i.due_date<(now() at time zone 'America/Lima')::date then 'vencido'
 when coalesce(a.paid,0)>0 then 'pago parcial' else 'pendiente' end status,
 coalesce(d.discounted,0)::bigint discounted_cents
from public.installments i join public.loan_periods p on p.id=i.period_id
left join (select installment_id,sum(amount_cents) paid from public.payment_installments group by installment_id) a on a.installment_id=i.id
left join (select installment_id,sum(amount_cents) discounted from public.installment_discounts group by installment_id) d on d.installment_id=i.id;
notify pgrst,'reload schema';
commit;
