// @vitest-environment nuxt
//
// La pantalla más complicada de la serie de papelera
// (`docs/features/papelera.md`): mesas ANIDADAS bajo salón y DOS endpoints de
// restaurar distintos (`POST /salones/:id/restaurar` en `SalonesController`,
// `POST /mesas/:id/restaurar` en `MesasController` — clases separadas del
// mismo archivo backend). Ninguno de los dos tiene unicidad de nombre, así
// que a diferencia de `turnos`/`descuentos` acá NO hay modal de colisión: un
// error al restaurar es siempre terminal (toast).
//
// A diferencia de `terceros`/`turnos` (tablas), esta pantalla es un selector
// de salón + plano de mesas: no hay filas de tabla, así que los helpers de
// los moldes se adaptan (título/botón en vez de fila).
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { markRaw } from 'vue'
import Salones from './salones.vue'
import SalonPlano from '~/components/salones/SalonPlano.vue'

/**
 * Esta es la primera pantalla de la serie que CIERRA un `AppDrawer` dentro de
 * un test (el drawer de mesa: `eliminarMesaDesdeDrawer()` lo cierra para abrir
 * el modal de confirmar borrado). Cerrarlo dispara la transición de salida de
 * `vaul`/`reka-ui` `Presence`, que guarda el objeto EN VIVO de
 * `getComputedStyle()` dentro de un `ref` de Vue. Ese objeto ya es un Proxy
 * interno de happy-dom (así implementa cientos de propiedades CSS) y `ref()`
 * lo envuelve en OTRO Proxy reactivo: el doble proxy rompe los traps de
 * happy-dom en cuanto algo lee o escribe una propiedad («Receiver must be an
 * instance of class CSSStyleDeclaration» / «Cannot read private member
 * #computed»). No es un bug de esta feature — es una incompatibilidad
 * conocida happy-dom + reactividad de Vue + `vaul` — así que se neutraliza
 * acá, LOCAL a este archivo, marcando el resultado con `markRaw` (Vue no lo
 * envuelve, así que happy-dom solo ve SU proxy, no dos) en vez de tocar
 * infraestructura compartida (`test.setup.ts`) que usan otras pantallas.
 */
let getComputedStyleOriginal: typeof window.getComputedStyle
beforeAll(() => {
  getComputedStyleOriginal = window.getComputedStyle
  window.getComputedStyle = ((el: Element, pseudo?: string | null) =>
    markRaw(getComputedStyleOriginal.call(window, el, pseudo) as object)) as typeof window.getComputedStyle
})
afterAll(() => {
  window.getComputedStyle = getComputedStyleOriginal
})

const SALON_ID = 'salon-1'
const MESA_ID = 'mesa-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface MesaFake {
  id: string
  nombre: string
  posX: string
  posY: string
  forma: string
  tamano: string
  cuentasAbiertas: number
  ocupada: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

interface SalonFake {
  id: string
  nombre: string
  mesas: MesaFake[]
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function mesa(over: Partial<MesaFake> = {}): MesaFake {
  return {
    id: MESA_ID,
    nombre: 'Mesa 1',
    posX: '0.5',
    posY: '0.5',
    forma: 'cuadrada',
    tamano: 'mediano',
    cuentasAbiertas: 0,
    ocupada: false,
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function mesaEliminada(over: Partial<MesaFake> = {}): MesaFake {
  return mesa({
    eliminadoEl: BORRADO_EL,
    eliminadoPorNombre: 'admin.paris',
    ...over,
  })
}

function salon(over: Partial<SalonFake> = {}): SalonFake {
  return {
    id: SALON_ID,
    nombre: 'Salón Principal',
    mesas: [],
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function salonEliminado(over: Partial<SalonFake> = {}): SalonFake {
  return salon({
    eliminadoEl: BORRADO_EL,
    eliminadoPorNombre: 'admin.paris',
    ...over,
  })
}

/**
 * Error con la forma que le llega a la pantalla desde ofetch: `message` para
 * el toast. Ni `salones` ni `mesas` tienen `nombreSugerido` porque no hay
 * colisión posible (sin unicidad de nombre, sin body en el restaurar).
 */
function errorApi(message: string) {
  const e = new Error(message) as Error & { data?: unknown }
  e.data = { message }
  return e
}

// ⚠️ Nuxt instala su PROPIA instancia de Pinia, así que espiar un store creado
// con `setActivePinia` no sirve: hay que mockear el auto-import.
let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

/** Cada toast que la pantalla pidió: el aviso de la mesa sacada del plano. */
let toasts: { title?: string, color?: string }[] = []
mockNuxtImport('useToast', () => {
  return () => ({ add: (t: { title?: string, color?: string }) => { toasts.push(t) } })
})

let salonesBackend: SalonFake[] = []
/** Cada body del `PATCH /salones/:id/layout`, en el orden en que salió. */
let patchesLayout: { mesas: { mesaId: string, posX: number, posY: number }[] }[] = []
/**
 * Con `retenerLayout`, cada `PATCH` del plano queda en vuelo hasta que el test
 * lo resuelve a mano, con la respuesta y en el orden que quiera. Sin él, el
 * mock contesta lo que haría el backend: las mesas vivas que se mandaron.
 */
let retenerLayout = false
let layoutEnVuelo: ((escritas: unknown[]) => void)[] = []
// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// en una promesa que el test resuelve a mano, en el orden que quiera.
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null
/** Cada `POST` de restaurar recibido, separado por recurso: la prueba de que
 * el botón de una mesa no le pega por error al endpoint de salones (y
 * viceversa). */
let postsRestaurarSalon: string[] = []
let postsRestaurarMesa: string[] = []
/** Retiene la respuesta del restaurar en vuelo para el doble submit. */
let restaurarSalonRetenido: Promise<unknown> | null = null
let restaurarMesaRetenido: Promise<unknown> | null = null
/** Retiene la respuesta de los `DELETE` (mesa y salón): el servidor ya borró y
 * la pantalla todavía no se enteró. */
let deleteRetenido: Promise<unknown> | null = null

function respuestaGet(incluirEliminados: boolean) {
  return salonesBackend
    .filter(s => incluirEliminados || !s.eliminadoEl)
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      mesas: s.mesas
        .filter(m => incluirEliminados || !m.eliminadoEl)
        .map(m => incluirEliminados
          ? { ...m }
          : {
              id: m.id,
              nombre: m.nombre,
              posX: m.posX,
              posY: m.posY,
              forma: m.forma,
              tamano: m.tamano,
              cuentasAbiertas: m.cuentasAbiertas,
              ocupada: m.ocupada,
            }),
      ...(incluirEliminados
        ? { eliminadoEl: s.eliminadoEl, eliminadoPorNombre: s.eliminadoPorNombre }
        : {}),
    }))
}

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: unknown }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    const method = opts?.method ?? 'GET'

    // POST /salones/:id/restaurar — endpoint de SALONES, cascada acotada al
    // `eliminadoEl` exacto que dejó ese borrado.
    if (method === 'POST' && url.includes('/salones/') && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      postsRestaurarSalon.push(id)
      const s = salonesBackend.find(x => x.id === id)
      if (!s?.eliminadoEl) {
        return Promise.reject(errorApi(`Salón ${id} no está en la papelera`))
      }
      const timestampCascada = s.eliminadoEl
      s.eliminadoEl = null
      s.eliminadoPorNombre = null
      for (const m of s.mesas) {
        if (m.eliminadoEl === timestampCascada) {
          m.eliminadoEl = null
          m.eliminadoPorNombre = null
        }
      }
      if (restaurarSalonRetenido) return restaurarSalonRetenido
      return Promise.resolve({ id: s.id, nombre: s.nombre })
    }

    // POST /mesas/:id/restaurar — endpoint DISTINTO, sin cascada.
    if (method === 'POST' && url.includes('/mesas/') && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      postsRestaurarMesa.push(id)
      const m = salonesBackend.flatMap(s => s.mesas).find(x => x.id === id)
      if (!m?.eliminadoEl) {
        return Promise.reject(errorApi(`Mesa ${id} no está en la papelera`))
      }
      m.eliminadoEl = null
      m.eliminadoPorNombre = null
      if (restaurarMesaRetenido) return restaurarMesaRetenido
      return Promise.resolve({
        id: m.id,
        nombre: m.nombre,
        posX: m.posX,
        posY: m.posY,
        forma: m.forma,
        tamano: m.tamano,
      })
    }

    if (method === 'DELETE' && url.includes('/salones/')) {
      const id = url.split('/').pop()
      const s = salonesBackend.find(x => x.id === id)
      if (s) {
        s.eliminadoEl = BORRADO_EL
        s.eliminadoPorNombre = 'admin.paris'
        // `eliminarSalon()` se lleva las mesas VIVAS del salón con el MISMO
        // timestamp (docs/features/papelera.md → "Colateral acotado").
        for (const m of s.mesas) {
          if (!m.eliminadoEl) {
            m.eliminadoEl = BORRADO_EL
            m.eliminadoPorNombre = 'admin.paris'
          }
        }
      }
      if (deleteRetenido) return deleteRetenido
      return Promise.resolve(undefined)
    }

    if (method === 'DELETE' && url.includes('/mesas/')) {
      const id = url.split('/').pop()
      const m = salonesBackend.flatMap(s => s.mesas).find(x => x.id === id)
      if (m) {
        m.eliminadoEl = BORRADO_EL
        m.eliminadoPorNombre = 'admin.paris'
      }
      if (deleteRetenido) return deleteRetenido
      return Promise.resolve(undefined)
    }

    if (method === 'PATCH' && url.endsWith('/layout')) {
      const body = opts?.body as (typeof patchesLayout)[number]
      patchesLayout.push(body)
      if (retenerLayout) {
        return new Promise((resolve) => { layoutEnVuelo.push(resolve) })
      }
      const vivas = new Set(salonesBackend.flatMap(x => x.mesas).filter(m => !m.eliminadoEl).map(m => m.id))
      return Promise.resolve(body.mesas
        .filter(m => vivas.has(m.mesaId))
        .map(m => ({ id: m.mesaId, posX: m.posX.toFixed(5), posY: m.posY.toFixed(5) })))
    }

    if (method === 'GET' && url.includes('/salones')) {
      const incluirEliminados = url.includes('incluirEliminados=true')
      if (incluirEliminados && overrideConEliminados) return overrideConEliminados
      if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
      return Promise.resolve(respuestaGet(incluirEliminados))
    }

    return Promise.resolve(undefined)
  }
})

async function montar() {
  const wrapper = await mountSuspended(Salones)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function tieneBoton(wrapper: Awaited<ReturnType<typeof montar>>, texto: string) {
  return wrapper.findAll('button').some(b => b.text().includes(texto))
}

function cuentaPorTitulo(
  wrapper: Awaited<ReturnType<typeof montar>>,
  title: string,
) {
  return wrapper.findAll(`[title="${title}"]`).length
}

async function activarVerEliminados(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

/**
 * `[role="dialog"]` MÁS RECIENTE, no el primero. `AppDrawer` usa `vaul`
 * (`reka-ui` `Presence`) para su transición de salida, que happy-dom no sabe
 * completar: al cerrar el drawer de mesa para abrir el modal de confirmar
 * borrado, el drawer se queda "colgado" en el DOM (con su propio
 * `role="dialog"` y su propio botón "Eliminar") mientras el modal nuevo se
 * teletransporta AL FINAL de `document.body`. Tomar el primero encontraría el
 * drawer fantasma, no el modal que se acaba de abrir.
 */
function dialogo(): HTMLElement | null {
  const nodos = document.body.querySelectorAll('[role="dialog"]')
  return nodos.length ? (nodos[nodos.length - 1] as HTMLElement) : null
}

/**
 * El modal lo teletransporta `UModal` fuera del wrapper. La búsqueda se acota a
 * `[role="dialog"]` y NO al `body` entero: el botón de la fila y el del modal
 * comparten el texto "Restaurar"/"Eliminar", así que buscar en todo el body
 * encontraría el de la fila y el test "confirmaría" sin haber abierto nada.
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
 * Los textos de los `UBadge` como elementos y no como subcadena del texto de
 * la página: un `toContain('Eliminado')` sobre el texto de la página queda
 * SUBSUMIDO por "Eliminado por <autor> el <fecha>", así que borrar el badge
 * entero no lo pondría rojo.
 */
function badges(wrapper: Awaited<ReturnType<typeof montar>>): string[] {
  return wrapper.findAll('span')
    .map(s => s.text().trim())
    .filter(t => t === 'Eliminado')
}

/** El botón "Restaurar" de la fila/lista (el que abre el modal), no el del modal. */
async function abrirRestaurarDeLaFila(
  wrapper: Awaited<ReturnType<typeof montar>>,
) {
  const boton = wrapper.findAll('button')
    .find(b => b.text().trim() === 'Restaurar')
  expect(boton, 'botón "Restaurar" en la fila').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 0))
}

/** Abre el drawer de una mesa desde el plano (doble-click), único camino a su
 * botón "Eliminar". */
async function abrirEditarMesaDesdePlano(
  wrapper: Awaited<ReturnType<typeof montar>>,
  mesaId: string,
) {
  const nodo = wrapper.find(`[data-qa="mesa-${mesaId}"]`)
  expect(nodo.exists(), 'nodo de la mesa en el plano').toBe(true)
  await nodo.trigger('dblclick')
  await new Promise(r => setTimeout(r, 20))
}

/**
 * `AppDrawer` teletransporta su contenido fuera del wrapper igual que
 * `UModal` (los dos usan `role="dialog"`), así que buscar con
 * `wrapper.findAll('button')` NUNCA encuentra el botón "Eliminar" del drawer
 * de mesa: hay que ir por `document.body`, mismo query que `dialogo()`.
 */
function botonEnDialogo(texto: string): HTMLButtonElement | undefined {
  const d = dialogo()
  expect(d, `diálogo abierto para encontrar el botón "${texto}"`).toBeTruthy()
  return [...d!.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
}

function reset() {
  esAdmin = false
  permisos = []
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurarSalon = []
  postsRestaurarMesa = []
  restaurarSalonRetenido = null
  restaurarMesaRetenido = null
  deleteRetenido = null
  toasts = []
  patchesLayout = []
  retenerLayout = false
  layoutEnVuelo = []
}

describe('salones — cada control con el permiso de SU endpoint', () => {
  beforeEach(() => {
    salonesBackend = [salon()]
    reset()
  })

  it('solo lectura: ni crear, ni editar, ni eliminar', async () => {
    esAdmin = false
    permisos = ['Salones:Leer']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo salón')).toBe(false)
    expect(tieneBoton(wrapper, 'Agregar mesa')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar salón')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar salón')).toBe(0)
    expect(wrapper.find('[aria-label="Ver eliminados"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Salón Principal')

    wrapper.unmount()
  })

  it('solo `Crear`: aparece el alta y NADA más', async () => {
    esAdmin = false
    permisos = ['Salones:Leer', 'Salones:Crear']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo salón')).toBe(true)
    expect(tieneBoton(wrapper, 'Agregar mesa')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar salón')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar salón')).toBe(0)

    wrapper.unmount()
  })

  it('solo `Actualizar`: aparece editar SIN aparecer crear ni eliminar', async () => {
    esAdmin = false
    permisos = ['Salones:Leer', 'Salones:Actualizar']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo salón')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar salón')).toBeGreaterThan(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar salón')).toBe(0)

    wrapper.unmount()
  })

  it('solo `Eliminar`: aparece la papelera y nada más', async () => {
    esAdmin = false
    permisos = ['Salones:Leer', 'Salones:Eliminar']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo salón')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar salón')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar salón')).toBeGreaterThan(0)
    expect(wrapper.find('[aria-label="Ver eliminados"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('el admin del tenant ve los controles sin permisos listados', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo salón')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar salón')).toBeGreaterThan(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar salón')).toBeGreaterThan(0)
    expect(wrapper.find('[aria-label="Ver eliminados"]').exists()).toBe(true)

    wrapper.unmount()
  })
})

describe('salones — papelera: eliminar salón respeta el toggle', () => {
  beforeEach(() => {
    salonesBackend = [salon()]
    reset()
    esAdmin = true
  })

  it('con "Ver eliminados" activo, borrar el salón lo deja visible como eliminado', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Salón Principal')

    await wrapper.find('[title="Eliminar salón"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminarSalon()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(salonesBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Salón Principal')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar el salón SÍ lo saca del listado', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Salón Principal')

    await wrapper.find('[title="Eliminar salón"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Salón Principal')
    expect(wrapper.text()).toContain('No hay salones')

    wrapper.unmount()
  })
})

describe('salones — papelera: eliminar mesa respeta el toggle', () => {
  beforeEach(() => {
    salonesBackend = [salon({ mesas: [mesa()] })]
    reset()
    esAdmin = true
  })

  it('con "Ver eliminados" activo, borrar la mesa la deja visible como eliminada (fuera del plano)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    await abrirEditarMesaDesdePlano(wrapper, MESA_ID)
    const eliminarEnDrawer = botonEnDialogo('Eliminar')
    expect(eliminarEnDrawer, 'botón "Eliminar" del drawer de mesa').toBeTruthy()
    eliminarEnDrawer!.click()
    await new Promise(r => setTimeout(r, 20))
    await confirmarEnModal('Eliminar')

    expect(salonesBackend[0]!.mesas[0]!.eliminadoEl).toBeTruthy()
    // La mesa eliminada sale del plano (decisión: el plano es para operar) y
    // aparece en la lista de "Mesas eliminadas" con su autor.
    expect(wrapper.find(`[data-qa="mesa-${MESA_ID}"]`).exists()).toBe(false)
    expect(wrapper.text()).toContain('Mesas eliminadas')
    expect(wrapper.text()).toContain('Mesa 1')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar la mesa SÍ la saca del plano (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.find(`[data-qa="mesa-${MESA_ID}"]`).exists()).toBe(true)

    await abrirEditarMesaDesdePlano(wrapper, MESA_ID)
    const eliminarEnDrawer = botonEnDialogo('Eliminar')
    eliminarEnDrawer!.click()
    await new Promise(r => setTimeout(r, 20))
    await confirmarEnModal('Eliminar')

    expect(wrapper.find(`[data-qa="mesa-${MESA_ID}"]`).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Mesas eliminadas')

    wrapper.unmount()
  })
})

describe('salones — papelera: restaurar salón (endpoint de SALONES)', () => {
  beforeEach(() => {
    salonesBackend = [salonEliminado()]
    reset()
    esAdmin = true
  })

  it('restaurar el salón lo devuelve al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurarSalon).toEqual([SALON_ID])
    expect(postsRestaurarMesa).toHaveLength(0)
    expect(salonesBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Salón Principal')
    expect(wrapper.text()).not.toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })

  // El modal NO se cierra al confirmar (lo cierran las funciones de la
  // página), así que mientras el POST viaja el botón sigue clickeable. Sin el
  // guard de reentrancia el segundo click manda un segundo POST sobre una
  // fila que el primero ya revivió, el backend contesta 404 y el usuario ve
  // un toast de ERROR justo después de un restore exitoso.
  it('dos clicks en Restaurar salón mandan UN solo POST (no un 404 encima del éxito)', async () => {
    let soltar: () => void = () => {}
    restaurarSalonRetenido = new Promise<void>((resolve) => {
      soltar = resolve
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

    soltar()
    await new Promise(r => setTimeout(r, 60))

    expect(postsRestaurarSalon).toEqual([SALON_ID])

    wrapper.unmount()
    restaurarSalonRetenido = null
  })

  it('un error al restaurar cierra el modal y avisa (sin pantalla de colisión que abrir)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    // Fila viva en el backend pero eliminada en la vista: el POST encuentra la
    // fila ya restaurada y contesta 404, igual que el backend real.
    salonesBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurarSalon).toHaveLength(1)
    expect(dialogo()).toBeNull()

    wrapper.unmount()
  })
})

describe('salones — papelera: restaurar mesa (endpoint de MESAS, distinto del de salones)', () => {
  beforeEach(() => {
    // Salón VIVO con una mesa eliminada: aísla el botón de "Restaurar" de la
    // lista de mesas del de "Restaurar salón" (que no aparece, porque el
    // salón está vivo).
    salonesBackend = [salon({ mesas: [mesaEliminada()] })]
    reset()
    esAdmin = true
  })

  it('restaurar la mesa le pega al endpoint de MESAS, no al de salones, y la devuelve al plano', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Mesas eliminadas')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // La prueba central de esta pantalla: el botón de la mesa pega a
    // `/mesas/:id/restaurar`, nunca a `/salones/:id/restaurar`.
    expect(postsRestaurarMesa).toEqual([MESA_ID])
    expect(postsRestaurarSalon).toHaveLength(0)
    expect(salonesBackend[0]!.mesas[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).not.toContain('Mesas eliminadas')
    expect(wrapper.find(`[data-qa="mesa-${MESA_ID}"]`).exists()).toBe(true)

    wrapper.unmount()
  })

  it('dos clicks en Restaurar mesa mandan UN solo POST', async () => {
    let soltar: () => void = () => {}
    restaurarMesaRetenido = new Promise<void>((resolve) => {
      soltar = resolve
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

    soltar()
    await new Promise(r => setTimeout(r, 60))

    expect(postsRestaurarMesa).toEqual([MESA_ID])

    wrapper.unmount()
    restaurarMesaRetenido = null
  })

  it('un error al restaurar la mesa cierra el modal y avisa', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    salonesBackend[0]!.mesas[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurarMesa).toHaveLength(1)
    expect(dialogo()).toBeNull()

    wrapper.unmount()
  })
})

describe('salones — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Un salón VIVO con una mesa viva y una eliminada: el `GET` con el flag
    // trae la mesa vieja (visible solo en "Mesas eliminadas"), el `GET` sin
    // el flag no. Con un único salón no hace falta abrir el `USelectMenu`
    // (que teletransporta sus opciones fuera del DOM cuando está cerrado).
    salonesBackend = [
      salon({
        mesas: [
          mesa({ id: 'mesa-viva', nombre: 'Mesa viva' }),
          mesaEliminada({ id: 'mesa-vieja', nombre: 'Mesa vieja' }),
        ],
      }),
    ]
    reset()
    esAdmin = true
  })

  it('si la respuesta del primer toggle llega DESPUÉS que la del segundo, el listado final igual corresponde al último toggle', async () => {
    const wrapper = await montar()

    // 1) Prender "Ver eliminados": dispara `cargar()` con el flag. Se retiene
    //    su respuesta con una promesa controlada — no resuelve todavía.
    let resolverConEliminados: (v: unknown[]) => void = () => {}
    overrideConEliminados = new Promise((resolve) => { resolverConEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 2) Apagarlo MIENTRAS la respuesta anterior sigue pendiente: dispara un
    //    segundo `cargar()`, también retenido, para controlar a mano en qué
    //    orden "llegan" las dos.
    let resolverSinEliminados: (v: unknown[]) => void = () => {}
    overrideSinEliminados = new Promise((resolve) => { resolverSinEliminados = resolve })
    await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // 3) Resolver en el orden INVERSO al que se dispararon: la del segundo
    //    toggle responde primero, la del primero después — el caso que la
    //    cola serial tiene que blindar.
    resolverSinEliminados(respuestaGet(false))
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(respuestaGet(true))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).not.toContain('Mesas eliminadas')
    expect(wrapper.text()).not.toContain('Mesa vieja')
    expect(wrapper.find('[data-qa="mesa-mesa-viva"]').exists()).toBe(true)

    wrapper.unmount()
  })
})

describe('salones — plano: la mesa que otra sesión borró', () => {
  beforeEach(() => {
    salonesBackend = [
      salon({
        mesas: [
          mesa({ id: 'mesa-a', nombre: 'Mesa A', posX: '0.2', posY: '0.2' }),
          mesa({ id: 'mesa-b', nombre: 'Mesa B', posX: '0.6', posY: '0.6' }),
        ],
      }),
    ]
    reset()
    esAdmin = true
  })

  /** Lo que hace el plano al arrastrar y soltar una mesa: `move` y `dragend`. */
  async function arrastrar(
    wrapper: Awaited<ReturnType<typeof montar>>,
    mesaId: string,
    posX: number,
    posY: number,
  ) {
    const plano = wrapper.findComponent(SalonPlano)
    expect(plano.exists(), 'plano montado').toBe(true)
    plano.vm.$emit('move', mesaId, posX, posY)
    plano.vm.$emit('dragend', mesaId)
    await new Promise(r => setTimeout(r, 10))
  }

  /** Otra sesión borra la mesa: esta pantalla no se entera (no hay polling). */
  function otraSesionBorra(mesaId: string) {
    const m = salonesBackend.flatMap(x => x.mesas).find(x => x.id === mesaId)!
    m.eliminadoEl = BORRADO_EL
    m.eliminadoPorNombre = 'otro.admin'
  }

  const enPlano = (wrapper: Awaited<ReturnType<typeof montar>>, id: string) =>
    wrapper.find(`[data-qa="mesa-${id}"]`).exists()

  it('la mesa que el guardado no devuelve sale del plano, con aviso, y el arrastre siguiente ya no la manda', async () => {
    const wrapper = await montar()
    otraSesionBorra('mesa-a')
    expect(enPlano(wrapper, 'mesa-a')).toBe(true)

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)

    expect(patchesLayout[0]!.mesas.map(m => m.mesaId)).toEqual(['mesa-a', 'mesa-b'])
    expect(enPlano(wrapper, 'mesa-a')).toBe(false)
    expect(enPlano(wrapper, 'mesa-b')).toBe(true)
    expect(toasts).toContainEqual(expect.objectContaining({
      title: 'Se sacó "Mesa A" del plano',
      color: 'warning',
    }))

    await arrastrar(wrapper, 'mesa-b', 0.4, 0.4)
    expect(patchesLayout[1]!.mesas.map(m => m.mesaId)).toEqual(['mesa-b'])

    wrapper.unmount()
  })

  it('si la respuesta de un guardado viejo llega después que la de uno nuevo, no revive la mesa sacada', async () => {
    const wrapper = await montar()
    retenerLayout = true

    // Guardado 1: sale con las dos, todavía vivas.
    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    // Otra sesión borra la A; guardado 2 sale mientras el 1 sigue en vuelo.
    otraSesionBorra('mesa-a')
    await arrastrar(wrapper, 'mesa-b', 0.4, 0.4)
    expect(layoutEnVuelo).toHaveLength(2)

    // Responde primero el 2 (ya sin la A)…
    layoutEnVuelo[1]!([{ id: 'mesa-b', posX: '0.40000', posY: '0.40000' }])
    await new Promise(r => setTimeout(r, 10))
    expect(enPlano(wrapper, 'mesa-a')).toBe(false)

    // …y después el 1, que la escribió cuando estaba viva.
    layoutEnVuelo[0]!([
      { id: 'mesa-a', posX: '0.20000', posY: '0.20000' },
      { id: 'mesa-b', posX: '0.50000', posY: '0.50000' },
    ])
    await new Promise(r => setTimeout(r, 10))
    expect(enPlano(wrapper, 'mesa-a')).toBe(false)
    expect(enPlano(wrapper, 'mesa-b')).toBe(true)

    wrapper.unmount()
  })

  it('la mesa que ESTA sesión borró con el guardado en vuelo sigue en "Mesas eliminadas", sin aviso de otra sesión', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    retenerLayout = true

    // El guardado sale con las dos vivas…
    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    // …y antes de que vuelva, esta misma pantalla borra la A.
    await abrirEditarMesaDesdePlano(wrapper, 'mesa-a')
    botonEnDialogo('Eliminar')!.click()
    await new Promise(r => setTimeout(r, 20))
    await confirmarEnModal('Eliminar')
    expect(wrapper.text()).toContain('Mesas eliminadas')
    expect(wrapper.text()).toContain('Mesa A')

    // El servidor no la escribió: ya estaba borrada.
    layoutEnVuelo[0]!([{ id: 'mesa-b', posX: '0.50000', posY: '0.50000' }])
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.text()).toContain('Mesas eliminadas')
    expect(wrapper.text()).toContain('Mesa A')
    expect(toasts.map(t => t.title)).not.toContain('Se sacó "Mesa A" del plano')

    wrapper.unmount()
  })

  it('la posición que devuelve el guardado no pisa la de un arrastre posterior', async () => {
    const wrapper = await montar()
    retenerLayout = true

    await arrastrar(wrapper, 'mesa-b', 0.3, 0.3)
    // La mesa se mueve otra vez antes de que vuelva el primer guardado.
    wrapper.findComponent(SalonPlano).vm.$emit('move', 'mesa-b', 0.7, 0.7)
    await new Promise(r => setTimeout(r, 10))

    layoutEnVuelo[0]!([
      { id: 'mesa-a', posX: '0.20000', posY: '0.20000' },
      { id: 'mesa-b', posX: '0.30000', posY: '0.30000' },
    ])
    await new Promise(r => setTimeout(r, 10))

    const estilo = wrapper.find('[data-qa="mesa-mesa-b"]').attributes('style') ?? ''
    expect(estilo).toContain('left: 70%')
    expect(estilo).toContain('top: 70%')

    wrapper.unmount()
  })

  /** Los avisos de mesas sacadas del plano, sean de una o de varias. */
  const avisosDeSacar = () => toasts.map(t => t.title ?? '').filter(t => t.startsWith('Se sac'))

  /** Borra la mesa desde su drawer y confirma (con «Ver eliminados» prendido recarga). */
  async function borrarMesa(wrapper: Awaited<ReturnType<typeof montar>>, mesaId: string) {
    await abrirEditarMesaDesdePlano(wrapper, mesaId)
    botonEnDialogo('Eliminar')!.click()
    await new Promise(r => setTimeout(r, 20))
    await confirmarEnModal('Eliminar')
  }

  it('la mesa que ESTA sesión borró y restauró con el guardado en vuelo sigue en el plano; la que borró otra sesión sale igual', async () => {
    salonesBackend[0]!.mesas.push(mesa({ id: 'mesa-c', nombre: 'Mesa C', posX: '0.8', posY: '0.8' }))
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    retenerLayout = true

    // El guardado sale con las tres vivas…
    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    // …y antes de que vuelva, esta pantalla borra la A y la restaura.
    await borrarMesa(wrapper, 'mesa-a')
    expect(enPlano(wrapper, 'mesa-a')).toBe(false)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')
    expect(postsRestaurarMesa).toEqual(['mesa-a'])
    expect(enPlano(wrapper, 'mesa-a'), 'A restaurada, antes de la respuesta').toBe(true)
    // Y otra sesión borra la C, que esta pantalla no tocó.
    otraSesionBorra('mesa-c')

    // El `UPDATE` corrió con la A borrada y la C también: vuelve solo la B.
    layoutEnVuelo[0]!([{ id: 'mesa-b', posX: '0.50000', posY: '0.50000' }])
    await new Promise(r => setTimeout(r, 10))

    expect(enPlano(wrapper, 'mesa-a'), 'A después de la respuesta').toBe(true)
    expect(toasts.map(t => t.title)).not.toContain('Se sacó "Mesa A" del plano')
    expect(enPlano(wrapper, 'mesa-c')).toBe(false)
    expect(toasts).toContainEqual(expect.objectContaining({
      title: 'Se sacó "Mesa C" del plano',
      color: 'warning',
    }))

    // El arrastre siguiente la sigue mandando.
    retenerLayout = false
    await arrastrar(wrapper, 'mesa-b', 0.4, 0.4)
    expect(patchesLayout[1]!.mesas.map(m => m.mesaId).sort()).toEqual(['mesa-a', 'mesa-b'])

    wrapper.unmount()
  })

  it('con dos guardados en vuelo, borrar y restaurar la mesa no la saca con ninguna de las dos respuestas', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    retenerLayout = true

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    await arrastrar(wrapper, 'mesa-b', 0.4, 0.4)
    expect(layoutEnVuelo).toHaveLength(2)
    await borrarMesa(wrapper, 'mesa-a')
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    layoutEnVuelo[1]!([{ id: 'mesa-b', posX: '0.40000', posY: '0.40000' }])
    await new Promise(r => setTimeout(r, 10))
    layoutEnVuelo[0]!([{ id: 'mesa-b', posX: '0.50000', posY: '0.50000' }])
    await new Promise(r => setTimeout(r, 10))

    expect(enPlano(wrapper, 'mesa-a'), 'A después de la respuesta').toBe(true)
    expect(avisosDeSacar()).toEqual([])

    wrapper.unmount()
  })

  it('la respuesta del guardado que llega mientras viaja el borrado de la mesa no la saca con un aviso de otra sesión', async () => {
    const wrapper = await montar()
    retenerLayout = true
    let soltarDelete: () => void = () => {}
    deleteRetenido = new Promise<void>((resolve) => { soltarDelete = resolve })

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    await borrarMesa(wrapper, 'mesa-a')
    // El servidor ya la borró; la pantalla la sigue teniendo viva.
    expect(enPlano(wrapper, 'mesa-a'), 'A mientras viaja el DELETE').toBe(true)

    layoutEnVuelo[0]!([{ id: 'mesa-b', posX: '0.50000', posY: '0.50000' }])
    await new Promise(r => setTimeout(r, 10))
    expect(avisosDeSacar()).toEqual([])

    soltarDelete()
    await new Promise(r => setTimeout(r, 20))
    expect(enPlano(wrapper, 'mesa-a'), 'A después del DELETE').toBe(false)
    expect(toasts.map(t => t.title)).toContain('Mesa eliminada')

    wrapper.unmount()
  })

  it('la respuesta del guardado que llega mientras viaja el borrado del salón no le saca las mesas con un aviso de otra sesión', async () => {
    const wrapper = await montar()
    retenerLayout = true
    let soltarDelete: () => void = () => {}
    deleteRetenido = new Promise<void>((resolve) => { soltarDelete = resolve })

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    await wrapper.find('[title="Eliminar salón"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')
    expect(enPlano(wrapper, 'mesa-a'), 'A mientras viaja el DELETE').toBe(true)

    layoutEnVuelo[0]!([])
    await new Promise(r => setTimeout(r, 10))
    expect(avisosDeSacar()).toEqual([])

    soltarDelete()
    await new Promise(r => setTimeout(r, 20))
    expect(toasts.map(t => t.title)).toContain('Salón eliminado')

    wrapper.unmount()
  })

  // Los tres que siguen no pasan por un borrado de esta pantalla: otra sesión
  // borra, y esta se entera por una recarga (prender «Ver eliminados») con el
  // guardado en vuelo. Separan la marca de restaurar y el filtro de vivas de
  // la marca del borrado, que en los casos de arriba los tapa.

  it('la mesa que otra sesión borró y esta pantalla restauró con el guardado en vuelo sigue en el plano', async () => {
    const wrapper = await montar()
    retenerLayout = true

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    otraSesionBorra('mesa-a')
    await activarVerEliminados(wrapper)
    expect(enPlano(wrapper, 'mesa-a'), 'A eliminada tras la recarga').toBe(false)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')
    expect(postsRestaurarMesa).toEqual(['mesa-a'])

    layoutEnVuelo[0]!([{ id: 'mesa-b', posX: '0.50000', posY: '0.50000' }])
    await new Promise(r => setTimeout(r, 10))

    expect(enPlano(wrapper, 'mesa-a'), 'A después de la respuesta').toBe(true)
    expect(avisosDeSacar()).toEqual([])

    wrapper.unmount()
  })

  it('el salón que otra sesión borró y esta pantalla restauró con el guardado en vuelo conserva sus mesas', async () => {
    const wrapper = await montar()
    retenerLayout = true

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    const s = salonesBackend[0]!
    s.eliminadoEl = BORRADO_EL
    s.eliminadoPorNombre = 'otro.admin'
    for (const m of s.mesas) {
      m.eliminadoEl = BORRADO_EL
      m.eliminadoPorNombre = 'otro.admin'
    }
    await activarVerEliminados(wrapper)
    await wrapper.find('[title="Restaurar salón"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Restaurar')
    expect(postsRestaurarSalon).toEqual([SALON_ID])

    layoutEnVuelo[0]!([])
    await new Promise(r => setTimeout(r, 10))

    expect(enPlano(wrapper, 'mesa-a'), 'A después de la respuesta').toBe(true)
    expect(enPlano(wrapper, 'mesa-b')).toBe(true)
    expect(avisosDeSacar()).toEqual([])

    wrapper.unmount()
  })

  it('la mesa que otra sesión borró y una recarga ya trajo como eliminada sigue en "Mesas eliminadas", sin aviso', async () => {
    const wrapper = await montar()
    retenerLayout = true

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    otraSesionBorra('mesa-a')
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Mesas eliminadas')

    layoutEnVuelo[0]!([{ id: 'mesa-b', posX: '0.50000', posY: '0.50000' }])
    await new Promise(r => setTimeout(r, 10))

    expect(wrapper.text()).toContain('Mesas eliminadas')
    expect(wrapper.text()).toContain('Mesa A')
    expect(avisosDeSacar()).toEqual([])

    wrapper.unmount()
  })

  it('borrar y restaurar el salón con el guardado en vuelo no le saca las mesas del plano', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    retenerLayout = true

    await arrastrar(wrapper, 'mesa-b', 0.5, 0.5)
    await wrapper.find('[title="Eliminar salón"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')
    expect(enPlano(wrapper, 'mesa-a')).toBe(false)
    await wrapper.find('[title="Restaurar salón"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Restaurar')
    expect(postsRestaurarSalon).toEqual([SALON_ID])
    expect(enPlano(wrapper, 'mesa-a'), 'A revivida con el salón, antes de la respuesta').toBe(true)

    // El `UPDATE` corrió con el salón borrado: no escribió ninguna.
    layoutEnVuelo[0]!([])
    await new Promise(r => setTimeout(r, 10))

    expect(enPlano(wrapper, 'mesa-a'), 'A después de la respuesta').toBe(true)
    expect(enPlano(wrapper, 'mesa-b')).toBe(true)
    expect(avisosDeSacar()).toEqual([])

    wrapper.unmount()
  })
})
