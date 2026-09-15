import { describe, it, expect } from 'vitest'
import {
  esDecimalValido,
  agruparFilasDevolucion,
  setCantidadFila,
  filasDevolucionValidas,
  devolucionesPayload,
  notaDevolucion,
  filaDevolvible,
  filaAcreditable,
  setReponerFila,
  normalizarParaSoloStock,
  filaEditable,
  valorDevueltoCuantizado,
  type DetalleVentaDevolucion,
  type FilaDevolucion,
  type CriterioRedondeoCongelado,
} from './useDevolucionInventario'

const detalle = (
  itemId: string,
  overrides: Partial<DetalleVentaDevolucion> = {},
): DetalleVentaDevolucion => ({
  itemId,
  descripcion: `Item ${itemId}`,
  cantidad: '2',
  modoInventario: 'cantidad',
  cantidadDevuelta: '0',
  totalLinea: '2000',
  ...overrides,
})

const fila = (
  itemId: string,
  overrides: Partial<FilaDevolucion> = {},
): FilaDevolucion => ({
  itemId,
  descripcion: `Item ${itemId}`,
  disponible: '2',
  modoInventario: 'cantidad',
  cantidad: '',
  puedeReponer: true,
  reponerStock: true,
  ...overrides,
})

describe('esDecimalValido', () => {
  it('acepta enteros y decimales positivos', () => {
    expect(esDecimalValido('1')).toBe(true)
    expect(esDecimalValido('0.5')).toBe(true)
    expect(esDecimalValido('10.25')).toBe(true)
  })

  it('rechaza vacío, negativos y no numéricos', () => {
    expect(esDecimalValido('')).toBe(false)
    expect(esDecimalValido('-1')).toBe(false)
    expect(esDecimalValido('abc')).toBe(false)
    expect(esDecimalValido('1,5')).toBe(false)
  })
})

describe('agruparFilasDevolucion', () => {
  it('crea una fila por ítem con disponible = cantidad − cantidadDevuelta', () => {
    const filas = agruparFilasDevolucion([
      detalle('a', { cantidad: '3', cantidadDevuelta: '1' }),
    ])
    expect(filas).toEqual([
      {
        itemId: 'a',
        descripcion: 'Item a',
        disponible: '2',
        modoInventario: 'cantidad',
        cantidad: '',
        puedeReponer: true,
        reponerStock: true,
      },
    ])
  })

  it('agrupa líneas del mismo ítem restando cantidadDevuelta UNA sola vez (el backend repite el total por ítem en cada línea)', () => {
    const filas = agruparFilasDevolucion([
      detalle('a', { cantidad: '2', cantidadDevuelta: '1' }),
      detalle('a', { cantidad: '3', cantidadDevuelta: '1' }),
    ])
    // disponible = (2 + 3) − 1, no − 2
    expect(filas).toHaveLength(1)
    expect(filas[0]!.disponible).toBe('4')
  })

  it('usa itemId como descripción cuando la línea no tiene descripción', () => {
    const filas = agruparFilasDevolucion([detalle('a', { descripcion: null })])
    expect(filas[0]!.descripcion).toBe('a')
  })

  it('preserva modoInventario null (servicio)', () => {
    const filas = agruparFilasDevolucion([detalle('s', { modoInventario: null })])
    expect(filas[0]!.modoInventario).toBeNull()
  })

  it('la reposición nace en lo que el ítem PUEDE, no en true', () => {
    // Tres modos distintos en la misma tanda: con uno solo, arrancar todo en
    // `true` pasaría igual.
    const filas = agruparFilasDevolucion([
      detalle('a', { modoInventario: 'cantidad' }),
      detalle('l', { modoInventario: 'lote' }),
      detalle('s', { modoInventario: null }),
    ])
    expect(filas.map(f => [f.puedeReponer, f.reponerStock])).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ])
  })
})

describe('setCantidadFila', () => {
  it('actualiza solo la fila del ítem, de forma inmutable', () => {
    const filas = [fila('a'), fila('b')]
    const result = setCantidadFila(filas, 'a', '1.5')
    expect(result[0]!.cantidad).toBe('1.5')
    expect(result[1]!.cantidad).toBe('')
    expect(filas[0]!.cantidad).toBe('')
    expect(result).not.toBe(filas)
  })
})

describe('filasDevolucionValidas', () => {
  it('vacías o sin cantidad son válidas', () => {
    expect(filasDevolucionValidas([])).toBe(true)
    expect(filasDevolucionValidas([fila('a')])).toBe(true)
  })

  it('cantidad no numérica invalida', () => {
    expect(filasDevolucionValidas([fila('a', { cantidad: 'x' })])).toBe(false)
  })

  it('cantidad que excede el disponible invalida', () => {
    expect(filasDevolucionValidas([fila('a', { disponible: '2', cantidad: '3' })])).toBe(false)
    expect(filasDevolucionValidas([fila('a', { disponible: '2', cantidad: '2' })])).toBe(true)
  })
})

describe('devolucionesPayload', () => {
  it('incluye solo filas con cantidad válida > 0', () => {
    const payload = devolucionesPayload([
      fila('a', { cantidad: '1' }),
      fila('b', { cantidad: '' }),
      fila('c', { cantidad: '0' }),
      fila('d', { cantidad: 'x' }),
    ])
    expect(payload).toEqual([{ itemId: 'a', cantidad: '1', reponerStock: true }])
  })

  it('el payload lleva la reposición de CADA fila', () => {
    // Las dos con cantidad y con reposición distinta: con un solo valor, mandar
    // siempre `true` pasaría igual.
    const payload = devolucionesPayload([
      fila('a', { cantidad: '2', reponerStock: true }),
      fila('b', { cantidad: '1', reponerStock: false }),
    ])
    expect(payload).toEqual([
      { itemId: 'a', cantidad: '2', reponerStock: true },
      { itemId: 'b', cantidad: '1', reponerStock: false },
    ])
  })
})

describe('setReponerFila', () => {
  it('apaga la reposición de la fila pedida y no toca las otras', () => {
    const filas = [fila('a'), fila('b')]
    const r = setReponerFila(filas, 'a', false)
    expect(r.map(f => f.reponerStock)).toEqual([false, true])
  })

  it('no la enciende donde el ítem no puede reponer', () => {
    // Encenderla mandaría al backend un pedido que rechaza con 400.
    const filas = [fila('s', { modoInventario: null, puedeReponer: false, reponerStock: false })]
    expect(setReponerFila(filas, 's', true)[0]!.reponerStock).toBe(false)
  })
})

describe('normalizarParaSoloStock', () => {
  // El gesto: destildar "generar nota de crédito" en el modal de reembolso. Ese
  // camino EXIGE que toda línea reponga, y su 400 llega después del commit del
  // reembolso: la plata ya volvió y la mercadería no vuelve al stock.
  it('la que el operador apagó con el switch vuelve a reponer, sin perder la cantidad', () => {
    // ⚠️ Es el caso que un filtro por `puedeReponer` deja pasar: la fila PUEDE
    // reponer, el operador la apagó, y al destildar el switch desaparece del
    // DOM — así que ese `false` queda invisible y sale en el payload.
    const filas = [fila('a', { cantidad: '2', reponerStock: false })]
    const r = normalizarParaSoloStock(filas)
    expect(r[0]!.reponerStock).toBe(true)
    expect(r[0]!.cantidad).toBe('2')
  })

  it('la que no puede reponer pierde la cantidad', () => {
    const filas = [
      fila('s', { cantidad: '1', modoInventario: null, puedeReponer: false, reponerStock: false }),
    ]
    const r = normalizarParaSoloStock(filas)
    expect(r[0]!.cantidad).toBe('')
    expect(r[0]!.reponerStock).toBe(false)
  })

  it('ninguna fila queda con reponerStock false y cantidad tipeada', () => {
    // El invariante que el camino de solo-stock necesita, sobre la mezcla.
    const filas = [
      fila('a', { cantidad: '2', reponerStock: false }),
      fila('b', { cantidad: '5' }),
      fila('s', { cantidad: '1', modoInventario: null, puedeReponer: false, reponerStock: false }),
    ]
    expect(
      normalizarParaSoloStock(filas).filter(f => f.cantidad && !f.reponerStock),
    ).toEqual([])
  })
})

describe('filaEditable', () => {
  it('en el camino que acredita entra cualquier ítem; en el de stock, solo el que repone', () => {
    const servicio = fila('s', { modoInventario: null, puedeReponer: false, reponerStock: false })
    const producto = fila('a')
    expect(filaEditable(servicio, 'acredita')).toBe(true)
    expect(filaEditable(servicio, 'solo-stock')).toBe(false)
    expect(filaEditable(producto, 'acredita')).toBe(true)
    expect(filaEditable(producto, 'solo-stock')).toBe(true)
  })

  it('sin disponible no se edita en ningún camino', () => {
    const f = fila('a', { disponible: '0' })
    expect(filaEditable(f, 'acredita')).toBe(false)
    expect(filaEditable(f, 'solo-stock')).toBe(false)
  })
})

describe('notaDevolucion / filaDevolvible / filaAcreditable', () => {
  it('servicio (modoInventario null): no vuelve al stock, pero SÍ se acredita', () => {
    // Es el cambio del 2026-09-04: acreditar dejó de exigir que el ítem pudiera
    // volver al inventario.
    const f = fila('s', { modoInventario: null, puedeReponer: false, reponerStock: false })
    expect(notaDevolucion(f)).toBe('Servicio: no vuelve al stock')
    expect(filaDevolvible(f)).toBe(false)
    expect(filaAcreditable(f)).toBe(true)
  })

  it('modo serie/lote: la vuelta al stock va por Inventario, y se acredita igual', () => {
    const f = fila('l', { modoInventario: 'lote', puedeReponer: false, reponerStock: false })
    expect(notaDevolucion(f)).toBe(
      'Modo lote: la vuelta al stock se registra desde Inventario',
    )
    expect(filaDevolvible(f)).toBe(false)
    expect(filaAcreditable(f)).toBe(true)
  })

  it('modo cantidad con disponible > 0: sin nota, devolvible y acreditable', () => {
    const f = fila('a')
    expect(notaDevolucion(f)).toBeNull()
    expect(filaDevolvible(f)).toBe(true)
    expect(filaAcreditable(f)).toBe(true)
  })

  it('sin disponible no se acredita ni se devuelve, pueda o no reponer', () => {
    // Las dos mitades del título: una fila que puede reponer y otra que no.
    const producto = fila('a', { disponible: '0' })
    const servicio = fila('s', {
      disponible: '0', modoInventario: null, puedeReponer: false, reponerStock: false,
    })
    for (const f of [producto, servicio]) {
      expect(filaDevolvible(f)).toBe(false)
      expect(filaAcreditable(f)).toBe(false)
    }
    expect(notaDevolucion(producto)).toBeNull()
  })
})

describe('valorDevueltoCuantizado', () => {
  // Moneda sin decimales (tipo CLP): `decimalesMoneda: 0`.
  const cfgClp = (modoRedondeo: string): CriterioRedondeoCongelado => ({
    decimalesMoneda: 0,
    modoRedondeo,
  })

  it('valúa cada ítem a lo que costó EN LA BOLETA, no al precio de lista', () => {
    // 3 unidades por 3.570 en total → 1.190 la unidad. Se marcan 2 → 2.380.
    // Valores que NO dividen redondo entre sí: con 1.000 la unidad, un cálculo
    // que usara el total de la línea entera pasaría igual. Cuantizado no cambia
    // el resultado acá (2.380 ya es entero).
    const detalles = [detalle('a', { cantidad: '3', totalLinea: '3570' })]
    const filas = [fila('a', { cantidad: '2' })]
    expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_UP'))).toBe('2380')
  })

  it('suma las líneas del mismo ítem antes de dividir', () => {
    // Dos líneas del mismo ítem con precios distintos: 1.000/1 y 4.000/2. El
    // valor por unidad es (1.000 + 4.000) / 3 = 1.666,66…, no el de una línea.
    const detalles = [
      detalle('a', { cantidad: '1', totalLinea: '1000' }),
      detalle('a', { cantidad: '2', totalLinea: '4000' }),
    ]
    const filas = [fila('a', { cantidad: '3' })]
    expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_UP'))).toBe('5000')
  })

  it('divide ANTES de multiplicar: con FLOOR, 1 en 3 unidades da 0, no 1', () => {
    // 1 dividido 3 no es exacto en las 20 cifras de Decimal.js: dividir
    // primero deja 0,99999999999999999999 (FLOOR → 0); multiplicar primero
    // (1 × 3 ÷ 3) cancela el residuo y da 1 exacto (FLOOR → 1). Con HALF_UP
    // los dos órdenes redondean a 1 — hace falta FLOOR, que no perdona ese
    // residuo, para que el orden decida el resultado cuantizado.
    const detalles = [detalle('a', { cantidad: '3', totalLinea: '1' })]
    const filas = [fila('a', { cantidad: '3' })]
    expect(valorDevueltoCuantizado(detalles, filas, cfgClp('FLOOR'))).toBe('0')
  })

  it('ignora filas sin cantidad, con cantidad inválida o de ítems que no están', () => {
    const detalles = [detalle('a', { cantidad: '2', totalLinea: '2000' })]
    const filas = [
      fila('a', { cantidad: '' }),
      fila('a', { cantidad: 'x' }),
      fila('z', { cantidad: '1' }),
    ]
    expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_UP'))).toBe('0')
  })

  it('una línea de cantidad cero no divide por cero', () => {
    const detalles = [detalle('a', { cantidad: '0', totalLinea: '0' })]
    expect(
      valorDevueltoCuantizado(detalles, [fila('a', { cantidad: '1' })], cfgClp('HALF_UP')),
    ).toBe('0')
  })

  // 3 unidades vendidas en 1.001 (CLP, sin decimales) → 333,6666… la unidad.
  // Devolviendo 1 de las 3, el bruto SIN cuantizar es 333,66666666666666667
  // (`cfg: null`, el orden viejo). Con el criterio congelado, el backend
  // cuantiza esa misma línea con HALF_UP y sube a 334: son dos números
  // DISTINTOS para el mismo devuelto, y es lo que este test fija — no que una
  // sola línea abra una "ventana" del umbral (esa demostración, con un monto
  // real y varias líneas, está en el test de abajo, "tres líneas de 2,6...").
  it('1.001/3: el bruto sin cuantizar y el cuantizado por el backend son números distintos', () => {
    const detalles = [detalle('a', { cantidad: '3', totalLinea: '1001' })]
    const filas = [fila('a', { cantidad: '1' })]
    expect(valorDevueltoCuantizado(detalles, filas, null)).toBe('333.66666666666666667')
    expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_UP'))).toBe('334')
  })

  // La ventana del umbral: en CLP (sin decimales) un monto de nota
  // también es entero, y una sola línea nunca abre la ventana con HALF_UP —el
  // salto de cuantizar es como máximo 0,5, así que si el bruto sin cuantizar
  // ya es ≤ el monto entero, el cuantizado no puede superarlo—. Con VARIAS
  // líneas sí: tres ítems vendidos a $13 las 5 unidades (2,6 la unidad; en
  // CLP el total de la línea es entero, la unidad no), devolviendo 1 de cada
  // uno, cuantizan a 3 cada uno (9 en total), pero la suma sin cuantizar es 7,8. Un monto de nota de 8 (entero,
  // válido en CLP) queda entre los dos: el modal viejo, que sumaba sin
  // cuantizar (7,8 ≤ 8), no pedía el motivo; el backend, que cuantiza CADA
  // LÍNEA antes de sumar (9 > 8), sí lo exige.
  it('tres líneas de 2,6 cuantizan a 3 cada una y suman 9 — la ventana real es de varias líneas, no de una', () => {
    const detalles = [
      detalle('a', { cantidad: '5', totalLinea: '13' }),
      detalle('b', { cantidad: '5', totalLinea: '13' }),
      detalle('c', { cantidad: '5', totalLinea: '13' }),
    ]
    const filas = [
      fila('a', { cantidad: '1' }),
      fila('b', { cantidad: '1' }),
      fila('c', { cantidad: '1' }),
    ]
    expect(valorDevueltoCuantizado(detalles, filas, null)).toBe('7.8')
    expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_UP'))).toBe('9')
  })

  describe('cada modo de redondeo produce lo que ese modo promete', () => {
    // Total 5, 2 unidades vendidas, se devuelve 1 → bruto exacto 2,5: el
    // empate de a propósito para que HALF_UP/CEIL (suben) y HALF_EVEN/FLOOR
    // (bajan, 2 es par) diverjan.
    const detalles = [detalle('a', { cantidad: '2', totalLinea: '5' })]
    const filas = [fila('a', { cantidad: '1' })]

    it('HALF_UP: 2,5 sube a 3', () => {
      expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_UP'))).toBe('3')
    })

    it('CEIL: 2,5 sube a 3', () => {
      expect(valorDevueltoCuantizado(detalles, filas, cfgClp('CEIL'))).toBe('3')
    })

    it('FLOOR: 2,5 baja a 2', () => {
      expect(valorDevueltoCuantizado(detalles, filas, cfgClp('FLOOR'))).toBe('2')
    })

    it('HALF_EVEN: 2,5 baja a 2 (par más cercano)', () => {
      expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_EVEN'))).toBe('2')
    })

    it('HALF_EVEN no es solo "redondear para abajo": 3,5 sube a 4 (par más cercano)', () => {
      // Total 7, 2 unidades, se devuelve 1 → bruto exacto 3,5. Si HALF_EVEN
      // fuera indistinguible de FLOOR, este caso también bajaría a 3.
      const detalles35 = [detalle('a', { cantidad: '2', totalLinea: '7' })]
      const filas35 = [fila('a', { cantidad: '1' })]
      expect(valorDevueltoCuantizado(detalles35, filas35, cfgClp('HALF_EVEN'))).toBe('4')
    })

    it('HALF_UP no es lo mismo que CEIL: 2,4 se queda en 2 con HALF_UP y sube a 3 con CEIL', () => {
      // Con 2,5 los dos suben, y esa fixture sola no distingue "sube en el
      // empate" (HALF_UP) de "siempre sube" (CEIL). 2,4 no es empate: HALF_UP
      // redondea al más cercano (2) y CEIL sube igual (3).
      const detalles24 = [detalle('a', { cantidad: '5', totalLinea: '12' })]
      const filas24 = [fila('a', { cantidad: '1' })]
      expect(valorDevueltoCuantizado(detalles24, filas24, cfgClp('HALF_UP'))).toBe('2')
      expect(valorDevueltoCuantizado(detalles24, filas24, cfgClp('CEIL'))).toBe('3')
    })

    it('un modoRedondeo desconocido cae a HALF_UP, no a CEIL, igual que `modoToRounding` en el backend', () => {
      // Bruto 2,4 (el de "HALF_UP no es lo mismo que CEIL", arriba): con 2,5
      // los dos redondean a 3 y un fallback a CEIL pasaría el test igual. Acá
      // HALF_UP da 2 y CEIL da 3 — que el desconocido dé '2' prueba que cae
      // en HALF_UP y no en el primer modo del mapeo u otro cualquiera.
      const detalles24 = [detalle('a', { cantidad: '5', totalLinea: '12' })]
      const filas24 = [fila('a', { cantidad: '1' })]
      expect(
        valorDevueltoCuantizado(detalles24, filas24, { decimalesMoneda: 0, modoRedondeo: 'BOGUS' }),
      ).toBe('2')
    })
  })

  // ⚠️ Prueba el VALOR cuantizado en el empate, no la comparación `>` del
  // modal: `motivoRequerido` (`gt` estricto) vive en `NotaCreditoModal.vue` y
  // no tiene test — no hay `.nuxt.spec.ts` para ese componente (ver el cierre
  // en `docs/agent/resueltos.md`). Lo que este test fija es que, en un
  // empate, `valorDevueltoCuantizado` devuelve EXACTAMENTE el monto — la
  // precondición que hace que `gt` dé `false` ahí, sin ejercitar el `gt` en
  // sí.
  it('empate exacto: el cuantizado da exactamente el monto (sin residuo que redondear)', () => {
    // 3 unidades vendidas en 3.000 → 1.000 la unidad, se devuelven las 3: sin
    // residuo, cuantizado y sin cuantizar coinciden en 3.000.
    const detalles = [detalle('a', { cantidad: '3', totalLinea: '3000' })]
    const filas = [fila('a', { cantidad: '3' })]
    expect(valorDevueltoCuantizado(detalles, filas, cfgClp('HALF_UP'))).toBe('3000')
  })

  it('moneda con decimales (2): cuantiza a centavos, no a la unidad', () => {
    // 10 en 3 unidades → 3,3333… la unidad; se devuelve 1.
    const detalles = [detalle('a', { cantidad: '3', totalLinea: '10' })]
    const filas = [fila('a', { cantidad: '1' })]
    expect(
      valorDevueltoCuantizado(detalles, filas, { decimalesMoneda: 2, modoRedondeo: 'HALF_UP' }),
    ).toBe('3.33')
  })

  it('sin criterio congelado (`cfg: null`) no cuantiza: el 400 de esa venta no depende de este número', () => {
    // `crearNotaCreditoDesdeVenta` fija `validarVentaElegible: true`, y con
    // eso el backend rechaza CUALQUIER nota de crédito manual sobre una venta
    // sin `config_calculo` antes de llegar a valuar nada
    // (`ventas.service.ts:1416-1439`) — así que este resultado nunca decide
    // si el POST pasa o no.
    const detalles = [detalle('a', { cantidad: '3', totalLinea: '3570' })]
    const filas = [fila('a', { cantidad: '2' })]
    expect(valorDevueltoCuantizado(detalles, filas, null)).toBe('2380')
  })
})
