// Rutas que no necesitan tenant activo (además de no necesitar auth o tenerla aparte)
//
// ⚠️ `/cambiar-contrasena` es exenta por definición: mientras la contraseña
// temporal no se cambie, `switch-tenant` responde 403, así que NUNCA va a haber
// tenant activo ahí. Sin la exención, `handlePostLogin` la desviaba a
// `/select-tenant` cuando la persona tiene 2+ tenants y quedaba **encerrada sin
// salida**: elegir tenant da 403, el 403 la manda acá, y acá el middleware la
// manda a elegir tenant. Con 1 solo tenant el rebote era invisible pero gastaba
// un switch-tenant fallido por visita.
const TENANT_EXEMPT = [
  '/select-tenant',
  '/no-tenant',
  '/login',
  '/register',
  '/cambiar-contrasena',
]

export default defineNuxtRouteMiddleware(async (to) => {
  const store = useAuthStore()
  const { token, user, activeTenantId, isSuperadmin } = storeToRefs(store)

  // Sin access token (p. ej. expiró tras 15 min) → intentar restaurar la
  // sesión con el refresh token antes de mandar al usuario a login.
  if (!token.value) await store.tryRefresh()
  if (!token.value) return navigateTo('/login')

  // Cargar usuario si no está cargado
  if (!user.value) await store.fetchMe()

  // Si fetchMe falló (token inválido), clearAuth ya limpió el token
  if (!token.value) return navigateTo('/login')

  // Rutas exentas del check de tenant
  if (TENANT_EXEMPT.some(p => to.path.startsWith(p))) return

  // Rutas admin: guard propio. Verificar isSuperadmin.
  if (to.path.startsWith('/admin')) {
    if (!isSuperadmin.value) return navigateTo('/')
    return
  }

  // Necesita tenant activo
  if (!activeTenantId.value) {
    await store.handlePostLogin()
    return
  }

  // Hay tenant activo (claim del JWT) pero, tras un refresh/reapertura del
  // navegador, la lista de tenants en memoria se reinicia. Rehidratarla para
  // que `activeTenant` pueda resolver el tenant seleccionado.
  const tenantStore = useTenantStore()
  if (tenantStore.tenants.length === 0) {
    await tenantStore.fetchMyTenants()
  }
})
