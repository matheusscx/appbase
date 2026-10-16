import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Invariantes de nombre accesible (auditoría UX 01.8, 05.19, 06.8, 07.8, 09.11).
//
// Un botón de solo ícono o un interruptor sin nombre compila, se ve bien y se
// anuncia como "botón" o "interruptor" a secas: el lector de pantalla no dice de
// qué fila. Tampoco sirve el `title`: no se anuncia de forma fiable y no existe
// en una pantalla táctil. Por eso hace falta un chequeo y no alcanza la guía.

const APP = join(__dirname, '..')

function fuentes(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...fuentes(full))
    else if (/\.vue$/.test(e.name)) out.push(full)
  }
  return out
}

interface Etiqueta {
  nombre: string
  atributos: string
  autocerrada: boolean
  inicio: number
  fin: number
  linea: number
}

/** Recorre las etiquetas de un `.vue`; el `>` dentro de comillas (`=>`) no cierra la etiqueta. */
function etiquetas(texto: string): Etiqueta[] {
  const out: Etiqueta[] = []
  const re = /<(\/?)([A-Za-z][\w.-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    let i = m.index + m[0].length
    let comilla = ''
    while (i < texto.length) {
      const c = texto[i]!
      if (comilla) { if (c === comilla) comilla = '' }
      else if (c === '"' || c === '\'') comilla = c
      else if (c === '>') break
      i++
    }
    const atributos = texto.slice(m.index + m[0].length, i)
    out.push({
      nombre: (m[1] ? '/' : '') + m[2]!,
      atributos,
      autocerrada: atributos.trimEnd().endsWith('/'),
      inicio: m.index,
      fin: i,
      linea: texto.slice(0, m.index).split('\n').length,
    })
    re.lastIndex = i
  }
  return out
}

const tiene = (attrs: string, ...nombres: string[]) =>
  nombres.some(n => new RegExp(`(^|\\s)(:|v-bind:)?${n}(\\s|=|$|/)`).test(attrs))

export interface Hallazgo { ruta: string, linea: number, que: string }

/**
 * Botones de solo ícono de las pantallas de configuración que no llegan a 44 px
 * (`size-11`). Auditoría 07.26: lápiz y basurero medían 32×32 con 4-8 px entre sí.
 */
export function iconosChicos(ruta: string, texto: string): Hallazgo[] {
  const tags = etiquetas(texto)
  const malos: Hallazgo[] = []
  tags.forEach((t, idx) => {
    if (t.nombre !== 'UButton' || !tiene(t.atributos, 'icon') || tiene(t.atributos, 'label', 'v-bind', 'v-text')) return
    const cierre = tags.slice(idx + 1).find(x => x.nombre === '/UButton' || x.nombre === 'UButton')
    const cuerpo = t.autocerrada ? '' : texto.slice(t.fin + 1, cierre?.inicio ?? t.fin + 1).trim()
    if (cuerpo === '' && !/\b(size-11|min-h-11|h-11)\b/.test(t.atributos)) {
      malos.push({ ruta, linea: t.linea, que: 'UButton de solo ícono bajo 44 px (falta size-11)' })
    }
  })
  return malos
}

/**
 * Un `div`, `li`, `span` o `UCard` con `@click` es invisible para el teclado y el
 * lector de pantalla (auditoría 01.9, 02.11, 03.11, 07.18, 09.12): hace falta
 * `role="button"` + `tabindex`, o ser un enlace (`as="a"`). `@click.stop` /
 * `.prevent` a secas no cuentan: es contención de eventos, no una acción.
 */
export function clicSinTeclado(ruta: string, texto: string): Hallazgo[] {
  const esAccion = (attrs: string) => {
    const m = /(^|\s)@click((?:\.[\w-]+)*)(=|\s|$)/.exec(attrs)
    if (!m) return false
    const mods = m[2]!.split('.').filter(Boolean)
    const soloContencion = m[3] !== '=' && mods.length > 0 && mods.every(x => ['stop', 'prevent', 'self'].includes(x))
    return !soloContencion
  }
  return etiquetas(texto)
    .filter(t => /^(div|span|li|p|section|article|UCard)$/.test(t.nombre))
    .filter(t => esAccion(t.atributos))
    .filter(t => !tiene(t.atributos, 'role', 'tabindex') && !/\sas="a"/.test(` ${t.atributos}`))
    .map(t => ({ ruta, linea: t.linea, que: `<${t.nombre}> con @click sin role ni tabindex` }))
}

export function sinNombre(ruta: string, texto: string): Hallazgo[] {
  const tags = etiquetas(texto)
  const malos: Hallazgo[] = []
  const camposConEtiqueta: boolean[] = []
  tags.forEach((t, idx) => {
    if (t.nombre === 'UFormField' && !t.autocerrada) camposConEtiqueta.push(tiene(t.atributos, 'label'))
    else if (t.nombre === '/UFormField') camposConEtiqueta.pop()

    if (t.nombre === 'UButton' && tiene(t.atributos, 'icon') && !tiene(t.atributos, 'label', 'aria-label', 'v-bind', 'v-text')) {
      // Con cuerpo (texto o slot) el botón ya se llama como su contenido.
      const cierre = tags.slice(idx + 1).find(x => x.nombre === '/UButton' || x.nombre === 'UButton')
      const cuerpo = t.autocerrada ? '' : texto.slice(t.fin + 1, cierre?.inicio ?? t.fin + 1).trim()
      if (cuerpo === '') malos.push({ ruta, linea: t.linea, que: 'UButton de solo ícono sin aria-label' })
    }
    if (t.nombre === 'button' && !t.autocerrada && !tiene(t.atributos, 'aria-label', 'v-bind')) {
      const cierre = tags.slice(idx + 1).find(x => x.nombre === '/button')
      const cuerpo = texto.slice(t.fin + 1, cierre?.inicio ?? t.fin + 1)
      // Solo ícono: sin texto una vez quitadas las etiquetas y sin interpolaciones.
      if (/<UIcon|<Icon/.test(cuerpo) && cuerpo.replace(/<[^>]*>/g, '').trim() === '') {
        malos.push({ ruta, linea: t.linea, que: '<button> de solo ícono sin aria-label' })
      }
    }
    if (t.nombre === 'USwitch' && !tiene(t.atributos, 'label', 'aria-label', 'v-bind')
      && !camposConEtiqueta.some(Boolean)) {
      const cierre = tags.slice(idx + 1).find(x => x.nombre === '/USwitch' || x.nombre === 'USwitch')
      const cuerpo = t.autocerrada ? '' : texto.slice(t.fin + 1, cierre?.inicio ?? t.fin + 1).trim()
      if (cuerpo === '' && !/#label/.test(cuerpo)) malos.push({ ruta, linea: t.linea, que: 'USwitch sin label ni aria-label' })
    }
  })
  return malos
}

const ARCHIVOS = fuentes(APP).map(f => ({ ruta: relative(APP, f).replace(/\\/g, '/'), texto: readFileSync(f, 'utf8') }))

describe('nombre accesible', () => {
  it('ningún botón de solo ícono, <button> de solo ícono ni interruptor queda sin nombre', () => {
    const todos = ARCHIVOS.flatMap(a => sinNombre(a.ruta, a.texto))
    expect(todos.map(h => `${h.ruta}:${h.linea} ${h.que}`)).toEqual([])
  })

  it('el chequeo ve lo que debe: un botón de ícono sin nombre y un interruptor sin rótulo', () => {
    const malo = `<template><UButton icon="i-lucide-x" @click="a => b()" /><USwitch :model-value="x" /></template>`
    expect(sinNombre('x.vue', malo).map(h => h.que)).toEqual([
      'UButton de solo ícono sin aria-label',
      'USwitch sin label ni aria-label',
    ])
    const bueno = `<template><UButton icon="i-lucide-x" aria-label="Cerrar" /><UFormField label="Activo"><USwitch v-model="x" /></UFormField><USwitch label="Sí" /><UButton icon="i-lucide-x">Cerrar</UButton></template>`
    expect(sinNombre('x.vue', bueno)).toEqual([])
  })
})

// Excepciones: el elemento NO es la acción, solo escucha clics para otra cosa.
const CLIC_PERMITIDO: Record<string, { usos: number, motivo: string }> = {
  'pages/paquetes/escanear.vue': { usos: 1, motivo: 'el clic en cualquier parte de la pantalla devuelve el foco a la pistola; no es una acción' },
}

describe('lo clicable se alcanza con teclado', () => {
  it('ninguna tarjeta o fila con @click queda sin rol ni tabindex, salvo la lista explícita', () => {
    const sobran: string[] = []
    for (const a of ARCHIVOS) {
      const n = clicSinTeclado(a.ruta, a.texto).length
      const permitido = CLIC_PERMITIDO[a.ruta]?.usos ?? 0
      if (n !== permitido) sobran.push(`${a.ruta}: ${n} elementos con @click sin teclado, permitidos ${permitido}`)
    }
    expect(sobran).toEqual([])
  })

  it('el chequeo ve lo que debe', () => {
    expect(clicSinTeclado('x.vue', '<div class="a" @click="x()">hola</div>')).toHaveLength(1)
    expect(clicSinTeclado('x.vue', '<UCard @click="x()" />')).toHaveLength(1)
    expect(clicSinTeclado('x.vue', '<div role="button" tabindex="0" @click="x()">hola</div>')).toEqual([])
    expect(clicSinTeclado('x.vue', '<UCard as="a" href="/a" @click="x()" />')).toEqual([])
    expect(clicSinTeclado('x.vue', '<div @click.stop>hola</div>')).toEqual([])
  })
})

// Pantallas de configuración: lápiz, basurero y compañía a 44 px. Cada excepción
// lleva su porqué; subir un número es decir "este también es chico a propósito".
const CHICOS_PERMITIDOS: Record<string, { usos: number, motivo: string }> = {
  'pages/configuracion/preferencias-financieras.vue': { usos: 2, motivo: 'subir/bajar el paso de la fórmula: dos flechas apiladas por fila, a 44 px la fila se triplica' },
  'pages/configuracion/propinas-distribucion.vue': { usos: 2, motivo: 'quitar grupo/peso dentro de una tarjeta densa; se confirma con el guardado' },
}

describe('tamaño táctil en configuración (07.26)', () => {
  it('los botones de solo ícono miden 44 px, salvo la lista explícita', () => {
    const sobran: string[] = []
    for (const a of ARCHIVOS.filter(x => x.ruta.startsWith('pages/configuracion/') || x.ruta === 'pages/terceros.vue')) {
      const n = iconosChicos(a.ruta, a.texto).length
      const permitido = CHICOS_PERMITIDOS[a.ruta]?.usos ?? 0
      if (n !== permitido) sobran.push(`${a.ruta}: ${n} botones bajo 44 px, permitidos ${permitido}`)
    }
    expect(sobran).toEqual([])
  })
})
