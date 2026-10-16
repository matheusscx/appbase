import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Invariantes de la identidad visual de Venka (auditoría UX 00.12, lote 9).
//
// Se rompen sin que nada falle: compilan, tipan y la pantalla "anda". Por eso
// hace falta un chequeo y no alcanza la guía:
//  - `font-mono` en un monto: DM Sans ya trae los dígitos de ancho fijo, y la
//    letra de terminal al lado de la de marca se ve de otra app.
//  - Rótulos en MAYÚSCULAS con espaciado: la marca escribe en oración.
//  - Un color de paleta de Tailwind (`text-green-600`): se salta los tonos de
//    estado de la marca (`text-success`, `text-error`), que son los que miden
//    4,5:1. Caja tuvo una excepción por esto y se retiró (03.8).

const APP = join(__dirname, '..')

function fuentes(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...fuentes(full))
    else if (/\.(ts|vue)$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(full)
  }
  return out
}

const ARCHIVOS = fuentes(APP).map(f => ({
  ruta: relative(APP, f).replace(/\\/g, '/'),
  texto: readFileSync(f, 'utf8'),
}))

// `font-mono` es legítimo solo en un IDENTIFICADOR técnico, que se lee carácter a
// carácter (no en una cifra que se suma o se compara). Cada entrada es
// archivo → cuántas veces, y el porqué. Subir un número es decir "este también es
// un identificador": hay que poder justificarlo.
const MONO_PERMITIDO: Record<string, { usos: number, motivo: string }> = {
  'components/ventas/VentaDetalleDrawer.vue': { usos: 2, motivo: 'número de serie y código de orden' },
  'components/ordenes/OrdenDetalleDrawer.vue': { usos: 2, motivo: 'código de orden y código de autorización' },
  'pages/ordenes.vue': { usos: 1, motivo: 'código de orden' },
  'components/ventas/CarritoPanel.vue': { usos: 1, motivo: 'número de serie' },
  'components/ventas/UnidadesSerieModal.vue': { usos: 1, motivo: 'número de serie' },
  'components/salones/AnularLineaModal.vue': { usos: 1, motivo: 'número de serie' },
  'pages/salones/index.vue': { usos: 1, motivo: 'número de serie' },
  'pages/configuracion/items.vue': { usos: 3, motivo: 'número de serie (2) y UUID del movimiento' },
  'pages/inventario/traslados.vue': { usos: 1, motivo: 'número de serie' },
  'pages/propinas/liquidaciones/[id]/imprimir.vue': { usos: 3, motivo: 'folio técnico del comprobante' },
  'pages/configuracion/pasarelas.vue': { usos: 1, motivo: 'prefijo técnico de la pasarela' },
  'pages/paquetes/index.vue': { usos: 2, motivo: 'código de bulto y lo que lee la pistola' },
  'pages/paquetes/escanear.vue': { usos: 4, motivo: 'códigos de bulto leídos con la pistola' },
  'pages/paquetes/rutas/[id].vue': { usos: 1, motivo: 'código de bulto' },
}

function conteo(re: RegExp, texto: string): number {
  return (texto.match(re) ?? []).length
}

describe('identidad visual de Venka', () => {
  it('font-mono solo en identificadores técnicos, dentro de la lista explícita', () => {
    const sobran: string[] = []
    for (const { ruta, texto } of ARCHIVOS) {
      const n = conteo(/\bfont-mono\b/g, texto)
      const permitido = MONO_PERMITIDO[ruta]?.usos ?? 0
      if (n > permitido) sobran.push(`${ruta}: ${n} usos, permitidos ${permitido}`)
    }
    expect(sobran, 'los montos y cifras van en DM Sans, sin font-mono').toEqual([])
  })

  it('la lista de excepciones no tiene entradas muertas', () => {
    const sueltas = Object.entries(MONO_PERMITIDO).filter(([ruta, { usos }]) => {
      const f = ARCHIVOS.find(a => a.ruta === ruta)
      return !f || conteo(/\bfont-mono\b/g, f.texto) !== usos
    }).map(([ruta]) => ruta)
    expect(sueltas).toEqual([])
  })

  it('ningún rótulo va en MAYÚSCULAS con espaciado', () => {
    const malos: string[] = []
    for (const { ruta, texto } of ARCHIVOS) {
      texto.split('\n').forEach((linea, i) => {
        if (/\buppercase\b/.test(linea) || /\btracking-(wide|wider|widest)\b/.test(linea)) {
          malos.push(`${ruta}:${i + 1}`)
        }
      })
    }
    expect(malos, 'los rótulos van en oración, en tono normal').toEqual([])
  })

  it('ningún color de paleta de Tailwind: los estados usan text-success / text-error / text-warning', () => {
    const re = /\b(?:text|bg|border|ring|divide|from|via|to)-(?:green|red|blue|emerald|amber|yellow|orange|sky|indigo|purple|rose|lime|teal|cyan|violet|fuchsia|pink)-\d{2,3}\b/
    const malos: string[] = []
    for (const { ruta, texto } of ARCHIVOS) {
      texto.split('\n').forEach((linea, i) => {
        if (re.test(linea)) malos.push(`${ruta}:${i + 1}`)
      })
    }
    expect(malos).toEqual([])
  })
})
