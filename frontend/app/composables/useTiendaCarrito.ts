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
 * El carrito también se guarda en `sessionStorage`: pagar con Webpay sale de la app con una
 * redirección completa, así que volver equivale a recargar, y `useState` solo vive en memoria
 * (auditoría UX 09.2). Va por tenant y usuario, para que ni otra cuenta ni otro comercio del
 * mismo usuario en la misma pestaña hereden el carrito, y se vacía solo con `limpiar()` (orden cobrada). Con el storage bloqueado o
 * ilegible la tienda funciona igual, sin carrito persistido.
 */
const CLAVE_CARRITO = 'tienda-carrito'

/** `null` sin usuario o sin tenant activo: ahí no se guarda ni se lee nada. */
function claveCarrito(tenantId: string | null | undefined, userId: string | undefined): string | null {
  return tenantId && userId ? `${CLAVE_CARRITO}:${tenantId}:${userId}` : null
}

function leerCarritoGuardado(clave: string | null): CarritoLinea[] {
  if (!clave) return []
  try {
    const crudo = sessionStorage.getItem(clave)
    const parseado: unknown = crudo ? JSON.parse(crudo) : []
    return Array.isArray(parseado) ? (parseado as CarritoLinea[]) : []
  }
  catch {
    return []
  }
}

function guardarCarrito(clave: string | null, lineas: CarritoLinea[]) {
  if (!clave) return
  try {
    if (lineas.length) sessionStorage.setItem(clave, JSON.stringify(lineas))
    else sessionStorage.removeItem(clave)
  }
  catch { /* sin storage la tienda sigue andando */ }
}

/**
 * Carrito de la tienda online. Usa useState (no un ref local) para que el
 * estado sobreviva la navegación de /tienda a /tienda/pasarela y de vuelta —
 * son páginas distintas, no la misma instancia de componente.
 */
export function useTiendaCarrito() {
  const authStore = useAuthStore()
  const clave = () => claveCarrito(authStore.activeTenantId, authStore.user?.id)
  const lineas = useState<CarritoLinea[]>('tienda-carrito-lineas', () => leerCarritoGuardado(clave()))
  const fijar = (nuevas: CarritoLinea[]) => {
    lineas.value = nuevas
    guardarCarrito(clave(), nuevas)
  }
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
    error: errorCalculo,
    asegurarVigente,
    recalcular,
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
    fijar(agregarLinea(lineas.value, item, catalogo()))
  }
  function quitar(index: number) {
    fijar(quitarLinea(lineas.value, index))
  }
  /** Deshace un `quitar`: la línea vuelve a su lugar (o al final si el carrito ya es más corto). */
  function restaurar(linea: CarritoLinea, index: number) {
    const copia = [...lineas.value]
    copia.splice(Math.min(index, copia.length), 0, linea)
    fijar(copia)
  }
  function cambiarCantidadPresentacion(
    index: number,
    presentacion: string,
    unidadCodigo: string,
    cantidadCanonica: string,
  ) {
    fijar(setCantidadPresentacion(
      lineas.value,
      index,
      presentacion,
      unidadCodigo,
      cantidadCanonica,
    ))
  }
  function cambiarCantidad(index: number, cantidad: string) {
    fijar(setCantidad(lineas.value, index, cantidad))
  }
  function limpiar() {
    fijar([])
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
    errorCalculo,
    asegurarVigente,
    recalcular,
    checkout,
    add,
    quitar,
    restaurar,
    cambiarCantidad,
    cambiarCantidadPresentacion,
    limpiar,
    pagar,
  }
}
