# Acceso de consulta y actualización de datos

La aplicación ya admite dos roles: `administrador` y `jefe`. El rol `jefe` se muestra como «Solo lectura» en la cuenta y puede consultar clientes, cartera, cuotas, pagos, refinanciaciones y descargar reportes. No puede registrar clientes, desembolsar, cobrar ni refinanciar. Las restricciones también se aplican en PostgreSQL mediante RLS y `require_admin`; ocultar botones no es la única protección.

## Crear la cuenta

Estas acciones requieren el responsable de Supabase. No existe un conector administrativo habilitado en el entorno de trabajo ni se ha creado una cuenta de producción automáticamente.

1. En Supabase, abre Authentication → Users → Add user → Create new user. Usa el correo de la persona que consultará y una contraseña segura, compartida directamente con ella; no publiques la contraseña en el repositorio ni en el chat. Confirma el correo según el mecanismo configurado en tu proyecto.
2. Copia el UUID del usuario nuevo.
3. En SQL Editor ejecuta lo siguiente, reemplazando `UUID_DEL_USUARIO_NUEVO` por ese UUID:

```sql
insert into public.profiles (id, role)
values ('UUID_DEL_USUARIO_NUEVO', 'jefe');
```

4. Inicia sesión con esa cuenta y comprueba que puede consultar, pero no ve Nuevo cliente, Nuevo préstamo, Confirmar pago, Liquidar préstamo ni Confirmar refinanciación. Configuración no muestra Revisar Excel para este rol.

No cambies el perfil del administrador existente. No necesitas crear una tabla ni un nuevo tipo de rol.

## Activar notificaciones Realtime

La interfaz escucha cambios de las tablas existentes y vuelve a leer los datos autorizados. Los saldos nunca se toman directamente del mensaje WebSocket. Las notificaciones se agrupan para evitar varias cargas por una sola operación financiera. Los canales y temporizadores se eliminan al cerrar la sesión o desmontar la pantalla.

Para recibir los eventos, incluye las siguientes tablas en la publicación `supabase_realtime` de tu proyecto. Puedes habilitarlas en el panel de publicaciones de Supabase o ejecutar este script idempotente en SQL Editor. Modifica únicamente la publicación de eventos; no cambia registros, columnas, cálculos, políticas ni permisos:

```sql
begin;
do $$
declare target_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
    foreach target_table in array array['clients', 'profiles', 'loans', 'loan_periods', 'payments', 'installments', 'payment_installments']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', target_table);
      end if;
    end loop;
  end if;
end $$;
commit;
```

Sin habilitar la publicación, o si Realtime está desconectado, los datos se consultan automáticamente cada 30 segundos y al recuperar el foco. Una pestaña oculta evita consultas periódicas; se actualiza al volver. Este respaldo no garantiza actualización instantánea.

## Validación pendiente en producción

Con dos navegadores: iniciar sesión como administrador y como consulta; registrar un pago autorizado con el administrador y comprobar que cambia el saldo en la sesión de consulta. Probar también el directorio de clientes. No se ha ejecutado esta comprobación contra tu Supabase real desde el entorno de desarrollo.
