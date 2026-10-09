# Interfaz de PM Créditos

El rediseño reutiliza Next.js, React, Tailwind, Radix y Lucide. No cambia las migraciones, la autenticación, las autorizaciones, las fórmulas ni los RPC financieros. No incorpora dependencias de producción nuevas ni datos de ejemplo a la aplicación.

## Auditoría y decisiones

La interfaz anterior reunía las tareas financieras en pestañas de una sola pantalla, mostraba el acceso como página principal y dependía de tablas extensas en móviles. El diseño actual permite entrar directamente a cada tarea desde el menú; el Dashboard es la primera vista después de iniciar sesión. El panel general y la revisión de Excel siguen disponibles.

La navegación utiliza azul marino, acciones azules, tarjetas blancas sobre fondo gris claro y tipografía Geist local con licencia OFL. El archivo local evita descargas de fuentes durante la compilación. Pagado/liquidado se muestran en verde, pendiente/atrasado en ámbar y vencido/mora en rojo; los estados siempre incluyen texto.

`src/components/app-shell.tsx` centraliza navegación, encabezado, búsqueda compartida y menú de usuario. En escritorio se puede plegar el menú. En tablet y móvil se utiliza un diálogo de navegación con foco controlado y cierre con Escape.

`src/components/ui/dashboard.tsx` comparte tarjetas, indicadores, etiquetas, estados vacíos, mensajes, skeletons, tablas y paneles laterales. Las tablas conservan encabezados semánticos y una descripción. En móviles se presentan como tarjetas etiquetadas; en pantallas mayores, las tablas extensas se desplazan dentro de su contenedor. Los controles tienen una altura mínima de 44 px. Los paneles gestionan el foco, contienen la navegación con Tab y devuelven el foco al cerrar. El enlace «Ir al contenido» está disponible por teclado.

## Módulos y datos

- **Dashboard:** capital original prestado, capital pendiente, total cobrado, interés cobrado, pagos recibidos hoy, cuotas vencidas, préstamos activos y liquidados. Capital pendiente excluye interés; Saldo en el panel general incluye ambos. «Cobros de hoy y esta semana» consulta el cronograma vigente y muestra cuotas pagadas, pendientes y vencidas.
- **Panel general:** mantiene las columnas, filtros, exportación y reglas de atraso existentes: de 1 a 6 días «Se atrasó X días», desde 7 «En mora». La refinanciación se muestra por separado.
- **Clientes:** búsqueda por nombre/DNI/stand, filtro de condición y formularios por secciones. «Ver detalle» consulta únicamente los préstamos de ese cliente; desde allí se abre su cronograma e historial.
- **Préstamos:** productos autorizados, vista previa de cuotas y confirmación del desembolso.
- **Cobros semanales:** cuotas pendientes, vencidas, pagadas o todas, con acceso al cobro y al enlace de recordatorio por WhatsApp. Abrir WhatsApp no envía el mensaje automáticamente.
- **Refinanciaciones:** préstamos activos con condiciones pendientes y periodos refinanciados. La acción mantiene los bloqueos existentes por interés y cuotas vencidas pendientes.
- **Historial de pagos:** fecha, total, interés, capital, préstamo y CSV. No incorpora anulación ni eliminación.
- **Reportes:** conserva las exportaciones y los totales por semana/mes.
- **Configuración:** muestra moneda, idioma, zona horaria y alcance del rol actual. Es informativa; los roles continúan gestionándose por el responsable del sistema.
- **Revisar Excel:** conserva la revisión local y sus advertencias; no realiza importación a la base de datos.

## Recepción de cobros

El detalle del préstamo permite escribir un monto libre, completar 1, 2 o 3 cuotas pendientes o liquidar todo el préstamo. Los accesos rápidos suman los importes restantes de las cuotas vigentes más antiguas; contemplan abonos parciales. Se deshabilita una opción si no hay suficientes cuotas pendientes. Liquidar utiliza capital pendiente + interés pendiente, sin descuentos.

Todos los botones solo preparan el monto: después se revisa la fecha y se pulsa «Confirmar pago». Se conserva la confirmación explícita y el RPC `record_payment`, que aplica el pago primero a interés y después a capital, asigna el importe a las cuotas en orden y liquida el préstamo al llegar a saldo cero. La fecha de vencimiento original no cambia al cobrar cuotas atrasadas juntas.

## Validación y actualización

Las pruebas Playwright verifican el acceso por rol, persistencia de sesión al volver a la pestaña, formularios, productos, confirmaciones, RPC de pagos/refinanciación, exportaciones y revisión XLSX. También recorren los módulos y detalles a 375, 430, 768, 1024, 1440 y 1920 px, comprobando que la página no tenga desbordamiento horizontal. Incluyen pagos de varias cuotas con un abono parcial previo y liquidación completa. Se generan capturas locales en `test-results/`, ignoradas por Git.

Las respuestas Supabase de estas pruebas están interceptadas; la suite PGlite comprueba las operaciones SQL localmente. Esto no acredita la integración ni la concurrencia en el proyecto Supabase de producción.

El rediseño se activa con el despliegue habitual de GitHub a Vercel. No requiere SQL adicional; un proyecto existente debe tener aplicadas previamente las migraciones 001, 002 y 003.
