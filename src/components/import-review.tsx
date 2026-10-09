'use client';
import {useState,type ChangeEvent} from 'react';
import {importColumns,reviewImportRows,headerName,type ReviewRow} from '@/lib/import-review';
import {Button} from '@/components/ui/button';
import {downloadCSV} from '@/lib/portal';
export default function ImportReview(){
 const [rows,setRows]=useState<(ReviewRow&{sheet:string})[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function inspect(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];if(!file)return;setRows([]);setError('');
  if(file.size>2*1024*1024){setError('El archivo supera 2 MB. Divide el libro para revisarlo.');return;}
  setBusy(true);
  try{
   const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();
   await book.xlsx.load(await file.arrayBuffer());
   const all:(ReviewRow&{sheet:string})[]=[];
   const seen=new Set<string>();
   if(!book.worksheets.length)throw new Error('El libro no contiene hojas.');
   for(const sheet of book.worksheets){
    if(sheet.rowCount>5001||sheet.columnCount>30)throw new Error('Cada hoja admite hasta 5000 registros y 30 columnas.');
    const headers:Record<number,string>={};
    sheet.getRow(1).eachCell((cell,col)=>{headers[col]=headerName(cell.text);});
    const missing=importColumns.filter(name=>!Object.values(headers).includes(name));
    if(missing.length)throw new Error(`Hoja ${sheet.name}: faltan columnas ${missing.join(', ')}. Adapta una copia del archivo a la plantilla.`);
    const input:Record<string,string>[]=[];const formulas=new Set<number>();
    for(let row=2;row<=sheet.rowCount;row++){
     const values:Record<string,string>={};let hasValue=false;
     for(const [col,name] of Object.entries(headers)){
      const cell=sheet.getRow(row).getCell(Number(col));let value=cell.value;
      if(value&&typeof value==='object'&&('formula'in value||'sharedFormula'in value)){
       formulas.add(row);value=value.result??null;
      }
      if(value&&typeof value==='object'&&'error'in value)values[name]=`ERROR ${value.error}`;
      else if(value instanceof Date)values[name]=value.toISOString().slice(0,10);
      else if(value&&typeof value==='object'&&'richText'in value)values[name]=value.richText.map(part=>part.text).join('');
      else if(value&&typeof value==='object'&&'text'in value)values[name]=value.text;
      else values[name]=value==null?'':String(value);
      if(values[name].trim())hasValue=true;
     }
     if(hasValue){values.__original_row=String(row);input.push(values);}
    }
    for(const item of reviewImportRows(input)){
     const row=Number(item.values.__original_row);item.row=row;
     if(formulas.has(row))item.warnings.push('Contiene fórmulas: revisar en Excel; se leyó el resultado almacenado, no se recalculó.');
     const dni=item.values.dni?.trim();if(dni&&seen.has(dni))item.errors.push('DNI repetido entre hojas o registros.');if(dni)seen.add(dni);
     all.push({...item,sheet:sheet.name});
    }
   }
   setRows(all);
  }catch(e){setError(e instanceof Error?e.message:'No fue posible abrir el archivo XLSX.');}
  finally{setBusy(false);event.target.value='';}
 }
 return <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-bold">Revisar importación de Excel</h2><p className="text-sm leading-6 text-slate-600">El archivo se revisa en tu navegador. No se envía ni se escribe en la base de datos. La importación definitiva requiere consolidar clientes, préstamos y sus historiales.</p><p className="text-xs leading-6 text-slate-500">Columnas de la plantilla: {importColumns.join(', ')}. Montos en soles, fecha AAAA-MM-DD y tasa mensual. Saldo_total es opcional.</p><Button variant="outline" onClick={()=>downloadCSV('plantilla-prestamos.csv',[[...importColumns,'saldo_total']])}>Descargar encabezados CSV</Button><label className="block">Seleccionar PRESTAMOS - PM.xlsx<input type="file" accept=".xlsx" disabled={busy} onChange={inspect}/></label>{busy&&<p role="status">Revisando libro…</p>}{error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}{rows.length>0&&<><p className="text-sm">{rows.length} registros · {rows.filter(r=>r.errors.length).length} con errores · {rows.filter(r=>r.warnings.length).length} con advertencias</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Hoja / fila','Cliente','DNI','Resultado'].map(t=><th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={`${r.sheet}:${r.row}`} className="border-t"><td className="p-3">{r.sheet} / {r.row}</td><td className="p-3">{r.values.cliente}</td><td className="p-3">{r.values.dni}</td><td className="p-3">{r.errors.map((e,i)=><p key={i} className="text-red-700">{e}</p>)}{r.warnings.map((e,i)=><p key={i} className="text-amber-700">{e}</p>)}{!r.errors.length&&!r.warnings.length&&<span className="text-teal-700">Campos consistentes; pendiente revisión de historial.</span>}</td></tr>)}</tbody></table></div></>}</section>;
}
