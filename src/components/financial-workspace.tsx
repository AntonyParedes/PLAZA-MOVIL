'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSupabase } from '@/lib/supabase';
import { cents, decimalSoles, formatPEN, loanProducts, scheduleLoan } from '@/lib/finance';
import { addDays, dateLabel, downloadCSV, limaDate, weekBounds, type Customer, type Loan, type Period, type Payment, type Installment } from '@/lib/portal';
import { collectionStatus, weekdayLabel } from '@/lib/collection-status';
import { Button } from '@/components/ui/button';
import { RefreshCw, Download, Plus, MessageCircle } from 'lucide-react';
const supabase=getSupabase();
const money=(value:number|bigint)=>formatPEN(value);
export default function FinancialWorkspace({clients,role}:{clients:Customer[];role:'administrador'|'jefe'}) {
 const [data,setData]=useState<{loans:Loan[];periods:Period[];payments:Payment[];installments:Installment[]}>({loans:[],periods:[],payments:[],installments:[]});
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 const [tab,setTab]=useState<'general'|'resumen'|'prestamos'|'cobranzas'|'reportes'>('general');
 const [search,setSearch]=useState('');
 const [stateFilter,setStateFilter]=useState('todos');
 const [memberFilter,setMemberFilter]=useState('todos');
 const [from,setFrom]=useState('');const [to,setTo]=useState('');
 const [showNew,setShowNew]=useState(false);
 const [selected,setSelected]=useState('');
 const [productId,setProductId]=useState('');
 const product=loanProducts.find(p=>p.id===productId);
 const [start,setStart]=useState(limaDate);
 const [paymentAmount,setPaymentAmount]=useState('');const [paidOn,setPaidOn]=useState(limaDate);
 const [preview,setPreview]=useState<ReturnType<typeof scheduleLoan>|null>(null);
 const mutationLock=useRef(false);
 const requests=useRef(new Map<string,string>());
 useEffect(()=>{
  let active=true;
  async function fetchAll(table:string) {
   const rows:unknown[]=[];
   for(let offset=0;;offset+=1000){
    const result=await supabase!.from(table).select('*').order('id').range(offset,offset+999);
    if(result.error)throw new Error('No se pudieron cargar operaciones. Verifica las migraciones y la conexión.');
    rows.push(...result.data);if(result.data.length<1000)return rows;
   }
  }
  async function load(){
   setLoading(true);setError('');
   try {
    const [loans,periods,payments,installments]=await Promise.all(['loans','loan_periods','payments','installment_balances'].map(fetchAll));
    if(active)setData({loans:loans as Loan[],periods:periods as Period[],payments:payments as Payment[],installments:installments as Installment[]});
   } catch(e){if(active)setError(e instanceof Error?e.message:'Error de conexión.');}
   finally{if(active)setLoading(false);}
  }
  void load();return()=>{active=false;};
 },[revision]);
 const customer=(loan:Loan)=>clients.find(c=>c.id===loan.client_id);
 const current=(loanId:string)=>data.periods.find(p=>p.loan_id===loanId&&p.is_current);
 const loanById=(id:string)=>data.loans.find(l=>l.id===id);
 const within=(date:string)=>(!from||date>=from)&&(!to||date<=to);
 const matches=(loan:Loan)=>`${customer(loan)?.full_name??''} ${customer(loan)?.dni??''} ${customer(loan)?.stand_code??''}`.toLowerCase().includes(search.toLowerCase());
 const loans=data.loans.filter(l=>matches(l)&&within(data.periods.find(p=>p.loan_id===l.id&&p.number===1)?.start_date??''));
 const payments=data.payments.filter(p=>within(p.paid_on)&&Boolean(loanById(p.loan_id)&&matches(loanById(p.loan_id)!)));
 const installments=data.installments.filter(i=>i.is_current&&i.pending_cents>0&&Boolean(loanById(i.loan_id)&&matches(loanById(i.loan_id)!)));
 const [today,setToday]=useState(limaDate);
 useEffect(()=>{const timer=setInterval(()=>setToday(limaDate()),60000);return()=>clearInterval(timer);},[]);
 const week=weekBounds(today);
 const selectedLoan=loanById(selected);
 const selectedPeriod=current(selected);
 const activeClients=new Set(data.loans.filter(l=>l.status==='activo').map(l=>l.client_id));
 async function mutate(name:string,args:Record<string,string|number>,confirmation:string){
  if(role!=='administrador'||mutationLock.current)return;
  if(!window.confirm(confirmation))return;
  mutationLock.current=true;setBusy(true);setError('');
  const signature=JSON.stringify([name,args]);
  const id=requests.current.get(signature)??crypto.randomUUID();requests.current.set(signature,id);
  try {
   const result=await supabase!.rpc(name,{...args,p_request:id});
   if(result.error)throw new Error(result.error.message);
   requests.current.delete(signature);setShowNew(false);setPaymentAmount('');setPreview(null);setRevision(r=>r+1);
  }catch(e){setError(e instanceof Error?e.message:'No se pudo completar la operación. Puedes reintentar con los mismos datos.');}
  finally{mutationLock.current=false;setBusy(false);}
 }
 function prepareLoan(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError('');
  try { if(!product)throw new Error('Selecciona un producto de préstamo.');setPreview(scheduleLoan(product.capital,product.rate,product.months,start)); }
  catch(e){setError(e instanceof Error?e.message:'Datos inválidos.');}
 }
 async function createLoan(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!preview||!product)return;
  const fields=new FormData(event.currentTarget);
  await mutate('create_loan',{p_client:String(fields.get('client')),p_capital:preview.originalCapital,p_rate:product.rate,p_months:product.months,p_start:start},`¿Desembolsar ${money(preview.originalCapital)} y registrar una deuda total de ${money(preview.totalCents)}? El préstamo no se podrá cancelar ni eliminar.`);
 }
 async function pay(event:FormEvent<HTMLFormElement>){
  event.preventDefault();try{await mutate('record_payment',{p_loan:selected,p_amount:cents(paymentAmount),p_paid_on:paidOn},`¿Registrar un pago de ${money(cents(paymentAmount))}? Se aplicará primero a intereses y después a capital. No se podrá anular.`);}
  catch(e){setError(e instanceof Error?e.message:'Monto inválido.');}
 }
 function exportReport(kind:string){
  if(kind==='pagos')downloadCSV('pagos-pm-creditos.csv',[['Cliente','Fecha','Total PEN','Interés PEN','Capital PEN'],...payments.map(p=>[customer(loanById(p.loan_id)!)?.full_name??'',p.paid_on,decimalSoles(p.amount_cents),decimalSoles(p.interest_cents),decimalSoles(p.capital_cents)])]);
  else if(kind==='vencidos')downloadCSV('cuotas-vencidas.csv',[['Cliente','Cuota','Vencimiento','Saldo PEN'],...installments.filter(i=>i.due_date<today&&within(i.due_date)).map(i=>[customer(loanById(i.loan_id)!)?.full_name??'',i.number,i.due_date,decimalSoles(i.pending_cents)])]);
  else if(kind==='refinanciaciones')downloadCSV('refinanciaciones.csv',[['Cliente','Periodo','Inicio','Fin','Capital PEN','Interés PEN'],...data.periods.filter(p=>p.number>1&&within(p.start_date)&&Boolean(loanById(p.loan_id)&&matches(loanById(p.loan_id)!))).map(p=>[customer(loanById(p.loan_id)!)?.full_name??'',p.number,p.start_date,p.end_date,decimalSoles(p.opening_capital),decimalSoles(p.interest_generated)])]);
  else downloadCSV(`prestamos-${kind}.csv`,[['Cliente','DNI','Estado','Capital original PEN','Capital pendiente PEN','Interés pendiente PEN'],...loans.filter(l=>kind==='todos'||l.status===kind).map(l=>[customer(l)?.full_name??'',customer(l)?.dni??'',l.status,decimalSoles(l.original_capital),decimalSoles(l.capital_pending),decimalSoles(l.interest_pending)])]);
 }
 function renderGeneralPanel(){
  const entries=loans.map(loan=>({loan,client:customer(loan),status:collectionStatus(loan,data.periods,data.installments,today)})).filter(row=>(memberFilter==='todos'||row.client?.member_type===memberFilter)&&(stateFilter==='todos'||(stateFilter==='refinanciado'?row.status.refinanced:row.status.state===stateFilter)));
  const headers=['Nombres y apellidos','Código stand','Condición','Fecha del préstamo','Saldo','Cuota semanal','Día de pago','Estado','Días de atraso','Refinanciado'];
  return <div className="space-y-4"><div className="flex flex-wrap items-end gap-4"><label>Condición<select aria-label="Filtrar condición" className="mt-1 block rounded-lg border bg-white p-3" value={memberFilter} onChange={e=>setMemberFilter(e.target.value)}><option value="todos">Todos</option><option value="socio">Socios</option><option value="trabajador">Trabajadores</option></select></label><label>Estado<select aria-label="Filtrar estado" className="mt-1 block rounded-lg border bg-white p-3" value={stateFilter} onChange={e=>setStateFilter(e.target.value)}><option value="todos">Todos</option><option value="Puntual">Puntuales</option><option value="Atrasado">Atrasados (1–6 días)</option><option value="En mora">En mora (7 días o más)</option><option value="Liquidado">Liquidados</option><option value="refinanciado">Refinanciados</option></select></label><Button variant="outline" onClick={()=>downloadCSV('panel-general.csv',[headers,...entries.map(({client,status})=>[client?.full_name??'',client?.stand_code??'Por registrar',client?.member_type??'Por registrar',status.startDate??'',decimalSoles(status.balance),decimalSoles(status.weeklyCents),status.nextDate??'',status.state==='Atrasado'?`Se atrasó ${status.daysLate} días`:status.state,status.daysLate,status.refinanced?'Sí':'No'])])}><Download size={16}/> Exportar panel CSV</Button></div><p className="text-sm text-slate-500">Saldo incluye capital e intereses pendientes. La cuota semanal es el importe programado; el atraso se cuenta desde la cuota impaga más antigua. Los préstamos refinanciados conservan su fecha de desembolso original.</p><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{[...headers,'Detalle'].map(title=><th key={title} className="whitespace-nowrap p-4">{title}</th>)}</tr></thead><tbody>{entries.map(({loan,client,status})=><tr key={loan.id} className="border-t border-slate-100"><td className="p-4 font-semibold">{client?.full_name??'Cliente no disponible'}</td><td className="p-4">{client?.stand_code??'Por registrar'}</td><td className="p-4 capitalize">{client?.member_type??'Por registrar'}</td><td className="whitespace-nowrap p-4">{status.startDate?dateLabel(status.startDate):'—'}</td><td className="whitespace-nowrap p-4 font-semibold">{money(status.balance)}</td><td className="whitespace-nowrap p-4">{money(status.weeklyCents)}</td><td className="whitespace-nowrap p-4">{status.nextDate?<><span className="capitalize">{weekdayLabel(status.nextDate)}</span><br/><span className="text-xs text-slate-500">{dateLabel(status.nextDate)}</span></>:'—'}</td><td className="p-4"><span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${status.state==='Liquidado'?'bg-slate-100 text-slate-700':status.daysLate>0?'bg-red-50 text-red-700':'bg-teal-50 text-teal-800'}`}>{status.state==='Atrasado'?`Se atrasó ${status.daysLate} ${status.daysLate===1?'día':'días'}`:status.state}</span></td><td className="p-4">{status.daysLate}</td><td className="p-4">{status.refinanced?'Sí':'No'}</td><td className="p-4"><Button variant="outline" onClick={()=>setSelected(loan.id)}>Abrir</Button></td></tr>)}</tbody></table>{entries.length===0&&<p className="p-8 text-center text-slate-500">Sin préstamos para estos filtros.</p>}</div></div>;
 }
 const totals={lent:loans.reduce((n,l)=>n+BigInt(l.original_capital),0n),capital:loans.reduce((n,l)=>n+BigInt(l.capital_pending),0n),interest:payments.reduce((n,p)=>n+BigInt(p.interest_cents),0n),paid:payments.reduce((n,p)=>n+BigInt(p.amount_cents),0n)};
 const groups=(key:'semana'|'mes')=>{
  const map=new Map<string,{total:bigint;interest:bigint}>();
  payments.forEach(p=>{const date=key==='mes'?p.paid_on.slice(0,7):weekBounds(p.paid_on).start;const value=map.get(date)??{total:0n,interest:0n};value.total+=BigInt(p.amount_cents);value.interest+=BigInt(p.interest_cents);map.set(date,value);});return [...map.entries()].sort(([a],[b])=>b.localeCompare(a));
 };
 if(loading)return <p role="status">Cargando operaciones…</p>;
 return <section className="space-y-6">
  {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">{error}</p>}
  <div className="flex flex-wrap items-center gap-2">{(['general','resumen','prestamos','cobranzas','reportes'] as const).map(t=><Button key={t} variant={t===tab?'default':'outline'} onClick={()=>setTab(t)}>{({general:'Panel general',resumen:'Indicadores',prestamos:'Préstamos',cobranzas:'Cobranzas',reportes:'Reportes'})[t]}</Button>)}<Button variant="outline" onClick={()=>setRevision(r=>r+1)} disabled={busy}><RefreshCw size={16}/> Actualizar</Button></div>
  <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3"><label>Buscar cliente / DNI / stand<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nombre, DNI o stand"/></label><label>Desde<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
  <p className="text-xs text-slate-500">El rango filtra préstamos por desembolso y pagos por fecha de pago. Los saldos y alertas corresponden a hoy en Lima. Los cronogramas anteriores se conservan como historial.</p>
  {tab==='general'&&renderGeneralPanel()}
  {tab==='resumen'&&<>
   <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Dinero prestado',money(totals.lent)],['Capital pendiente',money(totals.capital)],['Intereses cobrados',money(totals.interest)],['Total cobrado',money(totals.paid)],['Préstamos activos',loans.filter(l=>l.status==='activo').length],['Préstamos liquidados',loans.filter(l=>l.status==='liquidado').length],['Cobros de hoy',money(installments.filter(i=>i.due_date===today).reduce((n,i)=>n+BigInt(i.pending_cents),0n))],['Clientes atrasados',new Set(installments.filter(i=>i.due_date<today).map(i=>loanById(i.loan_id)!.client_id)).size]].map(([label,value])=><article key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-3 text-2xl font-bold">{value}</p></article>)}</div>
   <div className="grid gap-4 lg:grid-cols-3">{[['Vencen mañana',installments.filter(i=>i.due_date===addDays(today,1))],['Pendientes de esta semana',installments.filter(i=>i.due_date>=week.start&&i.due_date<=week.end)],['Próximos vencimientos',installments.filter(i=>i.due_date>today&&i.due_date<=addDays(today,7))]].map(([title,rows])=><article key={title as string} className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="mb-3 font-semibold">{title as string}</h3>{(rows as Installment[]).length===0?<p className="text-sm text-slate-500">Sin cuotas pendientes.</p>:(rows as Installment[]).map(i=><p key={i.id} className="mb-3 text-sm">{customer(loanById(i.loan_id)!)?.full_name}<br/><span className="text-slate-500">{dateLabel(i.due_date)} · {money(i.pending_cents)}</span></p>)}</article>)}</div>
   <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h3 className="font-semibold">Préstamos próximos a finalizar</h3>{data.periods.filter(p=>p.is_current&&p.end_date>=today&&p.end_date<=addDays(today,7)&&loanById(p.loan_id)?.status==='activo'&&matches(loanById(p.loan_id)!)).map(p=><p key={p.id} className="mt-3 text-sm">{customer(loanById(p.loan_id)!)?.full_name} · {dateLabel(p.end_date)}</p>)}</div>
  </>}
  {tab==='prestamos'&&<>
   {role==='administrador'&&<Button onClick={()=>{setShowNew(!showNew);setPreview(null);}}><Plus size={16}/> Nuevo préstamo</Button>}
   {showNew&&role==='administrador'&&<div className="rounded-xl border border-slate-200 bg-white p-6"><h2 className="mb-5 text-xl font-semibold">Preparar préstamo</h2><form onSubmit={prepareLoan} className="grid gap-4 sm:grid-cols-2"><label>Producto de préstamo<select aria-label="Producto de préstamo" className="mt-1 w-full rounded-lg border p-3" required value={productId} onChange={e=>{setProductId(e.target.value);setPreview(null);}}><option value="">Selecciona un producto autorizado</option>{loanProducts.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>Fecha del préstamo<input type="date" max={today} value={start} onChange={e=>{setStart(e.target.value);setPreview(null);}} required/></label><Button type="submit" variant="outline">Revisar cronograma</Button></form>
    {preview&&<div className="mt-6 space-y-4"><p>Capital: {money(preview.originalCapital)} · Interés: {money(preview.interestCents)} · Total: <strong>{money(preview.totalCents)}</strong></p><ul className="grid gap-2 sm:grid-cols-2">{preview.installments.map(i=><li key={i.number} className="rounded-lg bg-slate-50 p-3 text-sm">Cuota {i.number} · {dateLabel(i.dueDate)} · {money(i.scheduledCents)}</li>)}</ul><form onSubmit={createLoan} className="space-y-4"><label>Cliente<select name="client" required className="mt-1 block w-full rounded-lg border p-3"><option value="">Selecciona un cliente identificado sin préstamo activo</option>{clients.filter(c=>!activeClients.has(c.id)&&c.stand_code&&c.member_type).map(c=><option key={c.id} value={c.id}>{c.full_name} · stand {c.stand_code} · {c.member_type}</option>)}</select></label><Button disabled={busy} type="submit">Confirmar desembolso</Button></form></div>}
   </div>}
   <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Cliente','Original','Capital pendiente','Interés pendiente','Estado','Detalle'].map(t=><th key={t} className="p-4">{t}</th>)}</tr></thead><tbody>{loans.map(l=><tr key={l.id} className="border-t"><td className="p-4">{customer(l)?.full_name}</td><td className="p-4">{money(l.original_capital)}</td><td className="p-4">{money(l.capital_pending)}</td><td className="p-4">{money(l.interest_pending)}</td><td className="p-4">{l.status}</td><td className="p-4"><Button variant="outline" onClick={()=>setSelected(l.id)}>Abrir</Button></td></tr>)}</tbody></table>{!loans.length&&<p className="p-8 text-center text-slate-500">Sin préstamos para estos filtros.</p>}</div>
  </>}
  {tab==='cobranzas'&&<div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Cliente','Cuota','Vencimiento','Pendiente','Estado','Acción'].map(t=><th key={t} className="p-4">{t}</th>)}</tr></thead><tbody>{installments.filter(i=>within(i.due_date)).sort((a,b)=>a.due_date.localeCompare(b.due_date)).map(i=>{
   const l=loanById(i.loan_id)!;const c=customer(l);const text=`Hola ${c?.full_name}, te recordamos tu cuota de ${money(i.pending_cents)} con vencimiento ${dateLabel(i.due_date)}. PM Créditos.`;
   return <tr key={i.id} className="border-t"><td className="p-4">{c?.full_name}</td><td className="p-4">{i.number}</td><td className="p-4">{dateLabel(i.due_date)}</td><td className="p-4">{money(i.pending_cents)}</td><td className={`p-4 ${i.status==='vencido'?'text-red-700':i.due_date===today?'text-amber-700':'text-slate-600'}`}>{i.status}{i.due_date===today?' · hoy':''}</td><td className="flex flex-wrap gap-2 p-4"><Button variant="outline" onClick={()=>setSelected(l.id)}>Ver préstamo</Button>{c&&<Button asChild variant="outline"><a href={`https://wa.me/51${c.phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle size={16}/> WhatsApp</a></Button>}</td></tr>;
  })}</tbody></table>{!installments.length&&<p className="p-8 text-center text-slate-500">Sin cuotas pendientes.</p>}</div>}
  {tab==='reportes'&&<div className="space-y-5"><div className="flex flex-wrap gap-3">{[['todos','Capital pendiente'],['activo','Préstamos activos'],['liquidado','Créditos liquidados'],['pagos','Historial de pagos'],['vencidos','Cuotas vencidas'],['refinanciaciones','Refinanciaciones']].map(([kind,label])=><Button key={kind} variant="outline" onClick={()=>exportReport(kind)}><Download size={16}/>{label} CSV</Button>)}</div>{(['semana','mes'] as const).map(key=><div key={key} className="rounded-xl border bg-white p-5"><h3 className="mb-4 font-semibold">Cobros por {key}</h3><Button variant="outline" onClick={()=>downloadCSV(`cobros-${key}.csv`,[[key,'Cobrado PEN','Intereses cobrados PEN'],...groups(key).map(([date,value])=>[date,decimalSoles(value.total),decimalSoles(value.interest)])])}><Download size={16}/> Exportar CSV</Button><table className="mt-4 w-full text-left text-sm"><thead><tr><th className="py-2">Periodo</th><th>Total cobrado</th><th>Intereses cobrados</th></tr></thead><tbody>{groups(key).map(([date,value])=><tr key={date} className="border-t"><td className="py-3">{date}</td><td>{money(value.total)}</td><td>{money(value.interest)}</td></tr>)}</tbody></table></div>)}</div>}
  {selectedLoan&&<div className="rounded-xl border border-teal-200 bg-white p-6"><div className="flex justify-between gap-4"><h2 className="text-xl font-semibold">{customer(selectedLoan)?.full_name} · préstamo {selectedLoan.status}</h2><Button variant="outline" onClick={()=>setSelected('')}>Cerrar detalle</Button></div><p className="mt-4 text-sm">Original {money(selectedLoan.original_capital)} · amortizado {money(selectedLoan.original_capital-selectedLoan.capital_pending)} · pendiente {money(selectedLoan.capital_pending)} · interés pendiente {money(selectedLoan.interest_pending)}</p>
   {selectedLoan.status==='activo'&&role==='administrador'&&<div className="mt-6 grid gap-6 lg:grid-cols-2"><form onSubmit={pay} className="space-y-4"><h3 className="font-semibold">Registrar pago parcial o total</h3><label className="block">Monto (S/)<input value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} required inputMode="decimal"/></label><label className="block">Fecha de pago<input type="date" value={paidOn} onChange={e=>setPaidOn(e.target.value)} required min={selectedPeriod?.start_date} max={today}/></label><div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Confirmar pago</Button><Button type="button" variant="outline" onClick={()=>setPaymentAmount(decimalSoles(BigInt(selectedLoan.capital_pending)+BigInt(selectedLoan.interest_pending)))}>Usar saldo para liquidar</Button></div><p className="text-xs text-slate-500">Los pagos son definitivos. Revisa monto y fecha antes de confirmar.</p></form><div className="space-y-4"><h3 className="font-semibold">Refinanciar un mes</h3><p className="text-sm">Misma tasa mensual {selectedLoan.rate_basis_points/100} % sobre el capital original. El nuevo periodo comienza al terminar de pagar el interés anterior.</p><p className="text-sm">Inicio: {selectedPeriod?.interest_settled_on?dateLabel(selectedPeriod.interest_settled_on):'Interés aún pendiente'}</p><Button disabled={busy||selectedLoan.interest_pending!==0||data.installments.some(i=>i.loan_id===selected&&i.is_current&&i.due_date<today&&i.pending_cents>0)} onClick={()=>mutate('refinance_loan',{p_loan:selected},'¿Refinanciar un mes con la misma tasa sobre el capital original? Se conservará el historial previo.')}>Confirmar refinanciación</Button></div></div>}
   <h3 className="mb-3 mt-7 font-semibold">Historial de periodos y cuotas</h3>{data.periods.filter(p=>p.loan_id===selected).sort((a,b)=>a.number-b.number).map(p=><div key={p.id} className="mb-5 rounded-lg border p-4"><p className="mb-3 font-semibold">Periodo {p.number} · {p.is_current?'Vigente':'Histórico'} · {dateLabel(p.start_date)} – {dateLabel(p.end_date)}</p><p className="mb-3 text-sm">Interés generado: {money(p.interest_generated)}</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Cuota','Fecha original','Programado','Pagado','Saldo','Estado'].map(t=><th key={t} className="py-2 pr-4">{t}</th>)}</tr></thead><tbody>{data.installments.filter(i=>i.period_id===p.id).sort((a,b)=>a.number-b.number).map(i=><tr key={i.id} className="border-t"><td className="py-3">{i.number}</td><td>{dateLabel(i.due_date)}</td><td>{money(i.scheduled_cents)}</td><td>{money(i.paid_cents)}</td><td>{money(i.pending_cents)}</td><td>{p.is_current?i.status:'Histórico'}</td></tr>)}</tbody></table></div>{!p.is_current&&<p className="mt-3 text-xs text-slate-500">El saldo histórico se trasladó al nuevo periodo; no se suma de nuevo a la deuda vigente.</p>}</div>)}
   <h3 className="mb-3 mt-5 font-semibold">Pagos registrados</h3>{data.payments.filter(p=>p.loan_id===selected).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(p=><p key={p.id} className="mb-2 text-sm">{dateLabel(p.paid_on)} · {money(p.amount_cents)} (interés {money(p.interest_cents)} / capital {money(p.capital_cents)})</p>)}
  </div>}
 </section>;
}
