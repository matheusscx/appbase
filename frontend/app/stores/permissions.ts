import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export const usePermissionsStore = defineStore('permissions', () => {
  const config = useRuntimeConfig()
  const permisos = ref<string[]>([])
  const esAdmin = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchPermisos(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const apiUrl = config.public.apiUrl
      const [perms, admin] = await Promise.all([
        useApiFetch<string[]>(`${apiUrl}/rbac/mis-permisos`),
        useApiFetch<{ esAdmin: boolean }>(`${apiUrl}/rbac/es-admin`),
      ])
      permisos.value = perms
      esAdmin.value = admin.esAdmin
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
    esAdmin.value = false
    error.value = null
  }

  return { permisos, esAdmin, loading, error, fetchPermisos, can, reset }
})
