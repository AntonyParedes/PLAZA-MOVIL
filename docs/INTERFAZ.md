# Interfaz de PM Créditos

El rediseño reutiliza Next.js, React, Tailwind, Radix y Lucide. No cambia las migraciones, la autenticación, las autorizaciones, las fórmulas ni los RPC financieros. No incorpora dependencias de producción nuevas ni datos de ejemplo a la aplicación.

## Auditoría y decisiones

La interfaz anterior reunía las tareas financieras en pestañas de una sola pantalla, mostraba el acceso como página principal y dependía de tablas extensas en móviles. El diseño actual permite entrar directamente a cada tarea desde el menú; el Dashboard es la primera vista después de iniciar sesión. El panel general y la revisión de Excel siguen disponibles.

La interfaz utiliza verde #4EB852, morado #9763A8 y gris #A9ABAE, con blanco y negro según el contraste. Las acciones principales son verdes, los acentos morados y la navegación violeta oscuro. Usa tipografía Geist local con licencia OFL. El archivo local evita descargas de fuentes durante la compilación. Pagado/liquidado se muestran en verde, pendiente/atrasado en ámbar y vencido/mora en rojo; los estados siempre incluyen texto.

`src/components/app-shell.tsx` centraliza navegación, encabezado y menú de usuario. En escritorio se puede plegar el menú. En tablet y móvil se utiliza un diálogo de navegación con foco controlado y cierre con Escape.

`src/components/ui/dashboard.tsx` comparte tarjetas, indicadores, etiquetas, estados vacíos, mensajes, skeletons, tablas y paneles laterales. Las tablas conservan encabezados semánticos y una descripción. En móviles se presentan como tarjetas etiquetadas; en pantallas mayores, las tablas extensas se desplazan dentro de su contenedor. Los controles tienen una altura mínima de 44 px. Los paneles gestionan el foco, contienen la navegación con Tab y devuelven el foco al cerrar. El enlace «Ir al contenido» está disponible por teclado.

El menú tiene seis módulos: Inicio, Panel general, Clientes, Préstamos, Reportes y Configuración, agrupados en Operaciones, Análisis y Herramientas. Panel general tiene acceso directo para cobranza; Préstamos conserva la cartera compartida, el formulario de nuevo préstamo y Refinanciaciones mediante controles internos; ambos mantienen el mismo detalle y los permisos existentes. Cada pantalla utiliza un único buscador contextual compartido (`ClientSearch`), con opción de limpiar el texto.

## Módulos y datos

- **Inicio:** capital original prestado, capital pendiente, total cobrado, interés cobrado, pagos recibidos hoy, cuotas vencidas, préstamos activos y liquidados. Capital pendiente excluye interés; Saldo en el panel general incluye ambos. «Cobros de hoy y esta semana» consulta el cronograma vigente y muestra cuotas pagadas, pendientes y vencidas.
- **Cartera dentro de Préstamos:** muestra solo Prestatario, Fecha del préstamo, Día de pago (día de la semana), Saldo, Cuota semanal y Estado. Los atrasados aparecen primero por días de atraso; después se ordenan por el vencimiento pendiente y los liquidados quedan al final. El nombre abre el detalle con identificación, fechas, refinanciación, cronograma, pagos y recordatorio por WhatsApp de la cuota vigente pendiente más antigua. Excel y CSV conservan todas sus columnas. Mantiene los filtros y reglas de atraso: de 1 a 6 días «Se atrasó X días», desde 7 «En mora». La refinanciación se muestra por separado. La búsqueda es por nombre, DNI o stand; no hay filtro por rango de fechas.
- **Clientes:** búsqueda por nombre/DNI/stand y filtro de condición. Cada fila muestra nombre, socio/trabajador, stand, Saldo restante, Interés cobrado (ganancia) y WhatsApp. Los importes se ven sin desplegar el cliente; durante la carga muestran «Cargando…» y si falla la consulta «No disponible», en vez de aparentar saldo cero. Pulsar el nombre despliega su cuenta debajo, sin cambiar de módulo: Saldo, interés cobrado (ganancia), estado, atraso, préstamos, cuotas, pagos y datos de contacto. Solo un cliente se despliega a la vez; la edición del administrador está dentro del detalle. Los fondos son verdes para puntual/liquidado, ámbar para atraso y rojos desde 7 días de mora, con etiquetas de texto. El cliente sin préstamos usa un fondo neutro. Ganancia suma el interés efectivamente pagado de todos sus préstamos, sin capital ni interés pendiente o generado sin cobrar.
- **Préstamos:** productos autorizados, vista previa de cuotas y confirmación del desembolso.
- **Refinanciaciones (dentro de Préstamos):** préstamos activos con condiciones pendientes y periodos refinanciados. La acción exige interés completamente pagado y periodo vencido; las cuotas vencidas pendientes no la bloquean.
- **Reportes:** conserva las exportaciones y los totales por semana/mes.
- **Configuración:** muestra moneda, idioma, zona horaria y alcance del rol actual. Es informativa; los roles continúan gestionándose por el responsable del sistema.
- **Revisar Excel (dentro de Configuración, solo administrador):** conserva la revisión local y sus advertencias; no realiza importación a la base de datos.

## Apariencia día y noche

El botón con luna/sol en la barra superior y en el acceso alterna entre modo día y noche. La elección manual se guarda en este navegador y prevalece sobre el dispositivo al recargar. Sin elección guardada, el modo sigue `prefers-color-scheme` y cambia con el dispositivo. Configuración permite volver a «Usar configuración del dispositivo». Los fondos, tarjetas, tablas, formularios, textos, bordes y estados adaptan su contraste; los controles nativos también reciben `color-scheme`. Configuración indica la elección actual o «Automática · según el dispositivo». El modo día utiliza tarjetas blanco roto (#FCFBFD); el nocturno usa fondos violeta oscuro sin negro puro. La elección se aplica antes de mostrar la página; los controles siguen funcionando si el navegador impide guardar preferencias.

## Exportación completa a Excel

«Exportar Excel completo» descarga un archivo `.xlsx` real. La hoja Cartera incluye condición, número de referencia del préstamo, código stand, fecha, celular, apellidos y nombres, DNI, monto prestado, interés inicial, total a cobrar, cuota semanal, columnas de cuotas, Saldo, estado, número de cuotas, día de pago, días de atraso y refinanciación. El número de referencia es una posición ordenada por fecha e ID, no un identificador persistido; también se exporta el ID del préstamo.

El libro tiene nueve hojas: Cartera, Cuotas, Pagos, Periodos, Refinanciaciones, Clientes, Cobros por semana, Cobros por mes y Guía. Los filtros seleccionan préstamos, pero se conserva su historial completo para conciliar saldos. Las columnas CUOTA muestran el importe abonado a cada cuota del periodo vigente, con un mínimo de ocho columnas; las cuotas anteriores quedan en Cuotas. El total a cobrar suma capital original e intereses de todos los periodos sin duplicar capital refinanciado.

Fechas y montos utilizan formatos de Excel; DNI, stand y celular se guardan como texto para conservar ceros. Los montos que exceden la precisión de Excel se conservan como texto decimal exacto. Guía explica estas reglas y los colores. Reportes permite descargar Excel y conserva los CSV existentes.

## Recepción de cobros

El detalle del préstamo permite escribir un monto libre, completar 1, 2 o 3 cuotas pendientes o liquidar todo el préstamo. Los accesos rápidos suman los importes restantes de las cuotas vigentes más antiguas; contemplan abonos parciales. Se deshabilita una opción si no hay suficientes cuotas pendientes. Liquidar utiliza capital pendiente + interés pendiente, sin descuentos.

Todos los botones solo preparan el monto: después se revisa la fecha y se pulsa «Confirmar pago». Se conserva la confirmación explícita y el RPC `record_payment`, que aplica el pago primero a interés y después a capital, asigna el importe a las cuotas en orden y liquida el préstamo al llegar a saldo cero. La fecha de vencimiento original no cambia al cobrar cuotas atrasadas juntas.

## Validación y actualización

Las pruebas Playwright verifican el acceso por rol, persistencia de sesión al volver a la pestaña, formularios, productos, confirmaciones, RPC de pagos/refinanciación, exportaciones y revisión XLSX. También recorren los módulos y detalles a 375, 430, 768, 1024, 1440 y 1920 px, comprobando que la página no tenga desbordamiento horizontal. Incluyen pagos de varias cuotas con un abono parcial previo, liquidación completa, descarga y lectura de XLSX con filtros y cambios de apariencia clara/oscura a 375 y 1440 px. Se generan capturas locales en `test-results/`, ignoradas por Git.

Las respuestas Supabase de estas pruebas están interceptadas; la suite PGlite comprueba las operaciones SQL localmente. Esto no acredita la integración ni la concurrencia en el proyecto Supabase de producción.

El rediseño se activa con el despliegue habitual de GitHub a Vercel. No requiere SQL adicional; un proyecto existente debe tener aplicadas previamente las migraciones 001, 002 y 003.

## Recordatorios personales por WhatsApp

El botón abre `wa.me` para el celular peruano del cliente con un texto preparado: nombre, número de cuota, fecha de vencimiento, saldo pendiente, estado de la cuota y días de atraso. Desde 7 días de atraso se indica «En mora». Si la cuota seleccionada tiene menos atraso que otra cuota pendiente del préstamo, el texto distingue el estado de esa cuota del atraso más antiguo del préstamo. Las cuotas históricas no generan mora; los abonos parciales reducen el importe solicitado y conservan la fecha de vencimiento.

En caso de atraso se incluye «El atraso puede generar penalidades según las condiciones de tu préstamo». No se ha definido un plazo de penalidad ni se generan cargos. La firma es «Atentamente, La Gerencia, PM Créditos».

El mensaje sale desde la cuenta de WhatsApp del operador cuando pulsa Enviar en WhatsApp. Abrir el enlace no envía automáticamente ni inicia solicitudes a un servicio de mensajería.

El WhatsApp de Clientes resume el saldo y estado de la persona y la cuota pendiente más antigua de cada préstamo activo, con días de atraso y advertencia general de penalidades. Para préstamos liquidados informa saldo cero y agradece los pagos; para clientes sin préstamos no inventa deuda. Los enlaces permanecen deshabilitados durante la carga, si hay error de consulta o si el celular no tiene formato peruano válido. Actualizar vuelve a consultar los movimientos mediante los permisos actuales del operador.

## Fin del plazo y liquidación urgente

La clasificación prioriza Liquidado y luego Liquidación urgente: préstamo activo, saldo positivo y fecha de Lima posterior al fin del periodo vigente. Dentro del plazo siguen aplicando Puntual, atraso de 1–6 días y En mora desde 7 días. El vencimiento de un periodo histórico no reemplaza al periodo vigente de una refinanciación.

Liquidación urgente utiliza rojo con texto, aparece primero en el panel y tiene un filtro propio. Clientes hereda este estado si cualquiera de sus préstamos requiere liquidación. Las cuotas vigentes con saldo de ese préstamo muestran la urgencia. El detalle y WhatsApp solicitan liquidar capital + interés pendientes completos; el monto corresponde al préstamo vencido, no a otros préstamos del cliente. Las fechas, los días de atraso y los abonos recibidos se conservan; la clasificación no crea penalidades ni modifica las operaciones financieras. Excel y CSV incluyen el estado.

## Producto S/2.000 por dos meses

La selección de préstamos incluye S/2.000 al 6 % mensual por dos meses: ocho cuotas de S/280, con S/240 de interés. En proyectos existentes se aplica únicamente la migración 004 después de las anteriores; permite el producto en el servidor y conserva las operaciones anteriores.

## Cuotas que vencen hoy

Panel general resalta en morado suave la fila y muestra «Vence hoy» en Día de pago cuando existe una cuota vigente, con saldo pendiente y vencimiento exactamente igual a la fecha de Lima. No se compara solo el día de la semana: una cuota de hace siete días sigue atrasada y no se resalta como vencimiento de hoy. Las cuotas pagadas y los periodos históricos no activan el resaltado. El estado de cobranza conserva su color y prioridad. La fecha se actualiza cada minuto y el resaltado adapta el contraste al modo noche y a las tarjetas de celular.

Cobros semanales e Historial de pagos ya no son módulos del menú. El Dashboard mantiene la agenda de cobros; los detalles de préstamo permiten cobrar, consultar pagos y preparar recordatorios. Reportes conserva sus exportaciones.

## Optimización operativa

Inicio prioriza Capital pendiente, Total cobrado, Cobros del día y Cuotas vencidas. Capital prestado, Intereses cobrados y recuentos de préstamos quedan en «Más indicadores de cartera». La agenda permite Hoy, Esta semana, Vencidos y Próximos 7 días, conservando el registro de pago y WhatsApp. Hoy/semana incluyen cuotas pagadas; vencidos/próximos muestran solo cuotas con saldo pendiente. Las cuotas históricas no contaminan la agenda.

La cartera de Préstamos conserva exactamente seis columnas; el nuevo préstamo se prepara junto a esta cartera y mantiene revisión de cronograma y confirmación del desembolso. Los detalles concentran pagos, liquidación y refinanciación. Reportes centraliza las exportaciones: Excel completo, resumen de cobranza filtrable y todos los informes anteriores en Excel/CSV, junto a agregados por semana/mes.

Para evitar recorridos repetidos se mantienen índices en memoria de clientes, préstamos y periodos vigentes. Se recalculan cuando cambia su origen, sin alterar consultas de Supabase ni importes.

## Consulta y sincronización

El rol `jefe` se identifica como Solo lectura y conserva los permisos de consulta existentes. La interfaz vuelve a leer clientes y operaciones tras eventos de Supabase Realtime, con respaldo cada 30 segundos y al recuperar el foco. El responsable debe habilitar la publicación Realtime y crear el usuario conforme a `docs/ACCESO-CONSULTA.md`. No se crean cuentas ni se modifica la publicación de producción desde el navegador.

## Panel general con acceso directo

Se restaura su entrada lateral y su título propio por la prioridad operativa de cobranza. Conserva las seis columnas, filtros por condición y estado, búsqueda por nombre/DNI/stand, urgencia, mora y resaltado del día. Abre el mismo detalle autorizado. El formulario de nuevo préstamo aparece solo en Préstamos; ambas vistas reutilizan la tabla y los cálculos, sin duplicar implementación ni añadir consultas por navegar entre ellas. La sincronización y el rol de consulta se mantienen.

## Refinanciación después del periodo (14/10/2026)

Las cuotas vencidas dejan de bloquear la operación. Interfaz y RPC 005 exigen préstamo activo con capital pendiente, interés cancelado y fecha de Lima posterior al vencimiento vigente. El nuevo mes comienza al día siguiente del vencimiento anterior, conserva tasa sobre capital original y genera cuatro cuotas semanales. El detalle muestra inicio y fin antes de confirmar; el historial previo permanece íntegro. El rol de consulta no puede ejecutar la operación. La migración 005 debe aplicarse en Supabase para actualizar también la validación del servidor.
