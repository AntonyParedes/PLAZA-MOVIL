import {test} from 'node:test';
import assert from 'node:assert/strict';
import {limaDate,weekBounds,csvContent} from '../src/lib/portal';
import {reviewImportRows} from '../src/lib/import-review';
test('fechas de Lima y semana de lunes a domingo',()=>{
 assert.equal(limaDate(new Date('2026-10-10T03:00:00Z')),'2026-10-09');
 assert.deepEqual(weekBounds('2026-10-11'),{start:'2026-10-05',end:'2026-10-11'});
});
test('CSV escapa comillas y neutraliza fórmulas en texto de clientes',()=>{
 const csv=csvContent([['=SUM(1,2)','  +CMD','Nombre "real"',100]]);
 assert.ok(csv.includes('"\'=SUM(1,2)"'));
 assert.ok(csv.includes('"\'  +CMD"'));
 assert.ok(csv.includes('"Nombre ""real"""'));
 assert.ok(csv.endsWith('"100"'));
});
test('revisión de Excel detecta duplicados, faltantes y saldos inconsistentes',()=>{
 const good={cliente:'Cliente',dni:'12345678',capital_original:'1000',capital_pendiente:'810',interes_pendiente:'0',fecha_prestamo:'2026-10-09',tasa_mensual_porcentaje:'6',plazo_meses:'1',saldo_total:'810'};
 assert.equal(reviewImportRows([good])[0].errors.length,0);
 const rows=reviewImportRows([good,{...good,capital_pendiente:'1001',interes_pendiente:'70',saldo_total:'800'}, {...good,dni:'',fecha_prestamo:'2026-02-30'}]);
 assert.ok(rows[1].errors.some(e=>e.includes('repetido')));
 assert.ok(rows[1].errors.some(e=>e.includes('Capital pendiente')));
 assert.ok(rows[1].errors.some(e=>e.includes('Interés pendiente')));
 assert.ok(rows[1].errors.some(e=>e.includes('inconsistente')));
 assert.ok(rows[2].errors.some(e=>e.includes('Falta dni')));
 assert.ok(rows[2].errors.some(e=>e.includes('fecha')));
});
