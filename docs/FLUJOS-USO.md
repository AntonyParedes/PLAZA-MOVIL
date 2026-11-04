# Flujos de uso de Rapi Créditos

La revisión aplica los criterios de apple-design de orden lógico, contexto, acciones cercanas a su objeto y revisión de operaciones irreversibles. Es una reorganización del trabajo cotidiano; las reglas de préstamos, pagos, refinanciación, caja y RLS siguen siendo las existentes.

| Tarea | Problema encontrado | Flujo revisado |
| --- | --- | --- |
| Crear préstamo | Se preparaban condiciones y cronograma antes de elegir al prestatario | Persona → condiciones → revisión con nombre, DNI, stand, capital, interés, total y cuotas → confirmar desembolso |
| Encontrar prestatario | Los clientes con deuda o identificación incompleta desaparecían de la lista | Búsqueda opcional por nombre/DNI/stand; opciones bloqueadas con explicación; acceso a Clientes conservando la búsqueda |
| Cambiar de persona | Una revisión podía continuar mientras se elegía otro cliente | Cambiar de prestatario invalida la revisión; si Realtime detecta una deuda nueva se bloquea el desembolso |
| Empezar desde Clientes | Había que cambiar de módulo y buscar otra vez | La ficha permite Nuevo préstamo con la persona ya elegida, o Registrar pago/Ver préstamo con su cuenta abierta |
| Registrar cliente | Stand y condición precedían al nombre | Nombres y apellidos → DNI → stand y condición → contacto → guardar |
| Cobrar | Mucha información contractual antes de la acción | Identidad y saldo visibles; datos completos en una sección desplegable; selección de cuotas, importe o liquidación; revisión de distribución y saldo resultante |
| Cambiar de cuenta al cobrar | El importe escrito podía quedar en la siguiente persona | Abrir otra cuenta reinicia importe, fecha, penalidad y mensajes; refrescar la misma cuenta conserva el borrador |
| Penalidad | Necesitaba quedar inequívocamente asociada a una liquidación | Sigue siendo optativa, solo tras vencer el periodo; se confirma el prestatario, saldo, penalidad aparte y total |
| Refinanciar | Las condiciones aparecían sobre todo como errores al final | Se explicita el estado del interés anterior y del plazo antes de fecha, meses y propuesta de cuotas |
| Caja | El efecto del aporte o retiro se veía después de registrar | Se muestra la caja prevista antes de confirmar; apertura también contempla cobros y préstamos ya registrados |
| Eliminar cliente | Una operación definitiva estaba junto a editar | Se separa al final de la ficha, manteniendo resumen, DNI y motivo obligatorios |
| Consultar/reportar | Riesgo de confundir lectura con operación | Jefe conserva únicamente consulta; Reportes y exportaciones mantienen la información financiera y el registro independiente de penalidades |

## Conservación de reglas y datos

- No hay migración SQL nueva. Las RPC, RLS y bloqueos transaccionales permanecen intactos.
- El cálculo del cronograma y distribución del pago usa los mismos métodos de céntimos existentes.
- Cambiar monto, plazo, fecha o prestatario invalida el cronograma revisado. La elegibilidad se vuelve a evaluar con datos actualizados y la base valida al confirmar.
- Las confirmaciones de desembolso y cobro identifican a la persona y explican el resultado antes de la operación.
- Los errores del servidor también aparecen junto a la confirmación del préstamo, para no obligar a buscar el mensaje fuera del formulario.
- Se mantienen Sidebar morado en modo claro, esquema de color, modos día/noche, teclado, tamaños táctiles y preferencias de accesibilidad.

## Identidad visual

El nombre visible se actualiza a **Rapi Créditos** en acceso, pestaña, navegación, configuración, exportaciones y mensajes de WhatsApp. Se incorpora una versión para pantalla del logo de Plaza Móvil a partir de la referencia aportada, preparada sobre fondo morado para la marca blanca. No se sustituyen claves internas de sesión/tema ni tablas de Supabase; se conserva la preferencia de apariencia del navegador.

## Verificación

Playwright cubre orden persona/condiciones, selección y búsqueda, invalidación de revisión, cuenta bloqueada por un préstamo nuevo, accesos desde Clientes, distribución del cobro, limpieza entre cuentas, previsión de caja y carga de nombre/logo. Las pruebas existentes verifican desembolsos, cuotas, penalidades, refinanciación, roles, caja, exportaciones, navegación y sincronización. Los recorridos usan datos simulados; no registran préstamos ni pagos reales.

## Exportación de cobranza

- **Cartera:** conserva identificación, monto, interés inicial, total a cobrar, cuota semanal, cuotas en columnas, saldo, estado, número de cuotas y día de pago. Se retiran de esta primera hoja las columnas adicionales de la captura, el ID y la penalidad cobrada.
- Se eliminan las hojas **Cuotas**, **Periodos**, **Clientes** y **Cobros por semana**.
- Se conservan **Pagos**, **Penalidades**, **Refinanciaciones**, **Cobros por mes** y **Guía**.
- **Resumen financiero:** siempre global, independiente del filtro de Cartera. Separa capital prestado y pendiente, interés generado/pendiente/cobrado, penalidades, total cobrado y saldo por cada préstamo. Incluye apertura, aportes, retiros, pagos recibidos, desembolsos y saldo disponible de caja, más los movimientos manuales con su motivo.
- La caja se consulta al exportar mediante la RPC existente `cash_summary`, conservando su fórmula y permisos. No se suma nuevamente el interés ni las penalidades ya incluidas en pagos recibidos. Se descargan todos los movimientos con paginación.
- Si falta configurar el monto inicial, el disponible queda vacío con explicación; no se representa como cero. Si falla la consulta de caja o sus movimientos, se informa el error y no se descarga un reporte incompleto.

## Capturas de la revisión

- [Inicio y marca Rapi Créditos en modo claro](capturas/apple-inicio-dia.png)
- [Panel general en modo noche](capturas/apple-panel-noche.png)
- [Clientes en pantalla móvil](capturas/apple-clientes-movil.png)
- [Préstamo con persona elegida y revisión en móvil](capturas/rapi-persona-primero-movil.png)
