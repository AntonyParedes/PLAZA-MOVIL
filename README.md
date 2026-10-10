# PM Créditos

Base de desarrollo de una aplicación de préstamos personales en PEN y zona America/Lima. Next.js App Router, TypeScript, Tailwind, componente Button compatible con shadcn/ui, Supabase y Zod. Se usan consultas Supabase y migraciones SQL, sin Prisma.

## Estado real

Implementados: acceso por correo/contraseña, roles, consulta/alta/edición de clientes, panel financiero, préstamos, cronogramas, pagos parciales y totales, refinanciaciones, historial, alertas, WhatsApp manual, reportes XLSX completos y CSV, y apariencia automática clara/oscura. Productos disponibles: S/500 al 7 % mensual por un mes; S/1.000 al 6 % mensual por uno o dos meses y S/2.000 al 6 % mensual por dos meses (intereses S/35, S/60, S/120 y S/240, respectivamente). Las operaciones financieras utilizan RPC SQL transaccionales, bloqueos e idempotencia; pagos definitivos sin anulación ni eliminación, según decisión del usuario.

**Sin proyecto Supabase conectado: autenticación, persistencia y permisos aún no se han validado contra el servicio real.** Hay pruebas en PostgreSQL local con Auth simulado.

La revisión de XLSX detecta duplicados, faltantes, fórmulas y saldos inconsistentes; no importa a producción. El archivo original no se recibió y requiere adaptar sus hojas a la plantilla. Pendientes: integración real, pruebas de concurrencia en Supabase, política de excedentes, archivo Excel original y despliegue Vercel. No apto aún para operaciones financieras reales. Ver [reglas y verificación](docs/REQUISITOS.md).

## Desarrollo

Node.js 24 y npm 11. Desde la raíz del repositorio:

```sh
npm ci --cache /workspace/.npm-cache
npm run test
npm run lint
npm run typecheck
npm run build
npm run dev -- --hostname 0.0.0.0
```

No crear worktrees durante configuración: las tareas de nube ya están aisladas. No introducir claves privadas en el repositorio.

## Supabase

1. Crear proyecto Supabase. Copiar `.env.example` a `.env.local` (ignorado), sin sobreescribir configuración existente.
2. Configurar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. La clave publicable es pública; jamás utilizar `service_role` en una variable `NEXT_PUBLIC_*`.
3. Aplicar primero `supabase/migrations/202610090001_clients_security.sql` después `supabase/migrations/202610090002_financial_operations.sql`, `supabase/migrations/202610090003_client_stand.sql` y `supabase/migrations/202610100004_loan_2000.sql` en SQL Editor una sola vez cada una. Son migraciones iniciales, no scripts para ejecutar repetidamente.
4. Crear usuarios desde Supabase Authentication con contraseña segura; desactivar registro público en los ajustes de Auth. No hay registro de usuarios desde la aplicación.
5. El responsable del proyecto asigna el perfil desde SQL Editor (UUID real del usuario):

```sql
insert into public.profiles(id, role) values ('UUID_DEL_USUARIO', 'administrador');
-- Para supervisión usar 'jefe'. Nunca asignar roles desde el navegador.
```

6. Reiniciar Next.js después de cambiar variables. Verificar acceso, alta de cliente con administrador, consulta con jefe y denegación de escrituras con jefe mediante la API; usuario sin perfil y solicitudes anónimas no deben leer clientes. Estos controles requieren el proyecto real.

Las consultas del navegador usan el JWT del usuario; la autorización efectiva está en RLS. La navegación sin sesión no expone datos; ningún secreto privilegiado es necesario en el cliente. Configurar MFA, política de contraseñas, respaldos y retención antes de producción.

## Vercel

Importar repositorio como proyecto Next.js y configurar ambas variables públicas por entorno. Aplicar migraciones en un proyecto Supabase separado para pruebas. Recompilar cuando cambien variables públicas, pues Next.js las incorpora en el bundle. No publicar como sistema operativo de préstamos hasta completar las etapas pendientes y pruebas financieras, de seguridad y concurrencia.

## Pruebas

`npm test` valida cálculos en céntimos, redondeo, fechas semanales, refinanciación según reglas aprobadas, prioridad de interés, liquidación, acumulación de vencidos, rechazo de sobrepagos y archivos de revisión. Las migraciones se ejecutan en PostgreSQL local mediante PGlite, con Auth simulado: permisos, DNI único, auditoría, una deuda activa, idempotencia, rollback y operaciones financieras completas. No acreditan la integración real ni la concurrencia entre conexiones independientes.

## Importación y exportaciones

Revisar Excel desde el menú del administrador; los datos permanecen en el navegador. Formato de entrada: encabezados `cliente`, `dni`, `capital_original`, `capital_pendiente`, `interes_pendiente`, `fecha_prestamo`, `tasa_mensual_porcentaje`, `plazo_meses`; opcional `saldo_total`. Montos en soles, fechas AAAA-MM-DD, DNI de ocho dígitos como texto. Hasta 2 MB, 5000 registros y 30 columnas por hoja. Se leen resultados almacenados de fórmulas y se marcan para revisión; no se recalculan. Esta revisión no sustituye la conciliación de historial ni realiza importaciones.

«Exportar Excel completo» genera un `.xlsx` con Cartera, Cuotas, Pagos, Periodos, Refinanciaciones, Clientes, Cobros por semana, Cobros por mes y Guía. Incluye identificación, columnas de cuotas, saldos, estados y todo el historial de los préstamos seleccionados. La hoja Guía explica los filtros, los importes y la numeración de referencia. Ver [detalle de exportación](docs/INTERFAZ.md).

Los CSV incluyen BOM y comillas para Excel; los campos de texto neutralizan fórmulas. Los reportes de pagos/cobros usan fecha efectiva de pago; préstamos usan fecha de desembolso; saldos son los actuales. Los periodos históricos no se duplican en alertas vigentes.

## Pruebas de navegador

`npm run test:e2e` usa Chromium del sistema (`/usr/bin/chromium`; ruta alternativa con `CHROMIUM_PATH`) y un servidor temporal en el puerto 3100. Antes de ejecutarlo, detener solo servidores Next.js de este checkout que hayas iniciado, para evitar el bloqueo de desarrollo compartido; reiniciar el servidor de trabajo después. Las respuestas de Supabase están simuladas: se verifica navegación por rol, selección de productos, envío de RPC, exportación y carga de un XLSX de prueba. No se utiliza un proyecto Supabase ni se escriben datos reales.

## Actualización: identificación y panel general

Clientes: código de stand y condición socio/trabajador son obligatorios al registrar o editar. Personas distintas pueden compartir un stand. Los clientes anteriores conservan datos y operaciones y aparecen como «Por registrar» hasta completar su identificación. Sus pagos y refinanciaciones continúan funcionando; antes de crear un nuevo préstamo hay que completar la identificación.

**En un proyecto existente que ya ejecutó las migraciones 001 y 002, ejecutar únicamente `supabase/migrations/202610090003_client_stand.sql`, una sola vez. No repetir las migraciones iniciales.** En un proyecto nuevo, aplicar las tres en orden. Esta migración agrega columnas y validaciones, sin borrar ni recalcular préstamos o pagos.

Panel general: una fila por préstamo y seis columnas: Prestatario, Fecha del préstamo, Día de pago (día de la semana), Saldo, Cuota semanal y Estado. Primero aparecen los préstamos con mayor atraso; los liquidados quedan al final. Verde indica puntual/liquidado, ámbar atraso y rojo mora. Pulsar el nombre abre identificación, fechas, refinanciación, cronograma, pagos y WhatsApp. Saldo incluye capital e interés pendientes; la cuota semanal es el importe programado. Busca por nombre/DNI/stand y filtra por condición y estado. Excel completo y CSV mantienen toda la información.


Clasificación aprobada: sin cuotas vencidas pendientes = Puntual; de 1 a 6 días = «Se atrasó X días»; desde 7 días = En mora. Se cuenta desde la cuota vigente impaga más antigua, incluyendo pagos parciales, según fecha de Lima. Las cuotas históricas de refinanciaciones no duplican deuda ni atraso. La clasificación es visual y no genera cargos. La fecha de Lima se actualiza cada minuto mientras el panel está abierto.

## Interfaz y recepción de cobros

Navegación por módulos, Dashboard de cobros, menú plegable en escritorio, menú adaptable en tablet/móvil, formularios por secciones y detalles en paneles laterales. Las tablas se convierten en tarjetas en celulares. La apariencia sigue automáticamente el modo claro u oscuro del dispositivo y utiliza verde #4EB852, morado #9763A8 y gris #A9ABAE. Ver [decisiones visuales, módulos y pruebas](docs/INTERFAZ.md).

Desde Cobros semanales o el detalle del préstamo se puede ingresar un importe libre, completar 1/2/3 cuotas pendientes con accesos rápidos o liquidar capital + interés pendiente. Los botones preparan el importe; «Confirmar pago» conserva la confirmación y la operación financiera existentes. Las cuotas se completan desde la más antigua, contemplando abonos parciales.

Este rediseño no necesita migraciones nuevas ni cambios en las variables de entorno. Un proyecto existente debe tener las migraciones 001, 002 y 003 aplicadas. Publicar el nuevo commit mediante el despliegue habitual de Vercel.

## Clientes: cuenta desplegable

Clientes muestra nombre, condición, stand, Saldo restante, Interés cobrado (ganancia) y WhatsApp; pulsar el nombre abre los detalles en la misma página. La cuenta tiene color según su estado y muestra Saldo e Interés cobrado (ganancia), sumado de sus pagos reales. Debajo están préstamos, cronogramas, historial y contacto. La edición sigue limitada al administrador. WhatsApp prepara un resumen de deuda y atraso para enviar manualmente, con advertencia general y firma de Gerencia. Esta actualización no requiere SQL adicional.

## Liquidación urgente al terminar el plazo

Desde el día siguiente a la fecha final del periodo vigente, un préstamo activo con saldo pasa a «Liquidación urgente», con prioridad sobre atraso y mora. La fecha se evalúa en Lima; una refinanciación aprobada utiliza su propio periodo vigente. Los préstamos liquidados quedan liquidados.

Panel general los coloca primero y permite filtrar este estado. Clientes, detalles, cuotas y WhatsApp muestran la urgencia. El recordatorio de préstamo terminado solicita el 100 % del saldo restante (capital + interés pendientes), conserva los días de atraso y no agrega cargos. Excel y CSV exportan el nuevo estado. No requiere migración SQL ni modifica saldos o fechas contractuales.

## Nuevo producto S/2.000

S/2.000 al 6 % mensual durante dos meses (ocho semanas): interés S/240, total S/2.240 y ocho cuotas semanales de S/280. La primera vence siete días después del desembolso; la última, a los 56 días.

**En un proyecto existente con 001, 002 y 003 aplicadas, ejecutar únicamente `supabase/migrations/202610100004_loan_2000.sql` una vez en Supabase SQL Editor.** No repetir migraciones anteriores. La 004 actualiza la lista de productos permitidos en `create_loan` y conserva roles, idempotencia, bloqueos, préstamos y pagos previos. Después desplegar la versión nueva de la aplicación.

Panel general marca en morado «Vence hoy» para cuotas vigentes con saldo pendiente que vencen exactamente hoy en Lima, sin agregar columnas ni cambiar el estado de cobranza. Las cuotas pagadas no se resaltan.

El menú omite Cobros semanales e Historial de pagos. El registro y la consulta de pagos están en el detalle del préstamo, accesible desde Panel general o Préstamos; la agenda sigue en Dashboard y las exportaciones en Reportes. Estos cambios de interfaz no requieren SQL adicional.
