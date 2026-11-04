# Contraste del inventario RLS aportado por el responsable

**Resultado:** el catálogo de PM Créditos aportado coincide con las políticas, permisos y funciones esperados del repositorio. No se identificó una exposición crítica de RLS en esos metadatos. La observación preventiva sobre PUBLIC no está presente como un permiso efectivo en el inventario recibido.

La evidencia es el resultado de `rls-production-readonly.sql` compartido por el responsable: PostgreSQL 17.11, `checked_at_utc` 2026-11-04 04:04:59.392562 (3 de noviembre, 23:04:59 en Lima). Se ha contrastado el documento recibido; no se inició una sesión administrativa ni se ejecutaron operaciones de producción desde este entorno. No se incorpora al repositorio el archivo completo de configuración aportado.

## Comprobaciones que coinciden

- Las **10 tablas** de aplicación tienen RLS habilitada.
- Las **12 políticas** coinciden exactamente con el modelo local, incluyendo roles, condiciones USING y WITH CHECK.
- Las **2 vistas** usan `security_invoker=true`. Su `rls_enabled=false` es normal: las vistas respetan las políticas de las tablas subyacentes por esta configuración.
- Las **24 filas de permisos efectivos** de public (12 relaciones × anon/authenticated) coinciden: anon no tiene acceso a las tablas/vistas de PM; authenticated solo recibe SELECT y, para clients, INSERT/UPDATE sujetos a RLS. No tiene DELETE/TRUNCATE ni escritura directa en finanzas/perfiles/auditoría.
- Las **16 funciones**, incluyendo ambas firmas de refinanciación, tienen propietario postgres, `search_path` vacío y permisos EXECUTE coherentes. Las internas no pueden ejecutarse directamente con authenticated y ninguna permite ejecución a anon/PUBLIC.
- Los cuerpos de las **16 funciones** coinciden con las últimas definiciones de las migraciones. Quince hashes inicialmente distintos coinciden al convertir LF a CRLF (saltos de línea de Windows); la función SQL de una sola línea coincide directamente. No se observó un cambio de lógica por esas diferencias.
- `public_grants` está vacío. No se observan grants a PUBLIC en las relaciones inventariadas.
- anon/authenticated no son superusuarios, no tienen BYPASSRLS/CREATEROLE ni CREATE sobre public.
- Las membresías indicadas son de postgres/authenticator/supabase_realtime_admin hacia los roles de API; no indican que authenticated sea miembro de postgres. `service_role` con BYPASSRLS corresponde al rol administrativo de Supabase y no debe usarse como clave del navegador.

## PUBLIC y permisos futuros

La reproducción local de PUBLIC/TRUNCATE del informe inicial era un escenario condicionado, no una fuga confirmada. El catálogo recibido no presenta ese grant a PUBLIC ni TRUNCATE efectivo en las tablas de PM para anon/authenticated.

Los permisos predeterminados para objetos nuevos siguen siendo amplios en algunos creadores, incluidos privilegios auxiliares de tablas. Las migraciones de PM revocan permisos antes de conceder los necesarios, como confirma el inventario actual. Mantener esa disciplina al agregar tablas, vistas y funciones; cualquier endurecimiento de DEFAULT PRIVILEGES debe hacerse con alcance al creador/esquema adecuado y conservar los componentes administrados de Supabase. No se requiere una revocación masiva de las tablas existentes por este resultado.

## Realtime

La publicación informada contiene únicamente `public.cash_movements`. No incluye clients, loans, loan_periods, installments, payments ni payment_installments. Sus cambios se sincronizan por el respaldo periódico de la aplicación, no por notificaciones de esas tablas en esta configuración.

La aplicación no ofrece borrado de movimientos de caja y los roles de API carecen de DELETE sobre cash_movements. No se ha demostrado una fuga mediante eventos DELETE. Se mantiene como límite de la revisión que no se probaron suscripciones WebSocket con identidades reales; cualquier ampliación de la publicación debe considerar el tratamiento especial de DELETE documentado por Supabase.

## Storage y límites

Las ocho tablas de Storage inventariadas tienen RLS habilitada y no aparecen políticas de Storage en la lista recibida. Los grants de tabla amplios de los componentes administrados no equivalen por sí solos a lectura pública de archivos. El acceso a buckets/archivos, los buckets marcados públicos y el comportamiento de la API de Storage requieren una revisión específica si se utiliza ese servicio. No modificar indiscriminadamente los permisos internos de Storage a partir de los flags de esta salida.

La validación del catálogo complementa las cuatro pruebas locales de roles. No sustituye pruebas de integración con JWT y cuentas reales ni revisa MFA, contraseñas, claves del despliegue o acceso del personal al dashboard. No se modificaron datos, políticas, funciones, usuarios ni permisos de producción durante este contraste.
