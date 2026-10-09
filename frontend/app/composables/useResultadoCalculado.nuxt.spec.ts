// @vitest-environment nuxt
//
// El pegamento entre el carrito y su cálculo, compartido por los tres carritos
// (POS, tienda y salones). Vive testeado acá porque las tres formas de desfase
// que fija —la ventana del debounce, dos requests solapados y el cambio de
// cuenta— eran invisibles desde cada pantalla: dos de los tres carritos no
// tienen spec de página, y el tercero es de 1.400 líneas.
//
// Lo que se está probando NO es que el cálculo sea correcto (eso es del backend)
// sino que el resultado que se muestra corresponda al carrito que se está
// viendo: el cruce línea↔advertencia es por índice, y un índice que apunta al
// carrito anterior le pone a una línea el aviso de otra.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, effectScope } from 'vue'
import {
  avisoCalculoFallido,
  useResultadoCalculado,
  type CalcularVentaInput,
  type ResultadoVenta,
} from './useCalculoPrecios'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('./useApiFetch', () => ({ useApiFetch: apiMock }))

function input(ids: string[]): CalcularVentaInput {
  return { lineas: ids.map(id => ({ itemId: id, cantidad: '1' })) }
}

/** Un resultado reconocible por el `itemId` de cada línea: así un test puede
 *  afirmar A QUÉ carrito corresponde el resultado que quedó guardado. */
function resultadoDe(ids: string[]): ResultadoVenta {
  return {
    lineas: ids.map(id => ({
      itemId: id,
      cantidad: '1',
      precioUnitario: '100',
      subtotalNeto: '100',
      descuentoAplicado: '0',
      recargoAplicado: '0',
      impuestoAplicado: '0',
      totalLinea: '100',
      trazas: { descuentos: [], recargos: [], impuestos: [], promociones: [] },
      advertencias: [{ titulo: `Aviso de ${id}`, detalle: 'topeado' }],
    })),
    totales: {
      subtotalNeto: '100',
      totalDescuentos: '0',
      totalRecargos: '0',
      totalImpuestos: '0',
      totalFinal: `${ids.length}00`,
    },
    trazasVenta: { descuentos: [], recargos: [] },
    advertencias: [],
    advertenciasVenta: [],
  }
}

const diferido = () => {
  let resolver: (r: ResultadoVenta) => void = () => {}
  let rechazar: (e: Error) => void = () => {}
  const promesa = new Promise<ResultadoVenta>((res, rej) => {
    resolver = res
    rechazar = rej
  })
  return { promesa, resolver, rechazar }
}

beforeEach(() => {
  apiMock.mockReset()
})

describe('useResultadoCalculado — vigencia', () => {
  it('el resultado no está vigente hasta que corresponde al carrito actual', async () => {
    const carrito = ref(input(['A', 'B']))
    apiMock.mockResolvedValue(resultadoDe(['A', 'B']))
    const { resultado, vigente, recalcular } = useResultadoCalculado(() => carrito.value)

    expect(vigente.value).toBe(false)
    await recalcular()
    expect(vigente.value).toBe(true)
    expect(resultado.value?.lineas.map(l => l.itemId)).toEqual(['A', 'B'])

    // Se borra la primera línea: el template ya rinde [B], pero el resultado
    // guardado sigue siendo el de [A, B]. Es exactamente la ventana en la que
    // el aviso de A se dibujaba bajo B.
    carrito.value = input(['B'])
    expect(vigente.value).toBe(false)
    expect(resultado.value?.lineas.map(l => l.itemId)).toEqual(['A', 'B'])
  })

  it('carrito vacío y resultado limpio es consistente, no obsoleto', () => {
    const carrito = ref<CalcularVentaInput | null>(null)
    const { vigente } = useResultadoCalculado(() => carrito.value)
    expect(vigente.value).toBe(true)
  })

  it('una respuesta que llega para un carrito que ya cambió no se marca vigente', async () => {
    const carrito = ref(input(['A']))
    const primera = diferido()
    apiMock.mockReturnValueOnce(primera.promesa)
    const { resultado, vigente, recalcular } = useResultadoCalculado(() => carrito.value)

    const enVuelo = recalcular()
    carrito.value = input(['A', 'B'])
    primera.resolver(resultadoDe(['A']))
    await enVuelo

    // Llegó, pero es el cálculo de otro carrito: se guarda con la clave que le
    // corresponde, así que queda fuera de vigencia en vez de pasar por bueno.
    expect(resultado.value?.lineas.map(l => l.itemId)).toEqual(['A'])
    expect(vigente.value).toBe(false)
  })
})

describe('useResultadoCalculado — secuenciación', () => {
  it('una respuesta vieja que resuelve última no pisa a la nueva', async () => {
    const carrito = ref(input(['A']))
    const vieja = diferido()
    const nueva = diferido()
    apiMock.mockReturnValueOnce(vieja.promesa).mockReturnValueOnce(nueva.promesa)
    const { resultado, vigente, recalcular } = useResultadoCalculado(() => carrito.value)

    const p1 = recalcular()
    carrito.value = input(['A', 'B'])
    const p2 = recalcular()

    nueva.resolver(resultadoDe(['A', 'B']))
    await p2
    vieja.resolver(resultadoDe(['A']))
    await p1

    expect(resultado.value?.lineas.map(l => l.itemId)).toEqual(['A', 'B'])
    expect(vigente.value).toBe(true)
  })

  it('limpiar() descarta la respuesta que quedó en vuelo', async () => {
    const carrito = ref(input(['A']))
    const enVuelo = diferido()
    apiMock.mockReturnValueOnce(enVuelo.promesa)
    const { resultado, recalcular, limpiar } = useResultadoCalculado(() => carrito.value)

    const p = recalcular()
    limpiar()
    enVuelo.resolver(resultadoDe(['A']))
    await p

    expect(resultado.value).toBeNull()
  })

  it('un cálculo que falla para otro carrito no vuelve vigente al guardado', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockResolvedValueOnce(resultadoDe(['A']))
    const { resultado, vigente, recalcular } = useResultadoCalculado(() => carrito.value)
    await recalcular()

    carrito.value = input(['A', 'B'])
    apiMock.mockRejectedValueOnce(new Error('500'))
    await recalcular()

    expect(vigente.value).toBe(false)
    expect(resultado.value?.lineas.map(l => l.itemId)).toEqual(['A'])
  })

  it('un cálculo que falla NO borra el resultado del carrito actual', async () => {
    // Si lo borrara, un error de red dejaría el total en cero con el modal de
    // cobro ya abierto: el cajero vería $0 para un carrito con productos.
    const carrito = ref(input(['A']))
    apiMock.mockResolvedValueOnce(resultadoDe(['A']))
    const { resultado, vigente, recalcular, asegurarVigente } = useResultadoCalculado(() => carrito.value)
    await recalcular()

    apiMock.mockRejectedValueOnce(new Error('500'))
    await recalcular()

    expect(vigente.value).toBe(true)
    expect(resultado.value?.totales.totalFinal).toBe('100')
    expect(await asegurarVigente()).not.toBeNull()
  })
})

describe('useResultadoCalculado — estado compartido (persistKey)', () => {
  // El carrito de la tienda se instancia en tres páginas (`/tienda`,
  // `/tienda/pasarela`, `/tienda/retorno`) sobre el mismo estado. Lo que se
  // comparte tiene que incluir el token, si no una página no puede descartar la
  // respuesta que dejó en vuelo otra.
  it('el limpiar() de una instancia descarta la respuesta en vuelo de la otra', async () => {
    const carrito = ref(input(['A']))
    const enVuelo = diferido()
    apiMock.mockReturnValueOnce(enVuelo.promesa)

    const paginaA = useResultadoCalculado(() => carrito.value, { persistKey: 'carrito-test' })
    const paginaB = useResultadoCalculado(() => carrito.value, { persistKey: 'carrito-test' })

    const p = paginaA.recalcular()
    paginaB.limpiar()
    enVuelo.resolver(resultadoDe(['A']))
    await p

    expect(paginaA.resultado.value).toBeNull()
  })

  it('el debounce pendiente no sobrevive a la página que lo agendó', async () => {
    vi.useFakeTimers()
    try {
      const carrito = ref(input(['A']))
      apiMock.mockResolvedValue(resultadoDe(['A', 'B']))
      const scope = effectScope()
      scope.run(() => {
        useResultadoCalculado(() => carrito.value, { debounceMs: 300, persistKey: 'carrito-scope' })
      })

      carrito.value = input(['A', 'B'])
      await vi.advanceTimersByTimeAsync(0)
      scope.stop()

      await vi.advanceTimersByTimeAsync(1000)
      expect(apiMock).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })
})

describe('useResultadoCalculado — asegurarVigente', () => {
  it('recalcula y devuelve el resultado del carrito actual', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockResolvedValue(resultadoDe(['A']))
    const { asegurarVigente } = useResultadoCalculado(() => carrito.value)

    const res = await asegurarVigente()
    expect(res?.lineas.map(l => l.itemId)).toEqual(['A'])
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('no dispara un segundo cálculo si ya está vigente', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockResolvedValue(resultadoDe(['A']))
    const { asegurarVigente, recalcular } = useResultadoCalculado(() => carrito.value)

    await recalcular()
    await asegurarVigente()
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('se cuelga del request en vuelo del mismo carrito en vez de disparar otro', async () => {
    const carrito = ref(input(['A']))
    const enVuelo = diferido()
    apiMock.mockReturnValueOnce(enVuelo.promesa)
    const { asegurarVigente, recalcular } = useResultadoCalculado(() => carrito.value)

    void recalcular()
    const esperando = asegurarVigente()
    enVuelo.resolver(resultadoDe(['A']))

    expect((await esperando)?.lineas.map(l => l.itemId)).toEqual(['A'])
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('devuelve null si el cálculo falla: quien cobra no lee un total viejo', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockRejectedValueOnce(new Error('500'))
    const { asegurarVigente } = useResultadoCalculado(() => carrito.value)

    expect(await asegurarVigente()).toBeNull()
  })

  it('devuelve null con el carrito vacío', async () => {
    const carrito = ref<CalcularVentaInput | null>(null)
    const { asegurarVigente } = useResultadoCalculado(() => carrito.value)

    expect(await asegurarVigente()).toBeNull()
    expect(apiMock).not.toHaveBeenCalled()
  })
})

describe('useResultadoCalculado — debounce', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('varios cambios seguidos disparan un solo cálculo, con el último carrito', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockResolvedValue(resultadoDe(['A', 'B', 'C']))
    useResultadoCalculado(() => carrito.value, { debounceMs: 300 })

    carrito.value = input(['A', 'B'])
    await vi.advanceTimersByTimeAsync(100)
    carrito.value = input(['A', 'B', 'C'])
    await vi.advanceTimersByTimeAsync(100)
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock.mock.calls[0]?.[1]?.body).toEqual(input(['A', 'B', 'C']))
  })

  it('volver al carrito ya calculado no deja un cálculo agendado', async () => {
    // Agregar algo y sacarlo antes del retardo dejaba un timer vivo: se disparaba
    // más tarde, con el modal de cobro ya abierto, y lo que devolviera pisaba lo
    // que el cajero estaba mirando.
    const carrito = ref(input(['A']))
    apiMock.mockResolvedValue(resultadoDe(['A']))
    const { vigente, recalcular } = useResultadoCalculado(() => carrito.value, { debounceMs: 300 })
    await recalcular()
    expect(apiMock).toHaveBeenCalledTimes(1)

    carrito.value = input(['A', 'B'])
    await vi.advanceTimersByTimeAsync(100)
    carrito.value = input(['A'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(vigente.value).toBe(true)
  })

  it('asegurarVigente() no espera el debounce pendiente: calcula ya', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockResolvedValue(resultadoDe(['A', 'B']))
    const { asegurarVigente } = useResultadoCalculado(() => carrito.value, { debounceMs: 300 })

    carrito.value = input(['A', 'B'])
    // Deja correr el watcher (`flush: 'pre'`) sin llegar al retardo del debounce.
    await vi.advanceTimersByTimeAsync(0)
    const esperando = asegurarVigente()

    expect((await esperando)?.lineas.map(l => l.itemId)).toEqual(['A', 'B'])
    // El timer pendiente sigue vivo, pero al disparar revalida y no hace nada:
    // pasado el retardo no hay un segundo cálculo.
    await vi.advanceTimersByTimeAsync(500)
    expect(apiMock).toHaveBeenCalledTimes(1)
  })
})

/** Lo que tira `$fetch` (ofetch) ante una respuesta HTTP: `status` y el cuerpo en `data`. */
function errorHttp(status: number, message: string | string[]) {
  return Object.assign(new Error(`[POST] "http://api:3000/api/calculo-precios/calcular": ${status}`), {
    status,
    data: { statusCode: status, message },
  })
}
/** Un corte de red: ofetch no trae `status` y el `message` lleva la URL del backend. */
const errorDeRed = () => new Error('[POST] "http://api:3000/api/calculo-precios/calcular": <no response> fetch failed')

describe('useResultadoCalculado — el motivo del fallo', () => {
  // Hasta el 2026-10-08 el `catch` estaba vacío: un 400 del motor llegaba a la
  // pantalla como un `null` sin motivo y las tres decían "Intentá de nuevo".
  it('guarda el error del cálculo que falló para el carrito actual', async () => {
    const carrito = ref(input(['A']))
    const e = errorHttp(400, 'La cantidad supera el máximo permitido')
    apiMock.mockRejectedValueOnce(e)
    const { error, asegurarVigente } = useResultadoCalculado(() => carrito.value)

    expect(await asegurarVigente()).toBeNull()
    expect(error.value).toBe(e)
  })

  it('el error de OTRO carrito no explica el actual', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockRejectedValueOnce(errorHttp(400, 'Motivo de A'))
    const { error, recalcular } = useResultadoCalculado(() => carrito.value)
    await recalcular()

    carrito.value = input(['A', 'B'])
    expect(error.value).toBeNull()
  })

  it('un cálculo que sale bien borra el motivo anterior', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockRejectedValueOnce(errorHttp(400, 'Motivo'))
    apiMock.mockResolvedValueOnce(resultadoDe(['A']))
    const { error, recalcular } = useResultadoCalculado(() => carrito.value)
    await recalcular()
    expect(error.value).not.toBeNull()

    await recalcular()
    expect(error.value).toBeNull()
  })

  it('limpiar() se lleva el motivo con el carrito', async () => {
    const carrito = ref(input(['A']))
    apiMock.mockRejectedValueOnce(errorHttp(400, 'Motivo'))
    const { error, recalcular, limpiar } = useResultadoCalculado(() => carrito.value)
    await recalcular()

    limpiar()
    expect(error.value).toBeNull()
  })

  it('una respuesta obsoleta que falla no escribe el motivo', async () => {
    const carrito = ref(input(['A']))
    const viejo = diferido()
    const nuevo = diferido()
    apiMock.mockReturnValueOnce(viejo.promesa).mockReturnValueOnce(nuevo.promesa)
    const { error, recalcular } = useResultadoCalculado(() => carrito.value)

    const p1 = recalcular()
    carrito.value = input(['B'])
    const p2 = recalcular()
    nuevo.resolver(resultadoDe(['B']))
    await p2
    carrito.value = input(['A'])
    viejo.rechazar(errorHttp(400, 'Motivo del viejo'))
    await p1

    expect(error.value).toBeNull()
  })
})

describe('avisoCalculoFallido', () => {
  it('un 400 del motor lleva el motivo del servidor, sin "intentá de nuevo"', () => {
    expect(avisoCalculoFallido(errorHttp(400, 'La cantidad supera el máximo permitido'))).toEqual({
      title: 'No se pudo calcular el total',
      description: 'La cantidad supera el máximo permitido',
    })
  })

  it('el array del ValidationPipe se une en una sola línea', () => {
    expect(avisoCalculoFallido(errorHttp(400, ['a inválido', 'b inválido'])).description)
      .toBe('a inválido, b inválido')
  })

  it('un error de red pide reintentar y no muestra la URL del backend', () => {
    const aviso = avisoCalculoFallido(errorDeRed())
    expect(aviso).toEqual({ title: 'No se pudo calcular el total. Intentá de nuevo.' })
  })

  it('un 401 (sesión caída, el redirect a login ya va en camino) no muestra "Unauthorized" ni el mensaje del servidor', () => {
    const aviso = avisoCalculoFallido(errorHttp(401, 'Unauthorized'))
    expect(aviso).toEqual({ title: 'No se pudo calcular el total. Intentá de nuevo.' })
    expect(JSON.stringify(aviso)).not.toContain('Unauthorized')
    expect(avisoCalculoFallido(errorHttp(401, 'Token vencido por el servidor')).description).toBeUndefined()
  })

  it('un 403 y un 404 siguen llevando el motivo: el 401 es la única excepción', () => {
    expect(avisoCalculoFallido(errorHttp(403, 'Sin permiso')).description).toBe('Sin permiso')
    expect(avisoCalculoFallido(errorHttp(404, 'Ítem no encontrado')).description).toBe('Ítem no encontrado')
  })

  it('un 5xx pide reintentar aunque traiga mensaje', () => {
    expect(avisoCalculoFallido(errorHttp(500, 'Internal server error')))
      .toEqual({ title: 'No se pudo calcular el total. Intentá de nuevo.' })
  })

  it('sin error (el carrito quedó vacío) pide reintentar, como antes', () => {
    expect(avisoCalculoFallido(null)).toEqual({ title: 'No se pudo calcular el total. Intentá de nuevo.' })
  })

  it('un 4xx sin mensaje no inventa uno: pide reintentar', () => {
    const e = Object.assign(new Error('[POST] url: 400'), { status: 400, data: {} })
    expect(avisoCalculoFallido(e)).toEqual({ title: 'No se pudo calcular el total. Intentá de nuevo.' })
  })

  it('respeta el título de la pantalla', () => {
    expect(avisoCalculoFallido(errorDeRed(), 'No se pudo calcular el total de la cuenta'))
      .toEqual({ title: 'No se pudo calcular el total de la cuenta. Intentá de nuevo.' })
    expect(avisoCalculoFallido(errorHttp(400, 'Motivo'), 'No se pudo calcular el total de la cuenta'))
      .toEqual({ title: 'No se pudo calcular el total de la cuenta', description: 'Motivo' })
  })
})
