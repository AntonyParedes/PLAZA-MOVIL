import type {Loan,Period,Installment} from './portal';
export function collectionStatus(loan:Loan,periods:Period[],installments:Installment[],today:string,moraAfterDays=7){
 const current=periods.find(p=>p.loan_id===loan.id&&p.is_current);
 const rows=installments.filter(i=>i.loan_id===loan.id&&i.is_current).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.number-b.number);
 const unpaid=rows.filter(i=>i.pending_cents>0);
 const overdue=unpaid.filter(i=>i.due_date<today);
 const daysLate=loan.status!=='liquidado'&&overdue.length?Math.floor((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${overdue[0].due_date}T00:00:00Z`))/86400000):0;
 const settled=loan.status==='liquidado';
 const next=settled?undefined:unpaid[0];
 const state=settled?'Liquidado':daysLate>0?(moraAfterDays!==undefined&&daysLate>=moraAfterDays?'En mora':'Atrasado'):'Puntual';
 return {state,daysLate,refinanced:periods.some(p=>p.loan_id===loan.id&&p.number>1),
  startDate:periods.find(p=>p.loan_id===loan.id&&p.number===1)?.start_date??null,
  balance:BigInt(loan.capital_pending)+BigInt(loan.interest_pending),
  nextDate:next?.due_date??null,weeklyCents:next?.scheduled_cents??(settled?0:rows[0]?.scheduled_cents??0),
  overdueCents:overdue.reduce((sum,row)=>sum+BigInt(row.pending_cents),0n),currentPeriod:current,
 };
}
export function weekdayLabel(date:string){return new Intl.DateTimeFormat('es-PE',{weekday:'long',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));}
