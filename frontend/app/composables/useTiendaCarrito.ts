import {
  agregarLinea,
  quitarLinea,
  setCantidad,
  setCantidadPresentacion,
  toCalcularInput,
  type CarritoLinea,
  type ItemCatalogo,
} from './useVenta'
import { useResultadoCalculado, type ResultadoVenta } from './useCalculoPrecios'
import { useApiFetch } from './useApiFetch'

export interface CheckoutResponse {
  resultado: ResultadoVenta
  checkoutRef: string
  checkoutUrl: string
  /**
   * Método con el que la pantalla simulada registra el pago. Lo resuelve el
   * backend —mismo `resolverMetodoCredito` que usa la rama Webpay— porque la
   * pantalla lo elegía sola buscando "crédito" en el nombre y cayendo en el
   * primero de la lista, sin mirar si estaba habilitado. `null` cuando el
   * carrito suma $0: ahí no hay pago que registrar.
   */
  metodoPagoId: string | null
}

/**
 * Respuesta de `POST /online/pagar`: pago real por Webpay (redirect) cuando el
 * tenant lo tiene activo, o el flujo simulado (misma forma que CheckoutResponse)
 * cuando tiene prendida la pasarela demo. Sin ninguna de las dos configuradas
 * el endpoint responde 400: el simulado ya no se hereda por no tener Webpay.
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
  const checkout = useState<CheckoutResponse | null>('tienda-checkout', () => null)

  // `persistKey` porque el carrito de la tienda sobrevive la navegación a
  // /tienda/pasarela y de vuelta: el resultado tiene que volver con él, si no
  // los totales quedan vacíos hasta que el comprador toque algo.
  //
  // `canal: 'online'` porque este `calcular` es el único que no cobra —el
  // cobro real (`POST /online/pagar`) lo fuerza el backend igual— así que sin
  // esto la previsualización evaluaría promos de canal físico y mostraría un
  // total distinto del que el checkout va a cobrar de verdad.
  const {
    resultado,
    loading: loadingCalculo,
    vigente,
    asegurarVigente,
    limpiar: limpiarResultado,
  } = useResultadoCalculado(
    () => ({ ...toCalcularInput(lineas.value), canal: 'online' }),
    { debounceMs: 300, persistKey: 'tienda-carrito' },
  )

  const unidadesStore = useUnidadesMedidaStore()
  const config = useRuntimeConfig()

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
    limpiarResultado()
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
      const { resultado, checkoutRef, checkoutUrl, metodoPagoId } = response
      checkout.value = { resultado, checkoutRef, checkoutUrl, metodoPagoId }
    }
    return response
  }

  return {
    lineas,
    resultado,
    loadingCalculo,
    vigente,
    asegurarVigente,
    checkout,
    add,
    quitar,
    cambiarCantidad,
    cambiarCantidadPresentacion,
    limpiar,
    pagar,
  }
}
