import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rlsAuditDatabase } from './audit/rls-fixture';
import { admin, chief, outsider } from './helpers';

const tables=['profiles','clients','audit_events','loans','loan_periods','installments','payments','payment_installments','client_deletions','cash_movements','payment_corrections'];
const views=['installment_balances','penalty_register'];
const privateFunctions=['require_admin()','generate_installments(uuid)','audit_client_change()','require_client_identification()','require_borrower_identification()','client_deletion_snapshot(uuid)','payment_correction_plan(uuid,text,bigint,date,text)','prevent_retired_payment_request()'];
const apiFunctions=['current_app_role()','create_loan(uuid,uuid,bigint,integer,integer,date)','record_payment(uuid,uuid,bigint,date)','refinance_loan(uuid,uuid)','refinance_loan(uuid,uuid,date,integer)','preview_client_deletion(uuid)','delete_client(uuid,text,text,text)','record_cash_movement(uuid,text,bigint,text)','cash_summary()','settle_loan_with_penalty(uuid,uuid,bigint,bigint,text,date)','preview_payment_correction(uuid,text,bigint,date,text)','correct_payment(uuid,uuid,text,bigint,date,text,text)'];

test('auditoría: once tablas con RLS, dos vistas invoker y ACL mínimas sobre veinte funciones',async()=>{
 const {db}=await rlsAuditDatabase();
 try {
  await db.exec('reset role');
  const catalog=(await db.query<{relname:string;relrowsecurity:boolean;reloptions:string[]|null}>("select relname,relrowsecurity,reloptions from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v')")).rows;
  assert.equal(catalog.filter(r=>tables.includes(r.relname)).length,11);
  for(const table of tables)assert.equal(catalog.find(r=>r.relname===table)?.relrowsecurity,true,table);
  for(const view of views)assert.ok(catalog.find(r=>r.relname===view)?.reloptions?.includes('security_invoker=true'),view);
  for(const table of [...tables,...views])for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
   const actual=(await db.query<{allowed:boolean}>('select has_table_privilege($1,$2,$3) allowed',[role,`public.${table}`,privilege])).rows[0].allowed;
   const expected=role==='authenticated'&&(privilege==='SELECT'||(table==='clients'&&['INSERT','UPDATE'].includes(privilege)));
   assert.equal(actual,expected,`${role} ${privilege} ${table}`);
  }
  for(const signature of [...privateFunctions,...apiFunctions]){
   const row=(await db.query<{prosecdef:boolean;proconfig:string[];owner:string;anon:boolean;authenticated:boolean;public_execute:boolean}>(`select p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') public_execute from pg_proc p where p.oid=to_regprocedure($1)`,[`public.${signature}`])).rows[0];
   assert.ok(row,signature);assert.equal(row.prosecdef,true,signature);assert.ok(row.proconfig.includes('search_path=""'),signature);
   assert.equal(row.anon,false,signature);assert.equal(row.public_execute,false,signature);assert.equal(row.authenticated,apiFunctions.includes(signature),signature);
   assert.ok(!['anon','authenticated'].includes(row.owner),signature);
  }
  const roles=(await db.query<{rolname:string;rolsuper:boolean;rolbypassrls:boolean}>("select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('anon','authenticated')")).rows;
  for(const role of roles){assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);}
 }finally{await db.close();}
});

test('auditoría: roles reales en SQL, sin lectura indebida, elevación de perfil ni escrituras RPC para consulta/sin perfil',async()=>{
 const {db,first,second,activeLoan,removed,today}=await rlsAuditDatabase();
 try {
  const snapshot=(await db.query<{token:string}>(`select preview_client_deletion('${first}')->>'confirmation_token' token`)).rows[0].token;
  const mutations=[
   `select create_loan('${randomUUID()}','${second}',50000,700,1,'${today}')`,
   `select record_payment('${randomUUID()}','${activeLoan}',100,'${today}')`,
   `select refinance_loan('${randomUUID()}','${activeLoan}')`,
   `select refinance_loan('${randomUUID()}','${activeLoan}','${today}',1)`,
   `select preview_client_deletion('${first}')`,
   `select delete_client('${first}','12345678','Prueba denegada','${snapshot}')`,
   `select record_cash_movement('${randomUUID()}','aporte',100,'Prueba denegada')`,
   `select settle_loan_with_penalty('${randomUUID()}','${activeLoan}',52500,100,'Prueba denegada','${today}')`,
   `select preview_payment_correction(null,'anular',null,null,'Duplicado')`,
   `select correct_payment('${randomUUID()}',null,'anular',null,null,'Duplicado','token')`,
  ];
  for(const identity of [chief,outsider,'']){
   await db.exec(`set request.jwt.claim.sub='${identity}'`);
   // User-editable metadata is not the source of authorization.
   await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:identity,user_metadata:{role:'administrador'},app_metadata:{role:'administrador'}})]);
   const expected=identity===chief;
   for(const table of [...tables,...views]){
    const rows=(await db.query(`select * from public.${table}`)).rows;
    assert.equal(rows.length>0,expected&&!['client_deletions','payment_corrections'].includes(table),`${identity||'sin identidad'} SELECT ${table}`);
   }
   for(const sql of mutations)await assert.rejects(db.exec(sql),/Operación exclusiva del administrador/);
   if(!expected)await assert.rejects(db.exec('select cash_summary()'),/Acceso no autorizado/);
   else assert.ok((await db.query('select cash_summary()')).rows.length);
   await assert.rejects(db.exec(`insert into profiles(id,role) values('${outsider}','administrador')`),/permission denied/);
   await assert.rejects(db.exec("update profiles set role='administrador'"),/permission denied/);
   await assert.rejects(db.exec('delete from profiles'),/permission denied/);
   await assert.rejects(db.exec("insert into clients(full_name,dni,phone,address,stand_code,member_type) values('Intruso','44556677','999999999','Lima prueba','AUD-02','socio')"),/row-level security/);
   assert.equal((await db.query(`update clients set full_name='Cambio no autorizado' where id='${first}' returning id`)).rows.length,0);
   for(const table of tables.filter(t=>t!=='clients')) {
    await assert.rejects(db.exec(`delete from ${table}`),/permission denied/);
    await assert.rejects(db.exec(`truncate ${table} cascade`),/permission denied/);
   }
   await assert.rejects(db.exec('select generate_installments(null)'),/permission denied/);
   await assert.rejects(db.exec(`select client_deletion_snapshot('${first}')`),/permission denied/);
  }
  await db.exec('reset role; set role anon');
  for(const name of [...tables,...views])await assert.rejects(db.query(`select * from public.${name}`),/permission denied/);
  for(const sql of [...mutations,'select cash_summary()','select current_app_role()'])await assert.rejects(db.exec(sql),/permission denied/);
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${admin}'`);
  assert.equal((await db.query('select id from profiles')).rows.length,1); // Own profile only, including administrators.
  assert.equal((await db.query(`select * from client_deletions where client_id='${removed}'`)).rows.length,1);
  assert.equal((await db.query<{full_name:string}>(`select full_name from clients where id='${first}'`)).rows[0].full_name,'Cliente de auditoría');
  await db.exec(`select record_payment('${randomUUID()}','${activeLoan}',100,'${today}')`);
 }finally{await db.close();}
});

test('auditoría: endurecimiento pendiente si PUBLIC hereda TRUNCATE; RLS por sí sola no lo impide',async()=>{
 const {db}=await rlsAuditDatabase(true);
 try {
  assert.ok((await db.query('select * from audit_events')).rows.length>0);
  await db.exec(`set request.jwt.claim.sub='${outsider}'`);
  assert.equal((await db.query('select * from audit_events')).rows.length,0);
  assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','public.audit_events','TRUNCATE') allowed")).rows[0].allowed,true);
  // Local destructive proof on fictional data only. Never run against production.
  await db.exec('truncate audit_events');
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  assert.equal((await db.query('select * from audit_events')).rows.length,0);
 }finally{await db.close();}
});

test('auditoría: retirar o degradar un perfil se aplica a consultas y RPC aunque la identidad siga siendo la misma',async()=>{
 const {db,first}=await rlsAuditDatabase();
 try{
  assert.ok((await db.query('select * from clients')).rows.length);
  await db.exec(`reset role;update profiles set role='jefe' where id='${admin}';set role authenticated`);
  assert.equal((await db.query<{role:string}>('select current_app_role() role')).rows[0].role,'jefe');
  await assert.rejects(db.exec(`select preview_client_deletion('${first}')`),/Operación exclusiva/);
  await db.exec(`reset role;delete from profiles where id='${admin}';set role authenticated`);
  assert.equal((await db.query('select * from clients')).rows.length,0);
  assert.equal((await db.query('select * from penalty_register')).rows.length,0);
  await assert.rejects(db.exec('select cash_summary()'),/Acceso no autorizado/);
 }finally{await db.close();}
});
