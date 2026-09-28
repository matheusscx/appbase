import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DocumentoDte } from './useDte'
import {
  TAMANO_MAXIMO_DTE,
  bodyLectura,
  descuentoDeFactura,
  leerDte,
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
