# Revisión de Inicio: información financiera y gráficos

## Situación observada

Inicio muestra Caja disponible e Interés cobrado (globales), luego cuatro indicadores de cartera, una tabla de cuotas y dos bloques desplegables. Predominan los números aislados; no hay evolución temporal ni una distribución visual del saldo pendiente. La búsqueda afecta a los indicadores de cartera pero no a caja, por lo que comparar ambas áreas sin aclarar su alcance puede confundir.

El número actual de cuotas vencidas se calcula contando por fecha sin excluir explícitamente cuotas históricas ni pagadas; se corrigió al reorganizar estos indicadores. El estado de cobranza debe proceder del mismo cálculo que el Panel general: atraso de 1–6 días, mora desde 7 días y liquidación urgente cuando termina el periodo con deuda.

## Organización acordada y aplicada

1. **Disponibilidad actual:** caja disponible y capital pendiente de recuperar; cifra y gráfico de barras con etiquetas en soles. El interés pendiente se muestra separado, pues aún no es ganancia. Si falta apertura de caja, se explica sin mostrar cero; los saldos negativos conservan su signo.
2. **Ganancia y recuperación durante el tiempo:** barras mensuales separadas de interés cobrado, capital devuelto y penalidades. Los desembolsos originales pueden compararse con el capital recuperado; las refinanciaciones no son nuevos desembolsos. Se acordó todo el historial por defecto. Se grafica el interés cobrado por mes y se ofrece una tabla con interés, capital devuelto y penalidades.
3. **Prioridad de cobranza:** barras horizontales del saldo pendiente agrupado por puntual, atrasado, mora y liquidación urgente, con número de préstamos y acceso al Panel general. Los préstamos liquidados no forman parte del saldo pendiente.
4. **Acción inmediata:** conservar debajo los cobros de hoy/semana y sus botones de pago y WhatsApp. Los gráficos aportan contexto sin sustituir el trabajo de cobranza ni quitar el Panel general.

## Reglas de lectura

- Separar siempre las existencias de hoy (caja y deuda pendiente) de los movimientos de un periodo (cobros, desembolsos, aportes, retiros).
- Ganancia significa interés efectivamente cobrado; el capital devuelto no es ganancia. Penalidades tienen una serie propia.
- Los pagos se agrupan por su fecha de pago en Lima, no por fecha de creación ni vencimiento.
- El capital refinanciado no se suma otra vez al capital desembolsado. Se conservan todos los cobros históricos.
- Se acordó todo el historial y los mismos tres conceptos principales para el resumen Excel. La misma terminología debería aparecer en Inicio y Excel.
- Dar a cada gráfico título, leyenda, importes y alternativa en tabla; no depender únicamente del color. Usar verde y morado existentes, con contraste en día/noche y movimiento reducido.
- Mantener los datos al refrescar, sin pantalla en blanco ni pérdida del formulario abierto. Conservar consulta para jefe y escrituras exclusivas del administrador.

Se acordó priorizar caja disponible, capital por recuperar e interés cobrado. Se implementan los bloques 1, 2 y 4; el gráfico adicional por estado del bloque 3 queda como mejora posible, sin duplicar por ahora el Panel general. El Excel presenta los mismos tres conceptos primero, luego el cálculo de caja. No mezcla el dinero disponible con la ganancia ni vuelve a desembolsar el capital refinanciado.

## Capturas verificadas

- [Inicio con gráficos, escritorio claro](capturas/apple-inicio-dia.png)
- [Inicio con gráficos, móvil noche](capturas/inicio-graficos-movil-noche.png)

Pruebas con datos simulados comprueban separación de hojas, acumulación de capital e interés tras refinanciar, conservación de filtros, acceso de consulta, gráficos globales, navegación, ausencia de desbordamiento y cálculo de caja. No hay migración SQL ni cambios en RLS.
