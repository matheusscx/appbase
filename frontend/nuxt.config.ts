export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  runtimeConfig: {
    apiUrl: process.env.API_INTERNAL_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    public: {
      apiUrl: process.env.VITE_API_URL ?? 'http://localhost:3000/api',
    },
  },
})
