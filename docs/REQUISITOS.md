# PM Créditos: reglas aprobadas y verificación

## Contrato financiero aprobado por el usuario

- PEN, importes enteros en céntimos, zona America/Lima.
- Productos autorizados por la última aclaración: S/500 al 7 % mensual por un mes (S/35 de interés); S/1.000 al 6 % mensual por un mes (S/60); S/1.000 al 6 % mensual por dos meses (S/120). La tasa es **mensual** y el interés inicial se multiplica por los meses del contrato. Esta aclaración reemplaza la interpretación anterior de tasa para todo el plazo.
- Un mes equivale a cuatro semanas: cuatro u ocho cuotas, primera a los siete días. Los feriados no cambian vencimientos.
- Interés sobre capital original, también al refinanciar. Nunca sobre saldo ni sobre intereses.
- Redondeo de interés al céntimo más cercano, mitades hacia arriba. Céntimos sobrantes repartidos de uno en uno en las últimas cuotas.
- Pagos primero a interés pendiente, luego a capital; adelantos no reducen interés. El pago se distribuye por orden de cuotas y se conserva su vencimiento original.
- Cuotas impagas se acumulan para cobro sin mover la fecha final contractual.
- Un préstamo activo por cliente; otro solo después de liquidarlo.
- Refinanciación bloqueada mientras haya intereses pendientes o cuotas vencidas pendientes.
- Refinanciación: nuevo periodo de cuatro semanas empieza en la fecha de pago que cancela íntegramente el interés anterior. Se mantiene la tasa numérica anterior y se calcula sobre capital original. El capital pendiente se traslada sin capitalizar interés ni duplicar deuda.
- El cronograma anterior se conserva como histórico; sus pendientes no se suman al cronograma vigente.
- **Los pagos no se anulan ni eliminan**, según la última decisión del usuario, que reemplaza la regla inicial de anulaciones con motivo.
- El préstamo no se cancela ni se elimina: solo se liquida o refinancia. No se alteran capital original, tasa ni plazos ya registrados.
- Administrador registra/modifica clientes y opera. Jefe consulta. Roles asignados por responsable del proyecto, sin autoservicio.
- WhatsApp manual, sin envío automático. Excel se previsualiza y valida sin escribir a producción.

El administrador elige explícitamente uno de los tres productos. No se permiten combinaciones arbitrarias ni préstamos al 0 % desde la interfaz o las RPC SQL. Sobrepagos se rechazan: falta definir el tratamiento de excedentes antes de admitirlos. El acceso inicial utiliza correo como identificador de usuario en Supabase Auth.

## Modelo implementado

`profiles`, `clients`, `audit_events`, `loans`, `loan_periods`, `installments`, `payments`, `payment_installments` y vista `installment_balances`. No existe tabla ni función de anulaciones.

RPC `create_loan`, `record_payment`, `refinance_loan`: transacciones atómicas, bloqueo del préstamo/cliente y claves UUID de idempotencia. No hay permisos de escritura financiera directa para usuarios autenticados. Las consultas y vistas respetan RLS. Auditoría registra usuario, operación, entidad y hora, sin duplicar datos personales.

## Verificaciones y pendientes externos

Las pruebas locales verifican cálculos, redondeo, fechas, cuotas, refinanciación, pagos, liquidación, RLS, idempotencia y rollback de operaciones inválidas en PostgreSQL con Auth simulado. Esto no verifica la infraestructura real de Supabase ni la concurrencia entre conexiones independientes.

Falta crear proyecto Supabase, aplicar ambas migraciones, asignar usuarios/roles y validar el flujo completo con Auth/PostgREST reales. La integración, las pruebas reales de concurrencia, los respaldos y el despliegue Vercel siguen pendientes.

No se recibió PRESTAMOS - PM.xlsx. Se preparó revisión XLSX mediante columnas documentadas; la adaptación de sus hojas y fórmulas al archivo original queda pendiente. No hay importación automática de datos históricos ni generación ficticia de pagos para cuadrar saldos.

No se declara apto para operaciones reales antes de completar la validación de integración y las decisiones pendientes.
