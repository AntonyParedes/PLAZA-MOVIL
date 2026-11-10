"use client";

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {z} from 'zod';
import {getSupabase} from '@/lib/supabase';
import {cents,decimalSoles,formatPEN} from '@/lib/finance';
import {cashMoney} from '@/lib/cash';
import {dateLabel,limaDate,paymentReceived,type Payment} from '@/lib/portal';
import {Button} from './ui/button';
import {DataTable,Notice} from './ui/dashboard';

const supabase=getSupabase();
const sqlUrl='https://github.com/AntonyParedes/PLAZA-MOVIL/blob/mejora/experiencia-navegacion/supabase/migrations/202611040011_payment_corrections.sql';
const amount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const receipt=z.object({amount_cents:amount,paid_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),penalty_cents:amount.optional()});
const signed=z.string().regex(/^-?\d+$/);
const previewSchema=z.object({confirmation_token:z.string().regex(/^[a-f0-9]{32}$/),payment_id:z.string(),full_name:z.string(),dni:z.string(),balance_before_cents:signed,balance_after_cents:signed,cash_delta_cents:signed,interest_delta_cents:signed,penalty_delta_cents:signed,status_after:z.enum(['activo','liquidado']),periods_count:z.number().int().positive(),recalculated_payments:z.number().int().nonnegative(),before_payment:receipt,after_payment:receipt.nullable()});
type Preview=z.infer<typeof previewSchema>;
function messageFor(error:{code?:string;message:string}){
 return error.code==='PGRST202'||error.code==='42P01'||/schema cache|Could not find.*function/i.test(error.message)?'Actualización pendiente: aplica la migración 011 en Supabase para habilitar las correcciones.':error.message;
}
function ErrorNotice({message}:{message:string}){
 return <Notice error>{message}{message.startsWith('Actualización pendiente:')&&<p className="mt-2"><a className="font-semibold underline" href={message.includes('migración 012')?'https://github.com/AntonyParedes/PLAZA-MOVIL/blob/main/supabase/migrations/202611100012_integrate_early_settlement.sql':sqlUrl} target="_blank" rel="noreferrer">Abrir SQL de correcciones de pagos</a></p>}</Notice>;
}
export function PaymentCorrectionForm({payment,minDate,loanHasDiscount=false,onClose,onComplete,onBusyChange}:{payment:Payment;loanHasDiscount?:boolean;minDate?:string;onClose:()=>void;onComplete:()=>void;onBusyChange:(busy:boolean)=>void}){
 const [action,setAction]=useState<'corregir'|'anular'>('corregir');
 const [value,setValue]=useState(decimalSoles(payment.amount_cents));
 const [paidOn,setPaidOn]=useState(payment.paid_on);
 const [reason,setReason]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [accepted,setAccepted]=useState(false);
 const lock=useRef(false);
 const request=useRef<{token:string;id:string}|null>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[]);
 function invalidate(){setPreview(null);setAccepted(false);setError('');}
 function args(){return {p_payment:payment.id,p_action:action,p_amount:action==='corregir'?cents(value):null,p_paid_on:action==='corregir'?paidOn:null,p_reason:reason.trim()};}
 async function review(event:FormEvent){
  event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);onBusyChange(true);setError('');setPreview(null);setAccepted(false);
  try{
   const result=await supabase!.rpc('preview_payment_correction',args());
   if(result.error)throw Error(messageFor(result.error));
   if(loanHasDiscount && result.data?.discounts_supported!==true) throw Error('Actualización pendiente: aplica la migración 012 para corregir préstamos con descuento de interés.');
   const parsed=previewSchema.parse(result.data);setPreview(parsed);
   if(request.current?.token!==parsed.confirmation_token)request.current={token:parsed.confirmation_token,id:crypto.randomUUID()};
  }catch(cause){setError(cause instanceof z.ZodError?'No se pudo verificar la revisión de la corrección.':cause instanceof Error?cause.message:'No se pudo revisar la corrección.');}
  finally{lock.current=false;setBusy(false);onBusyChange(false);}
 }
 async function confirm(){
  if(!preview||!accepted||lock.current||!request.current)return;lock.current=true;setBusy(true);onBusyChange(true);setError('');
  try{
   const result=await supabase!.rpc('correct_payment',{...args(),p_request:request.current.id,p_confirmation_token:preview.confirmation_token});
   if(result.error)throw Error(messageFor(result.error));
   if(typeof result.data!=='string')throw Error('No se pudo confirmar el resultado. Puedes reintentar con la misma revisión.');
   onComplete();
  }catch(cause){const message=cause instanceof Error?cause.message:'No se pudo guardar la corrección.';setError(message);if(/datos cambiaron|ya fue anulado|ya no existe/.test(message)){setPreview(null);setAccepted(false);}}
  finally{lock.current=false;setBusy(false);onBusyChange(false);}
 }
 return <section className="mt-5 space-y-4 rounded-2xl border border-[var(--warning-border)] bg-[var(--surface)] p-4 sm:p-5" aria-label="Corregir pago registrado">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 ref={heading} tabIndex={-1} className="font-semibold">Corregir pago</h3><p className="mt-1 text-sm text-slate-500">Registro del {dateLabel(payment.paid_on)} · total cobrado {formatPEN(paymentReceived(payment))}</p></div><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar corrección</Button></div>
  <form onSubmit={review} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
   <label className="block">Tipo de corrección<select value={action} onChange={e=>{setAction(e.target.value as 'corregir'|'anular');invalidate();}}><option value="corregir">Corregir monto o fecha</option><option value="anular">Anular pago duplicado o equivocado</option></select></label>
   {action==='corregir'?<div className="grid gap-4 sm:grid-cols-2"><label>Monto aplicado al préstamo (S/)<input required type="number" min="0.01" step="0.01" inputMode="decimal" value={value} onChange={e=>{setValue(e.target.value);invalidate();}}/></label><label>Fecha correcta del pago<input required type="date" min={minDate} max={limaDate()} value={paidOn} onChange={e=>{setPaidOn(e.target.value);invalidate();}}/></label></div>:<p className="text-sm">Se anulará el registro de este cobro y se recalcularán la deuda y la caja. El original quedará archivado con el motivo de anulación.</p>}
   {(payment.penalty_cents??0)>0&&<p className="text-sm text-slate-500">Penalidad del recibo: {formatPEN(payment.penalty_cents!)}. Se conserva al corregir y se retira junto con el pago al anularlo.</p>}
   <label className="block">Motivo de la corrección<textarea required minLength={3} maxLength={300} value={reason} onChange={e=>{setReason(e.target.value);invalidate();}} placeholder="Por ejemplo: este pago se registró dos veces" rows={2}/></label>
   <p className="text-xs text-slate-500">Se recalculan los pagos y periodos afectados, conservando tasas, fechas de los contratos y el capital original. Solo confirma movimientos que se registraron por error.</p>
  </fieldset><Button type="submit" variant="outline" disabled={busy}>{busy?'Revisando…':'Revisar corrección'}</Button></form>
  {error&&<ErrorNotice message={error}/>}
  {preview&&<div className="space-y-4 border-t border-slate-200 pt-4" role="region" aria-label="Revisión de la corrección"><h4 className="font-semibold">{preview.full_name} · DNI {preview.dni}</h4><p className="text-sm">Pago actual: {formatPEN(paymentReceived(preview.before_payment))} del {dateLabel(preview.before_payment.paid_on)}. {preview.after_payment?`Pago corregido: ${formatPEN(paymentReceived(preview.after_payment))} del ${dateLabel(preview.after_payment.paid_on)}.`:"Resultado: pago anulado."}</p><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt>Saldo actual</dt><dd className="font-semibold">{cashMoney(preview.balance_before_cents)}</dd></div><div><dt>Saldo después de corregir</dt><dd className="font-semibold">{cashMoney(preview.balance_after_cents)}</dd></div><div><dt>Cambio en caja</dt><dd className="font-semibold">{cashMoney(preview.cash_delta_cents)}</dd></div><div><dt>Cambio en interés cobrado</dt><dd className="font-semibold">{cashMoney(preview.interest_delta_cents)}</dd></div><div><dt>Cambio en penalidades</dt><dd className="font-semibold">{cashMoney(preview.penalty_delta_cents)}</dd></div><div><dt>Estado resultante</dt><dd className="font-semibold">{preview.status_after==='activo'?'Activo':'Liquidado'}</dd></div></dl>
   <p className="text-xs text-slate-500">{preview.periods_count} periodo(s) revisado(s) · {preview.recalculated_payments} pago(s) recalculado(s). Un importe negativo en caja resta un ingreso registrado por error; no registra un retiro de dinero real. Corregir la fecha también puede cambiar el mes del cobro en los reportes.</p>
   <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 !h-5 !w-5" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>He revisado este pago, el motivo y los saldos resultantes.</span></label>
   <Button disabled={busy||!accepted} onClick={confirm}>{busy?'Guardando…':action==='anular'?'Confirmar anulación del pago':'Confirmar corrección del pago'}</Button>
  </div>}
 </section>;
}

const historySchema=z.array(z.object({id:z.string(),action:z.enum(['anular','corregir']),reason:z.string(),created_at:z.string(),before_payment:receipt,after_payment:receipt.nullable()}));
export function PaymentCorrectionHistory({loanId,revision}:{loanId:string;revision:string}){
 const [open,setOpen]=useState(false);const [rows,setRows]=useState<z.infer<typeof historySchema>>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!open)return;let active=true;
  async function load(){setLoading(true);try{
   const all:unknown[]=[];
   for(let offset=0;;offset+=1000){const result=await supabase!.from('payment_corrections').select('id,action,reason,created_at,before_payment,after_payment').eq('loan_id',loanId).order('created_at',{ascending:false}).order('id').range(offset,offset+999);if(result.error)throw Error(messageFor(result.error));all.push(...result.data);if(result.data.length<1000)break;}
   const data=historySchema.parse(all);if(active){setRows(data);setError('');}
  }catch(cause){if(active)setError(cause instanceof z.ZodError?'No se pudo verificar el historial de correcciones.':cause instanceof Error?cause.message:'No se pudo cargar el historial.');}finally{if(active)setLoading(false);}}
  void load();return()=>{active=false;};
 },[open,loanId,revision]);
 return <details className="mt-5 rounded-xl border border-slate-200 p-4" onToggle={e=>setOpen(e.currentTarget.open)}><summary className="min-h-11 cursor-pointer font-semibold text-sm">Correcciones anteriores</summary><div className="mt-3 space-y-3">{loading&&<p role="status" className="text-sm">Actualizando correcciones…</p>}{error&&<ErrorNotice message={error}/>}<DataTable caption="Auditoría de correcciones de pagos" headers={['Registro (Lima)','Acción','Pago original','Resultado','Motivo']} keys={rows.map(r=>r.id)} rows={rows.map(row=>[new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'}).format(new Date(row.created_at)),row.action==='anular'?'Anulado':'Corregido',`${dateLabel(row.before_payment.paid_on)} · ${formatPEN(paymentReceived(row.before_payment))}`,row.after_payment?`${dateLabel(row.after_payment.paid_on)} · ${formatPEN(paymentReceived(row.after_payment))}`:'No se cuenta como cobro',row.reason])} emptyTitle="Sin correcciones registradas" emptyDescription="Los originales y el motivo quedan archivados al confirmar una corrección."/></div></details>;
}
