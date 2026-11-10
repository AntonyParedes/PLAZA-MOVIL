"use client";

import {useEffect,useId,useRef,useState} from 'react';
import {capitalRecovery,chartPercent,financialOverview,interestTimeline} from '@/lib/financial-overview';
import type {Loan,Payment} from '@/lib/portal';
import {formatPEN} from '@/lib/finance';

export default function FinancialCharts({loans,payments,today}:{loans:Loan[];payments:Payment[];today:string}){
 const recovery=capitalRecovery(loans,payments);
 const overview=financialOverview(loans,payments);
 const timeline=interestTimeline(overview.months,today);
 const [mode,setMode]=useState<'monthly'|'cumulative'>('monthly');
 const [year,setYear]=useState('all');
 const years=[...new Set(timeline.map(row=>row.month.slice(0,4)))].reverse();
 const selectedYear=years.includes(year)?year:'all';
 const rows=timeline.filter(row=>selectedYear==='all'||row.month.startsWith(selectedYear));
 const values=rows.map(row=>mode==='monthly'?row.interest:row.accumulated);
 const max=values.reduce((m,v)=>v>m?v:m,0n);
 const plotRef=useRef<HTMLDivElement>(null);
 const [availableWidth,setAvailableWidth]=useState(320);
 const titleId=useId(),descriptionId=useId();
 useEffect(()=>{
  const element=plotRef.current;if(!element)return;
  const observer=new ResizeObserver(entries=>{const width=Math.floor(entries[0].contentRect.width);if(width>0)setAvailableWidth(width);});
  observer.observe(element);return()=>observer.disconnect();
 },[]);
 const cellWidth=Math.max(84,...values.map(v=>formatPEN(v).length*7));
 const width=Math.max(availableWidth,rows.length*cellWidth+24);
 const baseline=176,range=128;
 const coordinates=values.map((value,index)=>({x:12+(index+.5)*(width-24)/Math.max(1,values.length),y:baseline-chartPercent(value,max)/100*range,value}));
 const points=coordinates.map(p=>`${p.x},${p.y}`).join(' ');
 const monthLabel=(month:string)=>new Intl.DateTimeFormat('es-PE',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`));
 return <section className="home-charts" aria-label="Gráficos financieros de todo el historial">
  <section className="home-capital" aria-labelledby="capital-recovery-title">
   <header className="home-chart-heading"><div><h3 id="capital-recovery-title">Recuperación de capital</h3><p>¿Cuánto del dinero prestado ya volvió?</p></div>{recovery.reconciled&&<span className="home-percentage">{Math.round(chartPercent(recovery.returned,recovery.disbursed))} %</span>}</header>
   <p className="home-capital-total">{formatPEN(recovery.disbursed)} <small>entregados en préstamos</small></p>
   {recovery.disbursed===0n?<p className="home-chart-note">Todavía no hay préstamos registrados.</p>:<>
    {recovery.reconciled&&<div className="home-capital-track" role="img" aria-label={`Capital devuelto: ${formatPEN(recovery.returned)}. Capital pendiente: ${formatPEN(recovery.pending)}.`}><span style={{width:`${chartPercent(recovery.returned,recovery.disbursed)}%`}}/></div>}
    <dl className="home-capital-legend"><div><dt><span className="home-key home-key-returned"/>Devuelto</dt><dd>{formatPEN(recovery.returned)}</dd></div><div><dt><span className="home-key home-key-pending"/>Por recuperar</dt><dd>{recovery.reconciled?`${Math.round(chartPercent(recovery.pending,recovery.disbursed))} %`:formatPEN(recovery.pending)}</dd></div></dl>
    <p className="home-chart-note">{recovery.reconciled?'Refinanciar no cuenta como otro desembolso. Porcentajes redondeados.':'Los importes de capital no concilian todavía. Actualiza los datos y revisa los registros antes de interpretar una proporción.'}</p>
   </>}
  </section>
  <section className="home-interest" aria-labelledby="interest-evolution-title">
   <header className="home-chart-heading"><div><h3 id="interest-evolution-title">Interés cobrado</h3><p>{mode==='monthly'?'Cada barra representa un mes.':'Interés acumulado desde el primer cobro.'}</p></div><div className="home-chart-mode" role="group" aria-label="Vista del gráfico"><button type="button" aria-pressed={mode==='monthly'} onClick={()=>setMode('monthly')}>Por mes</button><button type="button" aria-pressed={mode==='cumulative'} onClick={()=>setMode('cumulative')}>Acumulado</button></div></header>
   {years.length>1&&<label className="home-year">Año del gráfico<select value={selectedYear} onChange={e=>setYear(e.target.value)}><option value="all">Todo el historial</option>{years.map(y=><option key={y}>{y}</option>)}</select></label>}
   <div ref={plotRef} className="home-chart-scroll" role="region" aria-label="Evolución mensual del interés cobrado" tabIndex={0}>
    {rows.length===0?<p className="home-chart-empty">Todavía no hay cobros registrados para graficar.</p>:<svg width={width} height={222} viewBox={`0 0 ${width} 222`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
     <title id={titleId}>{mode==='monthly'?'Interés cobrado por mes':'Interés acumulado'}: barras y línea de evolución</title><desc id={descriptionId}>La línea conecta el importe de cada barra en la misma escala de soles, sin pronosticar cobros. Consulta los importes exactos en la tabla mensual.</desc>
     {[baseline,baseline-range/2,baseline-range].map(y=><line key={y} x1="0" y1={y} x2={width} y2={y} className="home-chart-grid"/>)}
     {coordinates.map((p,index)=><rect key={rows[index].month} x={p.x-15} y={p.y} width="30" height={baseline-p.y} rx="3" className="home-interest-bar"><title>{rows[index].month}: {formatPEN(p.value)}</title></rect>)}
     <polyline data-testid="interest-trend-line" points={points} fill="none" className="home-trend-line"/>
     {coordinates.map((p,index)=><g key={rows[index].month}><circle cx={p.x} cy={p.y} r="4" className="home-trend-point"/><text x={p.x} y={p.y-14} textAnchor="middle" className="home-chart-amount">{formatPEN(p.value)}</text><text x={p.x} y="204" textAnchor="middle" className="home-chart-month">{monthLabel(rows[index].month)}{rows[index].month===today.slice(0,7)?'*':''}</text></g>)}
    </svg>}
   </div>
   {rows.length>0&&<><p className="home-chart-note home-line-caption"><span className="home-line-key"/>Línea: evolución del importe. {rows.some(row=>row.month===today.slice(0,7))?'* Mes en curso. ':''}{rows.length===1?'La línea se extenderá cuando haya más meses.':''}</p><details className="home-monthly-detail"><summary>Ver detalle mensual</summary><div className="home-chart-scroll"><table aria-label="Detalle mensual histórico"><thead><tr>{['Mes','Interés cobrado','Acumulado','Capital devuelto','Penalidades'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.month}><th scope="row">{row.month}</th><td>{formatPEN(row.interest)}</td><td>{formatPEN(row.accumulated)}</td><td>{formatPEN(row.capital)}</td><td>{formatPEN(row.penalty)}</td></tr>)}</tbody></table></div></details></>}
  </section>
 </section>;
}
