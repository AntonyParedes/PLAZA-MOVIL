begin;
do $$ begin
 if to_regclass('public.payment_corrections') is null then
  raise exception 'Aplica primero la migración 011 de correcciones de pagos';
 end if;
 if to_regclass('public.installment_discounts') is null then
  raise exception 'Aplica primero la migración 202611100005 de cancelación anticipada';
 end if;
end $$;
-- Extend audited corrections and client deletion to include interest forgiveness.
-- Pure replay: locks and reads, but never changes ledger rows during a preview.
create or replace function public.payment_correction_plan(p_payment uuid,p_action text,p_amount bigint,p_paid_on date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 l public.loans; c public.clients; target public.payments; pr public.loan_periods; pm public.payments; quota record;
 before_state jsonb; after_state jsonb; after_payments jsonb:='[]'; after_periods jsonb:='[]'; after_installments jsonb:='[]'; after_allocations jsonb:='[]'; after_discounts jsonb:='[]';
 original_target jsonb; updated_target jsonb; receipt jsonb; token text;
 capital bigint; interest bigint; opening bigint; interest_on date; total bigint; quota_count integer; remainder integer;
 quota_ids uuid[]; quota_amounts bigint[]; allocated bigint[]; idx integer; amount bigint; paid date; interest_part bigint; remaining bigint; part bigint;
 before_cash numeric; after_cash numeric; before_interest numeric; after_interest numeric; before_penalty numeric; after_penalty numeric;
 final_status text; periods_count integer:=0; changed_count integer;
 today date:=(now() at time zone 'America/Lima')::date;
begin
 perform public.require_admin();
 if p_payment is null or p_action is null or p_action not in ('anular','corregir') or p_reason is null or length(btrim(p_reason)) not between 3 and 300 then raise exception 'Elige el pago, la corrección y un motivo de 3 a 300 caracteres'; end if;
 if p_action='corregir' and (p_amount is null or p_amount<1 or p_amount>9007199254740991 or p_paid_on is null or p_paid_on>today) then raise exception 'Revisa el monto y la fecha del pago'; end if;
 if p_action='anular' and (p_amount is not null or p_paid_on is not null) then raise exception 'La anulación no admite un nuevo monto o fecha'; end if;
 select * into target from public.payments where id=p_payment;
 if not found then raise exception 'El pago ya no existe o ya fue anulado. Actualiza el préstamo'; end if;
 select * into strict l from public.loans where id=target.loan_id;
 -- Same client->loan order as loan creation and erroneous client deletion.
 select * into c from public.clients where id=l.client_id for update;
 if not found then raise exception 'Cliente inexistente'; end if;
 select * into l from public.loans where id=l.id for update;
 if not found then raise exception 'Préstamo inexistente'; end if;
 select * into target from public.payments where id=p_payment and loan_id=l.id;
 if not found then raise exception 'El pago ya fue anulado. Actualiza el préstamo'; end if;
 if p_action='corregir' and target.amount_cents=p_amount and target.paid_on=p_paid_on then raise exception 'No cambiaste el monto ni la fecha'; end if;
 if exists(select 1 from public.payments pay join public.loan_periods p on p.id=pay.period_id where (pay.loan_id=l.id or p.loan_id=l.id) and pay.loan_id<>p.loan_id)
 or exists(select 1 from public.payment_installments a join public.payments pay on pay.id=a.payment_id join public.installments i on i.id=a.installment_id join public.loan_periods p on p.id=i.period_id where (pay.loan_id=l.id or p.loan_id=l.id) and (pay.loan_id<>p.loan_id or pay.period_id<>i.period_id)) then
  raise exception 'Hay relaciones financieras inconsistentes. Revisa el préstamo antes de corregir';
 end if;
 before_state:=jsonb_build_object('client',jsonb_build_object('id',c.id,'full_name',c.full_name,'dni',c.dni),'loan',to_jsonb(l),
  'periods',(select jsonb_agg(to_jsonb(p) order by p.number) from public.loan_periods p where p.loan_id=l.id),
  'payments',coalesce((select jsonb_agg(to_jsonb(pay) order by pay.recorded_order) from public.payments pay where pay.loan_id=l.id),'[]'::jsonb),
  'installments',coalesce((select jsonb_agg(to_jsonb(i) order by p.number,i.number) from public.installments i join public.loan_periods p on p.id=i.period_id where p.loan_id=l.id),'[]'::jsonb),
  'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.payment_id,a.installment_id) from public.payment_installments a join public.payments pay on pay.id=a.payment_id where pay.loan_id=l.id),'[]'::jsonb));
 before_state:=before_state||jsonb_build_object('discounts',coalesce((select jsonb_agg(to_jsonb(d) order by d.payment_id,d.installment_id) from public.installment_discounts d join public.payments receipt_row on receipt_row.id=d.payment_id where receipt_row.loan_id=l.id),'[]'::jsonb));
 original_target:=to_jsonb(target);
 capital:=l.original_capital;
 if (select min(number)<>1 or max(number)<>count(*) or count(*) filter(where is_current)<>1 or max(number) filter(where is_current)<>max(number) from public.loan_periods where loan_id=l.id) is distinct from false then raise exception 'La secuencia de periodos o el periodo vigente es inconsistente'; end if;
 for pr in select * from public.loan_periods where loan_id=l.id order by number loop
  periods_count:=periods_count+1;
  if capital<=0 then raise exception 'La corrección liquidaría el préstamo antes de una refinanciación existente. Debe revisarse esa refinanciación'; end if;
  opening:=capital; interest:=pr.interest_generated; interest_on:=case when interest=0 then pr.start_date else null end;
  if opening::numeric+interest>9007199254740991 then raise exception 'El saldo recalculado supera el rango permitido'; end if;
  total:=opening+interest; quota_count:=pr.months*4; remainder:=total%quota_count;
  select array_agg(i.id order by i.number) into quota_ids from public.installments i where i.period_id=pr.id;
  if coalesce(array_length(quota_ids,1),0)<>quota_count then raise exception 'Cronograma inconsistente. Faltan cuotas en un periodo'; end if;
  quota_amounts:=array_fill(0::bigint,array[quota_count]); allocated:=array_fill(0::bigint,array[quota_count]);
  idx:=0;
  for quota in select * from public.installments where period_id=pr.id order by number loop
   idx:=idx+1;
   if quota.number<>idx or quota.due_date<>pr.start_date+idx*7 then raise exception 'Numeración o fechas de cuotas inconsistentes'; end if;
   quota_amounts[idx]:=total/quota_count+case when idx>quota_count-remainder then 1 else 0 end;
   after_installments:=after_installments||jsonb_build_array(to_jsonb(quota)||jsonb_build_object('scheduled_cents',quota_amounts[idx]));
  end loop;
  -- Keep recording order, including backdated receipts; dates are not used to reorder income.
  for pm in select * from public.payments where loan_id=l.id and period_id=pr.id order by recorded_order loop
   if pm.id=p_payment and p_action='anular' then continue; end if;
   amount:=case when pm.id=p_payment then p_amount else pm.amount_cents end;
   paid:=case when pm.id=p_payment then p_paid_on else pm.paid_on end;
   if not pr.is_current and paid>(select (n.created_at at time zone 'America/Lima')::date from public.loan_periods n where n.loan_id=l.id and n.number=pr.number+1) then raise exception 'La fecha del pago sería posterior al registro de su refinanciación. Revisa esa fecha'; end if;
   if paid<pr.start_date or paid>today then raise exception 'La fecha del pago debe pertenecer al periodo y no puede ser futura'; end if;
   if amount<1 or amount::numeric>capital::numeric+interest then raise exception 'La corrección dejaría otro pago superior a la deuda. Revisa los cobros posteriores'; end if;
   if pm.penalty_cents>0 and paid<=pr.end_date then raise exception 'Un pago con penalidad debe conservar una fecha posterior al vencimiento'; end if;
   if pm.interest_discount_cents>0 then
    if pm.penalty_cents>0 or paid>=pr.end_date or pm.interest_discount_cents>interest or amount::numeric<>capital::numeric+interest-pm.interest_discount_cents then
     raise exception 'La corrección cambia una cancelación anticipada posterior. Revisa o anula primero esa cancelación';
    end if;
    interest:=interest-pm.interest_discount_cents;
    if interest=0 then interest_on:=paid; end if;
   end if;
   interest_part:=least(amount,interest);
   if interest>0 and interest-interest_part=0 then interest_on:=paid; end if;
   interest:=interest-interest_part; capital:=capital-(amount-interest_part);
   receipt:=to_jsonb(pm)||jsonb_build_object('amount_cents',amount,'paid_on',paid,'interest_cents',interest_part,'capital_cents',amount-interest_part);
   after_payments:=after_payments||jsonb_build_array(receipt);
   if pm.id=p_payment then updated_target:=receipt; end if;
   remaining:=amount;
   for idx in 1..quota_count loop
    part:=least(remaining,quota_amounts[idx]-allocated[idx]);
    if part>0 then
     allocated[idx]:=allocated[idx]+part; remaining:=remaining-part;
     after_allocations:=after_allocations||jsonb_build_array(jsonb_build_object('payment_id',pm.id,'installment_id',quota_ids[idx],'amount_cents',part));
    end if;
    exit when remaining=0;
   end loop;
   if remaining<>0 then raise exception 'Cronograma inconsistente: no se pudo aplicar todo el pago'; end if;
   remaining:=pm.interest_discount_cents;
   for idx in 1..quota_count loop
    part:=least(remaining,quota_amounts[idx]-allocated[idx]);
    if part>0 then
     allocated[idx]:=allocated[idx]+part; remaining:=remaining-part;
     after_discounts:=after_discounts||jsonb_build_array(jsonb_build_object('payment_id',pm.id,'installment_id',quota_ids[idx],'amount_cents',part));
    end if;
    exit when remaining=0;
   end loop;
   if remaining<>0 then raise exception 'Cronograma inconsistente: no se pudo aplicar todo el descuento'; end if;

  end loop;
  after_periods:=after_periods||jsonb_build_array(to_jsonb(pr)||jsonb_build_object('opening_capital',opening,'interest_settled_on',interest_on));
  if not pr.is_current and interest<>0 then raise exception 'La corrección dejaría intereses pendientes antes de una refinanciación. Debe revisarse esa refinanciación'; end if;
 end loop;
 final_status:=case when capital=0 and interest=0 then 'liquidado' else 'activo' end;
 if final_status='activo' and exists(select 1 from public.loans where client_id=c.id and id<>l.id and status='activo') then raise exception 'La corrección reabriría un préstamo, pero el cliente ya tiene otro activo. Deben revisarse ambos préstamos'; end if;
 after_state:=jsonb_build_object('loan',to_jsonb(l)||jsonb_build_object('capital_pending',capital,'interest_pending',interest,'status',final_status),
  'periods',after_periods,'payments',after_payments,'installments',after_installments,'allocations',after_allocations,'discounts',after_discounts);
 select coalesce(sum((v->>'amount_cents')::numeric+(v->>'penalty_cents')::numeric),0),coalesce(sum((v->>'interest_cents')::numeric),0),coalesce(sum((v->>'penalty_cents')::numeric),0)
 into before_cash,before_interest,before_penalty from jsonb_array_elements(before_state->'payments') v;
 select coalesce(sum((v->>'amount_cents')::numeric+(v->>'penalty_cents')::numeric),0),coalesce(sum((v->>'interest_cents')::numeric),0),coalesce(sum((v->>'penalty_cents')::numeric),0)
 into after_cash,after_interest,after_penalty from jsonb_array_elements(after_payments) v;
 select count(*) into changed_count from jsonb_array_elements(after_payments) a join jsonb_array_elements(before_state->'payments') b on a->>'id'=b->>'id' where a<>b;
 token:=md5((before_state||jsonb_build_object('action',p_action,'payment_id',p_payment,'new_amount',p_amount,'new_paid_on',p_paid_on,'reason',btrim(p_reason)))::text);
 return jsonb_build_object('discounts_supported',true,'confirmation_token',token,'payment_id',target.id,'loan_id',l.id,'client_id',c.id,'full_name',c.full_name,'dni',c.dni,
  'action',p_action,'new_amount',p_amount,'new_paid_on',p_paid_on,'reason',btrim(p_reason),
  'balance_before_cents',(l.capital_pending::numeric+l.interest_pending)::text,'balance_after_cents',(capital::numeric+interest)::text,
  'cash_delta_cents',(after_cash-before_cash)::text,'interest_delta_cents',(after_interest-before_interest)::text,'penalty_delta_cents',(after_penalty-before_penalty)::text,
  'status_after',final_status,'periods_count',periods_count,'recalculated_payments',changed_count,
  'before_payment',original_target,'after_payment',updated_target,'before_state',before_state,'after_state',after_state);
end; $$;
revoke all on function public.payment_correction_plan(uuid,text,bigint,date,text) from public,anon,authenticated;

create or replace function public.preview_payment_correction(p_payment uuid,p_action text,p_amount bigint,p_paid_on date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_admin();
 return public.payment_correction_plan(p_payment,p_action,p_amount,p_paid_on,p_reason)-'before_state'-'after_state';
end; $$;
revoke all on function public.preview_payment_correction(uuid,text,bigint,date,text) from public,anon,authenticated;
grant execute on function public.preview_payment_correction(uuid,text,bigint,date,text) to authenticated;

create or replace function public.correct_payment(p_request uuid,p_payment uuid,p_action text,p_amount bigint,p_paid_on date,p_reason text,p_confirmation_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare plan jsonb; state jsonb; item jsonb; existing public.payment_corrections; correction_id uuid;
begin
 perform public.require_admin();
 if p_request is null or p_confirmation_token is null then raise exception 'Primero revisa el resultado de la corrección'; end if;
 perform pg_advisory_xact_lock(hashtext(p_request::text));
 select * into existing from public.payment_corrections where request_id=p_request;
 if found then
  if existing.payment_id is distinct from p_payment or existing.action is distinct from p_action or existing.new_amount is distinct from p_amount or existing.new_paid_on is distinct from p_paid_on or existing.reason is distinct from btrim(p_reason) or existing.confirmation_token is distinct from p_confirmation_token then raise exception 'Solicitud reutilizada con datos distintos'; end if;
  return existing.id;
 end if;
 plan:=public.payment_correction_plan(p_payment,p_action,p_amount,p_paid_on,p_reason);
 if plan->>'confirmation_token'<>p_confirmation_token then raise exception 'Los datos cambiaron. Actualiza la revisión antes de confirmar'; end if;
 state:=plan->'after_state';
 -- No live receipt is lost: the original and all affected records are archived first.
 insert into public.payment_corrections(request_id,payment_id,original_request_id,loan_id,client_id,action,new_amount,new_paid_on,reason,confirmation_token,before_payment,after_payment,before_state,after_state,actor_id)
 values(p_request,p_payment,(plan->'before_payment'->>'request_id')::uuid,(plan->>'loan_id')::uuid,(plan->>'client_id')::uuid,p_action,p_amount,p_paid_on,btrim(p_reason),p_confirmation_token,plan->'before_payment',nullif(plan->'after_payment','null'::jsonb),plan->'before_state',state,auth.uid()) returning id into correction_id;
 delete from public.installment_discounts where payment_id in(select id from public.payments where loan_id=(plan->>'loan_id')::uuid);
 delete from public.payment_installments where payment_id in(select id from public.payments where loan_id=(plan->>'loan_id')::uuid);
 if p_action='anular' then delete from public.payments where id=p_payment; end if;
 for item in select value from jsonb_array_elements(state->'payments') loop
  update public.payments set amount_cents=(item->>'amount_cents')::bigint,paid_on=(item->>'paid_on')::date,interest_cents=(item->>'interest_cents')::bigint,capital_cents=(item->>'capital_cents')::bigint where id=(item->>'id')::uuid;
 end loop;
 for item in select value from jsonb_array_elements(state->'periods') loop
  update public.loan_periods set opening_capital=(item->>'opening_capital')::bigint,interest_settled_on=(item->>'interest_settled_on')::date where id=(item->>'id')::uuid;
 end loop;
 for item in select value from jsonb_array_elements(state->'installments') loop
  update public.installments set scheduled_cents=(item->>'scheduled_cents')::bigint where id=(item->>'id')::uuid;
 end loop;
 for item in select value from jsonb_array_elements(state->'allocations') loop
  insert into public.payment_installments(payment_id,installment_id,amount_cents) values((item->>'payment_id')::uuid,(item->>'installment_id')::uuid,(item->>'amount_cents')::bigint);
 end loop;
 for item in select value from jsonb_array_elements(state->'discounts') loop
  insert into public.installment_discounts(payment_id,installment_id,amount_cents) values((item->>'payment_id')::uuid,(item->>'installment_id')::uuid,(item->>'amount_cents')::bigint);
 end loop;
 update public.loans set capital_pending=(state->'loan'->>'capital_pending')::bigint,interest_pending=(state->'loan'->>'interest_pending')::bigint,status=state->'loan'->>'status' where id=(plan->>'loan_id')::uuid;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'payments.'||p_action,correction_id);
 return correction_id;
end; $$;
revoke all on function public.correct_payment(uuid,uuid,text,bigint,date,text,text) from public,anon,authenticated;
grant execute on function public.correct_payment(uuid,uuid,text,bigint,date,text,text) to authenticated;
create or replace function public.delete_client(p_client uuid,p_dni text,p_reason text,p_confirmation_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.clients; summary jsonb;
begin
 perform public.require_admin();
 if p_client is null or p_dni is null or btrim(p_dni)!~'^[0-9]{8}$' or p_reason is null or length(btrim(p_reason)) not between 3 and 300 or p_confirmation_token is null then
  raise exception 'Confirma el DNI y escribe un motivo de 3 a 300 caracteres';
 end if;
 select * into c from public.clients where id=p_client for update;
 if not found then
  if exists(select 1 from public.client_deletions where client_id=p_client and confirmation_token=p_confirmation_token) then return p_client; end if;
  raise exception 'Cliente inexistente o ya eliminado';
 end if;
 if c.dni<>btrim(p_dni) then raise exception 'El DNI de confirmación no coincide'; end if;
 -- Same client->loan lock order as creation; payments/refinancing serialize on these loans.
 perform 1 from public.loans where client_id=p_client order by id for update;
 summary:=public.client_deletion_snapshot(p_client);
 if summary->>'confirmation_token'<>p_confirmation_token then
  raise exception 'Los datos cambiaron. Actualiza el resumen antes de eliminar';
 end if;
 if exists(select 1 from public.payment_installments a join public.payments pay on pay.id=a.payment_id join public.loans pl on pl.id=pay.loan_id join public.installments i on i.id=a.installment_id join public.loan_periods p on p.id=i.period_id join public.loans il on il.id=p.loan_id where pl.client_id<>il.client_id and (pl.client_id=p_client or il.client_id=p_client)) then
  raise exception 'Existen relaciones financieras inconsistentes. Revisa el cliente antes de eliminar';
 end if;
 insert into public.client_deletions(client_id,actor_id,reason,confirmation_token,loans_count,payments_count,balance_cents,paid_cents)
 values(p_client,auth.uid(),btrim(p_reason),p_confirmation_token,(summary->>'loans_count')::bigint,(summary->>'payments_count')::bigint,(summary->>'balance_cents')::numeric,(summary->>'paid_cents')::numeric);
 delete from public.installment_discounts where payment_id in(select pay.id from public.payments pay join public.loans l on l.id=pay.loan_id where l.client_id=p_client);
 delete from public.payment_installments where payment_id in(select pay.id from public.payments pay join public.loans l on l.id=pay.loan_id where l.client_id=p_client);
 delete from public.payments where loan_id in(select id from public.loans where client_id=p_client);
 delete from public.installments where period_id in(select p.id from public.loan_periods p join public.loans l on l.id=p.loan_id where l.client_id=p_client);
 delete from public.loan_periods where loan_id in(select id from public.loans where client_id=p_client);
 delete from public.loans where client_id=p_client;
 delete from public.clients where id=p_client;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'clients.delete',p_client);
 return p_client;
end; $$;
revoke all on function public.delete_client(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.delete_client(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
