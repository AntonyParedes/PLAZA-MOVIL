# Auditoría RLS de PM Créditos

**Resultado:** no se reprodujeron accesos indebidos ni elevación de privilegios en el modelo local construido con las migraciones 001–010. Hay una recomendación de endurecimiento dependiente de configuración y verificaciones pendientes en producción. Este resultado no certifica la configuración instalada en el Supabase publicado.

Base revisada: commit `935e981`, las diez migraciones de `supabase/migrations`, llamadas del frontend y configuración pública del cliente Supabase. La aplicación maneja una cartera compartida entre trabajadores autorizados, no un sistema de cuentas de prestatarios ni organizaciones independientes. Que un administrador o `jefe` lea todos los clientes es el comportamiento autorizado actual.

## Alcance y evidencia

- **10 tablas** de aplicación con RLS habilitada: profiles, clients, audit_events, loans, loan_periods, installments, payments, payment_installments, client_deletions y cash_movements.
- **2 vistas** con `security_invoker=true`: installment_balances y penalty_register. Las consultas respetan los permisos y políticas de las tablas base.
- **16 funciones** `SECURITY DEFINER`, incluyendo las dos firmas de refinance_loan. Todas tienen `search_path` vacío, propietario distinto de anon/authenticated y EXECUTE revocado a PUBLIC y anon.
- **6 funciones internas** sin ejecución directa para authenticated. Las funciones públicas autorizadas comprueban el rol de aplicación antes de operar o devolver datos protegidos.
- Las pruebas cargan todas las migraciones en PostgreSQL/PGlite con datos ficticios, incluidos pagos, refinanciación, penalidad, caja y eliminación, para no confundir tablas vacías con un bloqueo efectivo.
- `auth.uid()` se simula localmente para cambiar identidades. No se está probando la validación criptográfica de JWT de Supabase ni ejecutando instrucciones SQL desde un navegador real.
- No se encontraron usos de service_role en el cliente del repositorio; el cliente usa las dos variables públicas previstas. No se han inspeccionado los secretos de Vercel ni se ha usado una clave administrativa.

## Permisos comprobados

| Identidad | Lectura de clientes/finanzas/auditoría | Perfil | Escrituras |
| --- | --- | --- | --- |
| anon | Denegada por ACL | Denegada | Denegadas, incluido EXECUTE de RPC |
| authenticated sin perfil | Sin filas; cash_summary rechaza | Sin filas | RLS/ACL y require_admin rechazan |
| jefe | Cartera, pagos, cuotas, caja y penalidades | Solo su propio perfil | No puede registrar ni modificar operaciones |
| administrador | Cartera compartida y constancias de eliminación | Solo su propio perfil | Clientes mediante INSERT/UPDATE; operaciones financieras únicamente por RPC |

`client_deletions` solo devuelve filas al administrador. Ningún usuario de la API puede insertar/editar perfiles, borrar auditoría o actualizar directamente préstamos/pagos/caja. No hay privilegio TRUNCATE efectivo para anon/authenticated en el modelo estándar. Los roles de API simulados no son superusuarios ni tienen BYPASSRLS.

Las pruebas verifican también que datos de metadata que digan «administrador» no cambian la autorización, y que degradar o retirar un perfil se aplica en posteriores consultas/RPC aunque siga siendo la misma identidad. La fuente de autorización es `public.profiles`, consultada por `current_app_role()`. `require_admin()` usa `IS DISTINCT FROM`, por lo que un rol NULL no pasa la comprobación.

## Observación RLS-01: revocación explícita de PUBLIC

**Clasificación: endurecimiento preventivo, bajo y dependiente de configuración. No es una exposición observada en producción.**

Las migraciones 001 y 002 revocan permisos de las tablas a anon y authenticated, pero no explícitamente a PUBLIC. La vista installment_balances tampoco revoca PUBLIC explícitamente. Las migraciones 008–010 sí lo hacen para sus nuevas relaciones. Referencias: `202610090001_clients_security.sql:33`, `202610090002_financial_operations.sql:69` y `:210`.

Con los permisos predeterminados de la prueba, **no hay grants a PUBLIC** en las relaciones revisadas y los roles quedan protegidos. Sin embargo, si un creador tuviera DEFAULT PRIVILEGES que concedieran TRUNCATE a PUBLIC antes de ejecutar las migraciones, las revocaciones de 001/002 no retirarían ese permiso heredado. Se reprodujo únicamente en una base ficticia: un usuario sin perfil no podía leer auditoría, pero sí truncarla si PUBLIC recibía ese privilegio.

TRUNCATE no está sujeto a RLS. **Esta prueba usa acceso SQL local; el frontend y las RPC actuales no ofrecen un canal para ejecutar TRUNCATE arbitrario.** La reproducción no demuestra un ataque desde la API publicada ni que PUBLIC tenga ese permiso en tu proyecto.

Recomendación: revocar explícitamente los permisos de PUBLIC sobre las relaciones de PM Créditos y revisar DEFAULT PRIVILEGES del creador real. Mantener los grants específicos de authenticated y las políticas necesarias; no aplicar una revocación indiscriminada a otros objetos de Supabase. La consulta de inventario entregada muestra grants directos a PUBLIC, privilegios efectivos, membresías y permisos predeterminados para determinar si hace falta una corrección.

## Verificación pendiente: eventos DELETE de Realtime

El hook `src/hooks/use-live-revision.ts` escucha eventos `*`. El proyecto documenta publicar tablas financieras en supabase_realtime y la migración 009 incorpora cash_movements si existe la publicación.

La documentación oficial de [Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes#receiving-old-records) indica que RLS no se aplica a eventos DELETE de la misma forma que a los registros existentes. No debe suponerse que una prueba REST/SELECT cubre también el canal de eventos.

**No se ha demostrado una suscripción indebida ni fuga de registros en este proyecto.** Hace falta comprobar publicación, replica identity, autorización de suscripción y contenido efectivo de DELETE con identidades autorizadas y sin perfil. El riesgo a investigar es exposición de identificadores/metadatos de borrado; no se afirma que se estén enviando filas completas. Si esos eventos deben quedar restringidos al rol de aplicación, valorar notificaciones mediante canales privados autorizados o limitar la publicación. El polling existente permite mantener la actualización si se decide reducir eventos.

## Estado de la verificación publicada

Se detectaron URL y clave **publicable** configuradas para el proyecto esperado. Las comprobaciones previstas eran consultas HEAD de metadatos y las RPC de lectura current_app_role/cash_summary, sin mutaciones ni cuentas nuevas. La red rechazó el túnel hacia el host de Supabase con **403 del proxy Envoy**, antes de recibir respuesta del proyecto. Ese 403 **no es una respuesta de RLS** y no prueba ni acceso ni bloqueo en Supabase.

No hay conexión PostgreSQL administrativa ni conector Supabase disponible. Por ello no se han podido leer los catálogos reales ni comprobar qué migraciones, políticas adicionales, permisos heredados o publicaciones están instalados. Tampoco se han modificado políticas, usuarios, dinero ni datos de producción.

## Cómo cerrar la comprobación en producción

1. Abre PM Créditos en Supabase → SQL Editor.
2. Ejecuta `scripts/audit/rls-production-readonly.sql` completo. Usa una transacción de solo lectura y consulta catálogos; no instala políticas ni consulta filas de clientes/pagos, correos, contraseñas o tokens.
3. Guarda el valor de la columna `rls_audit` como JSON y compártelo para contrastarlo con el modelo esperado. Incluye configuración de public/storage, no contenidos de negocio.

El inventario informa RLS, expresiones USING/WITH CHECK, grants efectivos, PUBLIC, propietarios, funciones, search_path, membresías y publicación Realtime. Los hashes de funciones permiten detectar diferencias para revisar; una diferencia de hash por sí sola no prueba una vulnerabilidad. La consulta se ha ejecutado correctamente sobre el modelo local.

La revisión no cubre seguridad de contraseñas/MFA, configuración de validación JWT, rate limiting, acceso del personal al dashboard ni contenido de Storage. Los metadatos de Storage, si existen, sirven como inventario para una revisión específica; los buckets públicos y sus archivos no han sido probados.

## Comprobaciones reproducibles

```sh
npx tsx --test tests/rls-audit.test.ts
```

Cuatro casos: inventario y ACL de tablas/vistas/funciones; matriz de acceso y mutaciones por rol; reproducción aislada del escenario PUBLIC/TRUNCATE; degradación y retirada de perfiles. La prueba que trunca auditoría solo opera sobre datos ficticios en PostgreSQL local. El script para producción nunca trunca ni escribe.

Esta entrega es una auditoría: no cambia las reglas de negocio ni publica una migración de permisos. Cualquier endurecimiento deberá conservar la gestión de administradores y la consulta del rol jefe, y validarse contra los permisos reales obtenidos del inventario.
