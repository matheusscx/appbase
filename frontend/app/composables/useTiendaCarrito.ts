import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  setCantidadPresentacion,
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
 * Respuesta de `POST /online/pagar`: pago real por Webpay (redirect) cuando el
 * tenant lo tiene activo, o el flujo simulado (misma forma que CheckoutResponse)
 * como fallback.
 */
export type PagarResponse =
  | ({ modo: 'simulado' } & CheckoutResponse)
  | { modo: 'webpay', urlWebpay: string, ordenId: string }

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
  const unidadesStore = useUnidadesMedidaStore()
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

  function catalogo() {
    return unidadesStore.unidades.map(u => ({
      codigo: u.codigo,
      magnitud: u.magnitud,
      factorBase: u.factorBase,
    }))
  }

  function add(item: ItemCatalogo) {
    lineas.value = agregarLinea(lineas.value, item, catalogo())
  }
  function quitar(index: number) {
    lineas.value = quitarLinea(lineas.value, index)
  }
  function cambiarCantidadPresentacion(
    index: number,
    presentacion: string,
    unidadCodigo: string,
    cantidadCanonica: string,
  ) {
    lineas.value = setCantidadPresentacion(
      lineas.value,
      index,
      presentacion,
      unidadCodigo,
      cantidadCanonica,
    )
  }
  function cambiarCantidad(index: number, cantidad: string) {
    lineas.value = setCantidad(lineas.value, index, cantidad)
  }
  function limpiar() {
    lineas.value = []
    resultado.value = null
    checkout.value = null
  }

  async function pagar(): Promise<PagarResponse> {
    const response = await useApiFetch<PagarResponse>(
      `${config.public.apiUrl}/online/pagar`,
      { method: 'POST', body: toCalcularInput(lineas.value) },
    )
    // El flujo simulado (fallback) reutiliza la página /tienda/pasarela, que lee
    // el carrito desde este useState; el flujo Webpay sale de la SPA por redirect.
    if (response.modo === 'simulado') {
      const { resultado, checkoutRef, checkoutUrl } = response
      checkout.value = { resultado, checkoutRef, checkoutUrl }
    }
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
    cambiarCantidadPresentacion,
    limpiar,
    pagar,
  }
}
