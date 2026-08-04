// @vitest-environment nuxt
//
// Quinta pantalla con papelera, y el SEGUNDO caso real de la salida de colisión
// (el primero fue `descuentos`, de donde sale este molde). `recargos` es su
// gemelo: misma forma de garantizar la unicidad —solo por código, sin índice
// único en la base—, así que el backend puede consultar los nombres tomados
// ANTES de intentar. Los 5 recursos con índice único parcial que faltan no son
// este caso: se enteran de la colisión capturando el `23505`, o sea después de
// que falla el INSERT (ver `docs/agent/pendientes.md`).
//
// Los bugs que este spec fija son de RUNTIME: ni el build, ni el typecheck, ni
// una revisión de código los ven.
//   1. `eliminar()` sacando la fila del array local con el toggle prendido: la
//      fila desaparece en vez de pasar a "eliminada", justo el caso que el
//      toggle existe para mostrar.
//   2. La carrera de `cargar()` bajo toggles rápidos: gana el que responde
//      último, no el que se disparó último.
//   3. Doble submit al restaurar: el modal no se cierra durante el POST, así
//      que un segundo click manda un segundo `POST .../restaurar` sobre una
//      fila ya revivida → 404 → toast de ERROR encima de un éxito.
//   4. El 400 de colisión NO es un toast rojo sino
//      un segundo modal con un nombre libre editable. Si el catch lo tratara
//      como error terminal, el usuario quedaría sin salida más que renombrar a
//      mano la fila viva que le ocupa el nombre.
// Se prueba el síntoma observable en el DOM, no la implementación.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Recargos from './recargos.vue'

const RECARGO_ID = 'rec-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface RecargoFake {
  id: string
  nombre: string
  tipoReglaId: string
  modo: string | null
  valor: string | null
  metodoPagoIds: string[]
  tramos: { minimo: string, valor: string }[]
  diasVencimiento: number | null
  fechaInicio: string | null
  fechaFin: string | null
  activo: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function recargo(over: Partial<RecargoFake> = {}): RecargoFake {
  return {
    id: RECARGO_ID,
    nombre: 'Recargo finde',
    tipoReglaId: 'tipo-1',
    modo: 'porcentaje',
    valor: '0.10',
    metodoPagoIds: [],
    tramos: [],
    diasVencimiento: null,
    fechaInicio: null,
    fechaFin: null,
    activo: true,
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function eliminado(over: Partial<RecargoFake> = {}): RecargoFake {
  return recargo({
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

// Estado del "backend" simulado: `DELETE` lo muta, `GET` lo lee filtrando por
// `incluirEliminados` igual que el controller real.
let recargosBackend: RecargoFake[] = []

// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// en una promesa que el test resuelve a mano, en el orden que quiera.
// `null` = comportamiento normal (resuelve contra `recargosBackend`).
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null

/** Cada `POST .../restaurar` recibido, con el nombre que viajó (o `undefined`
 *  si el body no fue): el contador del doble submit y el testigo del renombre. */
let postsRestaurar: { id: string, nombre?: string }[] = []
/** Retiene la respuesta del restaurar para dejar el POST "en vuelo". */
let restaurarRetenido: Promise<unknown> | null = null

// ── Pausar ──────────────────────────────────────────────────────────────────
/** Ítems que `GET /recargos/:id/uso` devuelve por id. Ausente = ninguno. */
let usoPorId: Record<string, { id: string, nombre: string }[]> = {}
/** Hace fallar ese GET, para el caso "no se pausa a ciegas". */
let usoFalla = false
/** Cada `GET .../uso` recibido: el testigo de que reactivar NO consulta. */
let getsUso: string[] = []
/** Cada `PATCH /recargos/:id` recibido, con el `activo` que viajó. */
let patchesActivo: { id: string, activo: boolean }[] = []

/** N ítems distintos, que es lo único que el modal mira (`items.length`). */
function itemsUso(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    nombre: `Item ${i}`,
  }))
}

mockNuxtImport('useApiFetch', () => {
  return (
    url: string,
    opts?: { method?: string, body?: { nombre?: string, activo?: boolean } },
  ) => {
    if (typeof url !== 'string' || !url.includes('/recargos')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'GET' && url.endsWith('/uso')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      getsUso.push(id)
      if (usoFalla) return Promise.reject(errorApi('No se pudo verificar el uso'))
      return Promise.resolve({ items: usoPorId[id] ?? [] })
    }
    if (method === 'PATCH') {
      const id = url.split('/').pop() ?? ''
      const activo = opts?.body?.activo
      if (typeof activo === 'boolean') {
        patchesActivo.push({ id, activo })
        const r = recargosBackend.find(x => x.id === id)
        if (r) r.activo = activo
      }
      return Promise.resolve({ ...recargosBackend.find(x => x.id === id) })
    }
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const d = recargosBackend.find(x => x.id === id)
      if (d) {
        d.eliminadoEl = BORRADO_EL
        d.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      const nombreNuevo = opts?.body?.nombre
      postsRestaurar.push({ id, nombre: nombreNuevo })
      const d = recargosBackend.find(x => x.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo, es el toast de error
      // que el guard de reentrancia existe para evitar.
      if (!d?.eliminadoEl) {
        return Promise.reject(
          errorApi(`Recargo ${id} no está en la papelera`),
        )
      }
      const nombre = nombreNuevo ?? d.nombre
      const vivos = recargosBackend
        .filter(x => !x.eliminadoEl && x.id !== id)
        .map(x => x.nombre)
      if (vivos.includes(nombre)) {
        return Promise.reject(
          errorApi(
            `Ya existe un recargo activo con el nombre "${nombre}".`,
            { nombreSugerido: sugerir(nombre.replace(/ \d+$/, ''), vivos) },
          ),
        )
      }
      d.eliminadoEl = null
      d.eliminadoPorNombre = null
      d.nombre = nombre
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? recargosBackend
      : recargosBackend.filter(d => !d.eliminadoEl)
    return Promise.resolve(data.map(d => ({ ...d })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Recargos)
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
 * El modal de confirmación lo teletransporta `UModal` fuera del wrapper.
 * La búsqueda se acota a `[role="dialog"]` y NO al `body` entero: acá el botón
 * de la fila y el del modal comparten el texto "Restaurar", así que buscar en
 * todo el body encontraría el de la fila y el test "confirmaría" sin haber
 * abierto nada.
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
 * párrafo "Eliminado por <autor> el <fecha>" que va debajo: un
 * `toContain('Eliminado')` sobre el texto de la página queda SUBSUMIDO por ese
 * párrafo, así que borrar el badge entero no lo pondría rojo.
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

/** El switch de "activo" de la única fila del listado (el de la papelera vive
 *  fuera del `tbody`). */
function switchActivo(wrapper: Awaited<ReturnType<typeof montar>>) {
  const sw = wrapper.find('tbody button[role="switch"]')
  expect(sw.exists(), 'switch de activo en la fila').toBe(true)
  return sw
}

async function clickSwitchActivo(wrapper: Awaited<ReturnType<typeof montar>>) {
  await switchActivo(wrapper).trigger('click')
  await new Promise(r => setTimeout(r, 50))
}

function reset() {
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurar = []
  restaurarRetenido = null
  usoPorId = {}
  usoFalla = false
  getsUso = []
  patchesActivo = []
}

describe('configuracion/recargos — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    recargosBackend = [recargo()]
    reset()
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Recargo finde')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(recargosBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Recargo finde')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Recargo finde')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Recargo finde')

    wrapper.unmount()
  })

  it('el switch de activo está deshabilitado en una fila eliminada', async () => {
    recargosBackend = [eliminado()]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    const sw = wrapper.findAll('tbody button[role="switch"]')
    expect(sw).toHaveLength(1)
    expect(sw[0]!.attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })
})

describe('configuracion/recargos — papelera: restaurar', () => {
  beforeEach(() => {
    recargosBackend = [eliminado()]
    reset()
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(recargosBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Recargo finde')
    expect(wrapper.text()).not.toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })

  // El modal NO se cierra al confirmar (lo cierran las funciones de la página),
  // así que mientras el POST viaja el botón sigue clickeable. Sin el guard de
  // reentrancia el segundo click manda un segundo POST sobre una fila que el
  // primero ya revivió, el backend contesta 404 y el usuario ve un toast de
  // ERROR justo después de un restore exitoso.
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

    expect(postsRestaurar).toEqual([{ id: RECARGO_ID, nombre: undefined }])

    wrapper.unmount()
    restaurarRetenido = null
  })

  // La contracara del modal de colisión: un error que NO trae `nombreSugerido`
  // sigue siendo terminal. Sin esta distinción, el catch abriría un modal con
  // un campo vacío ante cualquier 404 o caída de red.
  it('un error SIN sugerencia no abre el modal de colisión: cierra y avisa', async () => {
    // Fila viva en el backend pero eliminada en la vista: el POST encuentra la
    // fila ya restaurada y contesta 404, igual que el backend real.
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    recargosBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(1)
    expect(document.body.textContent).not.toContain('No se puede restaurar con ese nombre')

    wrapper.unmount()
  })
})

// Lo nuevo de esta pantalla. El backend devuelve 400 con `nombreSugerido`
// cuando el nombre de la fila borrada ya lo tomó una viva; la pantalla tiene
// que ofrecer ese nombre —editable— en vez de dejar al usuario sin salida.
describe('configuracion/recargos — papelera: colisión de nombre al restaurar', () => {
  beforeEach(() => {
    recargosBackend = [
      eliminado(),
      recargo({ id: 'rec-vivo', nombre: 'Recargo finde' }),
    ]
    reset()
  })

  it('el 400 abre el modal con la sugerencia precargada y confirmar restaura CON ese nombre', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // El primer POST viajó sin nombre y volvió 400: no restauró nada.
    expect(postsRestaurar).toEqual([{ id: RECARGO_ID, nombre: undefined }])
    expect(recargosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)

    // Y en vez de un toast rojo, el modal con el nombre libre precargado.
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(document.body.textContent).toContain(
      'Ya existe un recargo activo con el nombre "Recargo finde".',
    )
    expect(campoNombre().value).toBe('Recargo finde 2')

    await confirmarEnModal('Restaurar')

    // El segundo POST sí llevó el nombre, y la fila revivió renombrada.
    expect(postsRestaurar).toHaveLength(2)
    expect(postsRestaurar[1]).toEqual({ id: RECARGO_ID, nombre: 'Recargo finde 2' })
    expect(recargosBackend[0]!.eliminadoEl).toBeNull()
    expect(recargosBackend[0]!.nombre).toBe('Recargo finde 2')
    // Los dos conviven vivos en la tabla, que es el punto de toda la salida.
    expect(wrapper.text()).toContain('Recargo finde 2')
    expect(badges(wrapper)).toHaveLength(0)

    wrapper.unmount()
  })

  it('si el usuario edita a un nombre TAMBIÉN tomado, vuelve el modal con la sugerencia siguiente', async () => {
    recargosBackend.push(
      recargo({ id: 'rec-vivo-2', nombre: 'Recargo finde 2' }),
    )
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // Con "Recargo finde" y "Recargo finde 2" vivos, la primera sugerencia salta
    // al 3; el usuario lo pisa a mano con uno que está ocupado.
    expect(campoNombre().value).toBe('Recargo finde 3')
    await escribirNombre('Recargo finde 2')
    await confirmarEnModal('Restaurar')

    // No restauró, no cerró el modal, y la sugerencia se actualizó.
    expect(recargosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(campoNombre().value).toBe('Recargo finde 3')

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

    expect(recargosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(postsRestaurar).toHaveLength(1)
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })
})

describe('configuracion/recargos — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Uno vivo y otro ya eliminado: así el `GET` con el flag trae algo
    // (Recargo viejo) que el `GET` sin el flag no trae, y las dos respuestas
    // son distinguibles en el DOM.
    recargosBackend = [
      recargo(),
      eliminado({ id: 'rec-2', nombre: 'Recargo viejo' }),
    ]
    reset()
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
      recargosBackend.filter(d => !d.eliminadoEl).map(d => ({ ...d })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(recargosBackend.map(d => ({ ...d })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Recargo finde')
    expect(wrapper.text()).not.toContain('Recargo viejo')

    wrapper.unmount()
  })
})

// Pausar una regla no la elimina —conserva sus asociaciones—, pero sí la saca
// de circulación. El diálogo existe para que el usuario sepa a cuánto afecta
// ANTES de aceptar, y solo aparece cuando hay algo que decir: reactivar y el
// caso de cero ítems pasan derecho, porque un diálogo que siempre aparece es
// un diálogo que se acepta sin leer.
describe('configuracion/recargos — pausar: confirmación con el alcance', () => {
  beforeEach(() => {
    recargosBackend = [recargo()]
    reset()
  })

  it('pausar una regla en uso abre el modal con el conteo REAL y recién al confirmar pausa', async () => {
    usoPorId = { [RECARGO_ID]: itemsUso(34) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('Pausar «Recargo finde»')
    expect(document.body.textContent).toContain('Deja de aplicarse en 34 ítems.')
    expect(document.body.textContent).toContain(
      'Las asociaciones se conservan: al reactivarlo vuelve como estaba.',
    )
    // Con el modal abierto todavía no viajó nada: el PATCH sale al confirmar.
    expect(patchesActivo).toEqual([])
    expect(recargosBackend[0]!.activo).toBe(true)

    await confirmarEnModal('Pausar')

    expect(patchesActivo).toEqual([{ id: RECARGO_ID, activo: false }])
    expect(recargosBackend[0]!.activo).toBe(false)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('false')

    wrapper.unmount()
  })

  it('el conteo sale de `items.length`, no de un número fijo', async () => {
    usoPorId = { [RECARGO_ID]: itemsUso(1) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('Deja de aplicarse en 1 ítem.')

    wrapper.unmount()
  })

  it('cancelar deja la regla activa y NO manda el PATCH', async () => {
    usoPorId = { [RECARGO_ID]: itemsUso(3) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)
    await confirmarEnModal('Cancelar')

    expect(patchesActivo).toEqual([])
    expect(recargosBackend[0]!.activo).toBe(true)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  it('sin ítems que la usen, pausar es directo: no abre modal', async () => {
    usoPorId = {}
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([{ id: RECARGO_ID, activo: false }])

    wrapper.unmount()
  })

  it('reactivar no pregunta nada: ni consulta el uso ni abre modal', async () => {
    recargosBackend = [recargo({ activo: false })]
    // Tendría 34 ítems para contar, pero reactivar no destruye nada.
    usoPorId = { [RECARGO_ID]: itemsUso(34) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(getsUso).toEqual([])
    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([{ id: RECARGO_ID, activo: true }])

    wrapper.unmount()
  })

  it('si el GET de uso falla, el toggle no se mueve y no se pausa a ciegas', async () => {
    usoFalla = true
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(getsUso).toEqual([RECARGO_ID])
    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([])
    expect(recargosBackend[0]!.activo).toBe(true)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })
})
