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
//
// ⚠️ **Los tres `describe` desmontan en `afterEach`, no al final del test.** Los
// diálogos de esta pantalla se teletransportan fuera del wrapper, así que los
// casos que los inspeccionan leen `document.body`; si un test falla ANTES de su
// `unmount()`, la pantalla queda montada y el siguiente encuentra diálogos
// viejos. Y como `document.body.querySelector('[role="dialog"]')` devuelve el
// PRIMERO, el test siguiente puede pasar en verde clickeando el modal del
// anterior. Cada `describe` anota abajo la medición con la que se comprobó.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Garzones from './garzones.vue'

const GARZON_ID = 'garzon-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface GarzonFake {
  id: string
  nombre: string
  activo: boolean
  tipo: string
  // `null` = se identifica por PIN. Con un `usuarioId`, el PIN lo fija el
  // garzón desde su cuenta y el botón de la fila pasa de "generar" a
  // "invalidar" (ver `esInvalidar` en `garzones.vue`).
  usuarioId: string | null
  // Del backend (`GarzonPublico.pinFijado`), NO derivado del historial. Con
  // `usuarioId`, distingue el garzón que YA puso su PIN (invalidarlo destruye
  // algo real) del que todavía no (invalidarlo no tiene ningún efecto).
  pinFijado: boolean
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
    usuarioId: null,
    pinFijado: true,
    creadoEl: '2026-07-01T10:00:00.000Z',
    actualizadoEl: '2026-07-01T10:00:00.000Z',
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

/** Una fila del historial de PIN, tal como la devuelve `GET .../pin-eventos`. */
interface EventoPinFake {
  id: string
  tipo: string
  usuarioNombre: string | null
  creadoEl: string
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

/**
 * Los toasts no se pueden leer del DOM sin montar `UApp`, así que se captura el
 * composable. Es lo único que permite afirmar el COLOR: una advertencia que
 * saliera como `success` se vería igual en un assert sobre el texto.
 */
let toasts: { title?: string, color?: string }[] = []

mockNuxtImport('useToast', () => {
  return () => ({
    add: (t: { title?: string, color?: string }) => {
      toasts.push(t)
    },
  })
})

let garzonesBackend: GarzonFake[] = []
/** Lo que el backend adjunta a la respuesta del PATCH (garzón o PIN). */
let advertenciasBackend: string[] = []
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
/** Historial de PIN por garzón, para `GET .../pin-eventos`. Vacío si no se fija. */
let eventosPinBackend: Record<string, EventoPinFake[]> = {}
/** Cada `GET .../pin-eventos` recibido: la sonda de "cero N+1" (finding 4). */
let pinEventosRequests: string[] = []
/** Fuerza el próximo `GET .../pin-eventos` a rechazar, para simular un fetch caído. */
let eventosPinRechaza = false

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string' || !url.includes('/garzones')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    // El backend devuelve `advertencias` en los dos PATCH: el del garzón y el
    // del PIN. Siempre presente, vacío cuando no hay nada que decir.
    if (method === 'PATCH') {
      const esPin = url.endsWith('/pin')
      const id = esPin ? (url.split('/').slice(-2)[0] ?? '') : (url.split('/').pop() ?? '')
      const g = garzonesBackend.find(x => x.id === id)
      if (!g) return Promise.reject(errorApi(`Garzón ${id} no encontrado`))
      if (esPin) {
        // Con cuenta vinculada el backend INVALIDA en vez de emitir: no hay
        // PIN que devolver, igual que el real (`GarzonConPin.pin: null`). Y
        // deja el `pinHash` en el centinela, tenga o no efecto real —de ahí
        // que `pinFijado` pase a `false` aunque ya estuviera en `false`.
        //
        // `habiaPin` se captura ANTES de mutar `g.pinFijado`, como el
        // service real (`garzones.service.ts`: lo lee antes de pisar el
        // hash): es la única fuente de verdad del RESULTADO — el front no
        // debe (y desde esta ronda no puede) inferirlo del `pinFijado` que
        // tenía en su propio caché.
        const habiaPin = g.pinFijado
        const pin = g.usuarioId ? null : '424242'
        if (g.usuarioId) g.pinFijado = false
        return Promise.resolve({ ...g, pin, advertencias: advertenciasBackend, habiaPin })
      }
      Object.assign(g, opts?.body ?? {})
      return Promise.resolve({ ...g, advertencias: advertenciasBackend })
    }
    if (method === 'GET' && url.includes('/pin-eventos')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      pinEventosRequests.push(id)
      if (eventosPinRechaza) {
        return Promise.reject(errorApi('No se pudo cargar el historial'))
      }
      return Promise.resolve(eventosPinBackend[id] ?? [])
    }
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
  advertenciasBackend = []
  eventosPinBackend = {}
  pinEventosRequests = []
  eventosPinRechaza = false
  toasts = []
}

describe('garzones — papelera: eliminar respeta el toggle', () => {
  // Desmontaje en `afterEach` por la razón del encabezado del archivo. Medido
  // acá el 2026-08-11: con el `unmount()` al final del test, forzar un fallo
  // con el modal abierto dejaba 1 diálogo huérfano en el test siguiente.
  let montado: Awaited<ReturnType<typeof montar>> | null = null

  beforeEach(() => {
    garzonesBackend = [garzon()]
    reset()
    esAdmin = true
  })

  afterEach(() => {
    montado?.unmount()
    montado = null
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = (montado = await montar())
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
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = (montado = await montar())
    expect(wrapper.text()).toContain('Ana Torres')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Ana Torres')
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
  // Desmontaje en `afterEach` por la razón del encabezado del archivo. Medido
  // acá el 2026-08-11: con el `unmount()` al final del test, forzar un fallo
  // con el modal abierto dejaba 1 diálogo huérfano en el test siguiente.
  let montado: Awaited<ReturnType<typeof montar>> | null = null

  beforeEach(() => {
    garzonesBackend = [eliminado()]
    reset()
    esAdmin = true
  })

  afterEach(() => {
    montado?.unmount()
    montado = null
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = (montado = await montar())
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(garzonesBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Ana Torres')
    expect(wrapper.text()).not.toContain('Eliminado por admin.paris')
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

    const wrapper = (montado = await montar())
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
    restaurarRetenido = null
  })

  // `garzones` no tiene modal de colisión (su índice único no es de nombre, el
  // POST ni acepta body): cualquier error al restaurar es siempre terminal —
  // cierra el modal y avisa por toast, nunca abre una segunda pantalla.
  it('un error al restaurar cierra el modal y avisa (no hay pantalla de colisión que abrir)', async () => {
    // Fila viva en el backend pero eliminada en la vista: el POST encuentra la
    // fila ya restaurada y contesta 404, igual que el backend real.
    const wrapper = (montado = await montar())
    await activarVerEliminados(wrapper)
    garzonesBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(1)
    expect(dialogo()).toBeNull()
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

    const wrapper = (montado = await montar())
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

// Decisión del owner (2026-08-07): cambiar el `tipo` con sesión abierta y
// regenerar el PIN de alguien en turno ADVIERTEN, no bloquean. El backend
// devuelve el aviso en `advertencias`; lo que se prueba acá es que llegue a los
// ojos del admin — un aviso que el backend calcula y la pantalla descarta no
// cambia nada respecto de no calcularlo.
describe('garzones — advertencias del backend', () => {
  // Desmontaje en `afterEach` por la razón del encabezado del archivo. Medido
  // acá el 2026-08-07: con el `unmount()` al final del test, un mutante que solo
  // debía matar 1 test mataba los 4 — señal falsa.
  let montado: Awaited<ReturnType<typeof montar>> | null = null

  beforeEach(() => {
    garzonesBackend = [garzon()]
    reset()
    esAdmin = true
  })

  afterEach(() => {
    montado?.unmount()
    montado = null
  })

  /**
   * Dos cosas que este montaje necesita y no son obvias:
   *
   * 1. **`AppDrawer` stubeado.** Su root es `UDrawer` (reka-ui) y **cerrarlo**
   *    revienta bajo happy-dom: la transición de salida de `usePresence` lee
   *    `style.display` de un nodo ya desprendido y tira un unhandled rejection.
   *    Los tests igual pasan, pero `vitest run` sale con exit 1. Medido aislando
   *    UNA variable: abrir el drawer y desmontar da 0 rejections; abrir, guardar
   *    —que hace `drawerOpen = false`— y desmontar da 2. Rompe el cierre, no el
   *    montaje. El stub va en `global.stubs` y no en `mockComponent`: así queda
   *    acotado a ESTE mount en vez de alcanzar a los `describe` de papelera.
   * 2. **`attachTo: document.body`.** El botón es
   *    `type="submit" form="garzon-form"`, y esa asociación por id la resuelve
   *    el DOCUMENTO. Con el wrapper desprendido el submit no dispara y el test
   *    pasaría sin haber guardado nada. Con el `UDrawer` real no se notaba
   *    porque teletransporta al body.
   *
   * El stub no vuelve vacuos los tests: el `UForm` y el botón siguen siendo los
   * de la página, y el mutante que saca el toast de éxito de `guardar()` mata
   * los dos casos que pasan por acá.
   */
  async function pantalla() {
    montado = await mountSuspended(Garzones, {
      attachTo: document.body,
      global: {
        stubs: {
          AppDrawer: {
            name: 'AppDrawer',
            props: ['open'],
            template: `
              <div v-if="open" role="dialog">
                <slot name="header" />
                <slot name="body" />
                <slot name="actions" />
              </div>
            `,
          },
        },
      },
    })
    await new Promise(r => setTimeout(r, 0))
    return montado
  }

  /**
   * Al confirmar la regeneración quedan DOS diálogos montados un instante: el
   * de confirmación cerrándose y el del PIN abriéndose. Buscar "el primero"
   * devolvería el equivocado, así que se busca por contenido — por el
   * TÍTULO ("PIN de Ana Torres") **y** por "Guárdalo ahora", que solo existe
   * en el modal de revelado.
   *
   * Buscar solo por el título no alcanza: el modal de CONFIRMACIÓN de
   * invalidar dice *"El PIN de Ana Torres deja de servir ahora…"*, que
   * también contiene el substring "PIN de Ana Torres" — con ese único
   * criterio, este helper podía agarrar el diálogo de confirmación en vez del
   * de revelado (o peor: devolver "encontrado" para un caso que ni siquiera
   * abre el modal de revelado, ver el hallazgo de la revisión del
   * 2026-08-14). Antes solo pasaba por casualidad: el de confirmación
   * alcanzaba a desmontarse en los `50ms` de espera de `regenerar()`.
   */
  function modalDelPin(): HTMLElement | undefined {
    return [...document.body.querySelectorAll('[role="dialog"]')]
      .find(d =>
        d.textContent?.includes('PIN de Ana Torres')
        && d.textContent?.includes('Guárdalo ahora'),
      ) as HTMLElement | undefined
  }

  async function regenerar(wrapper: Awaited<ReturnType<typeof montar>>) {
    // Ana Torres (fixture por defecto) no tiene cuenta vinculada: el botón
    // "genera", no "invalida".
    await wrapper.find('[aria-label="Generar PIN nuevo"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await confirmarEnModal('Generar PIN nuevo')
  }

  /**
   * El drawer stubeado NO se teletransporta —vive dentro del wrapper—, así que
   * su botón se busca ahí y no en `document.body` como los de los modales.
   */
  async function editarYGuardar(wrapper: Awaited<ReturnType<typeof montar>>) {
    await wrapper.find('[aria-label="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    const guardar = wrapper.findAll('button').find(b => b.text().trim() === 'Guardar')
    expect(guardar, 'botón "Guardar" en el drawer').toBeTruthy()
    await guardar!.trigger('click')
    await new Promise(r => setTimeout(r, 50))
  }

  it('la advertencia del PIN va DENTRO del modal que muestra el PIN, no en un toast', async () => {
    // Va ahí y no en un toast porque el modal tapa la pantalla: el admin está
    // mirando el PIN que tiene que entregar, y de eso habla el aviso.
    advertenciasBackend = [
      'Ana Torres está en turno: el PIN anterior deja de funcionar ya mismo, '
      + 'así que no va a poder operar ni marcar salida hasta que reciba el nuevo.',
    ]

    await regenerar(await pantalla())

    const d = modalDelPin()
    expect(d, 'modal del PIN revelado').toBeTruthy()
    expect(d!.textContent).toContain('no va a poder operar ni marcar salida')
    // Y no se duplicó como toast: el modal lo taparía.
    expect(toasts).toEqual([])
  })

  it('sin advertencias el modal del PIN no inventa una alerta', async () => {
    await regenerar(await pantalla())

    const d = modalDelPin()
    expect(d, 'modal del PIN revelado').toBeTruthy()
    expect(d!.textContent).not.toContain('está en turno')
  })

  it('la advertencia del cambio de tipo sale como toast warning, después del de éxito', async () => {
    advertenciasBackend = [
      'Ana Torres tiene una sesión abierta: el reparto de propinas de ese turno '
      + 'sigue usando el tipo con el que la abrió (garzon).',
    ]

    await editarYGuardar(await pantalla())

    // El orden importa: el cambio SÍ se guardó. Si el aviso saliera primero o
    // como `error`, se leería como que la edición falló.
    expect(toasts.map(t => t.color)).toEqual(['success', 'warning'])
    expect(toasts[0]?.title).toBe('Garzón actualizado')
    expect(toasts[1]?.title).toContain('sigue usando el tipo con el que la abrió')
  })

  it('sin advertencias el guardado deja un solo toast', async () => {
    await editarYGuardar(await pantalla())

    expect(toasts.map(t => t.color)).toEqual(['success'])
  })

  // El botón manda el estado del garzón, no una elección libre del encargado:
  // con cuenta vinculada invalida (destruye la credencial), sin cuenta genera
  // (el sistema sigue siendo dueño del PIN).
  it('el botón de PIN dice "Generar PIN nuevo" para un garzón sin cuenta, "Invalidar PIN" para uno con cuenta', async () => {
    garzonesBackend = [
      garzon(),
      garzon({ id: 'garzon-2', nombre: 'Beto Fuentes', usuarioId: 'user-1' }),
    ]

    const wrapper = (montado = await pantalla())

    expect(wrapper.find('[aria-label="Generar PIN nuevo"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Invalidar PIN"]').exists()).toBe(true)
  })

  it('el modal de confirmación anuncia que se genera un PIN nuevo, para un garzón sin cuenta', async () => {
    const wrapper = (montado = await pantalla())

    await wrapper.find('[aria-label="Generar PIN nuevo"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(dialogo()?.textContent).toContain('Se generará un PIN nuevo para Ana Torres')
    expect(dialogo()?.textContent).not.toContain('pone el suyo desde su cuenta')
  })

  it('el modal de confirmación anuncia que el PIN se invalida sin nada que mostrar, para un garzón CON cuenta que YA puso su PIN', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: true })]

    const wrapper = (montado = await pantalla())

    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(dialogo()?.textContent).toContain('El PIN de Ana Torres deja de servir ahora')
    expect(dialogo()?.textContent).toContain('Ana Torres pone el suyo desde su cuenta')
  })

  // El caso más común del flujo nuevo: recién vinculada la cuenta, el backend
  // ya dejó `pinHash = PIN_INUTILIZABLE` (evento `invalidado_por_vinculo`) y
  // el garzón todavía no fijó el suyo desde su perfil. "Invalidar" acá no
  // destruye nada — prometerlo sería la misma mentira que el hallazgo A que
  // esta task vino a cerrar, solo que en el caso más frecuente.
  it('el modal de confirmación NO promete destruir nada, para un garzón CON cuenta que TODAVÍA no puso su PIN', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: false })]

    const wrapper = (montado = await pantalla())

    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    const texto = dialogo()?.textContent
    expect(texto).toContain('Ana Torres todavía no puso su PIN')
    expect(texto).toContain('no hay ninguno que invalidar')
    // Las dos frases que prometían una destrucción que no va a pasar.
    expect(texto).not.toContain('deja de servir ahora')
    expect(texto).not.toContain('pierde')
    // El botón de confirmar tiene SU PROPIO rótulo acá: "Invalidar PIN"
    // prometería justo lo que el párrafo de arriba niega.
    expect(texto).toContain('Registrar igual')
    expect(
      [...dialogo()!.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Invalidar PIN'),
    ).toBe(false)
  })

  // Antes, un garzón con cuenta abría igual el modal de revelado con un hueco
  // donde iba el número ("no hay uno que mostrar acá"), que se leía como "no
  // pasó nada". El backend SÍ destruyó la credencial (`invalidado_por_encargado`)
  // — eso se avisa por toast, y el modal de revelado ni se abre.
  it('invalidar el PIN de un garzón con cuenta (YA puesto) NO abre el modal de revelado, y avisa por toast', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: true })]

    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    await confirmarEnModal('Invalidar PIN')

    expect(modalDelPin()).toBeUndefined()
    expect(toasts).toEqual([{ title: 'PIN de Ana Torres invalidado', color: 'success' }])
  })

  // Mismo botón, mismo endpoint, pero nada que destruir: el toast tiene que
  // decir la verdad y no reciclar el "invalidado" de arriba.
  it('"invalidar" el PIN de un garzón que TODAVÍA no lo puso avisa que no había nada, no que se invalidó algo', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: false })]

    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    await confirmarEnModal('Registrar igual')

    expect(modalDelPin()).toBeUndefined()
    expect(toasts).toEqual([{
      title: 'Ana Torres todavía no había puesto su PIN: no había nada que invalidar',
      color: 'neutral',
    }])
  })

  // Rotura encontrada en la revisión del 2026-08-14: `confirmarRegenerar` no
  // sincronizaba `garzones.value` con la respuesta fresca, así que un segundo
  // "Invalidar PIN" sobre la MISMA fila —sin recargar la página— seguía
  // leyendo el `pinFijado` viejo (`true`) y repetía la promesa destructiva
  // que ya no correspondía: el primer click YA había desfijado el PIN.
  it('invalidar dos veces seguidas: la segunda dice la verdad, no repite la primera', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: true })]

    const wrapper = (montado = await pantalla())

    // Primera vez: hay PIN puesto, así que SÍ destruye algo real.
    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    await confirmarEnModal('Invalidar PIN')
    expect(toasts.at(-1)).toEqual({ title: 'PIN de Ana Torres invalidado', color: 'success' })

    // Segunda vez, mismo wrapper, sin remontar ni recargar: si el front no
    // sincronizó el `pinFijado` fresco de la primera respuesta, este modal
    // repetiría "deja de servir ahora" sobre un PIN que ya no existe.
    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const texto = dialogo()?.textContent
    expect(texto).toContain('Ana Torres todavía no puso su PIN')
    expect(texto).not.toContain('deja de servir ahora')

    await confirmarEnModal('Registrar igual')
    expect(toasts.at(-1)).toEqual({
      title: 'Ana Torres todavía no había puesto su PIN: no había nada que invalidar',
      color: 'neutral',
    })
  })

  it('abrirRegenerar refresca el listado ANTES de armar el modal: la predicción no sale de un caché viejo', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: false })]

    const wrapper = (montado = await pantalla())
    // El garzón fija su PIN desde su perfil DESPUÉS de que esta pantalla
    // cargó el listado, pero ANTES de que el encargado haga click: el
    // `garzones.value` en memoria (`pinFijado: false`) ya quedó viejo.
    garzonesBackend[0]!.pinFijado = true

    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    // Sin el refresco de `abrirRegenerar`, el modal preguntaría con el texto
    // viejo ("no había nada que invalidar"). Con el refresco, pregunta con
    // el dato fresco.
    expect(dialogo()?.textContent).toContain('El PIN de Ana Torres deja de servir ahora')
  })

  // Ronda 4 de la revisión (2026-08-14): `abrirRegenerar` refresca el
  // listado antes de armar el modal, pero eso solo achica la ventana de la
  // carrera, no la cierra — el encargado puede tardar en confirmar, y algo
  // puede cambiar el estado real del garzón mientras el modal sigue abierto.
  // Por eso el RESULTADO (el toast, después de confirmar) tiene que salir de
  // `habiaPin` —que manda el backend en la respuesta del PATCH— y no del
  // `pinFijado` que la pantalla tenía al abrir el modal. Las dos direcciones:
  it('la predicción del modal envejece (el garzón fija su PIN mientras el modal está abierto): el toast dice la verdad del backend, no la del modal', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: false })]

    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    // La predicción, refrescada al abrir, es correcta EN ESE MOMENTO.
    expect(dialogo()?.textContent).toContain('todavía no puso su PIN')

    // Mientras el modal sigue abierto, el garzón fija su PIN desde su perfil
    // (o cualquier otro cambio ajeno a esta pestaña) — el listado en memoria
    // de la pantalla no se entera.
    garzonesBackend[0]!.pinFijado = true

    await confirmarEnModal('Registrar igual')

    // El PATCH SÍ destruyó una credencial real: el toast tiene que decirlo,
    // aunque el modal haya preguntado con la predicción vieja.
    expect(toasts).toEqual([{ title: 'PIN de Ana Torres invalidado', color: 'success' }])
  })

  it('la predicción del modal envejece (otra pestaña ya invalidó el PIN): el toast dice que no había nada, no repite la promesa del modal', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: true })]

    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))

    expect(dialogo()?.textContent).toContain('El PIN de Ana Torres deja de servir ahora')

    // Mientras el modal sigue abierto, otra pestaña (u otro encargado) ya
    // invalidó el PIN de este garzón.
    garzonesBackend[0]!.pinFijado = false

    await confirmarEnModal('Invalidar PIN')

    // No había nada que destruir a esta altura: el toast no puede repetir la
    // promesa que el modal hizo con una predicción ya vieja.
    expect(toasts).toEqual([{
      title: 'Ana Torres todavía no había puesto su PIN: no había nada que invalidar',
      color: 'neutral',
    }])
  })

  it('la ficha de un garzón con cuenta que ya fijó su PIN lo muestra "PIN puesto" y con su historial', async () => {
    // El badge sale de `pinFijado` (del listado, `GarzonPublico`), no del
    // historial: el historial de acá abajo es solo para la aserción del
    // texto "Puso su PIN", no para derivar el badge.
    garzonesBackend = [garzon({ id: 'garzon-2', nombre: 'Beto Fuentes', usuarioId: 'user-1', pinFijado: true })]
    eventosPinBackend['garzon-2'] = [
      { id: 'evt-2', tipo: 'fijado_por_garzon', usuarioNombre: 'Beto Fuentes', creadoEl: '2026-08-10T10:00:00.000Z' },
      { id: 'evt-1', tipo: 'invalidado_por_vinculo', usuarioNombre: 'admin.paris', creadoEl: '2026-08-01T10:00:00.000Z' },
    ]

    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.text()).toContain('PIN puesto')
    expect(wrapper.text()).toContain('Puso su PIN')
  })

  it('la ficha de un garzón con cuenta que TODAVÍA no fijó su PIN lo marca "Sin PIN todavía"', async () => {
    garzonesBackend = [garzon({ id: 'garzon-2', nombre: 'Beto Fuentes', usuarioId: 'user-1', pinFijado: false })]
    eventosPinBackend['garzon-2'] = [
      { id: 'evt-1', tipo: 'invalidado_por_vinculo', usuarioNombre: 'admin.paris', creadoEl: '2026-08-01T10:00:00.000Z' },
    ]

    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.text()).toContain('Sin PIN todavía')
    expect(wrapper.text()).not.toContain('PIN puesto')
  })

  // Hallazgo 1 de la revisión del 2026-08-14: `pinFijado` viene del listado
  // (síncrono con el montaje), no del fetch de `/pin-eventos` — así que un
  // historial que TARDA o FALLA no puede hacer que el badge mienta. Antes de
  // este fix, `eventosPin: []` (estado inicial Y estado de error) hacía que
  // el badge dijera "Sin PIN todavía" con la misma cara que un "no" real del
  // backend.
  it('el badge no miente aunque el historial no cargue: sale del listado, no del fetch de eventos', async () => {
    garzonesBackend = [garzon({ id: 'garzon-2', nombre: 'Beto Fuentes', usuarioId: 'user-1', pinFijado: true })]
    eventosPinRechaza = true

    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    // El badge dice la verdad (viene del listado) aunque el historial haya
    // fallado.
    expect(wrapper.text()).toContain('PIN puesto')
    expect(wrapper.text()).not.toContain('Sin PIN todavía')
    // Y la lista NO dice "Todavía no hubo cambios de PIN" — sería mentira:
    // no es que no hubo cambios, es que no se pudo saber.
    expect(wrapper.text()).not.toContain('Todavía no hubo cambios de PIN')
    expect(wrapper.text()).toContain('No se pudo cargar el historial')
  })

  it('la ficha de un garzón SIN cuenta no muestra el bloque de estado del PIN (se identifica por PIN emitido, no fijado)', async () => {
    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.text()).not.toContain('PIN puesto')
    expect(wrapper.text()).not.toContain('Sin PIN todavía')
  })

  // Hallazgo 4: el guard `if (garzon.usuarioId)` antes de `cargarEventosPin`
  // es lo único que sostiene "cero N+1" en la ficha. Borrarlo no pone nada
  // rojo en los demás tests —la ficha de un garzón sin cuenta simplemente no
  // tiene el bloque de PIN, eventos u no—, así que hace falta un test que
  // mire la llamada de red directamente.
  it('la ficha de un garzón SIN cuenta no pega a /pin-eventos', async () => {
    const wrapper = (montado = await pantalla())
    await wrapper.find('[aria-label="Editar"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))

    expect(pinEventosRequests).toEqual([])
  })

  // Revisión del 2026-08-14: `abrirRegenerar` no abre el modal si el garzón
  // se eliminó entre el click y que el refresco volviera — correcto, pero
  // antes lo hacía en silencio: el spinner del botón paraba y no pasaba
  // nada más, sin decirle al encargado por qué.
  it('el garzón se elimina mientras el refresco de abrirRegenerar está en vuelo: avisa por toast, no se queda callado', async () => {
    garzonesBackend = [garzon({ usuarioId: 'user-1', pinFijado: true })]

    const wrapper = (montado = await pantalla())

    // Retiene el GET que dispara `abrirRegenerar` (vía `cargar()`), para
    // controlar a mano qué pasa MIENTRAS está en vuelo.
    let resolverRefresco: (v: unknown[]) => void = () => {}
    overrideSinEliminados = new Promise((resolve) => { resolverRefresco = resolve })

    const clickPromise = wrapper.find('[aria-label="Invalidar PIN"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))

    // El garzón se elimina (otra pestaña, otro encargado) mientras el
    // refresco sigue pendiente.
    garzonesBackend[0]!.eliminadoEl = '2026-08-14T00:00:00.000Z'
    resolverRefresco(garzonesBackend.filter(g => !g.eliminadoEl).map(g => ({ ...g })))

    await clickPromise
    await new Promise(r => setTimeout(r, 20))

    // El modal no se abre —correcto, no hay nada que regenerar— pero el
    // encargado tiene que enterarse de por qué.
    expect(dialogo()).toBeNull()
    expect(toasts).toEqual([{
      title: 'Ana Torres ya no está disponible: se eliminó justo antes de que confirmaras',
      color: 'warning',
    }])
  })
})
