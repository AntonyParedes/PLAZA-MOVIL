# PM Créditos

Base de desarrollo de una aplicación de préstamos personales en PEN y zona America/Lima. Next.js App Router, TypeScript, Tailwind, componente Button compatible con shadcn/ui, Supabase y Zod. Se usan consultas Supabase y migraciones SQL, sin Prisma.

## Estado real

Implementados: acceso por correo/contraseña, roles, consulta/alta/edición de clientes, panel financiero, préstamos, cronogramas, pagos parciales y totales, refinanciaciones, historial, alertas, WhatsApp manual y reportes CSV. Productos disponibles: S/500 al 7 % mensual por un mes; S/1.000 al 6 % mensual por uno o dos meses (intereses S/35, S/60 y S/120, respectivamente). Las operaciones financieras utilizan RPC SQL transaccionales, bloqueos e idempotencia; pagos definitivos sin anulación ni eliminación, según decisión del usuario.

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
3. Aplicar primero `supabase/migrations/202610090001_clients_security.sql` y después `supabase/migrations/202610090002_financial_operations.sql` en SQL Editor una sola vez cada una. Son migraciones iniciales, no scripts para ejecutar repetidamente.
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

Los CSV incluyen BOM y comillas para Excel; los campos de texto neutralizan fórmulas. Los reportes de pagos/cobros usan fecha efectiva de pago; préstamos usan fecha de desembolso; saldos son los actuales. Los periodos históricos no se duplican en alertas vigentes.

## Pruebas de navegador

`npm run test:e2e` usa Chromium del sistema (`/usr/bin/chromium`; ruta alternativa con `CHROMIUM_PATH`) y un servidor temporal en el puerto 3100. Antes de ejecutarlo, detener solo servidores Next.js de este checkout que hayas iniciado, para evitar el bloqueo de desarrollo compartido; reiniciar el servidor de trabajo después. Las respuestas de Supabase están simuladas: se verifica navegación por rol, selección de productos, envío de RPC, exportación y carga de un XLSX de prueba. No se utiliza un proyecto Supabase ni se escriben datos reales.
