begin;
-- Explicit administrator-only exception for removing an erroneous client and its financial records.
create table if not exists public.client_deletions (
 client_id uuid primary key,
 actor_id uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 3 and 300),
 confirmation_token text not null,
 loans_count bigint not null,
 payments_count bigint not null,
 balance_cents numeric not null,
 paid_cents numeric not null,
 deleted_at timestamptz not null default now()
);
alter table public.client_deletions enable row level security;
revoke all on public.client_deletions from public,anon,authenticated;
grant select on public.client_deletions to authenticated;
drop policy if exists read_client_deletions on public.client_deletions;
create policy read_client_deletions on public.client_deletions for select to authenticated
 using ((select public.current_app_role())='administrador');

-- Private helper. The caller holds the client and loan locks before taking this snapshot.
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
  'paid_cents',(select coalesce(sum(p.amount_cents::numeric),0)::text from public.payments p join public.loans l on l.id=p.loan_id where l.client_id=p_client),
  'confirmation_token',md5(state::text));
end; $$;
revoke all on function public.client_deletion_snapshot(uuid) from public,anon,authenticated;

create or replace function public.preview_client_deletion(p_client uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_admin();
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'Cliente inexistente'; end if;
 perform 1 from public.loans where client_id=p_client order by id for update;
 return public.client_deletion_snapshot(p_client);
end; $$;
revoke all on function public.preview_client_deletion(uuid) from public,anon,authenticated;
grant execute on function public.preview_client_deletion(uuid) to authenticated;

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
