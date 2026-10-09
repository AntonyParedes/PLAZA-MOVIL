import {test,expect,type Page} from '@playwright/test';
const userId='11111111-1111-4111-8111-111111111111';
const clientId='22222222-2222-4222-8222-222222222222';
async function mockSupabase(page:Page,role:'administrador'|'jefe',tables:Record<string,unknown>={}){
 const calls:{name:string;body:Record<string,unknown>}[]=[];
 const user={id:userId,email:'prueba@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-10-01T00:00:00Z'};
 await page.route('https://pm-e2e.supabase.co/**',async route=>{
  const request=route.request();const url=new URL(request.url());
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','content-type':'application/json'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  let body:unknown=[];
  if(url.pathname==='/auth/v1/token')body={access_token:'mock-session-token',refresh_token:'mock-refresh-token',token_type:'bearer',expires_in:3600,user};
  else if(url.pathname==='/auth/v1/user')body=user;
  else if(url.pathname==='/auth/v1/logout'){await route.fulfill({status:204,headers});return;}
  else if(url.pathname==='/rest/v1/profiles')body={role};
  else if(url.pathname==='/rest/v1/clients')body=tables.clients??[{id:clientId,full_name:'Cliente de prueba',dni:'12345678',phone:'999999999',address:'Lima',notes:'',stand_code:'A-01',member_type:'socio',created_at:'2026-10-01T00:00:00Z'}];
  else if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1)!;
   calls.push({name,body:request.postDataJSON()});body='33333333-3333-4333-8333-333333333333';
  }
  const table=url.pathname.split('/').at(-1)!;
  if(url.pathname.startsWith('/rest/v1/')&&table in tables)body=tables[table];
  await route.fulfill({status:200,headers,body:JSON.stringify(body)});
 });
 return calls;
}
async function login(page:Page){
 await page.goto('/');
 await page.getByLabel('Correo electrónico').fill('prueba@example.test');
 await page.getByLabel('Contraseña').fill('contraseña-de-prueba');
 await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'administrador',exact:true}).or(page.getByRole('heading',{name:'jefe',exact:true}))).toBeVisible();
}
test('administrador selecciona producto de ocho cuotas y envía tasa mensual con UUID idempotente',async({page})=>{
 const calls=await mockSupabase(page,'administrador');await login(page);
 await page.getByRole('button',{name:'Panel general',exact:true}).click();
 await page.getByRole('button',{name:'Préstamos',exact:true}).click();
 await page.getByRole('button',{name:'Nuevo préstamo'}).click();
 await page.getByRole('combobox',{name:'Producto de préstamo',exact:true}).selectOption('1000-2');
 await page.getByLabel('Fecha del préstamo').fill('2026-10-09');
 await page.getByRole('button',{name:'Revisar cronograma'}).click();
 await expect(page.getByText(/Cuota 8 ·/)).toBeVisible();
 await expect(page.getByText(/Interés: S\/\s*120\.00/)).toBeVisible();
 await expect(page.getByText(/Cuota 9 ·/)).toHaveCount(0);
 await page.getByRole('combobox',{name:'Cliente',exact:true}).selectOption(clientId);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Confirmar desembolso'}).click();
 await expect.poll(()=>calls.length).toBe(1);
 expect(calls[0].name).toBe('create_loan');
 expect(calls[0].body).toMatchObject({p_client:clientId,p_capital:100000,p_rate:600,p_months:2,p_start:'2026-10-09'});
 expect(calls[0].body.p_request).toMatch(/^[0-9a-f-]{36}$/);
 await page.getByRole('button',{name:'Reportes',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Historial de pagos CSV'}).click();
 expect((await download).suggestedFilename()).toBe('pagos-pm-creditos.csv');
 await expect(page.getByRole('button',{name:/anular|eliminar/i})).toHaveCount(0);
});
test('jefe puede consultar pero no desembolsar ni importar',async({page})=>{
 await mockSupabase(page,'jefe');await login(page);
 await expect(page.getByRole('button',{name:'Revisar Excel',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Clientes',exact:true}).click();
 await expect(page.getByText('Cliente de prueba',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Nuevo cliente'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Editar',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Panel general',exact:true}).click();
 await page.getByRole('button',{name:'Préstamos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Nuevo préstamo'})).toHaveCount(0);
});

test('Excel muestra duplicados, saldos inconsistentes y fórmulas sin escribir a la API',async({page})=>{
 const calls=await mockSupabase(page,'administrador');await login(page);
 await page.getByRole('button',{name:'Revisar Excel',exact:true}).click();
 const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Préstamos');
 sheet.addRow(['cliente','dni','capital_original','capital_pendiente','interes_pendiente','fecha_prestamo','tasa_mensual_porcentaje','plazo_meses','saldo_total']);
 sheet.addRow(['Cliente de prueba','12345678',1000,810,0,'2026-10-09',6,1,810]);
 sheet.addRow(['Duplicado','12345678',1000,1001,70,'2026-10-09',6,1,{formula:'D3+E3',result:800}]);
 const buffer=Buffer.from(await book.xlsx.writeBuffer());
 await page.getByLabel('Seleccionar PRESTAMOS - PM.xlsx').setInputFiles({name:'PRESTAMOS - PM.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
 await expect(page.getByText(/2 registros · 1 con errores · 1 con advertencias/)).toBeVisible();
 await expect(page.getByText('Saldo total inconsistente con capital e interés pendientes.')).toBeVisible();
 await expect(page.getByText(/Contiene fórmulas:/)).toBeVisible();
 expect(calls).toHaveLength(0);
});

test('conserva el acceso al volver a la pestaña y al restaurar la sesión; salir explícitamente sigue funcionando',async({page})=>{
 await mockSupabase(page,'administrador');await login(page);
 await page.getByRole('button',{name:'Clientes',exact:true}).click();
 await expect(page.getByText('Cliente de prueba',{exact:true})).toBeVisible();
 // Exercise the real Supabase SDK visibility handler and wait for its auth notification.
 await page.evaluate(async()=>{
  const key=Object.keys(localStorage).find(key=>key.startsWith('sb-')&&key.endsWith('-auth-token'))!;
  await new Promise<void>(resolve=>{
   const observer=new BroadcastChannel(key);
   observer.onmessage=event=>{if(event.data.event==='SIGNED_IN'){observer.close();resolve();}};
   window.dispatchEvent(new Event('visibilitychange'));
  });
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
 await expect(page.getByText('Cliente de prueba',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Clientes',exact:true})).toBeEnabled();
 await page.reload();
 await expect(page.getByRole('heading',{name:'administrador',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Iniciar sesión',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('heading',{name:'Iniciar sesión',exact:true})).toBeVisible();
});

test('panel general identifica stand, socio/trabajador, saldo, atraso, mora y refinanciación',async({page})=>{
 const {limaDate,addDays}=await import('../src/lib/portal');const today=limaDate();
 const customers=['Ana Socia','Luis Trabajador','Maria Liquidada'].map((full_name,index)=>({id:`client-${index}`,full_name,dni:`1234567${index}`,phone:'999999999',stand_code:`S-0${index+1}`,member_type:index===1?'trabajador':'socio',address:'Lima',created_at:`${today}T00:00:00Z`}));
 const loans=customers.map((c,index)=>({id:`loan-${index}`,client_id:c.id,original_capital:100000,capital_pending:index===2?0:81000,interest_pending:index===2?0:6000,rate_basis_points:600,status:index===2?'liquidado':'activo',created_at:`${today}T00:00:00Z`}));
 const periods=loans.map((l,index)=>({id:`period-${index}`,loan_id:l.id,number:1,start_date:addDays(today,-28),end_date:today,months:1,opening_capital:100000,interest_generated:6000,interest_settled_on:null,is_current:index!==1}));
 periods.push({...periods[1],id:'refinanced',number:2,is_current:true,start_date:addDays(today,-14),end_date:addDays(today,14)});
 const installments=loans.map((l,index)=>({id:`quota-${index}`,loan_id:l.id,period_id:index===1?'refinanced':`period-${index}`,number:1,due_date:addDays(today,index===0?-3:-7),scheduled_cents:26500,paid_cents:index===2?26500:0,pending_cents:index===2?0:26500,is_current:true,status:'pendiente'}));
 await mockSupabase(page,'administrador',{clients:customers,loans,loan_periods:periods,installment_balances:installments});await login(page);
 await page.getByRole('button',{name:'Panel general',exact:true}).click();
 const ana=page.getByRole('row').filter({hasText:'Ana Socia'});
 await expect(ana).toContainText('S-01');await expect(ana).toContainText('Se atrasó 3 días');await expect(ana).toContainText('S/ 870.00');
 const luis=page.getByRole('row').filter({hasText:'Luis Trabajador'});
 await expect(luis).toContainText('trabajador');await expect(luis).toContainText('En mora');await expect(luis).toContainText('Sí');
 await expect(page.getByRole('row').filter({hasText:'Maria Liquidada'})).toContainText('Liquidado');
 await expect(page.getByRole('columnheader',{name:'Saldo',exact:true})).toBeVisible();
 await expect(page.getByRole('columnheader',{name:'Día de pago',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Filtrar estado'}).selectOption('En mora');
 await expect(ana).toHaveCount(0);await expect(luis).toBeVisible();
 await page.getByRole('combobox',{name:'Filtrar estado'}).selectOption('todos');
 await page.getByRole('combobox',{name:'Filtrar condición'}).selectOption('socio');
 await expect(luis).toHaveCount(0);await expect(ana).toBeVisible();
 await page.getByRole('button',{name:'Clientes',exact:true}).click();
 await page.getByRole('button',{name:'Nuevo cliente'}).click();
 await expect(page.getByLabel('Código de stand')).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Condición',exact:true})).toBeVisible();
});
