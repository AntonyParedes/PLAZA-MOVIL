import type { Loan, Payment } from './portal';

/** All recorded payments, grouped by payment date, never by creation date or loan period. */
export function financialOverview(loans: Loan[], payments: Payment[]) {
 const capitalPending=loans.reduce((sum,l)=>sum+BigInt(l.capital_pending),0n);
 const months=new Map<string,{interest:bigint;capital:bigint;penalty:bigint}>();
 for(const p of payments){
  const key=p.paid_on.slice(0,7);
  const value=months.get(key)??{interest:0n,capital:0n,penalty:0n};
  value.interest+=BigInt(p.interest_cents);value.capital+=BigInt(p.capital_cents);value.penalty+=BigInt(p.penalty_cents??0);
  months.set(key,value);
 }
 return {capitalPending,months:[...months].sort(([a],[b])=>a.localeCompare(b)).map(([month,values])=>({month,...values}))};
}
/** Bounded ratios only for drawing; original cents remain intact for all labels. */
export function chartPercent(value:bigint,max:bigint){return max>0n?Number((value<0n?-value:value)*10000n/max)/100:0;}
