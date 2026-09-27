# ADR-027: Gráficas con Unovis — SVG pintado con los tokens, y siempre al lado de una tabla

**Status**: Accepted

**Date**: 2026-09-21

## Context

Hasta el reporte de varianza la app no tenía **ninguna** gráfica: los números se leían en tablas
y tarjetas. La varianza necesita una lectura de un vistazo —*¿en qué productos se me va la
plata, y por qué?*— que la tabla paginada no da: diez productos, y en cada uno cuánto es merma,
cuánto cortesía y cuánto no tiene explicación.

Dibujarla exige una dependencia nueva, y una dependencia nueva la decide el owner (`CLAUDE.md`,
"Detenerse y preguntar"). La decisión quedó en la spec del frente
(`docs/superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md` § 2), textual:
*"vamos con unovis"* — `@unovis/vue` + `@unovis/ts`, licencia Apache-2.0, `peerDependencies`
`vue ^3`. Es la **única** dependencia nueva que ese frente tiene aprobada.

Dos restricciones que ya existían condicionan cómo se usa:

- **El design system prohíbe colores fuera de los tokens** (`frontend/docs/DESIGN-SYSTEM.md`,
  `design:check`): el modo oscuro y el theming por tenant salen de las variables CSS de Nuxt UI.
- **La app es SPA** (ADR-017) y la pantalla tiene que seguir sirviendo si la gráfica no monta.

## Decision

**Toda gráfica pasa por `app/components/AppGrafica.vue`**, que envuelve Unovis. Hoy dibuja barras
horizontales apiladas; el contrato es `series` (nombre, **token de color**, valores como string),
`categorias`, `formato`, y los estados `cargando` / `vacio` / `fallo`.

1. **Colores por token, nunca por literal.** Cada serie nombra un color semántico (`error`,
   `warning`, `info`…) y la barra se pinta con `var(--ui-<color>)`. Unovis dibuja **SVG**, así que
   el navegador resuelve la variable en el momento de pintar: el modo oscuro y el tema del tenant
   salen solos. Ejes, grilla y tooltip se atan a los tokens por las variables `--vis-*` de Unovis.
   Un `#hex` en el JS quedaría fijo en los dos temas.
2. **El texto lo pone el llamador** (`formato`). La gráfica no sabe de monedas ni de unidades; los
   valores llegan como string y se pasan a `number` **solo** para el largo de la barra —geometría,
   no plata—. Lo que la persona lee sale del string original.
3. **La gráfica acompaña a una tabla y nunca es la fuente de verdad.** El número exacto vive en la
   tabla de la misma pantalla; la gráfica va dentro de `<ClientOnly>` y nada de la pantalla la lee.
   Si Unovis no monta, se pierde el vistazo, no el dato.
4. **El tooltip escapa lo que tipeó el local.** Unovis inyecta el tooltip como HTML, y los nombres
   de producto los carga el usuario.

## Consequences

**Positivo**

- El próximo reporte con gráfica no decide nada de esto: pasa series y un `formato`.
- Modo oscuro sin trabajo extra, y `design:check` sigue siendo la red para los colores.

**Negativo / a sabiendas**

- **Una dependencia más, y pesa.** Medido el 2026-09-21: `npm install` sumó **161 paquetes**
  transitivos. `@unovis/ts` declara 69 dependencias directas: 23 módulos de d3 y además lo que
  usan sus otros tipos de gráfica —mapas (`leaflet`, `maplibre-gl`), `three`, `elkjs`—, que el
  build descarta porque no se importan. En el bundle entra solo por las pantallas que la usan: el chunk
  perezoso de `/reportes/varianza` —página más Unovis— pesa 185 KB, **63 KB gzip**, y el chunk
  de entrada lo referencia solo por `import()`. Una gráfica en una pantalla que se abre siempre
  (el inicio) lo metería en la carga de todos.
- **happy-dom no calcula layout**, así que los specs de render no ven la gráfica dibujada: mockean
  `@unovis/vue` y aseveran sobre lo que `AppGrafica` le pasa (datos, accessor de color, rótulos).
  Que las barras se vean y se lean en los dos temas se comprueba en el navegador — y hace falta:
  la primera versión pasaba todos sus specs y **dibujaba el top al revés** (Unovis pone la
  posición 0 abajo) con los nombres largos partidos en tres renglones encima de la barra vecina.
  Lo vio la captura, no el test; los dos quedaron fijados en el spec después.
- **Una serie mezcla monedas si los productos del top las mezclan**: el largo de la barra no es
  comparable entre monedas. La pantalla que la use tiene que decidir qué hacer con eso; la de
  varianza lo resuelve graficando solo la moneda oficial (ver `docs/features/reporte-varianza.md`).
