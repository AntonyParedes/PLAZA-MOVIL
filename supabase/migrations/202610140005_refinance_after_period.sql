begin;
-- Refinancing requires full interest payment and an ended current period.
-- Overdue quotas remain historical; the new month starts the day after the previous end date.
create or replace function public.refinance_loan(p_request uuid,p_loan uuid)
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
 if (now() at time zone 'America/Lima')::date<=p.end_date then
  raise exception 'El periodo aún no ha terminado';
 end if;
 v_interest:=floor((l.original_capital::numeric*l.rate_basis_points+5000)/10000);
 if l.capital_pending::numeric+v_interest>9007199254740991 then raise exception 'Deuda fuera de rango'; end if;
 update public.loan_periods set is_current=false where id=p.id;
 insert into public.loan_periods(loan_id,request_id,number,start_date,end_date,months,opening_capital,interest_generated,interest_settled_on)
 values(l.id,p_request,p.number+1,p.end_date+1,p.end_date+29,1,l.capital_pending,v_interest,case when v_interest=0 then p.end_date+1 end) returning id into v_period;
 perform public.generate_installments(v_period);
 update public.loans set interest_pending=v_interest where id=l.id;
 insert into public.audit_events(actor_id,action,entity_id) values(auth.uid(),'loans.refinance',v_period);
 return v_period;
end; $$;
revoke all on function public.refinance_loan(uuid,uuid) from public, anon, authenticated;
grant execute on function public.refinance_loan(uuid,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
