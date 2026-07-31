import { defineStore } from 'pinia'
import { decodeJwt } from '~/composables/useJwt'
import type { UsuarioPreferencias } from '~/types/usuario-preferencias'

export interface User {
  id: string
  nombre: string
  apellido: string | null
  telefono: string | null
  correo: string
  esSuperadmin: boolean
  nombreUsuario: string | null
  creadoEl: string
  preferencias?: UsuarioPreferencias
}

export const useAuthStore = defineStore('auth', () => {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const token = useCookie<string | null>('access_token', {
    maxAge: 60 * 15,
    sameSite: 'lax',
    path: '/',
  })
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Fuente de verdad: claims del JWT
  const claims = computed(() => token.value ? decodeJwt(token.value) : null)
  const activeTenantId = computed(() => claims.value?.tenant_id ?? null)
  const isSuperadmin = computed(() => claims.value?.es_superadmin ?? false)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function setToken(newToken: string) {
    token.value = newToken
  }

  function updateUser(partial: Partial<User>) {
    if (user.value) Object.assign(user.value, partial)
  }

  function clearAuth() {
    usePermissionsStore().reset()
    useMonedasStore().reset()
    token.value = null
    user.value = null
  }

  async function login(email: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${apiUrl}/auth/login`,
        { method: 'POST', body: { email, password }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: unknown) {
      // `detalleLocal: false`: es una pantalla pública, y el `message` de un error
      // de red de ofetch trae la URL del backend. Ver `apiErrorMsg`.
      error.value = apiErrorMsg(e, 'Error al iniciar sesión', { detalleLocal: false })
      return false
    } finally {
      loading.value = false
    }
  }

  async function register(nombre: string, correo: string, contrasena: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${apiUrl}/auth/register`,
        { method: 'POST', body: { nombre, correo, contrasena }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: unknown) {
      // Misma razón que en `login`: pantalla sin sesión.
      error.value = apiErrorMsg(e, 'Error al registrarse', { detalleLocal: false })
      return false
    } finally {
      loading.value = false
    }
  }

  // Intenta restaurar la sesión usando el refresh token, que viaja en una
  // cookie httpOnly: `credentials: 'include'` no es opcional — sin él el
  // navegador no la manda y el refresh falla con 401 sin explicación.
  async function tryRefresh(): Promise<boolean> {
    try {
      const data = await $fetch<{ access_token: string }>(
        `${apiUrl}/auth/refresh`,
        { method: 'POST', credentials: 'include' },
      )
      if (!data.access_token) return false
      setToken(data.access_token)
      return true
    } catch {
      return false
    }
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return
    try {
      user.value = await $fetch<User>(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token.value}` },
      })
    } catch {
      // Access token vencido: intentar refrescar y reintentar una sola vez.
      if (await tryRefresh()) {
        try {
          user.value = await $fetch<User>(`${apiUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${token.value}` },
          })
          return
        } catch { /* cae a clearAuth */ }
      }
      clearAuth()
    }
  }

  // Lógica post-login: llama my-tenants y redirige según cantidad
  // 0 tenants → /no-tenant
  // 1 tenant  → switch-tenant automático → /
  // >1 tenants → /select-tenant
  async function handlePostLogin(): Promise<void> {
    const tenantStore = useTenantStore()
    await tenantStore.fetchMyTenants()
    const list = tenantStore.tenants
    if (list.length === 0) {
      await navigateTo('/no-tenant')
    } else if (list.length === 1) {
      await tenantStore.switchTenant(list[0]!.tenantId)
    } else {
      await navigateTo('/select-tenant')
    }
  }

  function loginWithGoogle() {
    const apiBase = apiUrl.replace('/api', '')
    window.location.href = `${apiBase}/api/auth/google`
  }

  async function logout() {
    try {
      await $fetch(`${apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch { /* ignore */ }
    clearAuth()
    navigateTo('/login')
  }

  return {
    token,
    user,
    loading,
    error,
    claims,
    activeTenantId,
    isSuperadmin,
    isAuthenticated,
    setToken,
    updateUser,
    clearAuth,
    login,
    register,
    tryRefresh,
    fetchMe,
    handlePostLogin,
    loginWithGoogle,
    logout,
  }
})
