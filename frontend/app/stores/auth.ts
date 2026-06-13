import { defineStore } from 'pinia'

interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  error: string | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: import.meta.client ? localStorage.getItem('auth_token') : null,
    loading: false,
    error: null,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token && !!state.user,
  },

  actions: {
    setToken(token: string) {
      this.token = token
      if (import.meta.client) localStorage.setItem('auth_token', token)
    },

    clearAuth() {
      this.token = null
      this.user = null
      if (import.meta.client) localStorage.removeItem('auth_token')
    },

    async login(email: string, password: string) {
      const config = useRuntimeConfig()
      this.loading = true
      this.error = null
      try {
        const data = await $fetch<{ access_token: string; user: User }>(
          `${config.public.apiUrl}/auth/login`,
          { method: 'POST', body: { email, password } },
        )
        this.setToken(data.access_token)
        this.user = data.user
        return true
      } catch (e: any) {
        this.error = e?.data?.message ?? 'Error al iniciar sesión'
        return false
      } finally {
        this.loading = false
      }
    },

    async register(name: string, email: string, password: string) {
      const config = useRuntimeConfig()
      this.loading = true
      this.error = null
      try {
        const data = await $fetch<{ access_token: string; user: User }>(
          `${config.public.apiUrl}/auth/register`,
          { method: 'POST', body: { name, email, password } },
        )
        this.setToken(data.access_token)
        this.user = data.user
        return true
      } catch (e: any) {
        this.error = e?.data?.message ?? 'Error al registrarse'
        return false
      } finally {
        this.loading = false
      }
    },

    async fetchMe() {
      if (!this.token) return
      const config = useRuntimeConfig()
      try {
        this.user = await $fetch<User>(`${config.public.apiUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${this.token}` },
        })
      } catch {
        this.clearAuth()
      }
    },

    loginWithGoogle() {
      const config = useRuntimeConfig()
      const apiBase = config.public.apiUrl.replace('/api', '')
      window.location.href = `${apiBase}/api/auth/google`
    },

    logout() {
      this.clearAuth()
      navigateTo('/login')
    },
  },
})
