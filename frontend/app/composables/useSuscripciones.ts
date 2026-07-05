export interface Suscripcion {
  id: string
  itemNombre: string
  precio: string
  frecuencia: 'semanal' | 'mensual' | 'anual'
  proximoCobro: string
  estado: 'activa' | 'pausada' | 'cancelada'
}

function proximaFecha(diasDesdeHoy: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() + diasDesdeHoy)
  return fecha.toISOString()
}

function seedEjemplos(): Suscripcion[] {
  return [
    {
      id: crypto.randomUUID(),
      itemNombre: 'Plan Mantenimiento Mensual',
      precio: '15000',
      frecuencia: 'mensual',
      proximoCobro: proximaFecha(30),
      estado: 'activa',
    },
    {
      id: crypto.randomUUID(),
      itemNombre: 'Soporte Premium',
      precio: '9990',
      frecuencia: 'mensual',
      proximoCobro: proximaFecha(15),
      estado: 'pausada',
    },
  ]
}

/**
 * Suscripciones mock: solo frontend, persistidas en localStorage por tenant.
 * Sin backend — representan compras recurrentes de items del catálogo.
 */
export function useSuscripciones() {
  const tenantStore = useTenantStore()
  const storageKey = computed(
    () => `tienda:suscripciones:${tenantStore.activeTenant?.tenantId ?? 'sin-tenant'}`,
  )
  const suscripciones = ref<Suscripcion[]>([])

  function persistir() {
    if (import.meta.server) return
    localStorage.setItem(storageKey.value, JSON.stringify(suscripciones.value))
  }

  function cargar() {
    if (import.meta.server) return
    try {
      const raw = localStorage.getItem(storageKey.value)
      if (raw) {
        suscripciones.value = JSON.parse(raw) as Suscripcion[]
        return
      }
    } catch {
      // localStorage corrupto o inaccesible: se re-siembra abajo
    }
    suscripciones.value = seedEjemplos()
    persistir()
  }

  function cambiarEstado(id: string, estado: Suscripcion['estado']) {
    suscripciones.value = suscripciones.value.map((s) =>
      s.id === id ? { ...s, estado } : s,
    )
    persistir()
  }

  function pausar(id: string) {
    cambiarEstado(id, 'pausada')
  }
  function reanudar(id: string) {
    cambiarEstado(id, 'activa')
  }
  function cancelar(id: string) {
    cambiarEstado(id, 'cancelada')
  }

  onMounted(cargar)
  watch(storageKey, cargar)

  return { suscripciones, pausar, reanudar, cancelar }
}
