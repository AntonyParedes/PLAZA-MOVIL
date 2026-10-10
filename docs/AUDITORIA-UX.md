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
