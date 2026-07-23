import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export interface TenantItem {
  tenantId: string
  nombre: string
}

export const useTenantStore = defineStore('tenant', () => {
  const config = useRuntimeConfig()
  // En SSR (dentro de Docker el server Nuxt escucha en localhost:3000, el mismo
  // origen que `public.apiUrl`) hay que usar el host interno del backend; si no,
  // el $fetch hace loopback al propio server SSR. Mismo patrón que `auth.ts`.
  const serverApiUrl = import.meta.server ? (config as Record<string, unknown>).apiUrl as string | undefined : undefined
  const resolvedApiUrl = import.meta.server ? (serverApiUrl ?? config.public.apiUrl) : config.public.apiUrl
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
        `${resolvedApiUrl}/auth/my-tenants`,
      )
    }
    catch (e: unknown) {
      error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cargar tenants'
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
        `${resolvedApiUrl}/auth/switch-tenant`,
        { method: 'POST', body: { tenantId } },
      )
      auth.setToken(data.access_token)
      await usePermissionsStore().fetchPermisos()
      await navigateTo('/')
    }
    catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      error.value = msg ?? 'Error al cambiar de tenant'
    }
    finally {
      loading.value = false
    }
  }

  return { tenants, loading, error, activeTenant, fetchMyTenants, switchTenant }
})
