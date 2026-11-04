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

/** Capital is counted once per original loan; refinancing periods are not disbursements. */
export function capitalRecovery(loans: Loan[], payments: Payment[]) {
 const disbursed=loans.reduce((sum,l)=>sum+BigInt(l.original_capital),0n);
 const pending=loans.reduce((sum,l)=>sum+BigInt(l.capital_pending),0n);
 const returned=payments.reduce((sum,p)=>sum+BigInt(p.capital_cents),0n);
 return {disbursed,pending,returned,reconciled:disbursed>0n&&returned+pending===disbursed&&pending>=0n&&returned>=0n};
}

/** Include zero-payment calendar months so the line never skips a month silently. */
export function interestTimeline(months: ReturnType<typeof financialOverview>["months"], today: string) {
 if(!months.length)return [];
 const byMonth=new Map(months.map(row=>[row.month,row]));
 const last=[today.slice(0,7),...byMonth.keys()].sort().at(-1)!;
 const rows=[];let accumulated=0n;
 let month=[...byMonth.keys()].sort()[0];
 while(month<=last){
  const row=byMonth.get(month)??{month,interest:0n,capital:0n,penalty:0n};
  accumulated+=row.interest;rows.push({...row,accumulated});
  const [year,number]=month.split('-').map(Number);
  month=number===12?`${year+1}-01`:`${year}-${String(number+1).padStart(2,'0')}`;
 }
 return rows;
}
