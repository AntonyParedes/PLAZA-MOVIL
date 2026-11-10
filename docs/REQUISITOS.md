# PM Créditos: reglas aprobadas y verificación

## Contrato financiero aprobado por el usuario

- PEN, importes enteros en céntimos, zona America/Lima.
- Desde el 15/10/2026 el administrador ingresa un monto positivo con hasta dos decimales. Hasta S/500 inclusive corresponde 7 % mensual; por encima de S/500, 6 % mensual. Todos los montos admiten uno o dos meses (cuatro u ocho cuotas). La tasa se calcula automáticamente y se valida en SQL. Interés inicial = capital original × tasa mensual × meses, redondeado al céntimo. Ejemplo S/1.500 por dos meses: interés S/180, total S/1.680, ocho cuotas de S/210.
- Un mes equivale a cuatro semanas: cuatro u ocho cuotas, primera a los siete días. Los feriados no cambian vencimientos.
- Interés sobre capital original, también al refinanciar. Nunca sobre saldo ni sobre intereses.
- Redondeo de interés al céntimo más cercano, mitades hacia arriba. Céntimos sobrantes repartidos de uno en uno en las últimas cuotas.
- Pagos primero a interés pendiente, luego a capital; adelantos no reducen interés. El pago se distribuye por orden de cuotas y se conserva su vencimiento original.
- Cuotas impagas se acumulan para cobro sin mover la fecha final contractual.
- Un préstamo activo por cliente; otro solo después de liquidarlo.
- Refinanciación autorizada solo después del vencimiento del periodo vigente y con el interés generado completamente pagado. Las cuotas vencidas pendientes no bloquean la operación (actualización aprobada el 14/10/2026).
- Refinanciación: el administrador elige fecha y plazo de uno o dos meses (cuatro u ocho cuotas). La fecha debe ser posterior al vencimiento del periodo anterior y no futura; por defecto se propone el día siguiente al vencimiento. Se mantiene la tasa numérica anterior y se calcula sobre capital original. El capital pendiente se traslada sin capitalizar interés ni duplicar deuda.
- El cronograma anterior se conserva como histórico; sus pendientes no se suman al cronograma vigente.
- **Los pagos no se anulan ni eliminan**, según la última decisión del usuario, que reemplaza la regla inicial de anulaciones con motivo.
- El préstamo no se cancela ni se elimina: solo se liquida o refinancia. No se alteran capital original, tasa ni plazos ya registrados.
- Administrador registra/modifica clientes y opera. Jefe consulta. Roles asignados por responsable del proyecto, sin autoservicio.
- WhatsApp manual, sin envío automático. Excel se previsualiza y valida sin escribir a producción.

El administrador ingresa monto y elige uno o dos meses; la tasa no es editable. No se permite monto cero ni tasa de 0 % desde la interfaz o las RPC SQL. Sobrepagos se rechazan: falta definir el tratamiento de excedentes antes de admitirlos. El acceso inicial utiliza correo como identificador de usuario en Supabase Auth.

## Modelo implementado

`profiles`, `clients` (código de stand y condición socio/trabajador), `audit_events`, `loans`, `loan_periods`, `installments`, `payments`, `payment_installments` y vista `installment_balances`. No existe tabla ni función de anulaciones.

RPC `create_loan`, `record_payment`, `refinance_loan`: transacciones atómicas, bloqueo del préstamo/cliente y claves UUID de idempotencia. No hay permisos de escritura financiera directa para usuarios autenticados. Las consultas y vistas respetan RLS. Auditoría registra usuario, operación, entidad y hora, sin duplicar datos personales.

## Verificaciones y pendientes externos

Las pruebas locales verifican cálculos, redondeo, fechas, cuotas, refinanciación, pagos, liquidación, RLS, idempotencia y rollback de operaciones inválidas en PostgreSQL con Auth simulado. Esto no verifica la infraestructura real de Supabase ni la concurrencia entre conexiones independientes.

Falta crear proyecto Supabase, aplicar ambas migraciones, asignar usuarios/roles y validar el flujo completo con Auth/PostgREST reales. La integración, las pruebas reales de concurrencia, los respaldos y el despliegue Vercel siguen pendientes.

No se recibió PRESTAMOS - PM.xlsx. Se preparó revisión XLSX mediante columnas documentadas; la adaptación de sus hojas y fórmulas al archivo original queda pendiente. No hay importación automática de datos históricos ni generación ficticia de pagos para cuadrar saldos.

No se declara apto para operaciones reales antes de completar la validación de integración y las decisiones pendientes.

## Panel y estados aprobados

Código de stand y condición obligatorios para nuevos registros y edición; datos anteriores sin identificación se completan manualmente. Se permite que socio y trabajadores compartan stand. Panel con una fila por préstamo, fecha original, Saldo incluyendo intereses, cuota programada, día/fecha del pendiente más antiguo, atraso en días y refinanciación independiente. Puntual sin vencidos; Se atrasó X días de 1 a 6; En mora desde 7. Se conservan préstamos liquidados e historial. Migración 003 necesaria para actualizar proyectos existentes sin repetir 001/002.
