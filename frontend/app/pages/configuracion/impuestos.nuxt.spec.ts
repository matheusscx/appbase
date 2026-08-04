// @vitest-environment nuxt
//
// Tercera pantalla con papelera (tras `items` y `categorias`), y la que queda
// como molde para las 12 que faltan. Los bugs que este spec fija son de
// RUNTIME: ni el build, ni el typecheck, ni una revisión de código los ven.
//   1. `eliminar()` sacando la fila del array local con el toggle prendido:
//      la fila desaparece en vez de pasar a "eliminada", justo el caso que el
//      toggle existe para mostrar.
//   2. La carrera de `cargar()` bajo toggles rápidos: gana el que responde
//      último, no el que se disparó último.
//   3. Doble submit al restaurar: el modal no se cierra durante el POST, así
//      que un segundo click manda un segundo `POST .../restaurar` sobre una
//      fila ya revivida → 404 → toast de ERROR encima de un éxito.
// Se prueba el síntoma observable en el DOM, no la implementación.
//
// `impuestos` agrega lo suyo: sus filas tienen `origen`, y las de `sistema`
// (catálogo oficial del país) llegan al listado de la papelera pero NO se
// pueden restaurar. ⚠️ Ese caso es EXCLUSIVO de esta pantalla —es el único
// listado de los 16 que devuelve filas ajenas al tenant—, así que el guard de
// `origen` y su test NO se copian a las otras 12 (ver `docs/agent/pendientes.md`).
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Impuestos from './impuestos.vue'

const IMPUESTO_ID = 'imp-1'

interface ImpuestoFake {
  id: string
  nombre: string
  porcentaje: string
  activo: boolean
  origen: 'sistema' | 'personalizado'
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function impuestoPropio(): ImpuestoFake {
  return {
    id: IMPUESTO_ID,
    nombre: 'Impuesto verde',
    porcentaje: '0.05',
    activo: true,
    origen: 'personalizado',
    eliminadoEl: null,
    eliminadoPorNombre: null,
  }
}

function impuestoDeSistema(): ImpuestoFake {
  return {
    ...impuestoPropio(),
    id: 'imp-sistema',
    nombre: 'IVA',
    porcentaje: '0.19',
    origen: 'sistema',
  }
}

// Estado del "backend" simulado: `DELETE` lo muta, `GET` lo lee filtrando por
// `incluirEliminados` igual que el controller real.
let impuestosBackend: ImpuestoFake[] = []

// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// en una promesa que el test resuelve a mano, en el orden que quiera.
// `null` = comportamiento normal (resuelve contra `impuestosBackend`).
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null

/** Ids de cada `POST .../restaurar` recibido: el contador del doble submit. */
let postsRestaurar: string[] = []
/** Retiene la respuesta del restaurar para dejar el POST "en vuelo". */
let restaurarRetenido: Promise<unknown> | null = null

// ── Pausar ──────────────────────────────────────────────────────────────────
/** Ítems que `GET /impuestos/:id/uso` devuelve por id. Ausente = ninguno. */
let usoPorId: Record<string, { id: string, nombre: string }[]> = {}
/** Hace fallar ese GET, para el caso "no se pausa a ciegas". */
let usoFalla = false
/** Cada `GET .../uso` recibido: el testigo de que reactivar NO consulta. */
let getsUso: string[] = []
/** Cada `PATCH /impuestos/:id` recibido, con el `activo` que viajó. */
let patchesActivo: { id: string, activo: boolean }[] = []

/** N ítems distintos, que es lo único que el modal mira (`items.length`). */
function itemsUso(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    nombre: `Item ${i}`,
  }))
}

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: { activo?: boolean } }) => {
    if (typeof url !== 'string' || !url.includes('/impuestos')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'GET' && url.endsWith('/uso')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      getsUso.push(id)
      if (usoFalla) return Promise.reject(new Error('No se pudo verificar el uso'))
      return Promise.resolve({ items: usoPorId[id] ?? [] })
    }
    if (method === 'PATCH') {
      const id = url.split('/').pop() ?? ''
      const activo = opts?.body?.activo
      if (typeof activo === 'boolean') {
        patchesActivo.push({ id, activo })
        const imp = impuestosBackend.find(x => x.id === id)
        if (imp) imp.activo = activo
      }
      return Promise.resolve({ ...impuestosBackend.find(x => x.id === id) })
    }
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const imp = impuestosBackend.find(i => i.id === id)
      if (imp) {
        imp.eliminadoEl = '2026-08-01T21:00:00.000Z'
        imp.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      postsRestaurar.push(id)
      const imp = impuestosBackend.find(i => i.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo, es el toast de error
      // que el guard de reentrancia existe para evitar.
      if (!imp?.eliminadoEl) {
        return Promise.reject(
          new Error(`Impuesto ${id} no está en la papelera`),
        )
      }
      imp.eliminadoEl = null
      imp.eliminadoPorNombre = null
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? impuestosBackend
      : impuestosBackend.filter(i => !i.eliminadoEl)
    return Promise.resolve(data.map(i => ({ ...i })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Impuestos)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

async function activarVerEliminados(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.find('[aria-label="Ver eliminados"]').trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

/**
 * El modal de confirmación lo teletransporta `UModal` fuera del wrapper.
 * La búsqueda se acota a `[role="dialog"]` y NO al `body` entero (como sí
 * hace el spec de categorías): acá el botón de la fila y el del modal
 * comparten el texto "Restaurar", así que buscar en todo el body encontraría
 * el de la fila y el test "confirmaría" sin haber abierto nada.
 */
async function confirmarEnModal(texto: string) {
  const dialogo = document.body.querySelector('[role="dialog"]')
  expect(dialogo, `modal abierto para confirmar "${texto}"`).toBeTruthy()
  const boton = [...dialogo!.querySelectorAll('button')]
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
    .filter(t => t === 'Eliminado' || t === 'Sistema' || t === 'Personalizado')
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

function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
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

/** Lo que resetea cada `beforeEach` de los describes de pausar. */
function resetPausar() {
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurar = []
  restaurarRetenido = null
  usoPorId = {}
  usoFalla = false
  getsUso = []
  patchesActivo = []
}

describe('configuracion/impuestos — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    impuestosBackend = [impuestoPropio()]
    overrideConEliminados = null
    overrideSinEliminados = null
    postsRestaurar = []
    restaurarRetenido = null
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Impuesto verde')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, la aserción de abajo pasaría vacuamente.
    expect(impuestosBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Impuesto verde')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    // El badge, por elemento y no por subcadena: un `toContain('Eliminado')`
    // sobre el texto de la página queda SUBSUMIDO por la línea de arriba
    // ("Eliminado por admin.paris" ya lo contiene), así que borrar el badge
    // entero no lo pondría rojo. En `categorias.vue` esa misma línea sí
    // discrimina, pero solo por un accidente del género gramatical
    // ("Eliminada" vs "Eliminado por") — no es un molde que se pueda copiar a
    // las pantallas masculinas que faltan.
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Impuesto verde')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Impuesto verde')

    wrapper.unmount()
  })

  // El modal NO se cierra al confirmar (lo cierra el `finally` de la página),
  // así que mientras el POST viaja el botón sigue clickeable. Sin el guard de
  // reentrancia el segundo click manda un segundo POST sobre una fila que el
  // primero ya revivió, el backend contesta 404 y el usuario ve un toast de
  // ERROR justo después de un restore exitoso.
  it('dos clicks en Restaurar mandan UN solo POST (no un 404 encima del éxito)', async () => {
    impuestosBackend = [{
      ...impuestoPropio(),
      eliminadoEl: '2026-08-01T21:00:00.000Z',
      eliminadoPorNombre: 'admin.paris',
    }]
    let soltarRestaurar: () => void = () => {}
    restaurarRetenido = new Promise<void>((resolve) => {
      soltarRestaurar = resolve
    })

    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)

    const dialogo = document.body.querySelector('[role="dialog"]')!
    const boton = [...dialogo.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Restaurar')!
    boton.click()
    await new Promise(r => setTimeout(r, 10))
    // Segundo click con el primer POST todavía en vuelo.
    boton.click()
    await new Promise(r => setTimeout(r, 10))

    soltarRestaurar()
    await new Promise(r => setTimeout(r, 60))

    expect(postsRestaurar).toEqual([IMPUESTO_ID])

    wrapper.unmount()
    restaurarRetenido = null
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    impuestosBackend = [{
      ...impuestoPropio(),
      eliminadoEl: '2026-08-01T21:00:00.000Z',
      eliminadoPorNombre: 'admin.paris',
    }]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(impuestosBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Impuesto verde')
    expect(wrapper.text()).not.toContain('Eliminado por admin.paris')

    wrapper.unmount()
  })
})

// Lo propio de esta pantalla: el catálogo oficial del país no es del tenant y
// no se puede borrar ni restaurar. El listado de la papelera lo devuelve
// igual (viene por la rama `pais_id` del `OR`), así que el riesgo concreto es
// ofrecerle acciones que el backend va a rechazar.
describe('configuracion/impuestos — papelera: los impuestos de sistema no se tocan', () => {
  beforeEach(() => {
    impuestosBackend = [impuestoDeSistema(), impuestoPropio()]
    overrideConEliminados = null
    overrideSinEliminados = null
  })

  it('con el toggle activo, el impuesto de sistema VIVO sigue sin botón de eliminar', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    expect(wrapper.text()).toContain('IVA')
    expect(wrapper.text()).toContain('Catálogo oficial')
    // Un solo botón "Eliminar": el del impuesto propio. Si el de sistema
    // también lo tuviera, serían dos.
    expect(wrapper.findAll('[title="Eliminar"]')).toHaveLength(1)

    wrapper.unmount()
  })

  // ⚠️ Este test tiene que montar la fila de sistema YA ELIMINADA. La primera
  // versión la montaba viva y asertaba `not.toContain('Restaurar')`: con
  // ninguna fila eliminada, la rama de restaurar no se renderiza para NINGUNA,
  // así que la aserción pasaba por construcción y certificaba un guard que el
  // código no tenía. El estado no es alcanzable por producto —`remove()` exige
  // `{id, tenantId}` y las filas de país tienen `tenant_id NULL`—, pero el
  // listado de la papelera SÍ devuelve esas filas, así que la regla se prueba
  // sobre el estado que el componente puede recibir, no sobre el que la API
  // puede producir.
  it('una fila de sistema que llegara eliminada NO ofrece restaurar, y conserva "Catálogo oficial"', async () => {
    impuestosBackend = [
      {
        ...impuestoDeSistema(),
        eliminadoEl: '2026-07-30T12:00:00.000Z',
        eliminadoPorNombre: 'admin.paris',
      },
      {
        ...impuestoPropio(),
        eliminadoEl: '2026-07-30T12:00:00.000Z',
        eliminadoPorNombre: 'admin.paris',
      },
    ]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    // Ancla positiva: las DOS filas llegaron eliminadas, así que la rama de
    // restaurar sí está en juego — sin esto la aserción negativa sería vacua.
    expect(badges(wrapper).filter(b => b === 'Eliminado')).toHaveLength(2)
    // Y sin embargo hay UN solo "Restaurar": el del impuesto propio.
    expect(
      wrapper.findAll('button').filter(b => b.text().trim() === 'Restaurar'),
    ).toHaveLength(1)
    // La fila de sistema no se queda sin nada: mantiene su etiqueta.
    expect(wrapper.text()).toContain('Catálogo oficial')

    wrapper.unmount()
  })

  it('el switch de activo está deshabilitado en una fila eliminada', async () => {
    impuestosBackend = [{
      ...impuestoPropio(),
      eliminadoEl: '2026-07-30T12:00:00.000Z',
      eliminadoPorNombre: 'admin.paris',
    }]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    const sw = wrapper.findAll('tbody button[role="switch"]')
    expect(sw).toHaveLength(1)
    expect(sw[0]!.attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })
})

describe('configuracion/impuestos — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Uno vivo y otro ya eliminado: así el `GET` con el flag trae algo
    // (Impuesto viejo, con badge) que el `GET` sin el flag no trae, y las dos
    // respuestas son distinguibles en el DOM.
    impuestosBackend = [
      impuestoPropio(),
      {
        ...impuestoPropio(),
        id: 'imp-2',
        nombre: 'Impuesto viejo',
        eliminadoEl: '2026-07-30T12:00:00.000Z',
        eliminadoPorNombre: 'admin.paris',
      },
    ]
    overrideConEliminados = null
    overrideSinEliminados = null
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
    resolverSinEliminados(
      impuestosBackend.filter(i => !i.eliminadoEl).map(i => ({ ...i })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(impuestosBackend.map(i => ({ ...i })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Impuesto verde')
    expect(wrapper.text()).not.toContain('Impuesto viejo')

    wrapper.unmount()
  })
})

// Pausar un impuesto no lo elimina —conserva sus asociaciones—, pero sí lo
// saca de circulación. El diálogo existe para que el usuario sepa a cuánto
// afecta ANTES de aceptar, y solo aparece cuando hay algo que decir: reactivar
// y el caso de cero ítems pasan derecho, porque un diálogo que siempre aparece
// es un diálogo que se acepta sin leer.
describe('configuracion/impuestos — pausar: confirmación con el alcance', () => {
  beforeEach(() => {
    impuestosBackend = [impuestoPropio()]
    resetPausar()
  })

  it('pausar un impuesto en uso abre el modal con el conteo REAL y recién al confirmar pausa', async () => {
    usoPorId = { [IMPUESTO_ID]: itemsUso(34) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('Pausar «Impuesto verde»')
    expect(document.body.textContent).toContain('Deja de aplicarse en 34 ítems.')
    expect(document.body.textContent).toContain(
      'Las asociaciones se conservan: al reactivarlo vuelve como estaba.',
    )
    // Con el modal abierto todavía no viajó nada: el PATCH sale al confirmar.
    expect(patchesActivo).toEqual([])
    expect(impuestosBackend[0]!.activo).toBe(true)

    await confirmarEnModal('Pausar')

    expect(patchesActivo).toEqual([{ id: IMPUESTO_ID, activo: false }])
    expect(impuestosBackend[0]!.activo).toBe(false)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('false')

    wrapper.unmount()
  })

  it('el conteo sale de `items.length`, no de un número fijo', async () => {
    usoPorId = { [IMPUESTO_ID]: itemsUso(1) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('Deja de aplicarse en 1 ítem.')

    wrapper.unmount()
  })

  it('cancelar deja el impuesto activo y NO manda el PATCH', async () => {
    usoPorId = { [IMPUESTO_ID]: itemsUso(3) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)
    await confirmarEnModal('Cancelar')

    expect(patchesActivo).toEqual([])
    expect(impuestosBackend[0]!.activo).toBe(true)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  it('sin ítems que lo usen, pausar es directo: no abre modal', async () => {
    usoPorId = {}
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([{ id: IMPUESTO_ID, activo: false }])

    wrapper.unmount()
  })

  it('reactivar no pregunta nada: ni consulta el uso ni abre modal', async () => {
    impuestosBackend = [{ ...impuestoPropio(), activo: false }]
    // Tendría 34 ítems para contar, pero reactivar no destruye nada.
    usoPorId = { [IMPUESTO_ID]: itemsUso(34) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(getsUso).toEqual([])
    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([{ id: IMPUESTO_ID, activo: true }])

    wrapper.unmount()
  })

  it('si el GET de uso falla, el toggle no se mueve y no se pausa a ciegas', async () => {
    usoFalla = true
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(getsUso).toEqual([IMPUESTO_ID])
    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([])
    expect(impuestosBackend[0]!.activo).toBe(true)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })
})
