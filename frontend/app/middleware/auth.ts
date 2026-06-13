export default defineNuxtRouteMiddleware(async () => {
  const store = useAuthStore()
  if (!store.token) return navigateTo('/login')
  if (!store.user) await store.fetchMe()
  if (!store.isAuthenticated) return navigateTo('/login')
})
