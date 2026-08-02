// @vitest-environment nuxt
//
// Papelera de `garzones`, molde `configuracion/descuentos.vue` vía la variante
// gateada por permisos de `configuracion/turnos.vue` (mismo módulo RBAC,
// `Salones`: garzones no tiene módulo propio). Caso más parecido, ya resuelto:
// `terceros.vue` — SIN modal de colisión.
//
// `garzones` SÍ puede devolver 400 al restaurar, pero su colisión NO es de
// nombre: `uq_garzones_mostrador_tenant` permite un solo placeholder
// "Mostrador" vivo por tenant, y renombrar no la resuelve. Por eso ese 400 se
// muestra como error simple (toast), igual que `terceros` — nunca como modal
// de renombrado. `docs/features/papelera.md` § "garzones tiene una
// restricción única parcial distinta".
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Garzones from './garzones.vue'

const GARZON_ID = 'garzon-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface GarzonFake {
  id: string
  nombre: string
  activo: boolean
  tipo: string
  creadoEl: string
  actualizadoEl: string
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function garzon(over: Partial<GarzonFake> = {}): GarzonFake {
  return {
    id: GARZON_ID,
    nombre: 'Ana Torres',
    activo: true,
    tipo: 'garzon',
    creadoEl: '2026-07-01T10:00:00.000Z',
    actualizadoEl: '2026-07-01T10:00:00.000Z',
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function eliminado(over: Partial<GarzonFake> = {}): GarzonFake {
  return garzon({
    eliminadoEl: BORRADO_EL,
    eliminadoPorNombre: 'admin.paris',
    ...over,
  })
}

/**
 * Error con la forma que le llega a la pantalla desde ofetch: `message` para
 * el toast. `garzones` no tiene `nombreSugerido` porque su colisión no es de
 * nombre (el Mostrador) y el `POST .../restaurar` ni acepta body.
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

let garzonesBackend: GarzonFake[] = []
// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// en una promesa que el test resuelve a mano, en el orden que quiera.
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null
/** Cada `POST .../restaurar` recibido: el contador del doble submit. */
let postsRestaurar: string[] = []
/** Retiene la respuesta del restaurar para dejar el POST "en vuelo". */
let restaurarRetenido: Promise<unknown> | null = null
/**
 * Fuerza el `POST .../restaurar` a rechazar con ESTE mensaje puntual, sin
 * tocar `garzonesBackend`. Existe solo para el caso propio de `garzones`: el
 * 400 real es la colisión del placeholder "Mostrador", no un nombre duplicado
 * — el mensaje del backend real, para que el test no lo invente.
 */
let restaurarErrorForzado: string | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string }) => {
    if (typeof url !== 'string' || !url.includes('/garzones')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const g = garzonesBackend.find(x => x.id === id)
      if (g) {
        g.eliminadoEl = BORRADO_EL
        g.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      postsRestaurar.push(id)
      if (restaurarErrorForzado) {
        return Promise.reject(errorApi(restaurarErrorForzado))
      }
      const g = garzonesBackend.find(x => x.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo, es el toast de error
      // que el guard de reentrancia existe para evitar.
      if (!g?.eliminadoEl) {
        return Promise.reject(errorApi(`Garzón ${id} no está en la papelera`))
      }
      g.eliminadoEl = null
      g.eliminadoPorNombre = null
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? garzonesBackend
      : garzonesBackend.filter(g => !g.eliminadoEl)
    return Promise.resolve(data.map(g => ({ ...g })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Garzones)
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
 * del texto de la página: un `toContain('Eliminado')` sobre el texto de la
 * página queda SUBSUMIDO por el párrafo "Eliminado por <autor> el <fecha>" que
 * va debajo, así que borrar el badge entero no lo pondría rojo.
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

function reset() {
  esAdmin = false
  permisos = []
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurar = []
  restaurarRetenido = null
  restaurarErrorForzado = null
}

describe('garzones — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    garzonesBackend = [garzon()]
    reset()
    esAdmin = true
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Ana Torres')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(garzonesBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Ana Torres')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Ana Torres')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Ana Torres')

    wrapper.unmount()
  })
})

// El toggle "ver eliminados" y el botón "Restaurar" van los dos detrás de
// `Salones:Eliminar`: sin ese permiso el backend rechaza el restaurar, así que
// ofrecer la papelera sería prometer una acción que termina en 403.
describe('garzones — papelera: gateada por `Salones:Eliminar`', () => {
  beforeEach(() => {
    garzonesBackend = [eliminado()]
    reset()
  })

  it('sin `Salones:Eliminar` no hay toggle "Ver eliminados"', async () => {
    esAdmin = false
    permisos = ['Salones:Leer', 'Salones:Crear', 'Salones:Actualizar']

    const wrapper = await montar()

    // Ancla positiva: la pantalla SÍ cargó y muestra sus otros controles, así
    // que la ausencia del toggle es un gate y no una pantalla vacía.
    expect(wrapper.text()).toContain('Garzones')
    expect(wrapper.findAll('button').some(b => b.text().includes('Nuevo garzón'))).toBe(true)
    expect(wrapper.find('[aria-label="Ver eliminados"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('con `Salones:Eliminar` sí aparece el toggle, y la fila eliminada ofrece Restaurar', async () => {
    esAdmin = false
    permisos = ['Salones:Leer', 'Salones:Eliminar']

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

describe('garzones — papelera: restaurar', () => {
  beforeEach(() => {
    garzonesBackend = [eliminado()]
    reset()
    esAdmin = true
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(garzonesBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Ana Torres')
    expect(wrapper.text()).not.toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })

  // El modal NO se cierra al confirmar (lo cierran las funciones de la
  // página), así que mientras el POST viaja el botón sigue clickeable. Sin el
  // guard de reentrancia el segundo click manda un segundo POST sobre una
  // fila que el primero ya revivió, el backend contesta 404 y el usuario ve
  // un toast de ERROR justo después de un restore exitoso.
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

    expect(postsRestaurar).toEqual([GARZON_ID])

    wrapper.unmount()
    restaurarRetenido = null
  })

  // `garzones` no tiene modal de colisión (su índice único no es de nombre, el
  // POST ni acepta body): cualquier error al restaurar es siempre terminal —
  // cierra el modal y avisa por toast, nunca abre una segunda pantalla.
  it('un error al restaurar cierra el modal y avisa (no hay pantalla de colisión que abrir)', async () => {
    // Fila viva en el backend pero eliminada en la vista: el POST encuentra la
    // fila ya restaurada y contesta 404, igual que el backend real.
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    garzonesBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(1)
    expect(dialogo()).toBeNull()

    wrapper.unmount()
  })

  // El caso PROPIO de `garzones`: el 400 real de este recurso es la colisión
  // del placeholder "Mostrador" (índice único parcial `uq_garzones_mostrador_
  // tenant`), no un nombre duplicado. Aun con ese mensaje puntual, la pantalla
  // lo muestra como toast — nunca abre un modal de renombrado, porque
  // renombrar no resuelve esta colisión.
  it('el 400 de colisión con el Mostrador se muestra como toast, no como modal de renombrado', async () => {
    // El Mostrador viejo sigue en la papelera; una propina directa ya generó
    // uno nuevo mientras tanto, así que restaurar el viejo choca. Mensaje real
    // del backend (`garzones.service.ts` → `restaurar()`).
    garzonesBackend = [eliminado({ nombre: 'Mostrador' })]
    restaurarErrorForzado
      = 'Ya existe un garzón "Mostrador" activo para este tenant (se crea automáticamente, uno por tenant). '
        + 'No se puede restaurar el placeholder anterior mientras el nuevo siga vivo.'

    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // Nunca se abrió una segunda pantalla (ni modal de colisión, ni el campo
    // "Restaurar como" que sí existe en `descuentos`/`turnos`).
    expect(dialogo()).toBeNull()
    expect(document.body.textContent).not.toContain('No se puede restaurar con ese nombre')
    expect(document.body.querySelector('input[aria-label="Restaurar como"]')).toBeNull()
    expect(postsRestaurar).toEqual([GARZON_ID])
    // Y la fila sigue en la papelera: el restaurar no aplicó.
    expect(garzonesBackend[0]!.eliminadoEl).toBeTruthy()

    wrapper.unmount()
  })
})

describe('garzones — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Uno vivo y otro ya eliminado: así el `GET` con el flag trae algo
    // (garzón viejo) que el `GET` sin el flag no trae, y las dos respuestas
    // son distinguibles en el DOM.
    garzonesBackend = [
      garzon(),
      eliminado({ id: 'garzon-2', nombre: 'Garzón viejo' }),
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
    //    toggle responde primero, la del primero después — el caso que la cola
    //    serial tiene que blindar.
    resolverSinEliminados(
      garzonesBackend.filter(g => !g.eliminadoEl).map(g => ({ ...g })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(garzonesBackend.map(g => ({ ...g })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Ana Torres')
    expect(wrapper.text()).not.toContain('Garzón viejo')

    wrapper.unmount()
  })
})
