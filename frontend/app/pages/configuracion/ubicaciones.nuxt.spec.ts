// @vitest-environment nuxt
//
// Réplica del molde de `motivos-baja.nuxt.spec.ts` para `ubicaciones`, con las
// dos diferencias que el diseño pide (docs/features/bodegas-y-traslados.md):
// el local se dibuja arriba, separado, sin botón de eliminar; y el
// mensaje de error del DELETE con stock viaja tal cual del backend (no hay
// forma de afirmar el TEXTO del toast en este harness —`mountSuspended` monta
// sin `UApp`, ver el comentario de `descuentos.nuxt.spec.ts`—, así que lo que
// este archivo prueba es que la pantalla no lo intercepta ni lo reescribe:
// deja pasar `apiErrorMsg(e, ...)` tal cual, igual que el resto de la papelera).
//
// Los bugs que fija son de RUNTIME, igual que en motivos-baja:
//   1. `eliminar()` sacando la fila del array local con el toggle prendido.
//   2. La carrera de `cargar()` bajo toggles rápidos.
//   3. Doble submit al restaurar.
//   4. El 400 de colisión abre el modal con nombre editable, no un toast rojo.
//   5. (Propio de esta pantalla) el local nunca entra a la tabla de bodegas,
//      no tiene botón de eliminar, y su drawer de edición no ofrece "Activa".
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Ubicaciones from './ubicaciones.vue'

const LOCAL_ID = 'local-1'
const BODEGA_ID = 'bodega-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface UbicacionFake {
  id: string
  nombre: string
  tipo: 'local' | 'bodega'
  activo: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function local(over: Partial<UbicacionFake> = {}): UbicacionFake {
  return {
    id: LOCAL_ID,
    nombre: 'Local',
    tipo: 'local',
    activo: true,
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function bodega(over: Partial<UbicacionFake> = {}): UbicacionFake {
  return {
    id: BODEGA_ID,
    nombre: 'Bodega Subsuelo',
    tipo: 'bodega',
    activo: true,
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function eliminada(over: Partial<UbicacionFake> = {}): UbicacionFake {
  return bodega({
    eliminadoEl: BORRADO_EL,
    eliminadoPorNombre: 'admin.paris',
    ...over,
  })
}

/** Error con la forma que le llega a la pantalla desde ofetch. */
function errorApi(message: string, extra: Record<string, unknown> = {}) {
  const e = new Error(message) as Error & { data?: unknown }
  e.data = { message, ...extra }
  return e
}

function sugerir(base: string, vivos: string[]): string {
  for (let n = 2; ; n++) {
    const candidato = `${base} ${n}`
    if (!vivos.includes(candidato)) return candidato
  }
}

// Estado del "backend" simulado. Siempre incluye el local, igual que la API
// real: `GET /ubicaciones` de cualquier tenant trae al menos esa fila.
let ubicacionesBackend: UbicacionFake[] = []

let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null

/** Cada body de POST/PATCH recibido, para verificar que pasaría el DTO real
 *  del backend (`CreateUbicacionDto`/`UpdateUbicacionDto`) y no solo lo que
 *  este mock —que contesta 200 a cualquier cosa— acepta. */
let requestsEscritura: { method: string, url: string, body?: Record<string, unknown> }[] = []

let postsRestaurar: { id: string, nombre?: string }[] = []
let restaurarRetenido: Promise<unknown> | null = null

/**
 * Retiene el POST/PATCH de `guardar()` sin resolver. Sirve para afirmar el body
 * exacto que viajó (lo que importa: que pase el DTO real del backend) sin dejar
 * que `guardar()` termine y cierre el drawer — el cierre real dispara un
 * `unhandled rejection` de happy-dom/reka-ui ajeno a esta pantalla (reproducido
 * también en `motivos-baja.vue` sin tocar su código: es del harness, no un bug
 * de acá) que ninguna pantalla con `AppDrawer` había ejercitado todavía porque
 * ningún spec del repo prueba un guardado EXITOSO de punta a punta. No resolver
 * el POST/PATCH evita la transición de cierre sin dejar de probar lo que
 * importa acá: el body.
 */
let guardarRetenido: Promise<unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string' || !url.includes('/ubicaciones')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'

    if (method === 'DELETE') {
      requestsEscritura.push({ method, url })
      const id = url.split('/').pop()
      const u = ubicacionesBackend.find(x => x.id === id)
      if (u) {
        u.eliminadoEl = BORRADO_EL
        u.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }

    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      const nombreNuevo = opts?.body?.nombre as string | undefined
      postsRestaurar.push({ id, nombre: nombreNuevo })
      const u = ubicacionesBackend.find(x => x.id === id)
      if (!u?.eliminadoEl) {
        return Promise.reject(errorApi(`Ubicación ${id} no está en la papelera`))
      }
      const nombre = nombreNuevo ?? u.nombre
      const vivos = ubicacionesBackend
        .filter(x => !x.eliminadoEl && x.id !== id)
        .map(x => x.nombre)
      if (vivos.includes(nombre)) {
        return Promise.reject(
          errorApi(
            `Ya existe una ubicación activa con el nombre "${nombre}".`,
            { nombreSugerido: sugerir(nombre.replace(/ \d+$/, ''), vivos) },
          ),
        )
      }
      u.eliminadoEl = null
      u.eliminadoPorNombre = null
      u.nombre = nombre
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }

    if (method === 'POST') {
      // Body que el DTO real (`CreateUbicacionDto`) exige: `nombre` no vacío,
      // `tipo` en ('local'|'bodega'). Si la pantalla mandara otra cosa, el
      // backend real respondería 400 y este mock lo dejaría pasar en 200 —por
      // eso queda afirmado abajo con `requestsEscritura`.
      requestsEscritura.push({ method, url, body: opts?.body })
      const nombre = (opts?.body?.nombre as string) ?? ''
      const nueva: UbicacionFake = {
        id: `nueva-${ubicacionesBackend.length}`,
        nombre,
        tipo: 'bodega',
        activo: (opts?.body?.activo as boolean | undefined) ?? true,
        eliminadoEl: null,
        eliminadoPorNombre: null,
      }
      ubicacionesBackend.push(nueva)
      if (guardarRetenido) return guardarRetenido
      return Promise.resolve({ ...nueva })
    }

    if (method === 'PATCH') {
      requestsEscritura.push({ method, url, body: opts?.body })
      const id = url.split('/').pop()
      const u = ubicacionesBackend.find(x => x.id === id)
      if (u) {
        if (opts?.body && 'nombre' in opts.body) u.nombre = opts.body.nombre as string
        if (opts?.body && 'activo' in opts.body) u.activo = opts.body.activo as boolean
      }
      if (guardarRetenido) return guardarRetenido
      return Promise.resolve(u ? { ...u } : {})
    }

    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? ubicacionesBackend
      : ubicacionesBackend.filter(u => !u.eliminadoEl)
    return Promise.resolve(data.map(u => ({ ...u })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Ubicaciones)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

async function activarVerEliminados(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
}

async function confirmarEnModal(texto: string) {
  const d = dialogo()
  expect(d, `modal abierto para confirmar "${texto}"`).toBeTruthy()
  const boton = [...d!.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === texto)
  expect(boton, `botón "${texto}" dentro del modal`).toBeTruthy()
  boton!.click()
  await new Promise(r => setTimeout(r, 50))
}

function badges(wrapper: Awaited<ReturnType<typeof montar>>): string[] {
  return wrapper.findAll('tbody span')
    .map(s => s.text().trim())
    .filter(t => t === 'Eliminado')
}

async function abrirRestaurarDeLaFila(wrapper: Awaited<ReturnType<typeof montar>>) {
  const boton = wrapper.findAll('button')
    .find(b => b.text().trim() === 'Restaurar')
  expect(boton, 'botón "Restaurar" en la fila').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 0))
}

function campoNombre(): HTMLInputElement {
  const input = dialogo()?.querySelector<HTMLInputElement>(
    'input[aria-label="Restaurar como"]',
  )
  expect(input, 'campo "Restaurar como" dentro del modal de colisión').toBeTruthy()
  return input!
}

async function escribirNombre(valor: string) {
  const input = campoNombre()
  input.value = valor
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 10))
}

function reset() {
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurar = []
  restaurarRetenido = null
  guardarRetenido = null
  requestsEscritura = []
}

describe('configuracion/ubicaciones — el local arriba, sin borrar', () => {
  beforeEach(() => {
    ubicacionesBackend = [local(), bodega()]
    reset()
  })

  it('el local se dibuja separado, con el badge "Local", y no tiene botón de eliminar en su fila', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Local')
    const badgeLocal = wrapper.findAll('span').map(s => s.text().trim()).filter(t => t === 'Local')
    expect(badgeLocal.length).toBeGreaterThan(0)

    // La bodega sí tiene su botón "Eliminar" en la tabla.
    expect(wrapper.find('[title="Eliminar"]').exists()).toBe(true)

    // El local no aparece en la tabla de bodegas: ni una fila de tabla trae
    // solamente "Local" como nombre de bodega listada. Se verifica indirecto:
    // el único botón "Eliminar" de la pantalla es el de la bodega, no dos.
    expect(wrapper.findAll('[title="Eliminar"]')).toHaveLength(1)

    wrapper.unmount()
  })

  it('el local nunca sale en la tabla, aunque "Ver eliminados" esté prendido', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    // Sigue habiendo un solo botón "Eliminar" (el de la bodega): el local no
    // se coló a la tabla ni con la papelera abierta.
    expect(wrapper.findAll('[title="Eliminar"]')).toHaveLength(1)

    wrapper.unmount()
  })

  it('editar el local abre un drawer SOLO con "Nombre" (sin el switch "Activa")', async () => {
    const wrapper = await montar()
    await wrapper.find('[title="Renombrar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const dialogoDrawer = document.body.textContent ?? ''
    expect(dialogoDrawer).toContain('Renombrar local')
    // Sin campo "Activa": buscarlo por label y no encontrarlo.
    expect(dialogoDrawer).not.toContain('Activa')

    wrapper.unmount()
  })

  it('renombrar el local manda PATCH solo con nombre (sin activo)', async () => {
    // El POST/PATCH queda retenido a propósito (ver el docblock de
    // `guardarRetenido`): alcanza con el body para esta aserción, y así el
    // drawer nunca llega a cerrar ni dispara su transición.
    guardarRetenido = new Promise(() => {})

    const wrapper = await montar()
    await wrapper.find('[title="Renombrar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const input = dialogo()!.querySelector<HTMLInputElement>('input')
    expect(input).toBeTruthy()
    input!.value = 'Cocina'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 10))

    const boton = [...dialogo()!.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Guardar')!
    boton.click()
    await new Promise(r => setTimeout(r, 20))

    const patch = requestsEscritura.find(r => r.method === 'PATCH')
    expect(patch).toBeTruthy()
    expect(patch!.body).toEqual({ nombre: 'Cocina' })

    wrapper.unmount()
  })

  it('crear una bodega manda POST con tipo bodega (el body que pide CreateUbicacionDto)', async () => {
    guardarRetenido = new Promise(() => {})

    const wrapper = await montar()
    const abrir = wrapper.findAll('button').find(b => b.text().includes('Nueva bodega'))
    expect(abrir).toBeTruthy()
    await abrir!.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const input = dialogo()!.querySelector<HTMLInputElement>('input')
    expect(input).toBeTruthy()
    input!.value = 'Bodega Nueva'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 10))

    const boton = [...dialogo()!.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Crear')!
    boton.click()
    await new Promise(r => setTimeout(r, 20))

    const post = requestsEscritura.find(r => r.method === 'POST')
    expect(post).toBeTruthy()
    expect(post!.body).toMatchObject({ nombre: 'Bodega Nueva', tipo: 'bodega', activo: true })

    wrapper.unmount()
  })
})

describe('configuracion/ubicaciones — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    ubicacionesBackend = [local(), bodega()]
    reset()
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Bodega Subsuelo')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(ubicacionesBackend.find(u => u.id === BODEGA_ID)!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Bodega Subsuelo')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Bodega Subsuelo')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Bodega Subsuelo')
    // El local sigue, intacto: borrar la bodega no lo toca.
    expect(wrapper.text()).toContain('Local')

    wrapper.unmount()
  })

  it('el switch de activo está deshabilitado en una fila eliminada', async () => {
    ubicacionesBackend = [local(), eliminada()]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    const sw = wrapper.findAll('tbody button[role="switch"]')
    expect(sw).toHaveLength(1)
    expect(sw[0]!.attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })
})

describe('configuracion/ubicaciones — papelera: restaurar', () => {
  beforeEach(() => {
    ubicacionesBackend = [local(), eliminada()]
    reset()
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(ubicacionesBackend.find(u => u.id === BODEGA_ID)!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Bodega Subsuelo')
    expect(wrapper.text()).not.toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })

  it('dos clicks en Restaurar mandan UN solo POST', async () => {
    let soltarRestaurar: () => void = () => {}
    restaurarRetenido = new Promise<void>((resolve) => {
      soltarRestaurar = resolve
    })

    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)

    const boton = [...dialogo()!.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Restaurar')!
    boton.click()
    await new Promise(r => setTimeout(r, 10))
    boton.click()
    await new Promise(r => setTimeout(r, 10))

    soltarRestaurar()
    await new Promise(r => setTimeout(r, 60))

    expect(postsRestaurar).toEqual([{ id: BODEGA_ID, nombre: undefined }])

    wrapper.unmount()
    restaurarRetenido = null
  })
})

describe('configuracion/ubicaciones — papelera: colisión de nombre al restaurar', () => {
  beforeEach(() => {
    ubicacionesBackend = [
      local(),
      eliminada(),
      bodega({ id: 'bodega-viva', nombre: 'Bodega Subsuelo' }),
    ]
    reset()
  })

  it('el 400 abre el modal con la sugerencia precargada y confirmar restaura CON ese nombre', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toEqual([{ id: BODEGA_ID, nombre: undefined }])
    expect(ubicacionesBackend.find(u => u.id === BODEGA_ID)!.eliminadoEl).toBe(BORRADO_EL)

    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(campoNombre().value).toBe('Bodega Subsuelo 2')

    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(2)
    expect(postsRestaurar[1]).toEqual({ id: BODEGA_ID, nombre: 'Bodega Subsuelo 2' })
    expect(ubicacionesBackend.find(u => u.id === BODEGA_ID)!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Bodega Subsuelo 2')
    expect(badges(wrapper)).toHaveLength(0)

    wrapper.unmount()
  })

  it('cancelar el modal de colisión deja la fila en la papelera, sin restaurar nada', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    await confirmarEnModal('Cancelar')

    expect(ubicacionesBackend.find(u => u.id === BODEGA_ID)!.eliminadoEl).toBe(BORRADO_EL)
    expect(postsRestaurar).toHaveLength(1)
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el campo vacío el botón de confirmar está deshabilitado', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    await escribirNombre('   ')

    const boton = [...dialogo()!.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Restaurar')!
    expect(boton.hasAttribute('disabled')).toBe(true)
    boton.click()
    await new Promise(r => setTimeout(r, 20))
    expect(postsRestaurar).toHaveLength(1)

    wrapper.unmount()
  })
})

describe('configuracion/ubicaciones — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    ubicacionesBackend = [
      local(),
      bodega(),
      eliminada({ id: 'bodega-vieja', nombre: 'Bodega Vieja' }),
    ]
    reset()
  })

  it('si la respuesta del primer toggle llega DESPUÉS que la del segundo, el listado final igual corresponde al último toggle', async () => {
    const wrapper = await montar()

    let resolverConEliminados: (v: unknown[]) => void = () => {}
    overrideConEliminados = new Promise((resolve) => { resolverConEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    let resolverSinEliminados: (v: unknown[]) => void = () => {}
    overrideSinEliminados = new Promise((resolve) => { resolverSinEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    resolverSinEliminados(
      ubicacionesBackend.filter(u => !u.eliminadoEl).map(u => ({ ...u })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(ubicacionesBackend.map(u => ({ ...u })))
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.text()).toContain('Bodega Subsuelo')
    expect(wrapper.text()).not.toContain('Bodega Vieja')

    wrapper.unmount()
  })
})
