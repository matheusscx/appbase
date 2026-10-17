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
  app: {
    head: {
      title: 'Venka',
      htmlAttrs: { lang: 'es' },
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' },
        { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/icon-512.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        // Las dos tipografías de marca, para que la letra no salte al cargar.
        { rel: 'preload', href: '/fonts/dm-sans.woff2', as: 'font', type: 'font/woff2', crossorigin: '' },
        { rel: 'preload', href: '/fonts/bricolage-grotesque.woff2', as: 'font', type: 'font/woff2', crossorigin: '' },
      ],
    },
  },
  modules: ['@nuxt/ui', '@pinia/nuxt', ...(process.env.NODE_ENV !== 'production' ? ['@nuxt/test-utils/module'] : [])],
  // Íconos en el bundle del cliente (auditoría UX 07.23). Con `ssr: false`, `@nuxt/icon` pide en
  // runtime al API público de Iconify los que no encontró al escanear, y el CSS que arma con esa
  // respuesta salía corrido: "Productos" dibujaba el ícono de "Pasarelas de pago". El escaneo por
  // defecto no mira los `.ts`, y ahí viven los íconos del menú de Configuración y de los
  // composables: se suman, y así ningún ícono depende de un pedido en runtime.
  icon: {
    clientBundle: {
      scan: {
        globInclude: ['app/**/*.{vue,ts,tsx}'],
        globExclude: ['node_modules', 'dist', '.*', '**/*.spec.ts', 'e2e'],
      },
      // Los que usa Nuxt UI por dentro (abrir y colapsar el menú lateral): no están en `app/`.
      icons: ['lucide:menu', 'lucide:panel-left-close', 'lucide:panel-left-open'],
    },
  },
  colorMode: {
    preference: 'light',
    fallback: 'light',
  },
  // Solo el dev server: una dependencia que Vite descubre al abrir una pantalla
  // lo hace recargar la página, y un Playwright que navegaba en ese momento
  // pierde el click. `reset-db.sh` borra esta caché con el volumen, así que en
  // un stack de worktree pasaba en cada corrida (2026-09-29: `@unovis`, que solo
  // usa la varianza, tumbaba `reportes/varianza.spec.ts`). Una que falte aparece
  // en el log del frontend como "Vite discovered new dependencies at runtime".
  vite: {
    optimizeDeps: {
      include: ['@internationalized/date', '@unovis/ts', '@unovis/vue', '@vue/devtools-core', '@vue/devtools-kit', 'decimal.js', 'maska/vue', 'qz-tray'],
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
