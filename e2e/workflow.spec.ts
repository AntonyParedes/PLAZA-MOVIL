import {test,expect,type Page} from '@playwright/test';
const userId='11111111-1111-4111-8111-111111111111';
const clientId='22222222-2222-4222-8222-222222222222';
async function mockSupabase(page:Page,role:'administrador'|'jefe'){
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
  else if(url.pathname==='/rest/v1/clients')body=[{id:clientId,full_name:'Cliente de prueba',dni:'12345678',phone:'999999999',address:'Lima',notes:'',created_at:'2026-10-01T00:00:00Z'}];
  else if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1)!;
   calls.push({name,body:request.postDataJSON()});body='33333333-3333-4333-8333-333333333333';
  }
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
 await page.getByRole('button',{name:'Préstamos y cobranzas',exact:true}).click();
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
 await page.getByRole('button',{name:'Préstamos y cobranzas',exact:true}).click();
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
