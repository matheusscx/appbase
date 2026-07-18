import { ref, type Ref } from 'vue'
import type { BoletaEmisor } from '~/utils/ticket-builder'

export interface RazonSocialRow {
  nombre: string
  rut: string
  direccion?: string | null
  telefono?: string | null
  habilitado?: boolean
  preferida?: boolean
}

/** Selecciona el emisor: preferida → primera habilitada → nombre del tenant. */
export function elegirEmisor(razones: RazonSocialRow[], tenantNombre: string): BoletaEmisor {
  const elegida = razones.find(r => r.preferida) ?? razones.find(r => r.habilitado)
  if (!elegida) return { nombre: tenantNombre }
  return {
    nombre: elegida.nombre,
    rut: elegida.rut,
    direccion: elegida.direccion ?? undefined,
    telefono: elegida.telefono ?? undefined,
  }
}

export function useRazonSocialEmisor(): { emisor: Ref<BoletaEmisor>, cargar: () => Promise<void> } {
  const config = useRuntimeConfig()
  const tenantStore = useTenantStore()
  const emisor = ref<BoletaEmisor>({ nombre: '' })

  async function cargar(): Promise<void> {
    const tenantNombre = tenantStore.activeTenant?.nombre ?? ''
    try {
      const razones = await useApiFetch<RazonSocialRow[]>(`${config.public.apiUrl}/tenants/razones-sociales`)
      emisor.value = elegirEmisor(razones ?? [], tenantNombre)
    }
    catch {
      emisor.value = { nombre: tenantNombre }
    }
  }

  return { emisor, cargar }
}
