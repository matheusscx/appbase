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
      usePermissionsStore().reset()
      useMonedasStore().reset()
      const auth = useAuthStore()
      const data = await useApiFetch<{ access_token: string }>(
        `${apiUrl}/auth/switch-tenant`,
        { method: 'POST', body: { tenantId } },
      )
      auth.setToken(data.access_token)
      await usePermissionsStore().fetchPermisos()
      await navigateTo('/')
    }
    catch (e: unknown) {
      // Contraseña temporal sin cambiar: no es un error a mostrar, es un desvío.
      // Con un solo tenant esto corre AUTOMÁTICO después del login, así que sin
      // el desvío la persona quedaba en una pantalla de error sin salida.
      // Se mira el `codigo` y no el mensaje: reescribir el texto no debe romper
      // el flujo.
      if ((e as { data?: { codigo?: string } })?.data?.codigo === 'DEBE_CAMBIAR_CONTRASENA') {
        await navigateTo('/cambiar-contrasena')
        return
      }
      error.value = apiErrorMsg(e, 'Error al cambiar de tenant')
    }
    finally {
      loading.value = false
    }
  }

  return { tenants, loading, error, activeTenant, fetchMyTenants, switchTenant }
})
