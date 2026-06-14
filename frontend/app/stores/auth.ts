import { defineStore } from 'pinia'

interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export const useAuthStore = defineStore('auth', () => {
  const config = useRuntimeConfig()

  const token = useCookie<string | null>('access_token', {
    maxAge: 60 * 15,
    sameSite: 'lax',
    path: '/',
  })
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function setToken(newToken: string) {
    token.value = newToken
  }

  function clearAuth() {
    token.value = null
    user.value = null
  }

  async function login(email: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${config.public.apiUrl}/auth/login`,
        { method: 'POST', body: { email, password }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: any) {
      error.value = e?.data?.message ?? 'Error al iniciar sesión'
      return false
    } finally {
      loading.value = false
    }
  }

  async function register(name: string, email: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${config.public.apiUrl}/auth/register`,
        { method: 'POST', body: { name, email, password }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: any) {
      error.value = e?.data?.message ?? 'Error al registrarse'
      return false
    } finally {
      loading.value = false
    }
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return
    try {
      user.value = await $fetch<User>(`${config.public.apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token.value}` },
      })
    } catch {
      clearAuth()
    }
  }

  function loginWithGoogle() {
    const apiBase = config.public.apiUrl.replace('/api', '')
    window.location.href = `${apiBase}/api/auth/google`
  }

  async function logout() {
    try {
      await $fetch(`${config.public.apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch { /* ignore network errors on logout */ }
    clearAuth()
    navigateTo('/login')
  }

  return {
    token,
    user,
    loading,
    error,
    isAuthenticated,
    setToken,
    clearAuth,
    login,
    register,
    fetchMe,
    loginWithGoogle,
    logout,
  }
})
