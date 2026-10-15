begin;
-- Includes flexible loan amounts (006) and selectable refinancing date and term.
create or replace function public.create_loan(p_request uuid,p_client uuid,p_capital bigint,p_rate integer,p_months integer,p_start date)
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
 if p_rate<>(case when p_capital<=50000 then 700 else 600 end) then raise exception 'La tasa no corresponde al monto del préstamo'; end if;
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

create or replace function public.refinance_loan(p_request uuid,p_loan uuid,p_start date,p_months integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.loans; p public.loan_periods; existing public.loan_periods; v_period uuid; v_interest bigint;
begin
 perform public.require_admin();
 if p_request is null or p_loan is null or p_start is null or p_months is null then raise exception 'Campos requeridos'; end if;
 select * into strict l from public.loans where id=p_loan for update;
 select * into existing from public.loan_periods where request_id=p_request;
 if found then
  if existing.loan_id<>p_loan or existing.number=1 or existing.start_date<>p_start or existing.months<>p_months then raise exception 'Solicitud reutilizada con datos distintos'; end if;
  return existing.id;
 end if;
 select * into strict p from public.loan_periods where loan_id=l.id and is_current;
 if l.status<>'activo' or l.capital_pending=0 then raise exception 'Préstamo liquidado'; end if;
 if l.interest_pending<>0 or p.interest_settled_on is null then raise exception 'Intereses pendientes'; end if;
 if (now() at time zone 'America/Lima')::date<=p.end_date then
  raise exception 'El periodo aún no ha terminado';
 end if;
 if p_months not in(1,2) then raise exception 'El plazo debe ser de uno o dos meses'; end if;
 if p_start<=p.end_date or p_start>(now() at time zone 'America/Lima')::date then raise exception 'Fecha de refinanciación inválida: debe ser posterior al vencimiento y no futura'; end if;
 v_interest:=floor((l.original_capital::numeric*l.rate_basis_points*p_months+5000)/10000);
 if l.capital_pending::numeric+v_interest>9007199254740991 then raise exception 'Deuda fuera de rango'; end if;
 update public.loan_periods set is_current=false where id=p.id;
 insert into public.loan_periods(loan_id,request_id,number,start_date,end_date,months,opening_capital,interest_generated,interest_settled_on)
 values(l.id,p_request,p.number+1,p_start,p_start+p_months*28,p_months,l.capital_pending,v_interest,case when v_interest=0 then p_start end) returning id into v_period;
 perform public.generate_installments(v_period);
 update public.loans set interest_pending=v_interest where id=l.id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'loans.refinance',v_period);
 return v_period;
end; $$;
revoke all on function public.refinance_loan(uuid,uuid,date,integer) from public, anon, authenticated;
grant execute on function public.refinance_loan(uuid,uuid,date,integer) to authenticated;

-- Preserve the two-argument API for older clients without ambiguous default arguments.
create or replace function public.refinance_loan(p_request uuid,p_loan uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.loan_periods; current_end date;
begin
 perform public.require_admin();
 if p_request is null or p_loan is null then raise exception 'Campos requeridos'; end if;
 select * into previous from public.loan_periods where request_id=p_request;
 if found then
  return public.refinance_loan(p_request,p_loan,previous.start_date,previous.months);
 end if;
 select end_date into strict current_end from public.loan_periods where loan_id=p_loan and is_current;
 return public.refinance_loan(p_request,p_loan,current_end+1,1);
end; $$;
revoke all on function public.refinance_loan(uuid,uuid) from public,anon,authenticated;
grant execute on function public.refinance_loan(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
