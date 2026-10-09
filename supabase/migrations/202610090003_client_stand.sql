begin;
-- Existing clients retain their actual data; identification must be completed manually.
alter table public.clients
 add column stand_code text check(stand_code is null or length(trim(stand_code)) between 1 and 40),
 add column member_type text check(member_type is null or member_type in ('socio','trabajador'));
create function public.require_client_identification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.stand_code is null or length(trim(new.stand_code))=0 or new.member_type is null then
  raise exception 'Completa código de stand y condición socio/trabajador';
 end if;
 new.stand_code:=trim(new.stand_code);
 return new;
end; $$;
revoke all on function public.require_client_identification() from public,anon,authenticated;
create trigger require_client_identification before insert or update on public.clients
for each row execute function public.require_client_identification();
create function public.require_borrower_identification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.clients where id=new.client_id and stand_code is not null and member_type is not null) then
  raise exception 'Completa código de stand y condición del cliente antes de registrar un préstamo';
 end if;
 return new;
end; $$;
revoke all on function public.require_borrower_identification() from public,anon,authenticated;
create trigger require_borrower_identification before insert on public.loans
for each row execute function public.require_borrower_identification();
notify pgrst,'reload schema';
commit;
