# Correcciones de pagos

## Activación

1. En el proyecto existente de Supabase, abrir **SQL Editor → New query**.
2. Copiar el contenido completo de [202611040011_payment_corrections.sql](../supabase/migrations/202611040011_payment_corrections.sql) y pulsar **Run**. Requiere las migraciones previas, incluida 010 de penalidades. No volver a ejecutar las migraciones iniciales en una base que ya tiene datos.
3. Publicar la versión nueva en Vercel. La aplicación sigue usando la URL y clave publicable actuales; no necesita una clave administrativa en el navegador.

La migración crea la funcionalidad y su auditoría. **No anula ni corrige ningún pago por sí sola.** Si todavía no se aplicó, al intentar revisar una corrección la aplicación muestra un enlace al SQL pendiente.

## Uso

1. Entrar como administrador en **Panel general → abrir el préstamo → Pagos registrados**.
2. Pulsar **Corregir** junto al pago equivocado.
3. Elegir **Corregir monto o fecha** o **Anular pago duplicado o equivocado** y escribir el motivo.
4. Pulsar **Revisar corrección**. Se muestra el pago actual, el resultado propuesto, el saldo anterior y nuevo, los cambios en caja, interés y penalidades, y el estado resultante.
5. Marcar que se revisó el resultado y confirmar. Si otra operación cambió los datos, se exige una revisión nueva.
6. Consultar **Correcciones anteriores** para ver el original, el resultado y el motivo. Ese historial es administrativo; el perfil de consulta no puede corregir ni acceder al archivo completo.

Al introducir un pago con monto y fecha iguales a uno existente, aparece un aviso de posible duplicado. Un segundo cobro real del mismo importe y día sigue siendo posible con confirmación explícita; el sistema no anula nada automáticamente.

## Efectos contables

- El recibo original y los estados anteriores y posteriores quedan archivados en `payment_corrections` con autor, motivo y fecha. La aplicación no puede editar o borrar ese archivo.
- La anulación retira el recibo equivocado del libro de pagos vigente. Su original permanece en auditoría. La edición conserva el identificador del recibo y registra su versión anterior en auditoría.
- Se reconstruyen las distribuciones de interés/capital y las asignaciones de cuotas en orden de registro; la fecha de pago no reordena los recibos. Los pagos nuevos cuentan con un orden de registro explícito. Para los registros previos a esta migración se reconstruye por `created_at` e identificador en caso de empate.
- La corrección puede alcanzar pagos anteriores a una refinanciación: se recalcula el capital trasladado y el importe de cuotas posteriores. Se conservan capital original, tasa, fechas, plazos e interés contratado de cada periodo.
- La caja, ganancias, penalidades, gráficos y exportaciones consultan el libro vigente, de modo que dejan de sumar el cobro anulado y reflejan monto y fecha corregidos. Restar un ingreso duplicado no representa un retiro físico de dinero.
- La penalidad existente se conserva al editar monto/fecha y se retira si se anula el recibo completo. La edición no crea una penalidad nueva. Un pago con penalidad debe conservar una fecha posterior al vencimiento.
- Las correcciones se realizan en una sola transacción. Los reintentos con el mismo UUID no repiten el ajuste; tampoco se permite que una solicitud antigua de registro vuelva a crear un pago anulado.

## Conflictos que requieren revisar movimientos relacionados

No se alteran otras operaciones automáticamente para hacer encajar una corrección. La revisión explica el conflicto si:

- El nuevo resultado deja un cobro posterior superior a la deuda.
- Se retira el interés que permitió una refinanciación, sin que otros pagos del periodo lo cubran.
- El préstamo quedaría liquidado antes de una refinanciación que ya existe.
- La fecha corregida de un pago histórico queda después del registro de la refinanciación siguiente.
- Se reabriría un préstamo liquidado cuando el cliente ya tiene otro préstamo activo.
- Se detectan relaciones, cuotas o periodos inconsistentes.

En esos casos no se guarda ningún cambio. Es necesario revisar los movimientos implicados; no se cambia la regla de un préstamo activo por cliente ni se inventan intereses o pagos compensatorios.

## Verificación

Pruebas PostgreSQL locales cubren reconstrucción antes/después de refinanciar, capital e interés, caja, penalidades, permisos, revisiones antiguas, reintentos, solicitudes anuladas, migración repetible y rollback de todos los registros cuando falla la aplicación de cuotas. La auditoría RLS incluye once tablas y veinte funciones; las nuevas escrituras son exclusivas del administrador mediante RPC. Las pruebas de navegador cubren el flujo de revisión/confirmación, anulación, edición, auditoría, perfil de consulta, detección de posibles duplicados y pérdida de respuesta.

Las pruebas usan datos simulados. La activación en el proyecto Supabase real corresponde al paso SQL indicado arriba; no se han modificado pagos reales durante el desarrollo.

## Cancelaciones anticipadas con descuento

Después de la migración de cancelación anticipada (`202611100005_early_settlement.sql`), aplicar `202611100012_integrate_early_settlement.sql` una vez. La 012 conserva y recalcula las asignaciones de descuento separadas del efectivo, e incluye ambos estados en la auditoría. Anular esa cancelación restituye capital e interés pendientes, sujeto a las mismas restricciones de préstamos activos y refinanciaciones. Corregir un abono anterior se rechaza si vuelve inconsistente una cancelación posterior. La interfaz exige esta compatibilidad antes de confirmar correcciones en préstamos que tienen descuentos. No repetir la 005 ya aplicada. La instalación de la 012 no modifica recibos ni saldos existentes.
