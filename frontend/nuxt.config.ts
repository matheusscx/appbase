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
    // Sin `apiUrl` privada: existía para el fetching server-side, que con
    // `ssr: false` no ocurre. La leían `stores/auth.ts` y `stores/tenant.ts`,
    // pero solo detrás de `import.meta.server` y con fallback a la pública
    // (ADR-017).
    public: {
      apiUrl: process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    },
  },
})
