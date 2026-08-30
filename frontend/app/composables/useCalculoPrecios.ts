import type { Ref } from 'vue'
import { useApiFetch } from './useApiFetch'
import type { PersonalizacionPayload } from './useRecetaPersonalizacion'

// ── Tipos del contrato del motor de cálculo de precios ──────────────────────

export interface CalcularLineaInput {
  itemId: string
  cantidad: string
  cantidadPresentacion?: string
  unidadCodigoPresentacion?: string
  /**
   * Qué se pidió en esta línea. **El precio lo calcula el servidor** a partir de
   * esto (`precioBase + Σ extras`, convertido a moneda oficial una sola vez).
   *
   * Hasta el 2026-08-30 acá había un `precioUnitario` que el cliente calculaba y
   * mandaba: era `precioBase + extras` **en la moneda del ítem**, y el motor lo
   * usaba tal cual. Una receta en USD se previsualizaba en dólares y se cobraba
   * en pesos. Gemelo de `LineaDto` (backend): al tocar una punta, tocar la otra.
   */
  personalizacion?: PersonalizacionPayload
  /** Si se pasa, reemplaza las reglas asociadas al ítem. */
  descuentoIds?: string[]
  recargoIds?: string[]
  impuestoIds?: string[]
}

export interface CalcularVentaInput {
  lineas: CalcularLineaInput[]
  metodoPagoId?: string
  descuentosVentaIds?: string[]
  recargosVentaIds?: string[]
  /**
   * Cuenta de salón cuyo `abierta_el` decide la vigencia de las reglas con
   * fecha. Sin esto la previsualización de la cuenta evalúa "ahora" mientras
   * el cobro evalúa la apertura: la mesa que se sienta con la promo vigente y
   * paga después de que venció vería un total sin descuento en pantalla y
   * cobrado con descuento.
   */
  cuentaId?: string
  /**
   * Canal de la venta, para las promociones que rigen en uno solo. Default
   * `'fisico'` en el backend. Solo la Tienda lo manda —`'online'`— en su
   * previsualización: los dos caminos que COBRAN (`ventas.service.ts` y
   * `OnlineService.prepararLineasCheckout`) lo pisan con el canal real, así
   * que acá solo puede mentir en pantalla, nunca en lo cobrado.
   */
  canal?: 'fisico' | 'online'
}

export interface TrazaRegla {
  id: string
  nombre: string
  monto: string
}
export interface TrazaImpuesto extends TrazaRegla {
  tasa: string
}

/**
 * Lo que una promoción restó EN ESTA línea. Familia propia y no una
 * `TrazaRegla` más: el ticket y el drawer la muestran NOMBRADA
 * (`2x1 martes  −$5.000`), separada de los descuentos de catálogo, aunque su
 * monto haya entrado en el mismo `descuentoAplicado`.
 *
 * `aplicacion` es 1-based POR PROMO: dos grupos de un 2x1 sobre la misma línea
 * son `1` y `2`. **Ningún componente agrupa por él** —el ticket agrupa por `id`
 * (`ticket-builder.ts`) y el drawer no agrupa—: viaja en el congelado para
 * poder explicar una venta vieja. Ver `TrazaPromo` en el motor (backend).
 */
export interface TrazaPromo {
  /** `promocionId`. */
  id: string
  nombre: string
  /** `'porcentaje' | 'nxm' | 'precio_fijo'`. */
  tipo: string
  monto: string
  valorEfectivo: string
  aplicacion: number
}

/**
 * Una advertencia del cálculo. Va partida porque el carrito muestra el título
 * en la línea —que es angosta— y deja el detalle en un tooltip.
 */
export interface AdvertenciaPrecio {
  /** Qué la produjo. Ej: `Descuento "Promo fija $5.000"`. */
  titulo: string
  /** Qué pasó, sin repetir el título. Ej: `no se aplicó completo porque superaba el monto disponible`. */
  detalle: string
}

export interface ResultadoLinea {
  itemId: string
  cantidad: string
  precioUnitario: string
  subtotalNeto: string
  descuentoAplicado: string
  recargoAplicado: string
  impuestoAplicado: string
  totalLinea: string
  trazas: {
    descuentos: TrazaRegla[]
    recargos: TrazaRegla[]
    impuestos: TrazaImpuesto[]
    /** Las promos que restaron en esta línea. Ver `TrazaPromo`. */
    promociones: TrazaPromo[]
  }
  /** Descuentos topeados por el piso en cero en esta línea. */
  advertencias: AdvertenciaPrecio[]
}

export interface ResultadoVenta {
  lineas: ResultadoLinea[]
  totales: {
    subtotalNeto: string
    totalDescuentos: string
    totalRecargos: string
    totalImpuestos: string
    totalFinal: string
  }
  trazasVenta: {
    descuentos: TrazaRegla[]
    recargos: TrazaRegla[]
  }
  /** Aplanado: las de cada línea más las de venta. */
  advertencias: AdvertenciaPrecio[]
  /** Solo las de los descuentos a nivel venta. */
  advertenciasVenta: AdvertenciaPrecio[]
}

/**
 * Motor de cálculo de precios — wrapper de la API.
 * Devuelve el desglose (neto → descuentos → recargos → impuestos → total)
 * para una venta sin persistir nada. Pensado para el carrito/checkout del POS.
 */
export function useCalculoPrecios() {
  const config = useRuntimeConfig()

  function calcular(input: CalcularVentaInput): Promise<ResultadoVenta> {
    return useApiFetch<ResultadoVenta>(
      `${config.public.apiUrl}/calculo-precios/calcular`,
      { method: 'POST', body: input },
    )
  }

  return { calcular }
}

/**
 * Estado del último cálculo de un carrito, atado al carrito que lo produjo.
 *
 * El cruce línea↔resultado es **por índice**, que es lo correcto: dos líneas del
 * mismo ítem con distinta personalización no se distinguen por `itemId`. Pero el
 * índice solo sirve mientras el resultado corresponda al carrito que se está
 * viendo, y nadie garantizaba eso: al borrar la primera línea el template rendía
 * la segunda con la advertencia de la primera, y el modal de cobro abría con el
 * total del carrito anterior.
 *
 * Dos mecanismos, uno por cada forma de desfase:
 *
 * - **`vigente`** compara la clave del input actual contra la clave del input que
 *   produjo el resultado guardado. Es derivado, no un flag que alguien tiene que
 *   acordarse de bajar: cubre toda la ventana entre el cambio del carrito y la
 *   respuesta (debounce incluido) sin depender del orden de las llamadas.
 * - **el token de request** descarta respuestas obsoletas: dos `calcular`
 *   solapados no dejan que la vieja pise a la nueva.
 *
 * `resultado` conserva el último valor conocido a propósito (los totales no
 * parpadean en cada tecla, y un cálculo que falla tampoco lo borra); lo que no se
 * muestra mientras no está vigente son las advertencias, que son las que
 * quedarían atribuidas a la línea equivocada. Los flujos que mueven plata llaman
 * `asegurarVigente()` y **construyen con lo que devuelve** (ticket, totales
 * impresos, proyección de caja), no releyendo el ref.
 *
 * @param input     Getter del input de cálculo. `null` o sin líneas = carrito vacío.
 * @param debounceMs Si se pasa, el composable recalcula solo con ese retardo tras
 *   cada cambio del input (POS y tienda, donde el carrito cambia tecla a tecla).
 *   Sin él no hay watcher: el llamador decide cuándo recalcular (salones, que
 *   muta por request y ya sabe en qué punto quedó firme la línea).
 * @param persistKey Prefijo de `useState` para el carrito que sobrevive la
 *   navegación (tienda). Sin él, refs locales que mueren con la página.
 */
export function useResultadoCalculado(
  input: () => CalcularVentaInput | null,
  opts: { debounceMs?: number, persistKey?: string } = {},
) {
  const { calcular } = useCalculoPrecios()
  const { debounceMs, persistKey } = opts

  const resultado: Ref<ResultadoVenta | null> = persistKey
    ? useState<ResultadoVenta | null>(`${persistKey}-resultado`, () => null)
    : ref(null)
  const claveResultado: Ref<string | null> = persistKey
    ? useState<string | null>(`${persistKey}-clave`, () => null)
    : ref(null)
  const loading: Ref<boolean> = persistKey
    ? useState(`${persistKey}-loading`, () => false)
    : ref(false)

  function clave(i: CalcularVentaInput | null): string | null {
    return i && i.lineas.length > 0 ? JSON.stringify(i) : null
  }

  const claveActual = computed(() => clave(input()))
  /** ¿El resultado guardado corresponde al carrito actual? Con el carrito vacío
   *  y el resultado limpio ambas claves son `null`: consistente, no obsoleto. */
  const vigente = computed(() => claveResultado.value === claveActual.value)

  // El token también va en `useState` cuando el estado se comparte: `useTiendaCarrito()`
  // se instancia en tres páginas, y si el token fuera local el `limpiar()` de una no
  // podría descartar la respuesta en vuelo de otra (que sí escribe el estado compartido).
  const token: Ref<number> = persistKey ? useState(`${persistKey}-token`, () => 0) : ref(0)
  let timer: ReturnType<typeof setTimeout> | null = null
  let enVuelo: { clave: string | null, promesa: Promise<void> } | null = null

  async function ejecutar(clv: string | null, inp: CalcularVentaInput | null) {
    const mio = ++token.value
    if (clv === null || inp === null) {
      resultado.value = null
      claveResultado.value = null
      loading.value = false
      return
    }
    loading.value = true
    try {
      const r = await calcular(inp)
      if (mio !== token.value) return
      resultado.value = r
      claveResultado.value = clv
    }
    catch {
      // No se toca el resultado guardado: la vigencia ya dice si sirve. Si el
      // cálculo que falló era de OTRO carrito, el guardado queda fuera de
      // vigencia igual (nadie lo va a mostrar ni a cobrar); si era de ESTE, el
      // guardado sigue siendo el bueno y borrarlo dejaría el total en cero por
      // un error de red — con el modal de cobro abierto, incluso.
    }
    finally {
      if (mio === token.value) loading.value = false
    }
  }

  /** Recalcula ya, sin esperar el debounce. Si ya hay un request en vuelo para
   *  este mismo carrito, se cuelga de ese en vez de disparar otro — y por eso no
   *  hace falta cancelar el timer pendiente: cuando dispare, o el carrito ya está
   *  vigente y no hace nada, o se cuelga de este mismo request. */
  function recalcular(): Promise<void> {
    const clv = claveActual.value
    if (enVuelo && enVuelo.clave === clv) return enVuelo.promesa
    const promesa = ejecutar(clv, input()).finally(() => {
      if (enVuelo?.promesa === promesa) enVuelo = null
    })
    enVuelo = { clave: clv, promesa }
    return promesa
  }

  /** Espera a que el resultado corresponda al carrito actual y lo devuelve;
   *  `null` si el cálculo falló o el carrito quedó vacío. */
  async function asegurarVigente(): Promise<ResultadoVenta | null> {
    if (!vigente.value) await recalcular()
    return vigente.value ? resultado.value : null
  }

  /** Carrito que deja de existir (se vació, o se cambió de cuenta): el resultado
   *  se va con él, y la respuesta en vuelo ya no puede escribirlo. */
  function limpiar() {
    if (timer) { clearTimeout(timer); timer = null }
    token.value++
    enVuelo = null
    resultado.value = null
    claveResultado.value = null
    loading.value = false
  }

  if (debounceMs !== undefined) {
    watch(claveActual, () => {
      if (timer) { clearTimeout(timer); timer = null }
      timer = setTimeout(() => {
        timer = null
        // Se revalida al disparar, no al agendar: volver a un carrito ya
        // calculado (agregar algo y sacarlo antes del retardo) no recalcula
        // nada. Sin esto el timer sobrevivía y recalculaba más tarde, con el
        // modal de cobro ya abierto.
        if (!vigente.value) void recalcular()
      }, debounceMs)
    })
    // El timer no sobrevive a la página: si no, dispara un cálculo desde una
    // pantalla que ya no existe y escribe estado compartido (tienda).
    if (getCurrentScope()) onScopeDispose(() => { if (timer) clearTimeout(timer) })
  }

  return { resultado, loading, vigente, recalcular, asegurarVigente, limpiar }
}
