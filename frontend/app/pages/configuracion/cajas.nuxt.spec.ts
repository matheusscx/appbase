// @vitest-environment nuxt
//
// Pantalla de CAJONES con papelera, gateada por permisos (`Cajas`), tras el
// molde `descuentos` (colisión de nombre) y el molde `turnos` (gating por
// permisos). El backend exige `Cajas:Eliminar` tanto para el `DELETE` como
// para `POST /cajones/:id/restaurar`, así que la papelera entera —toggle
// incluido— tiene que estar detrás del mismo permiso: ofrecerla a quien no lo
// tiene es prometer una acción que termina en 403.
//
// Los bugs que fija son de RUNTIME, ni el build ni el typecheck los ven:
//   1. `eliminar()` sacando la fila del array local con el toggle prendido.
//   2. La carrera de `cargar()` bajo toggles rápidos.
//   3. Doble submit al restaurar (404 encima de un éxito).
//   4. El 400 de colisión tratado como error terminal en vez de pregunta.
//   5. El gating de la papelera por `Cajas:Eliminar`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Cajas from './cajas.vue'

const CAJON_ID = 'cajon-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface CajonFake {
  id: string
  nombre: string
  activo: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function cajon(over: Partial<CajonFake> = {}): CajonFake {
  return {
    id: CAJON_ID,
    nombre: 'Caja Principal',
    activo: true,
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function eliminado(over: Partial<CajonFake> = {}): CajonFake {
  return cajon({
    eliminadoEl: BORRADO_EL,
    eliminadoPorNombre: 'admin.paris',
    ...over,
  })
}

/**
 * Error con la forma que le llega a la pantalla desde ofetch: `message` para
 * el toast y `data` con el cuerpo del backend, que es de donde
 * `nombreSugeridoDe` saca la sugerencia.
 */
function errorApi(message: string, extra: Record<string, unknown> = {}) {
  const e = new Error(message) as Error & { data?: unknown }
  e.data = { message, ...extra }
  return e
}

/** Stub del contrato del backend, no de su algoritmo: primer "<base> N" libre
 *  con N ≥ 2. La aritmética real vive testeada en `nombre-sugerido.util.spec.ts`. */
function sugerir(base: string, vivos: string[]): string {
  for (let n = 2; ; n++) {
    const candidato = `${base} ${n}`
    if (!vivos.includes(candidato)) return candidato
  }
}

// ⚠️ Nuxt instala su PROPIA instancia de Pinia, así que espiar un store creado
// con `setActivePinia` no sirve: hay que mockear el auto-import.
let esAdmin = true
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

// `cajas.vue` también consulta `useCajaStore` (arqueo ciego) y
// `/tenants/members/para-selector` (drawer de usuarios) — ninguno relevante para la
// papelera. Se stubean con lo mínimo para que `onMounted` no reviente.
mockNuxtImport('useCajaStore', () => {
  return () => ({
    cargarArqueoCiego: () => Promise.resolve(false),
    guardarArqueoCiego: () => Promise.resolve(),
  })
})

let cajonesBackend: CajonFake[] = []
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null
let postsRestaurar: { id: string, nombre?: string }[] = []
let restaurarRetenido: Promise<unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: { nombre?: string } }) => {
    if (typeof url !== 'string' || !url.includes('/cajones')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const c = cajonesBackend.find(x => x.id === id)
      if (c) {
        c.eliminadoEl = BORRADO_EL
        c.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      const nombreNuevo = opts?.body?.nombre
      postsRestaurar.push({ id, nombre: nombreNuevo })
      const c = cajonesBackend.find(x => x.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo.
      if (!c?.eliminadoEl) {
        return Promise.reject(errorApi(`Cajón ${id} no está en la papelera`))
      }
      const nombre = nombreNuevo ?? c.nombre
      const vivos = cajonesBackend
        .filter(x => !x.eliminadoEl && x.id !== id)
        .map(x => x.nombre)
      if (vivos.includes(nombre)) {
        return Promise.reject(
          errorApi(
            `Ya existe un cajón con el nombre "${nombre}"`,
            { nombreSugerido: sugerir(nombre.replace(/ \d+$/, ''), vivos) },
          ),
        )
      }
      c.eliminadoEl = null
      c.eliminadoPorNombre = null
      c.nombre = nombre
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? cajonesBackend
      : cajonesBackend.filter(c => !c.eliminadoEl)
    return Promise.resolve(data.map(c => ({ ...c })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Cajas)
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

/**
 * El modal lo teletransporta `UModal` fuera del wrapper. La búsqueda se acota a
 * `[role="dialog"]` y NO al `body` entero: el botón de la fila y el del modal
 * comparten el texto "Restaurar", así que buscar en todo el body encontraría el
 * de la fila y el test "confirmaría" sin haber abierto nada.
 */
async function confirmarEnModal(texto: string) {
  const d = dialogo()
  expect(d, `modal abierto para confirmar "${texto}"`).toBeTruthy()
  const boton = [...d!.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === texto)
  expect(boton, `botón "${texto}" dentro del modal`).toBeTruthy()
  boton!.click()
  await new Promise(r => setTimeout(r, 50))
}

/**
 * Los textos de los `UBadge` de la tabla, como elementos y no como subcadena
 * del texto de la página. Es lo único que distingue el badge "Eliminado" del
 * párrafo "Eliminado por <autor> el <fecha>" que va debajo.
 */
function badges(wrapper: Awaited<ReturnType<typeof montar>>): string[] {
  return wrapper.findAll('tbody span')
    .map(s => s.text().trim())
    .filter(t => t === 'Eliminado')
}

/** El botón "Restaurar" de la fila (el que abre el modal), no el del modal. */
async function abrirRestaurarDeLaFila(
  wrapper: Awaited<ReturnType<typeof montar>>,
) {
  const boton = wrapper.findAll('button')
    .find(b => b.text().trim() === 'Restaurar')
  expect(boton, 'botón "Restaurar" en la fila').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 0))
}

/** El campo editable del modal de colisión, con el valor que trae precargado. */
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
  esAdmin = true
  permisos = []
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurar = []
  restaurarRetenido = null
}

describe('configuracion/cajas — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    cajonesBackend = [cajon()]
    reset()
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Caja Principal')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(cajonesBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Caja Principal')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Caja Principal')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Caja Principal')

    wrapper.unmount()
  })

  it('el switch de activo está deshabilitado en una fila eliminada', async () => {
    cajonesBackend = [eliminado()]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    const sw = wrapper.findAll('tbody button[role="switch"]')
    expect(sw).toHaveLength(1)
    expect(sw[0]!.attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })
})

// Lo propio de esta pantalla dentro de la familia con permisos: el backend
// pide `Cajas:Eliminar` tanto para eliminar como para restaurar, así que la
// papelera entera va detrás del mismo permiso.
describe('configuracion/cajas — papelera: gateada por `Cajas:Eliminar`', () => {
  beforeEach(() => {
    cajonesBackend = [eliminado()]
    reset()
  })

  it('sin `Cajas:Eliminar` no hay toggle "Ver eliminados"', async () => {
    esAdmin = false
    permisos = ['Cajas:Leer', 'Cajas:Crear', 'Cajas:Actualizar']

    const wrapper = await montar()

    // Ancla positiva: la pantalla SÍ cargó y muestra sus otros controles, así
    // que la ausencia del toggle es un gate y no una pantalla vacía.
    expect(wrapper.text()).toContain('Cajas')
    expect(wrapper.findAll('button').some(b => b.text().includes('Nueva caja'))).toBe(true)
    expect(wrapper.find('[aria-label="Ver eliminados"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('con `Cajas:Eliminar` sí aparece el toggle, y la fila eliminada ofrece Restaurar', async () => {
    esAdmin = false
    permisos = ['Cajas:Leer', 'Cajas:Eliminar']

    const wrapper = await montar()
    expect(wrapper.find('[aria-label="Ver eliminados"]').exists()).toBe(true)
    await activarVerEliminados(wrapper)

    expect(badges(wrapper)).toContain('Eliminado')
    expect(
      wrapper.findAll('button').filter(b => b.text().trim() === 'Restaurar'),
    ).toHaveLength(1)

    wrapper.unmount()
  })
})

describe('configuracion/cajas — papelera: restaurar', () => {
  beforeEach(() => {
    cajonesBackend = [eliminado()]
    reset()
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(cajonesBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Caja Principal')
    expect(wrapper.text()).not.toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })

  it('dos clicks en Restaurar mandan UN solo POST (no un 404 encima del éxito)', async () => {
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
    // Segundo click con el primer POST todavía en vuelo.
    boton.click()
    await new Promise(r => setTimeout(r, 10))

    soltarRestaurar()
    await new Promise(r => setTimeout(r, 60))

    expect(postsRestaurar).toEqual([{ id: CAJON_ID, nombre: undefined }])

    wrapper.unmount()
    restaurarRetenido = null
  })

  // La contracara del modal de colisión: un error que NO trae `nombreSugerido`
  // sigue siendo terminal.
  it('un error SIN sugerencia no abre el modal de colisión: cierra y avisa', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    cajonesBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(1)
    expect(document.body.textContent).not.toContain('No se puede restaurar con ese nombre')

    wrapper.unmount()
  })
})

describe('configuracion/cajas — papelera: colisión de nombre al restaurar', () => {
  beforeEach(() => {
    cajonesBackend = [
      eliminado(),
      cajon({ id: 'cajon-vivo', nombre: 'Caja Principal' }),
    ]
    reset()
  })

  it('el 400 abre el modal con la sugerencia precargada y confirmar restaura CON ese nombre', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // El primer POST viajó sin nombre y volvió 400: no restauró nada.
    expect(postsRestaurar).toEqual([{ id: CAJON_ID, nombre: undefined }])
    expect(cajonesBackend[0]!.eliminadoEl).toBe(BORRADO_EL)

    // Y en vez de un toast rojo, el modal con el nombre libre precargado.
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(document.body.textContent).toContain(
      'Ya existe un cajón con el nombre "Caja Principal"',
    )
    expect(campoNombre().value).toBe('Caja Principal 2')

    await confirmarEnModal('Restaurar')

    // El segundo POST sí llevó el nombre, y la fila revivió renombrada.
    expect(postsRestaurar).toHaveLength(2)
    expect(postsRestaurar[1]).toEqual({ id: CAJON_ID, nombre: 'Caja Principal 2' })
    expect(cajonesBackend[0]!.eliminadoEl).toBeNull()
    expect(cajonesBackend[0]!.nombre).toBe('Caja Principal 2')
    // Los dos conviven vivos en la tabla, que es el punto de toda la salida.
    expect(wrapper.text()).toContain('Caja Principal 2')
    expect(badges(wrapper)).toHaveLength(0)

    wrapper.unmount()
  })

  it('si el usuario edita a un nombre TAMBIÉN tomado, vuelve el modal con la sugerencia siguiente', async () => {
    cajonesBackend.push(
      cajon({ id: 'cajon-vivo-2', nombre: 'Caja Principal 2' }),
    )
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // Con "Caja Principal" y "Caja Principal 2" vivos, la primera sugerencia salta al 3;
    // el usuario lo pisa a mano con uno que está ocupado.
    expect(campoNombre().value).toBe('Caja Principal 3')
    await escribirNombre('Caja Principal 2')
    await confirmarEnModal('Restaurar')

    // No restauró, no cerró el modal, y la sugerencia se actualizó.
    expect(cajonesBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(campoNombre().value).toBe('Caja Principal 3')

    wrapper.unmount()
  })

  it('con el campo vacío el botón de confirmar está deshabilitado (no manda un POST sin nombre)', async () => {
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
    // Sigue en uno: el del intento original que dio 400.
    expect(postsRestaurar).toHaveLength(1)

    wrapper.unmount()
  })

  it('cancelar el modal de colisión deja la fila en la papelera, sin restaurar nada', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    await confirmarEnModal('Cancelar')

    expect(cajonesBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(postsRestaurar).toHaveLength(1)
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })
})

describe('configuracion/cajas — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Uno vivo y otro ya eliminado: así el `GET` con el flag trae algo (Cajón
    // viejo) que el `GET` sin el flag no trae, y las dos respuestas son
    // distinguibles en el DOM.
    cajonesBackend = [
      cajon(),
      eliminado({ id: 'cajon-2', nombre: 'Cajón viejo' }),
    ]
    reset()
  })

  it('si la respuesta del primer toggle llega DESPUÉS que la del segundo, el listado final igual corresponde al último toggle', async () => {
    const wrapper = await montar()

    // 1) Prender "Ver eliminados": dispara `cargar()` con el flag, con la
    //    respuesta retenida en una promesa controlada.
    let resolverConEliminados: (v: unknown[]) => void = () => {}
    overrideConEliminados = new Promise((resolve) => { resolverConEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 2) Apagarlo MIENTRAS la anterior sigue pendiente.
    let resolverSinEliminados: (v: unknown[]) => void = () => {}
    overrideSinEliminados = new Promise((resolve) => { resolverSinEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 3) Resolver en el orden INVERSO al que se dispararon.
    resolverSinEliminados(
      cajonesBackend.filter(c => !c.eliminadoEl).map(c => ({ ...c })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(cajonesBackend.map(c => ({ ...c })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Caja Principal')
    expect(wrapper.text()).not.toContain('Cajón viejo')

    wrapper.unmount()
  })
})
