# Inicio: propuesta implementada y línea de evolución mensual

Se implementa la propuesta aprobada en [PROPUESTA-INICIO.md](propuestas/PROPUESTA-INICIO.md), incorporando la línea solicitada sobre las barras.

## Organización

- **Mi cartera:** una cabecera breve y un único botón para actualizar los datos de Inicio, incluida caja.
- **Resumen del negocio:** caja disponible, capital por recuperar e interés cobrado. Se eliminan las tarjetas duplicadas y la comparación de estos tres conceptos en barras sin una base común.
- **Cartera:** franja con préstamos activos, liquidados y penalidades cobradas aparte.
- **Recuperación de capital:** muestra lo desembolsado originalmente y su división en capital devuelto y pendiente. Si los datos no concilian, se explican los importes sin dibujar una proporción falsa. Refinanciar no añade otro desembolso.
- **Interés cobrado:** barras y una línea que conecta el importe exacto de cada barra en la misma escala. La vista mensual admite descensos y ceros; Acumulado suma desde el primer cobro. Los meses sin pagos entre el primer cobro y el mes actual se muestran con cero, sin saltos silenciosos. El mes actual se marca como en curso. No son pronósticos ni una tasa porcentual de crecimiento.
- **Detalle del gráfico:** tabla con importes exactos, selector de año cuando hay varios y desplazamiento dentro del gráfico para historiales largos. Acumulado conserva lo cobrado antes del año visible; el filtro cambia lo que se muestra, no reinicia la ganancia.
- **Próximos vencimientos:** hasta tres cierres de plazo, ordenados por fecha, con días restantes y acceso a la cuenta correcta. Los botones Ver panel y Revisar cobranza abren Panel general con la búsqueda limpia.

## Estados y seguridad

Se conservan el registro de apertura, aportes y retiros, su confirmación y sus permisos. Un usuario de consulta puede ver caja y préstamos sin registrar operaciones. Se mantienen el modo día/noche, el menú morado, la actualización silenciosa y los borradores de operaciones abiertas.

Sin apertura no se muestra cero como caja disponible. Una caja negativa conserva el signo y su advertencia. Sin cobros no se inventa una curva; un único mes muestra el punto correspondiente. Los textos y la tabla permiten leer la información sin depender del color.

No hay migración SQL ni cambios en tasas, plazos, cobros, refinanciación o RLS. Todos los datos del aplicativo proceden de las consultas existentes; los ejemplos de la maqueta no se incorporan al producto.

## Verificación

Pruebas con datos simulados cubren conciliación del capital, intereses de refinanciaciones, meses sin pagos, cambio de año, vistas mensual/acumulada, coincidencia de la línea con cada barra, subidas y bajadas, permisos, movimiento de caja, apertura de la cuenta correcta, navegación y sincronización. Se revisan móvil, escritorio, modo claro/oscuro y accesibilidad. Se comprueba también la compilación de producción.

- [Inicio claro, escritorio](capturas/inicio-linea-escritorio.png)
- [Inicio oscuro, móvil](capturas/inicio-linea-movil-noche.png)
