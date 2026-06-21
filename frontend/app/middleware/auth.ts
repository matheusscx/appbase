// Rutas que no necesitan tenant activo (además de no necesitar auth o tenerla aparte)
const TENANT_EXEMPT = ['/select-tenant', '/no-tenant', '/login', '/register']

export default defineNuxtRouteMiddleware(async (to) => {
  const store = useAuthStore()

  // Sin token → login
  if (!store.token.value) return navigateTo('/login')

  // Cargar usuario si no está cargado
  if (!store.user.value) await store.fetchMe()

  // Si fetchMe falló (token inválido), clearAuth ya limpió el token
  if (!store.token.value) return navigateTo('/login')

  // Rutas exentas del check de tenant
  if (TENANT_EXEMPT.some(p => to.path.startsWith(p))) return

  // Rutas admin: guard propio. Verificar isSuperadmin.
  if (to.path.startsWith('/admin')) {
    if (!store.isSuperadmin.value) return navigateTo('/')
    return
  }

  // Necesita tenant activo
  if (!store.activeTenantId.value) {
    await store.handlePostLogin()
    return
  }
})
