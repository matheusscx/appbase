export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/ui', '@pinia/nuxt', ...(process.env.NODE_ENV !== 'production' ? ['@nuxt/test-utils/module'] : [])],
  colorMode: {
    preference: 'light',
    fallback: 'light',
  },
  vite: {
    optimizeDeps: {
      include: ['@vue/devtools-core', '@vue/devtools-kit'],
    },
  },
  runtimeConfig: {
    apiUrl: process.env.API_INTERNAL_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    public: {
      apiUrl: process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    },
  },
})
