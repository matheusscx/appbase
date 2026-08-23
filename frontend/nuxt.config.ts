export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // SPA: toda ruta de la app está detrás de `auth` y el token vive en el
  // cliente, así que el servidor no puede renderizar nada real — el menú
  // lateral depende de permisos y salía vacío, y los middlewares de permisos
  // (que esperan `ensureCargado`) hacían que el cliente hidratara con el store
  // ya poblado: `Hydration node mismatch` en cada carga dura. No hay nada
  // público que indexar, así que el SSR solo costaba. Ver ADR-017.
  ssr: false,
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/ui', '@pinia/nuxt', ...(process.env.NODE_ENV !== 'production' ? ['@nuxt/test-utils/module'] : [])],
  colorMode: {
    preference: 'light',
    fallback: 'light',
  },
  vite: {
    optimizeDeps: {
      include: ['@internationalized/date', '@vue/devtools-core', '@vue/devtools-kit', 'decimal.js', 'maska/vue', 'qz-tray'],
    },
  },
  runtimeConfig: {
    // Sigue sin haber `apiUrl` privada: existía para el fetching server-side,
    // que con `ssr: false` no ocurre (ADR-017). El destino del proxy NO va acá
    // —`nuxt.config.ts` se evalúa en el build y quedaría horneado—: lo lee
    // `server/api/[...].ts` de `process.env` en cada request.
    public: {
      // Relativa y constante, no configurable: el navegador habla SOLO con este
      // origen y `server/api/[...].ts` reenvía al backend. Que era una URL
      // absoluta configurable es lo que rompía el demo —cross-site, la cookie
      // de refresh no viajaba— y por eso dejó de ser una variable: apuntar el
      // navegador a otro host tiene que ser imposible, no desaconsejado.
      // Para desarrollar contra un backend remoto está `API_PROXY_TARGET`, que
      // mueve la perilla al servidor sin sacar al navegador de este origen.
      // ADR-022.
      apiUrl: '/api',
    },
  },
})
