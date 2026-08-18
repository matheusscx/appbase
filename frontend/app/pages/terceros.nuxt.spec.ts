// @vitest-environment nuxt
//
// Ver `DesfasesPanel.nuxt.spec.ts` para por qué el entorno va por
// archivo. Este spec cubre DOS cosas separadas:
//   1. Los tres permisos de `terceros` son SEPARADOS en el backend, y el modo
//      de falla es colapsarlos —esconderle el botón de editar a quien solo
//      tiene `Actualizar`, por ejemplo—. Eso no lo ve ningún test de lógica:
//      hay que renderizar.
//   2. La papelera (`docs/features/papelera.md`), molde `configuracion/
//      descuentos.vue` vía la variante gateada por permisos de
//      `configuracion/turnos.vue`. `terceros` NO tiene unicidad de nombre —
//      `POST /terceros/:id/restaurar` ni siquiera acepta body—, así que a
//      diferencia de `descuentos`/`turnos` acá NO hay modal de colisión: un
//      error al restaurar es siempre terminal (toast).
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Terceros from './terceros.vue'

const TERCERO_ID = 't-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface TerceroFake {
  id: string
  tipo: string
  nombre: string
  rut: string | null
  nombreLegal: string | null
  rutFiscal: string | null
  correo: string | null
  telefono: string | null
  activo: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function tercero(over: Partial<TerceroFake> = {}): TerceroFake {
  return {
    id: TERCERO_ID,
    tipo: 'proveedor',
    nombre: 'Distribuidora Sur',
    rut: null,
    nombreLegal: null,
    rutFiscal: null,
    correo: null,
    telefono: null,
    activo: true,
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function eliminado(over: Partial<TerceroFake> = {}): TerceroFake {
  return tercero({
    eliminadoEl: BORRADO_EL,
    eliminadoPorNombre: 'admin.paris',
    ...over,
  })
}

/**
 * Error con la forma que le llega a la pantalla desde ofetch: `message` para
 * el toast. `terceros` no tiene `nombreSugerido` porque no hay colisión
 * posible (sin unicidad de nombre, sin body en el restaurar).
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

let tercerosBackend: TerceroFake[] = []
// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// en una promesa que el test resuelve a mano, en el orden que quiera.
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null
/** Cada `POST .../restaurar` recibido: el contador del doble submit. */
let postsRestaurar: string[] = []
/** Retiene la respuesta del restaurar para dejar el POST "en vuelo". */
let restaurarRetenido: Promise<unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string }) => {
    if (typeof url !== 'string' || !url.includes('/terceros')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const t = tercerosBackend.find(x => x.id === id)
      if (t) {
        t.eliminadoEl = BORRADO_EL
        t.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      postsRestaurar.push(id)
      const t = tercerosBackend.find(x => x.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo, es el toast de error
      // que el guard de reentrancia existe para evitar.
      if (!t?.eliminadoEl) {
        return Promise.reject(errorApi(`Tercero ${id} no está en la papelera`))
      }
      t.eliminadoEl = null
      t.eliminadoPorNombre = null
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? tercerosBackend
      : tercerosBackend.filter(t => !t.eliminadoEl)
    return Promise.resolve(data.map(t => ({ ...t })))
  }
})

/** Los botones de fila son solo icono: se identifican por su `title`/icono. */
async function montar() {
  const wrapper = await mountSuspended(Terceros)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function tieneBoton(wrapper: Awaited<ReturnType<typeof montar>>, texto: string) {
  return wrapper.findAll('button').some(b => b.text().includes(texto))
}

/**
 * Por `title`, no por la clase del icono: el icono lo renderiza `UIcon` en un
 * hijo y en el entorno de test no siempre resuelve, así que consultarlo ataría
 * el test al bundle de iconos en vez de al control.
 */
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
}

describe('terceros — cada control con el permiso de SU endpoint', () => {
  beforeEach(() => {
    tercerosBackend = [tercero()]
    reset()
  })

  it('solo lectura: ni crear, ni editar, ni eliminar', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBe(0)
    // La tabla sigue cargando: el gate es de escritura, no de lectura.
    expect(wrapper.text()).toContain('Distribuidora Sur')
  })

  it('solo `Crear`: aparece el alta y NADA más', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Crear']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBe(0)
  })

  it('solo `Actualizar`: aparece editar SIN aparecer crear ni eliminar', async () => {
    // El caso que un `puedeEscribir` único se comería: los tres permisos son
    // distintos en el backend y hay roles que tienen uno solo.
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Actualizar']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBe(0)
  })

  it('solo `Eliminar`: aparece la papelera y nada más', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Eliminar']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBeGreaterThan(0)
  })

  it('el admin del tenant ve los tres sin permisos listados', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBeGreaterThan(0)
  })
})

describe('terceros — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    tercerosBackend = [tercero()]
    reset()
    esAdmin = true
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Distribuidora Sur')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(tercerosBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Distribuidora Sur')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Distribuidora Sur')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Distribuidora Sur')

    wrapper.unmount()
  })
})

// El toggle "ver eliminados" y el botón "Restaurar" van los dos detrás de
// `Terceros:Eliminar`: sin ese permiso el backend rechaza el restaurar, así
// que ofrecer la papelera sería prometer una acción que termina en 403.
describe('terceros — papelera: gateada por `Terceros:Eliminar`', () => {
  beforeEach(() => {
    tercerosBackend = [eliminado()]
    reset()
  })

  it('sin `Terceros:Eliminar` no hay toggle "Ver eliminados"', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Crear', 'Terceros:Actualizar']

    const wrapper = await montar()

    // Ancla positiva: la pantalla SÍ cargó y muestra sus otros controles, así
    // que la ausencia del toggle es un gate y no una pantalla vacía.
    expect(wrapper.text()).toContain('Terceros')
    expect(wrapper.findAll('button').some(b => b.text().includes('Nuevo tercero'))).toBe(true)
    expect(wrapper.find('[aria-label="Ver eliminados"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('con `Terceros:Eliminar` sí aparece el toggle, y la fila eliminada ofrece Restaurar', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Eliminar']

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

describe('terceros — papelera: restaurar', () => {
  beforeEach(() => {
    tercerosBackend = [eliminado()]
    reset()
    esAdmin = true
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(tercerosBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Distribuidora Sur')
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

    expect(postsRestaurar).toEqual([TERCERO_ID])

    wrapper.unmount()
    restaurarRetenido = null
  })

  // `terceros` no tiene modal de colisión (sin unicidad de nombre, el POST ni
  // acepta body): cualquier error al restaurar es siempre terminal — cierra
  // el modal y avisa por toast, nunca abre una segunda pantalla.
  it('un error al restaurar cierra el modal y avisa (no hay pantalla de colisión que abrir)', async () => {
    // Fila viva en el backend pero eliminada en la vista: el POST encuentra la
    // fila ya restaurada y contesta 404, igual que el backend real.
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    tercerosBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(1)
    expect(dialogo()).toBeNull()

    wrapper.unmount()
  })
})

describe('terceros — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Uno vivo y otro ya eliminado: así el `GET` con el flag trae algo
    // (Tercero viejo) que el `GET` sin el flag no trae, y las dos respuestas
    // son distinguibles en el DOM.
    tercerosBackend = [
      tercero(),
      eliminado({ id: 'tercero-2', nombre: 'Tercero viejo' }),
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
      tercerosBackend.filter(t => !t.eliminadoEl).map(t => ({ ...t })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(tercerosBackend.map(t => ({ ...t })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Distribuidora Sur')
    expect(wrapper.text()).not.toContain('Tercero viejo')

    wrapper.unmount()
  })
})
