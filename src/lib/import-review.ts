import { cents, interest, requireApprovedProduct, scheduleLoan } from '@/lib/finance';
export const importColumns=['cliente','dni','capital_original','capital_pendiente','interes_pendiente','fecha_prestamo','tasa_mensual_porcentaje','plazo_meses'] as const;
export type ReviewRow={row:number;values:Record<string,string>;errors:string[];warnings:string[]};
export function reviewImportRows(input:Record<string,string>[]):ReviewRow[]{
 const seen=new Set<string>();
 return input.map((values,index)=>{
  const errors:string[]=[];const warnings:string[]=[];
  for(const name of importColumns)if(!values[name]?.trim())errors.push(`Falta ${name}.`);
  const dni=values.dni?.trim()??'';
  if(!/^\d{8}$/.test(dni))errors.push('DNI: requiere 8 dígitos; conservar ceros iniciales.');
  if(seen.has(dni))errors.push('DNI repetido: revisar cliente y préstamos activos antes de consolidar.');
  if(dni)seen.add(dni);
  try{
   const original=cents(values.capital_original??'');const pending=cents(values.capital_pendiente??'');const pendingInterest=cents(values.interes_pendiente??'');const rate=cents(values.tasa_mensual_porcentaje??'');
   const months=Number(values.plazo_meses);
   if(months!==1&&months!==2)throw new Error('El plazo debe ser 1 o 2 meses.');
   requireApprovedProduct(original,rate,months);
   scheduleLoan(original,rate,months,values.fecha_prestamo??'');
   if(pending>original)errors.push('Capital pendiente superior al original.');
   if(pendingInterest>interest(original,rate,months))errors.push('Interés pendiente superior al interés del periodo.');
   if(values.saldo_total&&cents(values.saldo_total)!==pending+pendingInterest)errors.push('Saldo total inconsistente con capital e interés pendientes.');
   if(pending===0&&pendingInterest>0)warnings.push('Capital pagado con interés pendiente: revisar historial de distribución de pagos.');
  }catch(e){errors.push(e instanceof Error?e.message:'Monto o fecha inválidos.');}
  return {row:index+2,values,errors,warnings};
 });
}
export function headerName(text:string){return text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');}
