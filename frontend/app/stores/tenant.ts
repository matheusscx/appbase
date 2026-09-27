import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export interface TenantItem {
  tenantId: string
  nombre: string
}

export const useTenantStore = defineStore('tenant', () => {
  const apiUrl = useRuntimeConfig().public.apiUrl
  const tenants = ref<TenantItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const activeTenant = computed<TenantItem | null>(() => {
    const auth = useAuthStore()
    const id = auth.activeTenantId
    if (!id) return null
    return tenants.value.find(t => t.tenantId === id) ?? null
  })

  async function fetchMyTenants(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      tenants.value = await useApiFetch<TenantItem[]>(
        `${apiUrl}/auth/my-tenants`,
      )
    }
    catch (e: unknown) {
      error.value = apiErrorMsg(e, 'Error al cargar tenants')
    }
    finally {
      loading.value = false
    }
  }

  async function switchTenant(tenantId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const auth = useAuthStore()
      const data = await useApiFetch<{ access_token: string }>(
        `${apiUrl}/auth/switch-tenant`,
        { method: 'POST', body: { tenantId } },
      )
      // Se vacían recién acá, con el token nuevo ya puesto: si el POST falla, la
      // sesión sigue en el tenant de antes y sus permisos y monedas siguen valiendo.
      // Y van antes de `fetchPermisos`, que no lanza: si esa carga falla, lo que
      // queda es "sin cargar" para el tenant nuevo, no los datos del viejo.
      auth.setToken(data.access_token)
      usePermissionsStore().reset()
      useMonedasStore().reset()
      await usePermissionsStore().fetchPermisos()
      await navigateTo('/')
    }
    catch (e: unknown) {
      error.value = apiErrorMsg(e, 'Error al cambiar de tenant')
    }
    finally {
      loading.value = false
    }
  }

  return { tenants, loading, error, activeTenant, fetchMyTenants, switchTenant }
})
