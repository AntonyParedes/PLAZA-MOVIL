# Diseño de PM Créditos con apple-design

Referencias aplicadas: [skill original de Emil Kowalski](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) y [catálogo ui-skills](https://www.ui-skills.com/skills/emilkowalski/apple-design). La skill se leyó desde su fuente original; no se instalaron dependencias ni se ejecutó código del repositorio externo.

## Dirección visual

Una herramienta financiera tranquila y legible. Se conserva verde #4EB852, morado #9763A8 y el gris de marca. Navegación con tonos claros durante el día y oscuros por la noche, selección verde, fondos de contenido neutros y estados de cobranza semánticos. Los importes, etiquetas y estados siguen siendo información prioritaria.

Tipografía de sistema (San Francisco en dispositivos Apple, Segoe UI en Windows, fuente local como alternativa), cifras tabulares, títulos con espaciado ajustado y textos pequeños con aire suficiente. Fondos suaves, esquinas coherentes y sombras ligeras establecen profundidad; las barras superiores usan una sola capa translúcida de alcance limitado. Las tarjetas de caja tienen mayor jerarquía numérica que los indicadores secundarios.

La implementación compartida afecta Inicio, caja, Panel general, Clientes, Préstamos/refinanciación, Reportes/penalidades, Configuración, acceso y paneles laterales. El Panel general mantiene las siete columnas, los estados de atraso, mora y liquidación urgente, el resaltado del vencimiento de hoy y la búsqueda única por nombre/DNI/stand. No se alteran importes, reglas, consultas, roles ni operaciones financieras.

## Interacción y accesibilidad

- Respuesta visual inmediata al presionar, acciones con un mínimo de 44 px y foco visible morado.
- Solo paneles, menú y popover tienen entrada/salida breve con opacidad y transformación. Las pantallas, cifras y actualizaciones no tienen animaciones de entrada repetidas.
- No se simulan gestos ni se añaden arrastres a formularios. Se mantiene Radix para teclado, Escape, foco y cierre accesible.
- `prefers-reduced-motion` elimina desplazamientos y pulsaciones animadas. Las animaciones repetitivas se detienen.
- `prefers-reduced-transparency` elimina transparencias y desenfoque. `prefers-contrast: more` usa superficies opacas y bordes definidos.
- Campos de 16 px o más para evitar zoom al editar desde iPhone, respeto del tamaño de texto y áreas seguras del dispositivo.
- Hover limitado a los efectos decorativos de ratón; nada depende de hover para usarse.
- Los estados conservan etiquetas además del color. La lectura de datos sigue visible durante actualizaciones en segundo plano.

## Validación

El recorrido de Playwright «apple-design» visita los seis módulos, acceso y detalle de liquidación con datos simulados, en 375 y 1440 px, día/noche. Captura pantallas y comprueba desbordamiento, columnas del Panel general y disponibilidad de la penalidad. Otra comprobación usa texto al 125 %, contraste alto, movimiento reducido y navegación por teclado. Los archivos de revisión quedan en `test-results/` y no contienen datos reales ni se publican automáticamente.

Los cambios no necesitan una nueva migración SQL. La publicación usa el despliegue habitual de Vercel, manteniendo las migraciones que ya requiere cada función existente.

## Capturas de revisión

Capturadas en el navegador de pruebas con datos simulados; los importes y nombres no son datos de producción.

- [Inicio, escritorio y modo día](capturas/apple-inicio-dia.png)
- [Panel general, escritorio y modo noche](capturas/apple-panel-noche.png)
- [Clientes, celular](capturas/apple-clientes-movil.png)
