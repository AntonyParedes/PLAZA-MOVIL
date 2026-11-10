# Propuesta de rediseño de Inicio · Rapi Créditos

[Maqueta interactiva](inicio.html) · [Escritorio claro](inicio-escritorio-claro.png) · [Móvil claro](inicio-movil-claro.png) · [Móvil oscuro](inicio-movil-oscuro.png)

## Diagnóstico

La interfaz no permite deducir quién la creó. Sí presenta rasgos de una plantilla genérica: muchas tarjetas similares, información repetida, iconos decorativos y títulos intercambiables con cualquier aplicación financiera. El problema es de jerarquía y de selección de información, no de añadir más efectos.

Se revisaron las capturas aportadas y el código actual de Inicio (`cash-overview`, `financial-charts`, `financial-workspace` y `app-shell`). Las capturas aún incluyen el buscador y la agenda que ya se retiraron en `9538224`; ambos quedan fuera de esta propuesta.

| Hallazgo | Efecto sobre el uso | Cambio propuesto |
| --- | --- | --- |
| Caja, capital pendiente e interés aparecen en las tarjetas y se repiten en barras; el interés vuelve a aparecer en Más indicadores | Se alarga la página sin responder una pregunta nueva | Un solo resumen principal con esos tres importes |
| Las barras comparan caja disponible, deuda pendiente y ganancia, que no son partes de un mismo total | La diferencia de longitud tiene poco significado y obliga a explicarla con un párrafo | Sustituirlas por capital devuelto frente a capital pendiente: dos partes del mismo capital entregado |
| Tarjetas casi idénticas para todos los conceptos, con bordes y esquinas repetidos | Todo parece igual de importante; aspecto de componentes ensamblados | Un único bloque principal; gráficos sobre el fondo; lista con divisores y una franja secundaria discreta |
| Sin configurar ocupa el mismo lugar que una gran cifra y se explica de nuevo más abajo | El estado incompleto domina la pantalla sin facilitar la solución | Estado breve Falta registrar la apertura, con Configurar mi caja junto al dato |
| Exceso de fórmulas y notas bajo cada indicador | La pantalla obliga a leer antes de operar | Una línea de significado; fórmula y movimientos dentro de Ver caja |
| Gráfico mensual muy separado, sin opción de distinguir ingreso mensual de acumulado | Cuesta entender cuánto entró en cada mes y cuánto se lleva ganado | Vistas Por mes y Acumulado, importes visibles y tabla accesible |
| Más indicadores repite información y esconde el número de activos y liquidados | Los datos útiles quedan enterrados entre duplicados | Franja compacta: activos, liquidados y penalidades cobradas |
| Próximos vencimientos se recorre sin ordenar explícitamente por fin de periodo en el código | Un vencimiento lejano puede aparecer antes que el más cercano | Lista visible, ordenada por fecha ascendente, con fecha, persona y días restantes |
| Las capturas del teléfono parecen una vista ancha reducida | El texto queda muy pequeño y las acciones se perciben lejanas | Validar viewport, zoom y modo escritorio del navegador; diseño real a 375–430 px, sin depender de reducir todo el escritorio |

La última observación es una hipótesis: una captura no permite confirmar la configuración del navegador. El código ya usa cambios de distribución para pantallas pequeñas, por lo que no debe atribuirse automáticamente todo el problema a CSS.

## Dirección visual recomendada

Una interfaz sobria con identidad de Plaza Móvil, más parecida a una herramienta de trabajo cuidada que a una colección de tarjetas. Se conserva el menú morado, el logo pequeño y la familia de colores verde, morado y gris. La personalidad se construye con composición, tipografía y proporciones.

- Fondo claro cálido y superficies blancas. En noche, carbón con matiz morado; sin negro y blanco deslumbrantes.
- Un resumen principal con tres divisiones. Caja a la izquierda; capital por recuperar e interés cobrado a su lado. En móvil se reordena como una sección compacta, sin tres tarjetas aisladas.
- Números grandes y alineados, símbolo S/ secundario, etiquetas claras. El verde identifica importes recibidos o disponibles; el morado caracteriza la serie de intereses; gris indica capital pendiente. Alertas de cobranza conservan su semántica.
- Menos iconos decorativos, menos sombras y menos contenedores. Los botones se reservan para acciones reales.
- Una acción contextual para configurar/ver caja. Actualización silenciosa con estado breve; un reintento visible cuando falle, sin dos botones de refrescar compitiendo en la cabecera.

## Estructura de Inicio

1. **Cabecera breve:** Mi cartera, fecha y estado de actualización. Se conserva el acceso al menú, apariencia y usuario del aplicativo.
2. **Resumen del negocio:** caja disponible, capital por recuperar e interés efectivamente cobrado. Todo el historial, como se acordó. Sin repetir estos tres números en un gráfico genérico debajo.
3. **Franja de cartera:** cantidad de préstamos activos, liquidados y penalidades cobradas por separado.
4. **Recuperación de capital:** capital original desembolsado una sola vez, dividido entre capital efectivamente devuelto y capital pendiente. Se mostrará como proporción únicamente cuando ambas partes concilien. Si no concilian, presentar los importes separados y un aviso de revisión; no inventar un porcentaje.
5. **Interés cobrado:** barras por mes; alternativa acumulada. La selección cambia la lectura del gráfico, no el periodo global del resumen. Los meses actuales se identifican como en curso; no se promete crecimiento comparando un mes incompleto con uno cerrado. Con muchos meses, elegir año/Todos y mantener alternativa en tabla; no comprimir decenas de barras en el teléfono.
6. **Próximos vencimientos:** hasta tres cierres de plazo próximos, ordenados por fecha, y Ver panel. No vuelve la agenda semanal retirada. Las cuotas vencidas se resumen en una sola alerta que enlaza al Panel general.

En móvil, los gráficos van uno debajo del otro. Los datos de capital y ganancia se alinean en filas legibles. Se priorizan acciones de al menos 44 px y se evita el desplazamiento horizontal de toda la página. La maqueta contiene un rótulo y controles de comparación exclusivos de la propuesta; estos no formarían parte del aplicativo.

## Estados que debe cubrir la implementación

- **Sin apertura:** caja sin importe, acción Configurar mi caja para administrador; explicación y consulta sin escritura para jefe.
- **Caja negativa:** conservar el signo y explicar que necesita revisión; no mostrarla como dinero disponible para prestar ni dibujar un porcentaje positivo.
- **Sin préstamos o pagos:** mensaje breve en el espacio correspondiente; sin columnas, porcentajes o tendencia inventados.
- **Datos históricos extensos:** navegación por año o tabla; conservar Todo el historial como referencia de los totales.
- **Fallos de actualización:** conservar la última información con su fecha, distinguir datos antiguos y ofrecer reintento.
- **Vencimientos:** especificar si se trata del cierre del plazo o de una cuota; mantener mora desde 7 días y liquidación urgente al finalizar el plazo con saldo.
- **Accesibilidad:** etiquetas además del color, teclado, foco visible, cifras exactas en tabla y respeto por movimiento reducido.

## Datos y alcance de esta propuesta

La maqueta es un HTML autónomo con datos ilustrativos y sin conexión a Supabase. Permite alternar día/noche, caja configurada/sin configurar y gráfico mensual/acumulado. Los enlaces de operación explican su destino mediante una ventana de muestra; no crean registros.

Ejemplo coherente usado para caja configurada: apertura S/20.000, desembolsos S/14.000 y cobros S/6.260 dan caja S/12.260. Los cobros del ejemplo se descomponen en capital S/5.455, interés S/695 y penalidades S/110. Estas cifras no afirman el saldo real del negocio. La versión inicial muestra caja sin configurar, como en la captura.

Una implementación reutilizaría las consultas, reglas financieras y permisos existentes. No necesita cambiar RLS, tasas, plazos ni la distribución de pagos. La maqueta muestra una dirección de diseño; el código y la publicación del aplicativo permanecen fuera de este entregable.

## Implementación aprobada

El usuario aprobó esta dirección y solicitó una línea sobre cada barra mensual. La implementación se documenta en [INICIO-REDISENO.md](../INICIO-REDISENO.md); esta maqueta permanece como referencia del diseño propuesto.
