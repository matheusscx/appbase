export interface Tarjeta {
  id: string
  titular: string
  marca: string
  last4: string
  vencimiento: string
  preferida: boolean
}

function detectarMarca(numero: string): string {
  switch (numero.trim()[0]) {
    case '4': return 'Visa'
    case '5': return 'Mastercard'
    case '3': return 'American Express'
    case '6': return 'Discover'
    default: return 'Tarjeta'
  }
}

/**
 * Medios de pago mock: solo frontend, persistido en localStorage por tenant.
 * Nunca se guarda el número completo ni el CVV — solo marca + últimos 4 dígitos.
 */
export function useTarjetas() {
  const tenantStore = useTenantStore()
  const storageKey = computed(
    () => `tienda:tarjetas:${tenantStore.activeTenant?.tenantId ?? 'sin-tenant'}`,
  )
  const tarjetas = ref<Tarjeta[]>([])

  function cargar() {
    if (import.meta.server) return
    try {
      const raw = localStorage.getItem(storageKey.value)
      tarjetas.value = raw ? (JSON.parse(raw) as Tarjeta[]) : []
    } catch {
      tarjetas.value = []
    }
  }

  function persistir() {
    if (import.meta.server) return
    localStorage.setItem(storageKey.value, JSON.stringify(tarjetas.value))
  }

  function agregar(datos: { numero: string, titular: string, vencimiento: string }) {
    const nueva: Tarjeta = {
      id: crypto.randomUUID(),
      titular: datos.titular,
      marca: detectarMarca(datos.numero),
      last4: datos.numero.replace(/\D/g, '').slice(-4),
      vencimiento: datos.vencimiento,
      preferida: tarjetas.value.length === 0,
    }
    tarjetas.value = [...tarjetas.value, nueva]
    persistir()
  }

  function eliminar(id: string) {
    const eraPreferida = tarjetas.value.find((t) => t.id === id)?.preferida ?? false
    tarjetas.value = tarjetas.value.filter((t) => t.id !== id)
    if (eraPreferida && tarjetas.value.length > 0) {
      tarjetas.value = tarjetas.value.map((t, i) => ({ ...t, preferida: i === 0 }))
    }
    persistir()
  }

  function marcarPreferida(id: string) {
    tarjetas.value = tarjetas.value.map((t) => ({ ...t, preferida: t.id === id }))
    persistir()
  }

  const preferida = computed(() => tarjetas.value.find((t) => t.preferida) ?? null)

  onMounted(cargar)
  watch(storageKey, cargar)

  return { tarjetas, preferida, agregar, eliminar, marcarPreferida }
}
