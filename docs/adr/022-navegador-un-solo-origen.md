# ADR-022: El navegador habla con un solo origen — el frontend hace de proxy de `/api`

**Status**: Accepted

**Date**: 2026-08-23

## Context

El navegador llamaba al backend directo, con su URL absoluta (`VITE_API_URL`) horneada en
el bundle en tiempo de build. **En local funciona y desplegado no**, y la diferencia no es
de configuración sino de cómo el navegador define «sitio»:

- En desarrollo, `localhost:5173` y `localhost:3000` se diferencian **solo en el puerto**, y
  el puerto **no cuenta** para decidir si dos URLs son del mismo sitio. Son same-site.
- En Railway, `frontend-production-c0db.up.railway.app` y
  `backend-production-8635.up.railway.app` tienen **dominios registrables distintos**, porque
  `up.railway.app` está en la [Public Suffix List](https://publicsuffix.org/) (verificado el
  2026-08-23). Son **cross-site**.

La cookie de refresh se emite con `SameSite=Lax` (`auth.controller.ts:41`), y una cookie
`Lax` no viaja cross-site. Resultado medido contra el demo vivo el 2026-08-23: el login
devolvía 200, pero `POST /auth/switch-tenant` contestaba **401 «No refresh token»** y no se
podía entrar. El backend estaba sano —con `curl` y un cookie jar el flujo completa—, CORS
estaba bien configurado (`allow-credentials: true` y el `allow-origin` correcto) y el
cliente también (`credentials: 'include'` en todas las llamadas).

**Lo que hace peligroso a este bug no es su arreglo, es su forma:** ningún test lo podía
cazar, porque en local la app es same-site y funciona. Existía solo desplegado.

## Decision

**El navegador habla con un solo origen: el del frontend.** `runtimeConfig.public.apiUrl`
pasa a ser `/api`, **relativa y constante** — deja de ser una variable de entorno. Un
catch-all de Nitro (`frontend/server/api/[...].ts`) reenvía cada `/api/**` al backend con
`proxyRequest` de h3, que forwardea cabeceras (incluidas `Cookie` y `Authorization`),
cuerpo, código de estado y `Set-Cookie`.

**Un proxy transporta; no interpreta ni amplía.** Las dos cosas que eso obliga no son
opcionales, y las dos se midieron rotas antes de cerrarlas:

- **`redirect: 'manual'`.** `proxyRequest` usa el `fetch` de Node, que por defecto **sigue**
  los 3xx. Sin esto el servidor consume la redirección y le devuelve al navegador un 200 con
  lo que resultó de haber ido él. Rompe el login con Google, que es una navegación de nivel
  superior a `/api/auth/google` donde el backend contesta 302 hacia `accounts.google.com`:
  medido, esa ruta pasaba de **302 a 200** y el usuario nunca llegaba a la pantalla de Google.
- **La ruta se normaliza y se ancla a `/api`.** `event.path` llega cruda, sin normalizar, y
  el `..` lo resuelve el parser de URL del fetch saliente **después** de salir del handler:
  medido, `/api/../algo` llegaba al backend como `/algo`, fuera del prefijo. Hoy no hay nada
  montado ahí, pero eso es una propiedad del backend de hoy y no una barrera — el día que
  exista un endpoint fuera de `/api`, este proxy lo publicaría sin que nada avise.

Consecuencias directas, aplicadas en el mismo commit:

- **La cookie de refresh es same-origin por construcción.** No hay ninguna configuración que
  la pueda volver cross-site.
- **CORS sale del camino real.** Sigue configurado en el backend para clientes que peguen
  directo a la API, pero el navegador ya no depende de él.
- **El destino del proxy se lee de `process.env.API_PROXY_TARGET` en cada request**, no de
  `runtimeConfig`. `nuxt.config.ts` se evalúa en el **build**: cualquier cosa que se resuelva
  ahí queda horneada en la imagen. Eso es lo que obligaba a reconstruir para cambiar de
  backend, y es la trampa que esta decisión elimina. Por eso también desaparece el
  `ARG VITE_API_URL` de `Dockerfile.prod`.
- **`API_PROXY_TARGET` sustituye a `VITE_API_URL`** en `docker-compose.yml` (`http://backend:3000`,
  la red interna), `.env.example` y CI.
- **Desarrollo y producción usan el mismo camino.** No es un detalle: la causa de este bug
  fue precisamente que dev y prod tenían formas distintas. Un proxy que solo existiera
  desplegado sería código que nunca corre en local — el mismo error con otro disfraz.

Esto **no contradice** [ADR-017](./017-spa-sin-ssr.md). Aquella decisión apagó el
*renderizado* server-side y borró la `runtimeConfig` privada que alimentaba el fetching del
servidor; ésta usa el servidor para **transportar**, no para renderizar. ADR-017 ya dejaba
dicho que «Nitro sigue construyéndose y `node .output/server/index.mjs` sigue sirviendo la
app»: es exactamente lo que hace posible este proxy.

## Consequences

**A favor**

- El demo vuelve a dejar entrar, y la clase entera de bugs de cookie cross-site desaparece
  en vez de quedar permitida.
- Un salto menos de configuración: el navegador no necesita saber dónde vive el backend.
- Cambiar de backend es una variable de entorno y un reinicio, no un rebuild.

**En contra**

- **Un salto de red más por request.** Navegador → Nitro → backend. En Railway hoy ese salto
  sale a la red pública; usar la red privada (`*.railway.internal`) lo bajaría y queda como
  mejora, no como requisito.
- **El servidor del frontend pasa a ser parte del camino crítico.** Si se cae, la API deja de
  ser alcanzable aunque el backend esté sano. Antes eran dos caídas independientes.
- **Una variable mal puesta da 502 en vez de fallar en el build.** Es a propósito: 502 se
  diagnostica; una URL horneada mal no se ve hasta que un humano intenta entrar.
- **Un proxy es superficie propia que hay que mantener correcta.** No alcanza con que las
  llamadas «funcionen»: hay que sostener que transporta sin interpretar. Las dos propiedades
  de arriba son la deuda concreta de esto, y las encontró la revisión independiente del diff
  —no la suite—, con el login en verde mientras el redirect ya estaba roto.
- **No habilita cerrar el backend a internet.** El retorno de la pasarela y el callback de
  Google entran **directo al backend** por `API_PUBLIC_URL` / `GOOGLE_CALLBACK_URL`, no por
  este proxy. Sigue teniendo que ser públicamente alcanzable.
- **Dos límites que hoy no muerden y llegan con features previsibles.** `proxyRequest`
  bufferea el cuerpo entero en memoria (`readRawBody`), así que una subida de imágenes de
  producto pediría `streamRequest: true`; y un proxy HTTP no upgradea **WebSockets**, así que
  algo como comandas en vivo necesita camino propio. Verificado el 2026-08-23: hoy no hay
  ningún `multipart` ni gateway de WS en el backend.
- **Lo que ve el backend como cliente es este servidor, no el navegador.** Nadie usa la IP del
  cliente hoy —medido: sin `req.ip`, sin throttler, sin `X-Forwarded-For`—, pero el día del
  rate limiting «por IP» todos los usuarios comparten un balde. La nota accionable vive en la
  entrada de rate limiting de [`docs/agent/pendientes.md`](../agent/pendientes.md).

**Mejora pendiente, con su prerequisito:** el salto sale hoy a la red pública de Railway.
Pasarlo a `*.railway.internal` exige antes que el backend escuche en IPv6 —`main.ts` hace
`app.listen(process.env.PORT ?? 3000)`, que bindea `0.0.0.0`, y esa red es IPv6-only—.

**Cuándo revisarla.** No cuando exista la whitelist de CORS: CORS ya estaba bien el día que
el demo no dejaba entrar, y no es lo que gobierna si la cookie viaja. La condición sería que
frontend y backend pasen a compartir dominio registrable, y aun así revertir sería opcional
—el proxy no estorba ahí y sigue impidiendo que el bug vuelva por configuración—. La nota
larga, para quien tome el endurecimiento de CORS, está en
[`docs/agent/pendientes.md`](../agent/pendientes.md) § «Endurecimiento para producción».

## Alternatives considered

- **Dominio propio con `app.` y `api.` bajo el mismo dominio registrable.** Comparten
  eTLD+1, así que pasan a ser same-site y `Lax` alcanza: **cero código**. Descartada como
  *solución* —no como opción futura— porque deja la corrección dependiendo de una condición
  de infraestructura invisible desde el código: el día que alguien despliegue en dos
  dominios distintos, el bug vuelve sin que nada avise. Con el proxy, no puede volver.
- **`SameSite=None; Secure` en la cookie.** Una línea. Descartada por dos motivos: toca la
  cookie de refresh del sistema de autenticación ya implementado, que roza la invariante 4
  de `CLAUDE.md`; y *permite* el envío cross-site en vez de eliminar la necesidad, dejando la
  sesión más expuesta.
- **`routeRules: { '/api/**': { proxy: … } }` de Nitro.** Más corto, pero se resuelve en
  `nuxt.config.ts` —build time—, así que reintroduce la URL horneada que esta decisión saca.
