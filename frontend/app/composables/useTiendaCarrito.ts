import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  toCalcularInput,
  type CarritoLinea,
  type ItemCatalogo,
} from './useVenta'
import { useCalculoPrecios, type ResultadoVenta } from './useCalculoPrecios'
import { useApiFetch } from './useApiFetch'

export interface CheckoutResponse {
  resultado: ResultadoVenta
  checkoutRef: string
  checkoutUrl: string
}

/**
 * Carrito de la tienda online. Usa useState (no un ref local) para que el
 * estado sobreviva la navegación de /tienda a /tienda/pasarela y de vuelta —
 * son páginas distintas, no la misma instancia de componente.
 */
export function useTiendaCarrito() {
  const lineas = useState<CarritoLinea[]>('tienda-carrito-lineas', () => [])
  const resultado = useState<ResultadoVenta | null>('tienda-carrito-resultado', () => null)
  const loadingCalculo = useState('tienda-carrito-loading', () => false)
  const checkout = useState<CheckoutResponse | null>('tienda-checkout', () => null)

  const { calcular } = useCalculoPrecios()
  const config = useRuntimeConfig()

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function recalcular() {
    if (lineas.value.length === 0) {
      resultado.value = null
      return
    }
    loadingCalculo.value = true
    try {
      resultado.value = await calcular(toCalcularInput(lineas.value))
    } finally {
      loadingCalculo.value = false
    }
  }

  watch(
    lineas,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void recalcular()
      }, 300)
    },
    { deep: true },
  )

  function add(item: ItemCatalogo) {
    lineas.value = agregarLinea(lineas.value, item)
  }
  function quitar(itemId: string) {
    lineas.value = quitarLinea(lineas.value, itemId)
  }
  function cambiarCantidad(itemId: string, cantidad: string) {
    lineas.value = setCantidad(lineas.value, itemId, cantidad)
  }
  function limpiar() {
    lineas.value = []
    resultado.value = null
    checkout.value = null
  }

  async function pagar(): Promise<CheckoutResponse> {
    const response = await useApiFetch<CheckoutResponse>(
      `${config.public.apiUrl}/online/checkout`,
      { method: 'POST', body: toCalcularInput(lineas.value) },
    )
    checkout.value = response
    return response
  }

  return {
    lineas,
    resultado,
    loadingCalculo,
    checkout,
    add,
    quitar,
    cambiarCantidad,
    limpiar,
    pagar,
  }
}
