# ADR-017: La app es una SPA (`ssr: false`) — el servidor no puede renderizar nada real

**Status**: Accepted

**Date**: 2026-07-30

## Context

Nuxt venía con SSR activo por defecto, sin que fuera una decisión: nadie lo eligió, era
el default del framework.

**Toda ruta de la app está detrás de `auth`.** No hay catálogo público, ni landing, ni
nada indexable: `/login`, `/register` y `/forgot-password` son el flujo de autenticación
y el resto exige sesión. El token vive en el cliente, así que **el servidor no tiene con
qué autenticarse** contra el backend.

La consecuencia era que el SSR renderizaba una app vacía: el menú lateral
(`layouts/dashboard.vue`) arma sus ítems desde `permissionsStore`, que en el servidor
está sin poblar, así que el HTML del servidor traía un menú incompleto.

Eso pasó desapercibido mientras el cliente también hidrataba con el store vacío —los dos
lados coincidían *por casualidad*, y el menú se completaba después—. El barrido de
permisos de jul-2026 rompió la casualidad: los middlewares `admin` y `permiso` esperan
`permissionsStore.ensureCargado()` antes de decidir, así que en una carga dura el cliente
llega a hidratar con el store **ya poblado** y el servidor había renderizado el menú
vacío.

Verificado en navegador contra el stack real: `/cajas/historial` y
`/configuracion/impuestos` tiraban `Hydration node mismatch` + `Hydration completed but
contains mismatches`; `/inventario` —misma layout, sin middleware de permisos— no.

No rompía la pantalla (Vue re-renderiza el subárbol), pero ensuciaba la consola y tapaba
mismatches reales.

## Decision

**`ssr: false` para toda la app.** Es una SPA.

Descartado: `routeRules` por ruta. Habría que mantener a mano la lista de rutas con
middleware de permisos, y el default seguiría siendo el equivocado — la próxima pantalla
con guard nace rota. El corte natural no es "algunas rutas": es que **ninguna** ruta puede
renderizarse en el servidor.

Consecuencias directas de la decisión, aplicadas en el mismo commit:

- **Se borra la `runtimeConfig.apiUrl` privada** y su `API_INTERNAL_URL` en
  `docker-compose.yml` y en `frontend/Dockerfile.prod`. Existían para que el servidor de
  Nuxt llamara al backend por la red interna de Docker en vez de hacer loopback contra sí
  mismo. La leían `app/stores/auth.ts` y `app/stores/tenant.ts`, y **solo** detrás de
  `import.meta.server`, que con `ssr: false` nunca es verdadero; las dos tienen fallback a
  `config.public.apiUrl`, así que borrarla no cambia ningún camino alcanzable.
- **Se agrega `app/spa-loading-template.html`**: sin SSR la carga dura arranca en blanco
  hasta que baja el bundle. El SSR al menos pintaba el shell; el loader recupera eso.

## Consequences

**A favor**

- Desaparece la clase entera de bugs de hidratación. No hay dos renders que conciliar.
- El resumen de build de Nitro baja de **11,5 MB a 2,1 MB** (2,46 MB → 506 kB gzip): ya no
  se empaqueta el runtime de render server-side. Es la cifra que imprime `npm run build`,
  no el peso de `.output` en disco (4,8 MB, porque incluye los assets del cliente).
- Un solo entorno de ejecución. Se termina el "¿esto corre en el servidor?" en cada
  composable, `onMounted` y middleware — la pregunta que hacía que el guard viejo de las
  seis pantallas de caja se escribiera en `onMounted` en vez de en un middleware.
- Nitro sigue construyéndose y `node .output/server/index.mjs` sigue sirviendo la app.
  No cambia el despliegue.

**En contra**

- **First paint más lento**: nada visible hasta que baja y ejecuta el JS. Mitigado con el
  loader, no eliminado. Es un POS que se usa por turnos completos en LAN, no un sitio de
  visita única: la carga dura ocurre una vez por turno.
- **Sin SEO ni previsualizaciones de link.** Hoy no cuesta nada: no hay nada público. Si
  algún día se agrega un catálogo público o una landing, esta decisión **debe revisarse**
  — y ahí sí `routeRules` es la herramienta, para prerenderizar *esas* rutas.
- Los tests que dependían de HTML del servidor no existen; los de navegador
  (`npm run e2e`) esperan por `networkidle`, así que no los afecta.

## Alternatives considered

- **Dejar el SSR y aceptar los warnings.** El costo no es el ruido: un mismatch conocido
  y tolerado entrena a ignorar la consola, y el próximo —uno real— pasa desapercibido.
- **Dejar el SSR y sacar la espera de `ensureCargado` de los middlewares.** Revierte un
  arreglo correcto por una razón equivocada: sin esa espera, un admin entrando por URL
  directa o F5 se lee como no-admin y queda expulsado de su propia pantalla.
- **Poblar el store en el servidor.** Requiere que el token viaje en cookie legible por el
  servidor. Es rediseñar la autenticación (ADR-001, ADR-003) para ganar un SSR que nadie
  necesita.
