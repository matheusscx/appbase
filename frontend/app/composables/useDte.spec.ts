import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DocumentoDte } from './useDte'
import {
  TAMANO_MAXIMO_DTE,
  bodyLectura,
  debeLlenarDescuentoDte,
  descuentoDeFactura,
  fraseOrigenDte,
  leerDte,
  lineaFormDesdeDte,
  mensajeCompraExistente,
  normalizarClave,
  precargaDescuento,
  repartirLineas,
  textoLinea,
} from './useDte'

const FIXTURES = join(__dirname, '__fixtures__/dte')

function leerFixture(nombre: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, nombre))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** Stub de `formatMonto`: solo separa miles con texto, sin aritmética — el
 *  punto de `textoLinea` es la composición del texto, no el formato de plata
 *  (eso lo prueba `useFormatters.spec.ts`). */
function formatMontoStub(v: string): string {
  return `$${v.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

function documentoOk(resultado: ReturnType<typeof leerDte>): DocumentoDte {
  if (!resultado.ok) throw new Error(`se esperaba ok:true, vino: ${resultado.error}`)
  const [doc] = resultado.documentos
  if (!doc) throw new Error('sin documentos')
  return doc
}

describe('leerDte — andina-33.xml (la escena de la spec)', () => {
  const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))

  it('un solo documento, con sus tres líneas', () => {
    expect(doc.lineas).toHaveLength(3)
  })

  it('línea 1 (Coca, con descuento de línea): precioUnitario 91.200 ÷ 10 = 9.120, no 9.600 (PrcItem)', () => {
    const linea = doc.lineas[0]!
    expect(linea.clave).toBe('CODIGO:INT1:CC350-12')
    expect(linea.precioUnitario).toBe('9120')
    expect(linea.conAjusteDeLinea).toBe(true)
  })

  it('línea 2 (Fanta, sin descuento): precioUnitario = MontoItem porque no hay descuento', () => {
    expect(doc.lineas[1]!.precioUnitario).toBe('8800')
  })

  it('línea 3 (FLETE, sin código ni cantidad): clave por texto, sin cantidad ni precio unitario', () => {
    const linea = doc.lineas[2]!
    expect(linea.clave).toBe('NOMBRE:FLETE')
    expect(linea.cantidad).toBeNull()
    expect(linea.precioUnitario).toBeNull()
    expect(linea.montoItem).toBe('5000')
  })

  it('descuentoDeFactura: 2% de (91.200 + 8.800 + 5.000) = 2% de 105.000 = 2.100, el flete adentro de la base', () => {
    expect(descuentoDeFactura(doc, 0)).toEqual({ monto: '2100', avisos: [] })
  })
})

describe('leerDte — MntTotal, FchVenc y FmaPago (tarea 4)', () => {
  it('andina-33.xml: MntTotal viene, sin FchVenc ni FmaPago (no los trae)', () => {
    const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))
    expect(doc.montoTotal).toBe('122451')
    expect(doc.fechaVencimiento).toBeNull()
    expect(doc.fmaPago).toBeNull()
  })

  it('contado (FmaPago 1): sin FchVenc', () => {
    const doc = documentoOk(leerDte(leerFixture('contado-fma-pago-1.xml')))
    expect(doc.fmaPago).toBe('1')
    expect(doc.fechaVencimiento).toBeNull()
  })

  it('crédito (FmaPago 2): trae FchVenc, y esa fecha manda (spec § 4.2)', () => {
    const doc = documentoOk(leerDte(leerFixture('credito-fchvenc.xml')))
    expect(doc.fmaPago).toBe('2')
    expect(doc.fechaVencimiento).toBe('2026-10-16')
    expect(doc.montoTotal).toBe('119000')
  })
})

describe('leerDte — encoding ISO-8859-1', () => {
  it('un NmbItem con CAFÉ se lee CAFÉ, no un mojibake de UTF-8', () => {
    const doc = documentoOk(leerDte(leerFixture('dte-suelto.xml')))
    expect(doc.lineas[0]!.descripcion).toBe('CAFÉ EN GRANO 250G')
  })
})

describe('leerDte — raíces y varios documentos', () => {
  it('envio-3-docs.xml (EnvioDTE con 3 DTE) → 3 documentos', () => {
    const resultado = leerDte(leerFixture('envio-3-docs.xml'))
    expect(resultado.ok).toBe(true)
    expect(resultado.ok && resultado.documentos).toHaveLength(3)
  })

  it('dte-suelto.xml (raíz DTE, sin EnvioDTE) → 1 documento', () => {
    const resultado = leerDte(leerFixture('dte-suelto.xml'))
    expect(resultado.ok).toBe(true)
    expect(resultado.ok && resultado.documentos).toHaveLength(1)
  })
})

describe('leerDte — rechazos', () => {
  it('con-doctype.xml: el <!DOCTYPE> se rechaza ANTES de parsear, aunque el resto sea un DTE válido', () => {
    // Sin entidades y sin subset interno: happy-dom lo parsea sin `parsererror`, así
    // que si esto da ok:true, el precheck de la regex se salteó (no es el parser
    // rechazándolo por su cuenta).
    expect(leerDte(leerFixture('con-doctype.xml'))).toEqual({
      ok: false,
      error: 'Este archivo no es una factura electrónica del SII',
    })
  })

  it('no-es-dte.xml: XML válido pero no es un DTE', () => {
    expect(leerDte(leerFixture('no-es-dte.xml'))).toEqual({
      ok: false,
      error: 'Este archivo no es una factura electrónica del SII',
    })
  })

  it('un archivo de más de 2 MB se rechaza por tamaño, sin llegar a decodificarlo', () => {
    const resultado = leerDte(new ArrayBuffer(TAMANO_MAXIMO_DTE + 1))
    expect(resultado.ok).toBe(false)
    expect(!resultado.ok && resultado.error).toMatch(/2 MB/)
  })
})

describe('leerDte — precios brutos (MntBruto = 1)', () => {
  it('con IVA incluido, ninguna línea trae precioUnitario', () => {
    const doc = documentoOk(leerDte(leerFixture('precios-brutos.xml')))
    expect(doc.preciosConIva).toBe(true)
    expect(doc.lineas.every(l => l.precioUnitario === null)).toBe(true)
  })
})

describe('leerDte — cantidad con más de 4 decimales', () => {
  const doc = documentoOk(leerDte(leerFixture('cantidad-6-decimales.xml')))

  it('QtyItem 1.123456 (6 decimales, más allá de la escala del kardex) → cantidad null', () => {
    expect(doc.lineas[0]!.cantidad).toBeNull()
  })

  it('QtyItem 3 y MontoItem 10000 → precioUnitario 3333.3333 (no divide exacto)', () => {
    expect(doc.lineas[1]!.precioUnitario).toBe('3333.3333')
  })
})

/**
 * Ata esta `normalizarClave` con la del backend
 * (`backend/src/modules/compras/lectura-dte.service.ts`, describe homónimo en
 * `lectura-dte.service.spec.ts`) — mismos pares, mismo orden
 * (docs/agent/pendientes.md § 1, "Atar con un test las dos `normalizarClave`").
 * Backend y frontend no comparten código (decisión del owner), así que el
 * fixture está duplicado a mano en los dos specs: si uno cambia, el otro no
 * se entera solo. Medido 2026-09-28 que las dos implementaciones no divergen
 * para ningún code point combinado con espacios — este fixture cubre los
 * casos de borde de esa medición (NBSP, tabs, `ß`, saltos de línea, espacios
 * al borde y en medio).
 */
describe('normalizarClave — pares atados con el backend (lectura-dte.service.spec.ts)', () => {
  const PARES: [entrada: string, clave: string][] = [
    ['  codigo:int1:cc350-12 ', 'CODIGO:INT1:CC350-12'],
    ['NOMBRE:Fanta   350ml  CJ12', 'NOMBRE:FANTA 350ML CJ12'],
    [' CJ12 ', 'CJ12'],
    ['CJ 12', 'CJ 12'],
    ['\tCJ12\t', 'CJ12'],
    ['CJ\t12', 'CJ 12'],
    ['cj12\nabc', 'CJ12 ABC'],
    ['\ncj12\n', 'CJ12'],
    ['straße 350ml', 'STRASSE 350ML'],
    ['ß', 'SS'],
    ['  ß ml  ', 'SS ML'],
    ['  Fanta 350ml\tCJ12\n', 'FANTA 350ML CJ12'],
  ]

  it.each(PARES)('%j → %j', (entrada, clave) => {
    expect(normalizarClave(entrada)).toBe(clave)
  })
})

describe('descuentoDeFactura — descuentos y recargos globales', () => {
  it('un $ fijo más un % sobre las líneas exentas (misma IndExeDR) se suman; un recargo va a avisos, no al monto', () => {
    const doc = documentoOk(leerDte(leerFixture('descuentos-globales.xml')))
    // D $1.500 + D 10% de la línea exenta ($20.000, IndExe=1 calza con IndExeDR=1) = $2.000
    // → 1.500 + 2.000 = 3.500. El R $800 no entra al monto.
    const { monto, avisos } = descuentoDeFactura(doc, 0)
    expect(monto).toBe('3500')
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toContain('$800')
  })
})

describe('bodyLectura', () => {
  it('tiene exactamente las claves del DTO del backend, sin proveedorId si no se eligió a mano', () => {
    const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))
    const body = bodyLectura(doc)
    expect(Object.keys(body).sort()).toEqual(['claves', 'emisorRut', 'folio', 'receptorRut', 'tipoDte'])
  })

  it('con proveedorId elegido a mano, se agrega esa clave', () => {
    const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))
    const body = bodyLectura(doc, 'prov-1')
    expect(Object.keys(body).sort()).toEqual(['claves', 'emisorRut', 'folio', 'proveedorId', 'receptorRut', 'tipoDte'])
    expect(body.proveedorId).toBe('prov-1')
  })

  it('claves sin repetidos: dos líneas con la misma clave (bonificada a $0) mandan una sola', () => {
    const docConRepetidos: DocumentoDte = {
      tipoDte: '33',
      folio: '1',
      fechaEmision: '2026-09-20',
      emisorRut: '76543210-3',
      emisorRazonSocial: 'Distribuidora Andina Ltda',
      receptorRut: '76123456-7',
      montoTotal: null,
      fechaVencimiento: null,
      fmaPago: null,
      preciosConIva: false,
      descuentosGlobales: [],
      lineas: [
        { clave: 'CODIGO:INT1:CC350-12', descripcion: 'COCA', cantidad: '10', unidadFactura: 'CJ', precioListado: '9600', precioUnitario: '9600', conAjusteDeLinea: false, montoItem: '96000', indExe: null },
        { clave: 'CODIGO:INT1:CC350-12', descripcion: 'COCA REGALO', cantidad: '1', unidadFactura: 'CJ', precioListado: '0', precioUnitario: '0', conAjusteDeLinea: false, montoItem: '0', indExe: null },
      ],
    }
    const body = bodyLectura(docConRepetidos)
    expect(body.claves).toEqual(['CODIGO:INT1:CC350-12'])
  })
})

describe('repartirLineas', () => {
  it('la Coca con destino, la Fanta sin asociación (null) y el FLETE apartado', () => {
    const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))
    const { lineas, apartadas } = repartirLineas(doc, [
      { clave: 'CODIGO:INT1:CC350-12', destino: { itemId: 'item-coca', presentacionId: 'pres-caja' } },
      { clave: 'NOMBRE:FLETE', destino: 'no_mercaderia' },
    ])

    expect(lineas).toHaveLength(2)
    expect(lineas[0]!.linea.clave).toBe('CODIGO:INT1:CC350-12')
    expect(lineas[0]!.destino).toEqual({ itemId: 'item-coca', presentacionId: 'pres-caja' })
    expect(lineas[1]!.linea.clave).toBe('CODIGO:INT1:FA350-12')
    expect(lineas[1]!.destino).toBeNull()

    expect(apartadas).toHaveLength(1)
    expect(apartadas[0]!.clave).toBe('NOMBRE:FLETE')
  })
})

describe('textoLinea — lo que la línea muestra de la factura (ruling 4)', () => {
  it('con cantidad, unidad y precio: descripción · cantidad unidad · precio', () => {
    const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))
    expect(textoLinea(doc.lineas[0]!, formatMontoStub)).toBe('COCA COLA 350ML CJ12 · 10 CJ · $9.600')
  })

  it('sin cantidad ni precio (FLETE): sin "·" colgando', () => {
    const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))
    expect(textoLinea(doc.lineas[2]!, formatMontoStub)).toBe('FLETE')
  })
})

// Fix round 1, F1: un `MontoItem`/`ValorDR` que no es un número no puede hacer
// TRONAR `leerDte` — su contrato es `ResultadoLecturaDte`, nunca un throw. La
// línea rota queda sin precio; el descuento global roto se salta con aviso.
describe('valores no numéricos en el XML (fix round 1, F1)', () => {
  it('MontoItem="abc" deja esa línea sin montoItem ni precioUnitario, sin tirar el documento entero', () => {
    const resultado = leerDte(leerFixture('valores-invalidos.xml'))
    expect(resultado.ok).toBe(true)
    const doc = documentoOk(resultado)
    expect(doc.lineas).toHaveLength(2)
    expect(doc.lineas[0]!.montoItem).toBe('2000') // la línea válida no se contagia
    expect(doc.lineas[1]!.montoItem).toBeNull()
    expect(doc.lineas[1]!.precioUnitario).toBeNull()
  })

  it('descuentoDeFactura con un ValorDR="x": no explota, lo salta y avisa', () => {
    const doc = documentoOk(leerDte(leerFixture('valores-invalidos.xml')))
    expect(() => descuentoDeFactura(doc, 0)).not.toThrow()
    const { monto, avisos } = descuentoDeFactura(doc, 0)
    expect(monto).toBeNull()
    expect(avisos).toContain('La factura trae un descuento global que no se pudo leer')
  })
})

// Fix round 1, F2: `MontoItem = PrcItem×Qty − Descuento + Recargo` (Formato DTE
// pág. 41). Una línea con SOLO recargo también cambia el precio y tiene que
// avisarlo — de ahí el nombre `conAjusteDeLinea` (no solo "descuento").
describe('ajuste de línea por recargo (fix round 1, F2)', () => {
  it('una línea con solo RecargoMonto: conAjusteDeLinea true y el precio incluye el recargo', () => {
    const doc = documentoOk(leerDte(leerFixture('ajuste-de-linea.xml')))
    const linea = doc.lineas[0]!
    // MontoItem = PrcItem(1000) × Qty(10) + Recargo(500) = 10.500 ÷ 10 = 1.050
    expect(linea.conAjusteDeLinea).toBe(true)
    expect(linea.precioUnitario).toBe('1050')
  })
})

// Tarea 4 — lo que la pantalla de Nueva compra precarga desde el XML
// (`pages/compras/[id].vue`), sacado del `.vue` para que quede puro y testeable acá.
describe('lineaFormDesdeDte', () => {
  const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))
  const coca = doc.lineas[0]! // CODIGO:INT1:CC350-12, 10 CJ, $9.120
  const flete = doc.lineas[2]! // NOMBRE:FLETE, sin cantidad ni precio

  const PRODUCTO_COCA = { modoInventario: 'cantidad', unidadMedida: 'unidad' }

  it('con destino y el producto vivo en el catálogo: calzó por código, con su unidad', () => {
    const r = lineaFormDesdeDte(
      coca,
      { itemId: 'item-coca', unidadCodigo: 'unidad' },
      null,
      PRODUCTO_COCA,
      v => `$${v}`,
    )
    expect(r.itemId).toBe('item-coca')
    expect(r.unidadCodigo).toBe('unidad')
    expect(r.presentacionId).toBe('')
    expect(r.cantidad).toBe('10')
    expect(r.precioUnitario).toBe('9120')
    expect(r.dte).toEqual({
      clave: 'CODIGO:INT1:CC350-12',
      descripcion: 'COCA COLA 350ML CJ12',
      texto: textoLinea(coca, v => `$${v}`), // se delega en textoLinea, no se arma acá
      calzo: true,
      nota: null,
      conAjusteDeLinea: true,
    })
  })

  it('con destino pero el producto ya no está en el catálogo: llega por asociar, no con un producto fantasma', () => {
    const r = lineaFormDesdeDte(
      coca,
      { itemId: 'item-borrado', unidadCodigo: 'unidad' },
      'el producto al que apuntaba ya no está',
      undefined,
      v => v,
    )
    expect(r.itemId).toBe('')
    expect(r.unidadCodigo).toBe('')
    expect(r.dte!.calzo).toBe(false)
    expect(r.dte!.nota).toBe('el producto al que apuntaba ya no está')
  })

  it('sin destino (por asociar): itemId y unidad vacíos, cantidad y precio del XML igual', () => {
    const r = lineaFormDesdeDte(coca, null, null, undefined, v => v)
    expect(r.itemId).toBe('')
    expect(r.unidadCodigo).toBe('')
    expect(r.presentacionId).toBe('')
    expect(r.cantidad).toBe('10')
    expect(r.precioUnitario).toBe('9120')
    expect(r.dte!.calzo).toBe(false)
  })

  it('con presentación en el destino: unidadCodigo vacío, presentacionId puesto', () => {
    const r = lineaFormDesdeDte(coca, { itemId: 'item-coca', presentacionId: 'pres-caja' }, null, PRODUCTO_COCA, v => v)
    expect(r.presentacionId).toBe('pres-caja')
    expect(r.unidadCodigo).toBe('')
  })

  it('una línea sin cantidad ni precio (FLETE): cantidad y precioUnitario vacíos, no null suelto', () => {
    const r = lineaFormDesdeDte(flete, null, null, undefined, v => v)
    expect(r.cantidad).toBe('')
    expect(r.precioUnitario).toBe('')
  })
})

describe('precargaDescuento', () => {
  const doc = documentoOk(leerDte(leerFixture('andina-33.xml')))

  it('sin líneas sin precio y sin precios brutos: carga el descuento de descuentoDeFactura (2.100)', () => {
    expect(precargaDescuento(doc, 0, false)).toEqual({ monto: '2100', avisos: [] })
  })

  it('con precios brutos: no carga nada y avisa que hay que tipear el neto, sin llamar a descuentoDeFactura', () => {
    const bruto = documentoOk(leerDte(leerFixture('precios-brutos.xml')))
    expect(precargaDescuento(bruto, 0, false)).toEqual({
      monto: null,
      avisos: ['Esta factura trae los precios con IVA incluido: tipeá el neto'],
    })
  })

  it('con alguna línea sin precio (y la factura sí trae un descuento global): no carga nada y avisa', () => {
    const r = precargaDescuento(doc, 0, true)
    expect(r.monto).toBeNull()
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0]).toMatch(/sin precio/)
  })

  it('con alguna línea sin precio y SIN descuento global en la factura: no avisa nada (no hay nada que no se cargó)', () => {
    const sinDescuento: DocumentoDte = { ...doc, descuentosGlobales: [] }
    expect(precargaDescuento(sinDescuento, 0, true)).toEqual({ monto: null, avisos: [] })
  })
})

describe('fraseOrigenDte', () => {
  it('arma la franja superior con tipo, folio y proveedor', () => {
    expect(fraseOrigenDte('Factura', '123', 'Distribuidora Andina')).toBe(
      'Cargado desde la factura Factura N° 123 · Distribuidora Andina · '
      + 'Aceptar o reclamar esta factura se sigue haciendo en el SII',
    )
  })
})

describe('mensajeCompraExistente', () => {
  it('confirmada: nombra la fecha', () => {
    expect(mensajeCompraExistente(
      { id: 'c1', estado: 'confirmada', confirmadoEl: '2026-09-22' },
      iso => iso,
    )).toBe('Esta factura ya está cargada (confirmada el 2026-09-22)')
  })

  it('borrador: sin fecha', () => {
    expect(mensajeCompraExistente(
      { id: 'c1', estado: 'borrador', confirmadoEl: null },
      iso => iso,
    )).toBe('Esta factura ya está cargada (borrador)')
  })
})

// F1, ronda 1: el descuento se recalcula cada vez que cambian las líneas que
// quedan en la compra (apartar el FLETE puede destrabarlo), así que llenar el
// campo no puede repetirse en cada recálculo.
describe('debeLlenarDescuentoDte', () => {
  it('con monto, sin llenar antes y el campo vacío: sí', () => {
    expect(debeLlenarDescuentoDte('2100', false, '')).toBe(true)
  })

  it('sin monto (todavía bloqueado, o precios brutos): no', () => {
    expect(debeLlenarDescuentoDte(null, false, '')).toBe(false)
  })

  it('ya se llenó antes en esta lectura: no, aunque el campo esté vacío de nuevo (lo borraron a mano)', () => {
    expect(debeLlenarDescuentoDte('2100', true, '')).toBe(false)
  })

  it('el campo ya tiene algo tipeado (a mano, antes de que el monto estuviera listo): no lo pisa', () => {
    expect(debeLlenarDescuentoDte('2100', false, '500')).toBe(false)
  })
})
