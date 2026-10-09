export type Loan = { id: string; client_id: string; original_capital: number; capital_pending: number; interest_pending: number; rate_basis_points: number; status: 'activo' | 'liquidado'; created_at: string };
export type Period = { id: string; loan_id: string; number: number; start_date: string; end_date: string; months: number; opening_capital: number; interest_generated: number; interest_settled_on: string | null; is_current: boolean };
export type Payment = { id: string; loan_id: string; period_id: string; amount_cents: number; interest_cents: number; capital_cents: number; paid_on: string; created_at: string };
export type Installment = { id: string; period_id: string; loan_id: string; number: number; due_date: string; scheduled_cents: number; paid_cents: number; pending_cents: number; is_current: boolean; status: string };
export type Customer = { id: string; full_name: string; dni: string; phone: string; stand_code: string | null; member_type: 'socio' | 'trabajador' | null };
export function limaDate(now = new Date()): string {
 const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Lima', year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
export function addDays(date:string,days:number):string {
 const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
export function weekBounds(today:string) {
 const day=new Date(`${today}T00:00:00Z`).getUTCDay();
 const start=addDays(today,-((day+6)%7)); return {start,end:addDays(start,6)};
}
export function dateLabel(date:string) { return new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${date}T00:00:00Z`)); }
export function csvContent(rows: (string|number)[][]):string {
 // Prevent spreadsheet formulas from user-controlled strings, including leading whitespace.
 return '\uFEFF'+rows.map(row=>row.map(cell=>{
  let value=String(cell);
  if(typeof cell==='string' && /^[\s]*[=+@-]/.test(value))value="'"+value;
  return '"'+value.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n');
}
export function downloadCSV(filename:string,rows:(string|number)[][]) {
 const url=URL.createObjectURL(new Blob([csvContent(rows)],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);
}
