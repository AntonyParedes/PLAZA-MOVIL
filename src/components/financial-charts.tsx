"use client";
import type { CashSummary } from '@/lib/cash';
import { cashMoney } from '@/lib/cash';
import { chartPercent, financialOverview } from '@/lib/financial-overview';
import type { Loan, Payment } from '@/lib/portal';
import { formatPEN } from '@/lib/finance';
import { Card } from './ui/dashboard';

export default function FinancialCharts({summary,loans,payments}:{summary:CashSummary;loans:Loan[];payments:Payment[]}){
 const overview=financialOverview(loans,payments);
 const amounts=[{label:'Caja disponible',value:summary.balance_cents===null?null:BigInt(summary.balance_cents),color:'var(--chart-green)'},
  {label:'Capital por recuperar',value:overview.capitalPending,color:'var(--chart-gray)'},
  {label:'Ganancia cobrada',value:BigInt(summary.interest_cents),color:'var(--chart-purple)'}];
 const max=amounts.reduce((m,v)=>{const n=v.value===null?0n:v.value<0n?-v.value:v.value;return n>m?n:m;},0n);
 const maxInterest=overview.months.reduce((m,v)=>v.interest>m?v.interest:m,0n);
 return <section className="grid gap-4 xl:grid-cols-2" aria-label="Gráficos financieros de todo el historial">
  <Card><h3 className="font-semibold">Tu dinero, de un vistazo</h3><p className="mt-1 text-sm text-slate-500">Situación actual · toda la operación</p>
   <dl className="mt-6 space-y-5">{amounts.map(item=><div key={item.label}><div className="flex flex-wrap justify-between gap-2 text-sm"><dt>{item.label}</dt><dd className="font-semibold tabular-nums">{item.value===null?'Sin configurar':cashMoney(item.value.toString())}</dd></div><div aria-hidden="true" className="mt-2 h-3 overflow-hidden rounded-full bg-[var(--neutral-100)]"><div className="h-full rounded-full" style={{width:`${item.value===null?0:chartPercent(item.value,max)}%`,background:item.color}}/></div></div>)}</dl>
   <p className="mt-5 text-xs text-slate-500">Son conceptos distintos, no se suman entre sí. La ganancia ya está incluida en los pagos que entraron a caja.{summary.balance_cents?.startsWith('-')?' La caja es negativa: revisa sus movimientos.':''}</p>
  </Card>
  <Card><h3 className="font-semibold">Cómo ha crecido tu ganancia</h3><p className="mt-1 text-sm text-slate-500">Interés cobrado por mes · todo el historial</p>
   {overview.months.length===0?<p className="py-12 text-sm text-slate-500">Todavía no hay cobros registrados para graficar.</p>:<>
    <div className="mt-5 overflow-x-auto" role="region" aria-label="Evolución mensual del interés cobrado" tabIndex={0}>
     <div className="flex h-44 items-end gap-4 pb-1" style={{minWidth:Math.max(240,overview.months.length*88)}}>
      {overview.months.map(row=><div key={row.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2 text-center text-xs"><span className="whitespace-nowrap font-semibold tabular-nums">{formatPEN(row.interest)}</span><div aria-hidden="true" className="w-8 rounded-t-md bg-[var(--chart-purple)]" style={{height:`${chartPercent(row.interest,maxInterest)*.95}px`}}/><span>{new Intl.DateTimeFormat('es-PE',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(`${row.month}-01T00:00:00Z`))}</span></div>)}
     </div>
    </div>
    <details className="mt-4"><summary className="min-h-11 cursor-pointer text-sm font-medium">Ver detalle mensual</summary><div className="overflow-x-auto"><table className="w-full text-left text-xs" aria-label="Detalle mensual histórico"><thead><tr>{['Mes','Interés cobrado','Capital devuelto','Penalidades'].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{overview.months.map(row=><tr key={row.month}><th className="p-2">{row.month}</th><td className="p-2">{formatPEN(row.interest)}</td><td className="p-2">{formatPEN(row.capital)}</td><td className="p-2">{formatPEN(row.penalty)}</td></tr>)}</tbody></table></div></details>
   </>}
  </Card>
 </section>;
}
