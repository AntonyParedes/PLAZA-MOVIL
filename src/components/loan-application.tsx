"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Customer } from "@/lib/portal";
import { dateLabel, limaDate } from "@/lib/portal";
import { cents, formatPEN, monthlyRateForCapital, scheduleLoan } from "@/lib/finance";
import { Button } from "./ui/button";
import { Notice, SectionHeading } from "./ui/dashboard";

type Proposal = ReturnType<typeof scheduleLoan>;
export default function LoanApplication({ clients, activeLoans, busy, loading, initialBorrowerId, onSubmit, onClients, onOpenLoan, onCancel, submissionError, onClearError }: {
 clients: Customer[];
 activeLoans: { id: string; client_id: string }[];
 busy: boolean;
 loading: boolean;
 initialBorrowerId?: string;
 onSubmit: (client: Customer, proposal: Proposal) => Promise<boolean>;
 onClients: (query?: string) => void;
 submissionError?: string;
 onClearError: () => void;
 onOpenLoan: (id: string) => void;
 onCancel: () => void;
}) {
 const [borrowerId,setBorrowerId]=useState(initialBorrowerId ?? "");
 const [query,setQuery]=useState("");
 const [amount,setAmount]=useState("");
 const [months,setMonths]=useState<1|2>(1);
 const [start,setStart]=useState(limaDate);
 const [proposal,setProposal]=useState<Proposal|null>(null);
 const [error,setError]=useState("");
 const reviewHeading=useRef<HTMLHeadingElement>(null);
 const borrower=clients.find(c=>c.id===borrowerId);
 const active=activeLoans.find(l=>l.client_id===borrowerId);
 const identified=Boolean(borrower?.stand_code&&borrower.member_type);
 const eligible=Boolean(borrower&&identified&&!active);
 const options=clients.filter(c=>c.id===borrowerId||`${c.full_name} ${c.dni} ${c.stand_code??""}`.toLowerCase().includes(query.trim().toLowerCase()));
 let rate:number|null=null;
 try{rate=monthlyRateForCapital(cents(amount));}catch{/* Explain input at review. */}
 function prepare(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError("");onClearError();
  try{
   if(!eligible)throw Error("Selecciona un cliente identificado sin préstamo activo.");
   const next=scheduleLoan(cents(amount),monthlyRateForCapital(cents(amount)),months,start);
   setProposal(next);
   requestAnimationFrame(()=>reviewHeading.current?.focus());
  }catch(cause){setError(cause instanceof Error?cause.message:"Revisa los datos del préstamo.");}
 }
 async function confirm(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!borrower||!proposal||!eligible||busy||loading)return;
  await onSubmit(borrower,proposal);
 }
 return <div className="space-y-6">
  <SectionHeading title="Preparar préstamo" description="Primero elige a la persona; después revisa las condiciones y confirma." action={<Button variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button>}/>
  <ol className="workflow-steps" aria-label="Pasos del préstamo">
   {["Persona","Condiciones","Revisión"].map((label,index)=><li key={label} aria-current={index===(proposal?2:eligible?1:0)?"step":undefined}><span aria-hidden="true">{index+1}</span>{label}</li>)}
  </ol>
  <section aria-label="Persona que solicita el préstamo" className="space-y-4">
   <h3 className="font-semibold">1. ¿Quién solicita el préstamo?</h3>
   <div className="grid gap-4 sm:grid-cols-2">
    <label>Buscar prestatario<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre, DNI o stand" disabled={busy}/></label>
    <label>Cliente<select name="client" value={borrowerId} required disabled={busy||loading} onChange={e=>{if(e.target.value!==borrowerId){setBorrowerId(e.target.value);setProposal(null);setError("");onClearError();}}}>
     <option value="">Selecciona a la persona</option>
     {options.map(c=>{const blocked=activeLoans.some(l=>l.client_id===c.id)?"Ya tiene préstamo activo":!c.stand_code||!c.member_type?"Completa su identificación":"";return <option key={c.id} value={c.id} disabled={Boolean(blocked)}>{c.full_name} · DNI {c.dni} · stand {c.stand_code??"por registrar"}{blocked?` · ${blocked}`:""}</option>;})}
    </select></label>
   </div>
   {borrower&&<div className="workflow-person rounded-xl bg-[var(--accent-soft)] p-4 text-sm"><strong className="block text-base">{borrower.full_name}</strong><p className="mt-1">DNI {borrower.dni} · Stand {borrower.stand_code??"por registrar"} · {borrower.member_type??"Condición por registrar"}</p></div>}
   {!eligible&&borrower&&<Notice error>{active?"Esta persona ya tiene un préstamo activo. Abre su cuenta para cobrar o refinanciar.":"Completa el stand y la condición del cliente antes de prestar."}</Notice>}
   <div className="flex flex-wrap items-center gap-3 text-sm">
    {active&&<Button type="button" variant="outline" onClick={()=>onOpenLoan(active.id)}>Ver préstamo actual</Button>}
    <Button type="button" variant="outline" disabled={busy} onClick={()=>onClients(borrower?.dni??query)}>{borrower&&!identified?"Completar datos en Clientes":"Ir a Clientes"}</Button>
    <p className="text-xs text-slate-500">Si no aparece, búscalo por DNI o revisa su identificación y préstamo activo.</p>
   </div>
  </section>
  <form onSubmit={prepare} className="space-y-4">
   <fieldset disabled={!eligible||busy||loading} className="grid gap-4 sm:grid-cols-2">
    <legend className="mb-4 font-semibold">2. Define las condiciones</legend>
    <label>Monto del préstamo (S/)<input type="number" min="0.01" step="0.01" inputMode="decimal" required value={amount} onChange={e=>{setAmount(e.target.value);setProposal(null);onClearError();}} placeholder="Ej. 1500.00"/></label>
    <label>Plazo del préstamo<select aria-label="Plazo del préstamo" value={months} onChange={e=>{setMonths(Number(e.target.value) as 1|2);setProposal(null);onClearError();}}><option value="1">1 mes · 4 cuotas semanales</option><option value="2">2 meses · 8 cuotas semanales</option></select></label>
    <label>Fecha del préstamo<input type="date" max={limaDate()} value={start} required onChange={e=>{setStart(e.target.value);setProposal(null);onClearError();}}/></label>
    <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700" role="status">Tasa mensual: <strong>{rate===null?"Ingresa el monto":`${rate/100} %`}</strong><p className="mt-1 text-xs">Hasta S/500: 7 % mensual. Más de S/500: 6 % mensual.</p></div>
   </fieldset>
   {!eligible&&<p className="text-sm text-slate-500">Elige primero a la persona para continuar.</p>}
   {error&&<Notice error>{error}</Notice>}
   <Button type="submit" variant="outline" disabled={!eligible||busy||loading}>Revisar cronograma</Button>
  </form>
  {proposal&&<section aria-label="Revisión del préstamo" className="space-y-4 border-t border-slate-100 pt-5">
   <h3 ref={reviewHeading} tabIndex={-1} className="font-semibold">3. Revisa y confirma</h3>
   <div className="rounded-xl bg-blue-50 p-4 text-sm leading-7"><strong className="block">{borrower?.full_name} · DNI {borrower?.dni}</strong><p>Capital: {formatPEN(proposal.originalCapital)} · Interés: {formatPEN(proposal.interestCents)} · Total: <strong>{formatPEN(proposal.totalCents)}</strong></p><p>{months===1?"4":"8"} cuotas semanales · Primera cuota: {dateLabel(proposal.installments[0].dueDate)}</p></div>
   <ul className="grid gap-2 sm:grid-cols-2">{proposal.installments.map(i=><li key={i.number} className="rounded-xl bg-slate-50 p-3 text-sm">Cuota {i.number} · {dateLabel(i.dueDate)} · {formatPEN(i.scheduledCents)}</li>)}</ul>
   {!eligible&&<Notice error>El cliente dejó de estar disponible para un nuevo préstamo. Revisa su cuenta antes de continuar.</Notice>}
   {submissionError&&<Notice error>{submissionError}</Notice>}
   <form onSubmit={confirm}><Button type="submit" disabled={busy||loading||!eligible}>{busy?"Registrando…":"Confirmar desembolso"}</Button></form>
  </section>}
 </div>;
}
