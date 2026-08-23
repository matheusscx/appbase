import { createError, defineEventHandler, proxyRequest } from 'h3'

/**
 * Todo `/api/**` que pida el navegador lo reenvía este servidor al backend.
 *
 * **Por qué existe:** hasta el 2026-08-23 el navegador llamaba al backend
 * directo, con su URL absoluta horneada en el bundle. En local eso funciona
 * —`localhost:5173` y `localhost:3000` se diferencian solo en el puerto, y el
 * puerto no cuenta para «sitio»—, pero desplegado son **sitios distintos**
 * (`up.railway.app` está en la Public Suffix List), y una cookie `SameSite=Lax`
 * no viaja cross-site: el demo no podía completar el login. Con este proxy el
 * navegador habla **solo con este origen**, así que la cookie de refresh es
 * same-origin por construcción y CORS deja de existir en el camino real.
 * Detalle y alternativas descartadas: **ADR-022**.
 *
 * Que esto sea posible con `ssr: false` no es casualidad: ADR-017 dejó dicho
 * que Nitro se sigue construyendo y `node .output/server/index.mjs` sigue
 * sirviendo la app. Lo que la SPA no hace es *renderizar* en el servidor; el
 * servidor sigue estando, y acá se usa para transportar, no para renderizar.
 *
 * ⚠️ El destino se lee de `process.env` en **cada request**, a propósito.
 * `nuxt.config.ts` se evalúa en el BUILD, así que cualquier cosa que se resuelva
 * ahí queda horneada en la imagen y cambiarla exige reconstruir — que es
 * exactamente la trampa que teníamos. Acá `API_PROXY_TARGET` es una variable de
 * entorno de verdad: se cambia y basta con reiniciar.
 *
 * El default sirve para `npm run dev` fuera de Docker. Adentro de Docker y en
 * Railway hay que fijarla (`docker-compose.yml` la pone en `http://backend:3000`).
 */
export default defineEventHandler((event) => {
  const destino = process.env.API_PROXY_TARGET ?? 'http://localhost:3000'

  // `event.path` es la ruta CRUDA que llegó por el socket, sin normalizar. Si
  // se concatena tal cual, el `..` lo resuelve el parser de URL del fetch
  // saliente y **después** de haber salido de acá: `/api/../algo` llega al
  // backend como `/algo`, fuera del prefijo. Hoy no hay nada montado ahí
  // —medido: contesta `Cannot GET /algo`— pero eso es una propiedad del backend
  // de hoy, no una barrera. Se normaliza primero y se exige el prefijo después,
  // así el día que exista algo fuera de `/api` este proxy no lo publica.
  const ruta = new URL(event.path, 'http://proxy.invalid')
  if (ruta.pathname !== '/api' && !ruta.pathname.startsWith('/api/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  // El backend monta su API en `/api` (`API_PREFIX`), así que la ruta va 1:1 y
  // no hay reescritura que mantener sincronizada.
  return proxyRequest(event, `${destino}${ruta.pathname}${ruta.search}`, {
    // ⚠️ Sin esto, un 3xx del backend lo sigue ESTE servidor y el navegador
    // recibe 200 con el resultado de la redirección. Rompe el login con Google,
    // que es una navegación de nivel superior a `/api/auth/google`: el backend
    // contesta 302 hacia `accounts.google.com` y el usuario tiene que ir él.
    // Medido: sin `manual`, esa ruta pasa de 302 a 200. Un proxy transporta la
    // redirección, no la consume.
    fetchOptions: { redirect: 'manual' },
  })
})
