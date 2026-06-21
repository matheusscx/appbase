import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export const usePermissionsStore = defineStore('permissions', () => {
  const config = useRuntimeConfig()
  const permisos = ref<string[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchPermisos(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const apiUrl = config.public.apiUrl
      permisos.value = await useApiFetch<string[]>(`${apiUrl}/rbac/mis-permisos`)
    }
    catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      error.value = msg ?? 'Error al cargar permisos'
    }
    finally {
      loading.value = false
    }
  }

  function can(modulo: string, permiso: string): boolean {
    const auth = useAuthStore()
    if (auth.isSuperadmin) return true
    return permisos.value.includes(`${modulo}:${permiso}`)
  }

  function reset(): void {
    permisos.value = []
    error.value = null
  }

  return { permisos, loading, error, fetchPermisos, can, reset }
})
