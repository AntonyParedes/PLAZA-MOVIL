# Auditoría y modernización de PM Créditos

## Alcance

Se mejora el aplicativo existente: Next.js 16.4, React 19, TypeScript, Tailwind 4, Radix UI y Lucide. La única ruta de producto es `/`; las secciones se gestionan dentro del área autenticada. Se conserva Supabase como origen de datos. No se cambian migraciones, contratos de API, cálculo financiero, autenticación ni permisos.

## Diagnóstico previo

| Prioridad | Hallazgo | Resolución |
| --- | --- | --- |
| Alta | Dos buscadores simultáneos en escritorio comparten el mismo estado y repiten la tarea. | Una búsqueda contextual por pantalla, con botón para limpiar; componente reutilizable. |
| Alta | Refinanciaciones es un acceso lateral separado aunque consulta los mismos préstamos y abre el mismo detalle. | Agrupar dentro de Préstamos; mantener revisión, historial, exportación y operación en una pestaña interna. |
| Media | Operaciones, reportes y herramientas compiten en una lista plana. | Agrupaciones visibles: Operaciones, Análisis y Herramientas. |
| Media | Descripciones genéricas no orientan la próxima acción. | Textos específicos para cobranza, préstamos, refinanciaciones y reportes. |
| Media | Tablas anchas carecen de acceso explícito por teclado a su área desplazable. | Región etiquetada y enfocable en el componente de tabla común. |
| Baja | Filas de escritorio ocupan espacio adicional y las cifras necesitan alineación consistente. | Espaciado algo más compacto y cifras tabulares para saldos, cuotas y montos. |

## Navegación resultante

- Operaciones: Dashboard, Panel general, Clientes y Préstamos.
- Dentro de Préstamos: Préstamos y Refinanciaciones. El menú lateral indica Préstamos activo en ambas vistas.
- Análisis: Reportes.
- Herramientas: Configuración y Revisar Excel (este último solo para administrador).
- Menú de cuenta: Configuración y Cerrar sesión.

Se conservan los cobros y la liquidación en el detalle del préstamo; el historial por préstamo y las exportaciones siguen disponibles. El panel general mantiene las seis columnas solicitadas. Los clientes conservan saldo y ganancia visibles, contacto por WhatsApp y detalles desplegables en la misma página.

## Sistema visual y accesibilidad

Se reutilizan botones, tarjetas, indicadores, panel de detalle y colores existentes: verde, morado y neutros. El modo día/noche y la preferencia del dispositivo siguen disponibles. Los estados conservan etiquetas además del color; el vencimiento de hoy mantiene su resaltado. La navegación móvil sigue siendo un diálogo con cierre mediante Escape; las tablas se presentan como fichas en pantallas pequeñas. Se conserva el enlace para saltar al contenido, los focos visibles y las áreas interactivas de al menos 44 px.

La revisión automatizada de navegación y formularios no equivale a una certificación completa WCAG. Queda pendiente validar con usuarios reales y lector de pantalla en sus dispositivos.

## Publicación

Los cambios se preparan en `mejora/experiencia-navegacion`. No se publican en `main` ni se despliegan a producción automáticamente. Las pruebas con Supabase simulado verifican interfaz y solicitudes; no prueban la configuración de la base de datos de producción.

## Validación ejecutada

- Compilación de producción, ESLint y TypeScript: correctos.
- Pruebas de lógica y PostgreSQL local: 46 aprobadas.
- Playwright con Supabase simulado: 30 aprobadas; navegación a 375, 430, 768, 1024, 1440 y 1920 px, roles, sesión, clientes, cobros, refinanciación, WhatsApp y XLSX.
- Capturas revisadas de la navegación reorganizada en escritorio y móvil; modos día y noche. Se generan en `test-results/navigation-after-*.png` (artefactos locales, no versionados).
- No se ejecutaron operaciones contra Supabase de producción ni se validó un despliegue remoto.

## Segunda revisión: cinco módulos y foco en cobranza

Problemas de prioridad alta: ocho indicadores iniciales compiten con la agenda; tres listas de próximos cobros repiten cuotas; la cartera de Préstamos duplica el Panel general; las exportaciones están repartidas entre módulos. La navegación tenía siete entradas después de la primera revisión.

Implementación: cinco módulos (Inicio, Clientes, Préstamos, Reportes, Configuración); cartera de seis columnas y nuevo préstamo reunidos; refinanciaciones internas; revisión Excel interna a Configuración. Cuatro indicadores principales y otros cuatro desplegables; una sola agenda con cuatro vistas. Todas las exportaciones siguen disponibles desde Reportes, incluido el resumen filtrado. Mantener la revisión de condiciones de refinanciación y los informes por semana/mes conserva sus diferencias operativas. No se eliminan datos ni funcionalidades por rol.

La auditoría confirma que la lectura financiera ya pagina y carga tablas en paralelo; los cambios de vista no vuelven a solicitar esos datos. Se reemplazan búsquedas lineales repetidas por índices memorizados. Se mantiene la descarga XLSX diferida y no se añaden dependencias.

El archivo de requisitos recibido termina cortado en «Fór…». Se aplica el alcance íntegro disponible, manteniendo las restricciones previas sobre base de datos, fórmulas, API, permisos y publicación sin producción.

## Validación de la segunda revisión y acceso de consulta

Compilación, ESLint y TypeScript aprobados; 46 pruebas de lógica aprobadas. Se ejecutaron los 34 casos de Playwright: 33 pasaron en el conjunto completo; el caso nuevo de Realtime requirió corregir el simulador al protocolo Phoenix 2.0 utilizado por la dependencia instalada. Los dos casos de sincronización se repitieron y pasaron, cubriendo los 34 casos. La prueba comprueba cambio de saldo mediante eventos, respaldo de 30 segundos y ausencia de solicitudes de escritura para consulta. La inspección visual confirma el Inicio compacto y las cinco entradas de navegación.

Se reutiliza el rol `jefe`; se muestra como Solo lectura. Crear la cuenta y habilitar la publicación Realtime requieren al responsable del proyecto, con instrucciones concretas en `docs/ACCESO-CONSULTA.md`. No existe una URL de vista previa disponible y no hay credenciales administrativas de Vercel o Supabase en este entorno. Se publica únicamente la rama de revisión, sin modificar `main` ni producción.

## Corrección tras revisión del usuario: Panel general

La integración dentro de Préstamos dificultaba encontrar la herramienta principal de cobranza. Se restaura Panel general como acceso directo y se mantienen las mejoras de Inicio, refinanciaciones y configuración internas, exportaciones centralizadas y sincronización. El menú pasa a seis entradas. Panel general conserva la tabla de seis columnas y evita el formulario de desembolso; Préstamos incorpora esa operación, reutilizando tabla y cálculos. No cambia la base de datos ni los contratos financieros.

Validación de la restauración: compilación, lint y TypeScript correctos; 13 casos de navegador aprobados, incluidos acceso directo para ambos roles en móvil/escritorio, seis columnas, estados urgentes, resaltado de hoy y operaciones financieras preservadas.
