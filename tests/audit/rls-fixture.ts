import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { admin, chief, outsider } from '../helpers';

export async function rlsAuditDatabase(publicTruncateDefault=false) {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;`);
 if(publicTruncateDefault)await db.exec('alter default privileges in schema public grant truncate on tables to public');
 const root=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of (await readdir(root)).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name,root),'utf8'));
 await db.exec(`insert into auth.users values('${admin}'),('${chief}'),('${outsider}');insert into profiles(id,role) values('${admin}','administrador'),('${chief}','jefe');set role authenticated;set request.jwt.claim.sub='${admin}'`);
 const dates=(await db.query<{today:string;start:string;paid:string;refinanced:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-100)::text start,((now() at time zone 'America/Lima')::date-75)::text paid,((now() at time zone 'America/Lima')::date-71)::text refinanced")).rows[0];
 const createClient=async(dni:string)=>(await db.query<{id:string}>("insert into clients(full_name,dni,phone,address,stand_code,member_type) values('Cliente de auditoría',$1,'999999999','Lima prueba','AUD-01','socio') returning id",[dni])).rows[0].id;
 const first=await createClient('12345678');
 const loan=(await db.query<{id:string}>(`select create_loan('${randomUUID()}','${first}',100000,600,1,'${dates.start}') id`)).rows[0].id;
 await db.exec(`select record_payment('${randomUUID()}','${loan}',6000,'${dates.paid}');select refinance_loan('${randomUUID()}','${loan}','${dates.refinanced}',2);select settle_loan_with_penalty('${randomUUID()}','${loan}',112000,1000,'Plazo vencido','${dates.today}');select record_cash_movement('${randomUUID()}','apertura',500000,'Capital de prueba')`);
 const second=await createClient('87654321');
 const activeLoan=(await db.query<{id:string}>(`select create_loan('${randomUUID()}','${second}',50000,700,1,'${dates.today}') id`)).rows[0].id;
 await db.exec(`select record_payment('${randomUUID()}','${activeLoan}',1000,'${dates.today}')`);
 const removed=await createClient('11223344');
 const token=(await db.query<{token:string}>(`select preview_client_deletion('${removed}')->>'confirmation_token' token`)).rows[0].token;
 await db.exec(`select delete_client('${removed}','11223344','Duplicado de prueba','${token}')`);
 return {db,first,second,loan,activeLoan,removed,today:dates.today};
}
