// @vitest-environment nuxt
//
// Cuarta pantalla con papelera (tras `items`, `categorias` e `impuestos`), y la
// primera con la salida de colisión de nombre. Los bugs que este spec fija son
// de RUNTIME: ni el build, ni el typecheck, ni una revisión de código los ven.
//   1. `eliminar()` sacando la fila del array local con el toggle prendido: la
//      fila desaparece en vez de pasar a "eliminada", justo el caso que el
//      toggle existe para mostrar.
//   2. La carrera de `cargar()` bajo toggles rápidos: gana el que responde
//      último, no el que se disparó último.
//   3. Doble submit al restaurar: el modal no se cierra durante el POST, así
//      que un segundo click manda un segundo `POST .../restaurar` sobre una
//      fila ya revivida → 404 → toast de ERROR encima de un éxito.
//   4. Lo nuevo de esta pantalla: el 400 de colisión NO es un toast rojo sino
//      un segundo modal con un nombre libre editable. Si el catch lo tratara
//      como error terminal, el usuario quedaría sin salida más que renombrar a
//      mano la fila viva que le ocupa el nombre.
// Se prueba el síntoma observable en el DOM, no la implementación.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Descuentos from './descuentos.vue'

const DESCUENTO_ID = 'desc-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface DescuentoFake {
  id: string
  nombre: string
  nivel: 'linea' | 'venta'
  tipoReglaId: string
  modo: string | null
  valorMonto: string | null
  valorPorcentaje: string | null
  metodoPagoIds: string[]
  tramos: { minimo: string, valorMonto: string | null, valorPorcentaje: string | null }[]
  diasVencimiento: number | null
  fechaInicio: string | null
  fechaFin: string | null
  activo: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function descuento(over: Partial<DescuentoFake> = {}): DescuentoFake {
  return {
    id: DESCUENTO_ID,
    nombre: 'Black Friday',
    nivel: 'linea',
    tipoReglaId: 'tipo-1',
    modo: 'porcentaje',
    valorMonto: null,
    valorPorcentaje: '0.10',
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

function eliminado(over: Partial<DescuentoFake> = {}): DescuentoFake {
  return descuento({
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
let descuentosBackend: DescuentoFake[] = []

// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// en una promesa que el test resuelve a mano, en el orden que quiera.
// `null` = comportamiento normal (resuelve contra `descuentosBackend`).
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null

/** Cada `POST .../restaurar` recibido, con el nombre que viajó (o `undefined`
 *  si el body no fue): el contador del doble submit y el testigo del renombre. */
let postsRestaurar: { id: string, nombre?: string }[] = []
/** Retiene la respuesta del restaurar para dejar el POST "en vuelo". */
let restaurarRetenido: Promise<unknown> | null = null

// ── Pausar ──────────────────────────────────────────────────────────────────
/** Ítems que `GET /descuentos/:id/uso` devuelve por id. Ausente = ninguno. */
let usoPorId: Record<string, { id: string, nombre: string, eliminado?: boolean }[]> = {}
/** Hace fallar ese GET, para el caso "no se pausa a ciegas". */
let usoFalla = false
/** El PATCH de activo rechaza: sirve para ver si el switch vuelve a su lugar. */
let patchActivoFalla = false
/** Hace fallar el PATCH de guardado del drawer: el 400 del cambio de nivel. */
let patchGuardarFalla = false
/** Cada `GET .../uso` recibido: el testigo de que reactivar NO consulta. */
let getsUso: string[] = []
/** Cada `PATCH /descuentos/:id` recibido, con el `activo` que viajó. */
let patchesActivo: { id: string, activo: boolean }[] = []
/** Cada `PATCH` de GUARDADO del drawer, con el body entero: es el único lugar
 *  donde se puede ver si la key `tramos` viajó, que es lo que limpia los
 *  escalones huérfanos al cambiar de tipo. */
let patchesGuardar: { id: string, body: Record<string, unknown> }[] = []

/** N ítems distintos, que es lo único que el modal mira (`items.length`). */
function itemsUso(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    nombre: `Item ${i}`,
  }))
}

/**
 * `directo` es de `modo: 'libre'` con `campoValor` (ver `reglas-form-config.ts`):
 * es el tipo que hace rendir el radio Porcentaje/Monto fijo y el campo de importe,
 * que desde el 2026-08-23 son DOS —`valorMonto` y `valorPorcentaje`, uno por modo—.
 * Sin tipos, `config` queda en `null` y el drawer no muestra ninguno de los dos.
 */
const TIPOS_REGLA = [
  { id: 'tipo-1', nombre: 'Directo', codigo: 'directo', descripcion: null },
  // Su `nivelSugerido` es `'venta'`: es el que empuja el radio "Se aplica".
  { id: 'tipo-2', nombre: 'Por monto de venta', codigo: 'por_monto_venta', descripcion: null },
]

/** La moneda oficial del tenant: sin ella `MoneyInput` no resuelve config y se
 *  rinde deshabilitado y vacío, con lo que el test pasaría por el motivo
 *  equivocado (vacío por apagado, no vacío por reseteado). */
const MONEDA_CLP = {
  monedaId: 'clp-1',
  nombre: 'Peso chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

mockNuxtImport('useApiFetch', () => {
  return (
    url: string,
    opts?: {
      method?: string
      body?: { nombre?: string, activo?: boolean } & Record<string, unknown>
    },
  ) => {
    if (typeof url === 'string' && url.includes('/tipos-regla')) {
      return Promise.resolve(TIPOS_REGLA)
    }
    if (typeof url !== 'string' || !url.includes('/descuentos')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    // El drawer chequea el nombre ANTES de guardar y aborta si no está libre.
    // Sin esta rama el fake devolvía la lista, `res.disponible` quedaba
    // `undefined` y `guardar()` volvía sin mandar nada: cualquier test del
    // guardado fallaba por el motivo equivocado.
    if (method === 'GET' && url.includes('/nombre-disponible')) {
      return Promise.resolve({ disponible: true })
    }
    if (method === 'GET' && url.endsWith('/uso')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      getsUso.push(id)
      if (usoFalla) return Promise.reject(errorApi('No se pudo verificar el uso'))
      // El `nivel` sale de la fila, igual que en el backend: `obtenerUso` lo
      // lee del descuento, no de las asociaciones.
      return Promise.resolve({
        nivel: descuentosBackend.find(x => x.id === id)?.nivel ?? 'linea',
        items: usoPorId[id] ?? [],
      })
    }
    if (method === 'PATCH') {
      const id = url.split('/').pop() ?? ''
      const activo = opts?.body?.activo
      if (typeof activo === 'boolean') {
        // El rechazo va DESPUÉS de registrar el intento: si no, `patchesActivo`
        // quedaría vacío y un test no podría distinguir "el backend lo rechazó"
        // de "el flujo nunca llegó a mandarlo".
        patchesActivo.push({ id, activo })
        if (patchActivoFalla) return Promise.reject(errorApi('No se pudo actualizar'))
        const d = descuentosBackend.find(x => x.id === id)
        if (d) d.activo = activo
      }
      // El toggle de la grilla y el drawer pegan al MISMO endpoint, y los dos
      // mandan `activo`. Lo que los separa es `nombre`: el drawer manda el form
      // entero, el toggle manda solo el switch.
      if (typeof opts?.body?.nombre === 'string')
        patchesGuardar.push({ id, body: opts.body })
      if (patchGuardarFalla) return Promise.reject(errorApi('No se puede pasar a nivel venta'))
      return Promise.resolve({ ...descuentosBackend.find(x => x.id === id) })
    }
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const d = descuentosBackend.find(x => x.id === id)
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
      const d = descuentosBackend.find(x => x.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo, es el toast de error
      // que el guard de reentrancia existe para evitar.
      if (!d?.eliminadoEl) {
        return Promise.reject(
          errorApi(`Descuento ${id} no está en la papelera`),
        )
      }
      const nombre = nombreNuevo ?? d.nombre
      const vivos = descuentosBackend
        .filter(x => !x.eliminadoEl && x.id !== id)
        .map(x => x.nombre)
      if (vivos.includes(nombre)) {
        return Promise.reject(
          errorApi(
            `Ya existe un descuento activo con el nombre "${nombre}".`,
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
      ? descuentosBackend
      : descuentosBackend.filter(d => !d.eliminadoEl)
    return Promise.resolve(data.map(d => ({ ...d })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Descuentos)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

/**
 * Abre el drawer de edición de la PRIMERA fila de la grilla.
 *
 * Vive a nivel módulo porque lo usan tres describes: estaba duplicado dos veces
 * —una con este nombre y otra como `abrirEdicion`— y el tercer uso, el del
 * frente de la forma de importe (2026-08-26), cruzó el umbral que fija
 * `CLAUDE.md`: *"duplicar dos veces es aceptable, se extrae a la tercera"*.
 *
 * El `hydrate` de la moneda no es decoración: sin la moneda oficial `MoneyInput`
 * no resuelve config y se rinde deshabilitado y vacío, así que un test del campo
 * de importe pasaría por el motivo equivocado.
 */
async function abrirEdicionDeLaFila(wrapper: Awaited<ReturnType<typeof montar>>) {
  useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
  const boton = wrapper.findAll('button').find(b => b.attributes('title') === 'Editar')
  expect(boton, 'botón "Editar" en la fila').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
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

/**
 * Los textos de los `UBadge` de vigencia, con el mismo criterio que `badges()`:
 * como elementos, no como subcadena del texto de la página.
 */
function badgesVigencia(wrapper: Awaited<ReturnType<typeof montar>>): string[] {
  return wrapper.findAll('tbody span')
    .map(s => s.text().trim())
    .filter(t => t === 'Vencida' || t === 'Programada')
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
  patchGuardarFalla = false
  patchActivoFalla = false
  getsUso = []
  patchesActivo = []
  patchesGuardar = []
}

describe('configuracion/descuentos — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    descuentosBackend = [descuento()]
    reset()
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Black Friday')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(descuentosBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Black Friday')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Black Friday')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Black Friday')

    wrapper.unmount()
  })

  it('el switch de activo está deshabilitado en una fila eliminada', async () => {
    descuentosBackend = [eliminado()]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    const sw = wrapper.findAll('tbody button[role="switch"]')
    expect(sw).toHaveLength(1)
    expect(sw[0]!.attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })
})

describe('configuracion/descuentos — papelera: restaurar', () => {
  beforeEach(() => {
    descuentosBackend = [eliminado()]
    reset()
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(descuentosBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Black Friday')
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

    expect(postsRestaurar).toEqual([{ id: DESCUENTO_ID, nombre: undefined }])

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
    descuentosBackend[0]!.eliminadoEl = null

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
describe('configuracion/descuentos — papelera: colisión de nombre al restaurar', () => {
  beforeEach(() => {
    descuentosBackend = [
      eliminado(),
      descuento({ id: 'desc-vivo', nombre: 'Black Friday' }),
    ]
    reset()
  })

  it('el 400 abre el modal con la sugerencia precargada y confirmar restaura CON ese nombre', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // El primer POST viajó sin nombre y volvió 400: no restauró nada.
    expect(postsRestaurar).toEqual([{ id: DESCUENTO_ID, nombre: undefined }])
    expect(descuentosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)

    // Y en vez de un toast rojo, el modal con el nombre libre precargado.
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(document.body.textContent).toContain(
      'Ya existe un descuento activo con el nombre "Black Friday".',
    )
    expect(campoNombre().value).toBe('Black Friday 2')

    await confirmarEnModal('Restaurar')

    // El segundo POST sí llevó el nombre, y la fila revivió renombrada.
    expect(postsRestaurar).toHaveLength(2)
    expect(postsRestaurar[1]).toEqual({ id: DESCUENTO_ID, nombre: 'Black Friday 2' })
    expect(descuentosBackend[0]!.eliminadoEl).toBeNull()
    expect(descuentosBackend[0]!.nombre).toBe('Black Friday 2')
    // Los dos conviven vivos en la tabla, que es el punto de toda la salida.
    expect(wrapper.text()).toContain('Black Friday 2')
    expect(badges(wrapper)).toHaveLength(0)

    wrapper.unmount()
  })

  it('si el usuario edita a un nombre TAMBIÉN tomado, vuelve el modal con la sugerencia siguiente', async () => {
    descuentosBackend.push(
      descuento({ id: 'desc-vivo-2', nombre: 'Black Friday 2' }),
    )
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // Con "Black Friday" y "Black Friday 2" vivos, la primera sugerencia salta
    // al 3; el usuario lo pisa a mano con uno que está ocupado.
    expect(campoNombre().value).toBe('Black Friday 3')
    await escribirNombre('Black Friday 2')
    await confirmarEnModal('Restaurar')

    // No restauró, no cerró el modal, y la sugerencia se actualizó.
    expect(descuentosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(campoNombre().value).toBe('Black Friday 3')

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

    expect(descuentosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(postsRestaurar).toHaveLength(1)
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })
})

describe('configuracion/descuentos — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Uno vivo y otro ya eliminado: así el `GET` con el flag trae algo
    // (Descuento viejo) que el `GET` sin el flag no trae, y las dos respuestas
    // son distinguibles en el DOM.
    descuentosBackend = [
      descuento(),
      eliminado({ id: 'desc-2', nombre: 'Descuento viejo' }),
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
      descuentosBackend.filter(d => !d.eliminadoEl).map(d => ({ ...d })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(descuentosBackend.map(d => ({ ...d })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Black Friday')
    expect(wrapper.text()).not.toContain('Descuento viejo')

    wrapper.unmount()
  })
})

// Pausar una regla no la elimina —conserva sus asociaciones—, pero sí la saca
// de circulación. El diálogo existe para que el usuario sepa a cuánto afecta
// ANTES de aceptar, y solo aparece cuando hay algo que decir: reactivar y el
// caso de cero ítems pasan derecho, porque un diálogo que siempre aparece es
// un diálogo que se acepta sin leer.
describe('configuracion/descuentos — pausar: confirmación con el alcance', () => {
  beforeEach(() => {
    descuentosBackend = [descuento()]
    reset()
  })

  it('pausar una regla en uso abre el modal con el conteo REAL y recién al confirmar pausa', async () => {
    usoPorId = { [DESCUENTO_ID]: itemsUso(34) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('Pausar «Black Friday»')
    expect(document.body.textContent).toContain('Deja de aplicarse en 34 ítems.')
    expect(document.body.textContent).toContain(
      'Las asociaciones se conservan: al reactivarlo vuelve como estaba.',
    )
    // Con el modal abierto todavía no viajó nada: el PATCH sale al confirmar.
    expect(patchesActivo).toEqual([])
    expect(descuentosBackend[0]!.activo).toBe(true)

    await confirmarEnModal('Pausar')

    expect(patchesActivo).toEqual([{ id: DESCUENTO_ID, activo: false }])
    expect(descuentosBackend[0]!.activo).toBe(false)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('false')

    wrapper.unmount()
  })

  it('el conteo sale de `items.length`, no de un número fijo', async () => {
    usoPorId = { [DESCUENTO_ID]: itemsUso(1) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('Deja de aplicarse en 1 ítem.')

    wrapper.unmount()
  })

  it('cancelar deja la regla activa y NO manda el PATCH', async () => {
    usoPorId = { [DESCUENTO_ID]: itemsUso(3) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)
    await confirmarEnModal('Cancelar')

    expect(patchesActivo).toEqual([])
    expect(descuentosBackend[0]!.activo).toBe(true)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  /**
   * `GET /uso` incluye los ítems en la papelera desde el 2026-08-25, marcados
   * con `eliminado`, porque el 400 del cambio de nivel los necesita. Este modal
   * NO: para pausar, un ítem borrado es ruido.
   *
   * Sin el filtro, esta regla dejaría de pausarse en silencio para abrir un
   * modal que anuncia ítems afectados que el admin no ve en ningún lado.
   */
  it('un ítem en la papelera no cuenta: pausar sigue siendo directo', async () => {
    usoPorId = {
      [DESCUENTO_ID]: [{ id: 'item-borrado', nombre: 'Torta vieja', eliminado: true }],
    }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([{ id: DESCUENTO_ID, activo: false }])

    wrapper.unmount()
  })

  it('el modal cuenta solo los vivos, no los de la papelera', async () => {
    usoPorId = {
      [DESCUENTO_ID]: [
        { id: 'item-vivo', nombre: 'Café', eliminado: false },
        { id: 'item-borrado', nombre: 'Torta vieja', eliminado: true },
      ],
    }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('1 ítem')
    expect(document.body.textContent).not.toContain('2 ítems')

    wrapper.unmount()
  })

  it('sin ítems que la usen, pausar es directo: no abre modal', async () => {
    usoPorId = {}
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([{ id: DESCUENTO_ID, activo: false }])

    wrapper.unmount()
  })

  // Una regla de nivel venta no se asocia a ningún ítem: su conteo es 0 por
  // construcción. Hasta el 2026-08-25 eso la hacía caer en la rama "nadie la
  // usa" y se pausaba sin preguntar, mientras la pantalla habría dicho que
  // afectaba a 0 ítems. Lo que pierde el local es poder aplicarla al cobrar.
  it('una regla de nivel venta pregunta aunque no tenga ningún ítem', async () => {
    descuentosBackend = [descuento({ nivel: 'venta' })]
    usoPorId = {}
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(document.body.textContent).toContain('Pausar «Black Friday»')
    expect(document.body.textContent).toContain(
      'Deja de ofrecerse al cobrar',
    )
    expect(document.body.textContent).not.toContain('0 ítems')
    // Con el modal abierto todavía no viajó nada.
    expect(patchesActivo).toEqual([])

    await confirmarEnModal('Pausar')
    expect(patchesActivo).toEqual([{ id: DESCUENTO_ID, activo: false }])

    wrapper.unmount()
  })

  it('la tabla marca la regla de venta, y no marca la de línea', async () => {
    descuentosBackend = [descuento({ nivel: 'venta' })]
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Por venta')
    wrapper.unmount()

    descuentosBackend = [descuento({ nivel: 'linea' })]
    const otro = await montar()
    // La de línea es el caso esperado y el default de la columna: marcarla
    // sería ruido en casi todas las filas.
    expect(otro.text()).not.toContain('Por venta')
    expect(otro.text()).not.toContain('Por ítem')
    otro.unmount()
  })

  it('reactivar no pregunta nada: ni consulta el uso ni abre modal', async () => {
    descuentosBackend = [descuento({ activo: false })]
    // Tendría 34 ítems para contar, pero reactivar no destruye nada.
    usoPorId = { [DESCUENTO_ID]: itemsUso(34) }
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(getsUso).toEqual([])
    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([{ id: DESCUENTO_ID, activo: true }])

    wrapper.unmount()
  })

  it('si el PATCH falla, el switch vuelve a su lugar en vez de mentir', async () => {
    // El toggle es optimista: se mueve antes de que el backend conteste. Sin el
    // revert, un PATCH rechazado deja el switch mostrando un estado que el
    // backend nunca aceptó, y la regla se sigue aplicando a espaldas de quien
    // la pausó. Vive en `usePausaRegla`, compartido por las tres pantallas.
    usoPorId = {}
    patchActivoFalla = true
    const wrapper = await montar()

    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')
    await clickSwitchActivo(wrapper)

    // Testigo de que el flujo SÍ corrió: consultó el uso y mandó el PATCH. Sin
    // esto, el test pasaría igual si el toggle nunca se hubiera disparado.
    expect(getsUso).toEqual([DESCUENTO_ID])
    expect(patchesActivo).toEqual([{ id: DESCUENTO_ID, activo: false }])
    // Y el switch volvió a su lugar en vez de quedar mostrando lo que el
    // backend rechazó.
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  it('si el GET de uso falla, el toggle no se mueve y no se pausa a ciegas', async () => {
    usoFalla = true
    const wrapper = await montar()

    await clickSwitchActivo(wrapper)

    expect(getsUso).toEqual([DESCUENTO_ID])
    expect(dialogo()).toBeNull()
    expect(patchesActivo).toEqual([])
    expect(descuentosBackend[0]!.activo).toBe(true)
    expect(switchActivo(wrapper).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })
})

/**
 * El importe se guarda en DOS campos —`valorMonto` (plata, `MoneyInput`, escala de
 * la moneda) y `valorPorcentaje` (decimal, `UInput`, `0.10` = 10%)— y cada rama del
 * `v-if` del drawer escribe el suyo. No comparten ni escala ni significado.
 *
 * El bug que este describe fija: al pasar de porcentaje a monto fijo, el input
 * mostraba `0` —`MoneyInput` trunca a los 0 decimales del CLP solo para MOSTRAR—
 * mientras el modelo seguía valiendo `0.10`. El usuario veía un número y guardaba
 * otro. Medido revirtiendo el fix: el campo queda en `'0'` y el modelo en `'0.10'`.
 * Es de RUNTIME: ni el build ni el typecheck lo ven.
 *
 * ⚠️ **Cuál de los dos tests lo caza cambió con las columnas partidas, y conviene
 * decirlo para no confiar en el equivocado.** El primero —de porcentaje a monto
 * fijo— ya NO muere si se apaga el reset: `abrirEditar` puebla `valorMonto` desde
 * la fila, que en una regla de porcentaje es `null`, así que el campo aparece
 * vacío haya reset o no. Queda como ancla de render. **El que fija la conducta es
 * el segundo** —volver a porcentaje después de tipear un monto—, que sí muere.
 * Medido apagando el cuerpo de `onModoChange`.
 *
 * Con las columnas partidas hay un segundo motivo para resetear, y no reemplaza al
 * primero: el backend rechaza un body que traiga las dos columnas, así que la
 * unidad abandonada no puede quedar cargada.
 */
describe('configuracion/descuentos — cambiar de modo no deja un valor de la otra escala', () => {
  beforeEach(() => {
    descuentosBackend = [descuento({ modo: 'porcentaje', valorPorcentaje: '0.10' })]
    reset()
  })

  /** El input del campo "Valor" dentro del drawer, sea la rama MoneyInput o la de
   *  porcentaje: las dos rinden un `<input>` y solo una está montada a la vez. */
  function inputValor(): HTMLInputElement {
    const campos = [...(dialogo()?.querySelectorAll<HTMLInputElement>('input') ?? [])]
    const input = campos.find(i => i.getAttribute('inputmode') === 'decimal')
    expect(input, 'campo "Valor" dentro del drawer').toBeTruthy()
    return input!
  }

  /** El radio de un modo, dentro del drawer. Reka UI los rinde como
   *  `button[role="radio"]` con el `value` del item, no como `<input type=radio>`. */
  async function clickModo(valor: string) {
    const radio = dialogo()?.querySelector<HTMLElement>(`[role="radio"][value="${valor}"]`)
    expect(radio, `radio de modo "${valor}"`).toBeTruthy()
    radio!.click()
    await new Promise(r => setTimeout(r, 20))
  }

  it('de porcentaje a monto fijo, el campo queda vacío en vez de mostrar 0 con 0.10 adentro', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    // Punto de partida: el porcentaje guardado, tal cual.
    expect(inputValor().value).toBe('0.10')

    await clickModo('monto_fijo')

    const campo = inputValor()
    // Vacío por RESETEADO, no por apagado: si `MoneyInput` no hubiera resuelto la
    // moneda se rendiría deshabilitado y también vacío, y el test pasaría por el
    // motivo equivocado.
    expect(campo.disabled).toBe(false)
    expect(campo.value).toBe('')
  })

  it('volver a porcentaje tampoco arrastra el monto fijo que se haya tipeado', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await clickModo('monto_fijo')

    const campo = inputValor()
    campo.value = '5000'
    campo.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
    expect(inputValor().value).toBe('5.000')

    await clickModo('porcentaje')

    expect(inputValor().value).toBe('')
  })
})

// El badge de vigencia (`useVigenciaRegla`): sin él, una regla vencida se ve
// idéntica a una vigente en la tabla y el local puede pasar semanas creyendo
// que da un descuento que no está dando. `directo` es el tipo que expone
// `fechaInicio`/`fechaFin` en el drawer (ver `TIPOS_REGLA` arriba), así que
// alcanza con variarlas en el fake — no hace falta tocar el drawer para esto.
/** 'YYYY-MM-DD' de HOY, con el mismo criterio que `useVigenciaRegla` (fecha
 *  LOCAL, no `toISOString()` que da UTC). Se calcula en vez de fijar una fecha
 *  a mano porque los tests de borde de abajo necesitan que "hoy" en el test sea
 *  el mismo "hoy" que usa el composable, corra cuando corra la suite. */
function hoyLocal(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

describe('configuracion/descuentos — badge de vigencia', () => {
  beforeEach(() => {
    reset()
  })

  it('una regla cuyo rango ya pasó se muestra como Vencida', async () => {
    descuentosBackend = [descuento({ fechaInicio: null, fechaFin: '2020-01-01' })]
    const wrapper = await montar()

    expect(badgesVigencia(wrapper)).toEqual(['Vencida'])

    wrapper.unmount()
  })

  // Contracara del anterior: una fecha de inicio futura es "todavía no", no
  // "ya pasó". Sin esta distinción, un mutante que devolviera 'vencida' para
  // cualquier regla con al menos una fecha puesta pasaría el test de arriba
  // igual.
  it('una regla programada a futuro se muestra como Programada, no como Vencida', async () => {
    descuentosBackend = [descuento({ fechaInicio: '2099-01-01', fechaFin: null })]
    const wrapper = await montar()

    expect(badgesVigencia(wrapper)).toEqual(['Programada'])

    wrapper.unmount()
  })

  // El caso esperado —una regla en su rango vigente— NO lleva badge: solo se
  // marca la excepción. Sin este test, un mutante que sacara el `v-if` y
  // mostrara el badge siempre (con la etiqueta "vigente" o vacía) pasaría los
  // dos tests de arriba igual, porque ninguno mira las filas vigentes.
  it('una regla vigente (dentro de su rango) no muestra ningún badge de vigencia', async () => {
    descuentosBackend = [descuento({ fechaInicio: '2020-01-01', fechaFin: '2099-01-01' })]
    const wrapper = await montar()

    expect(badgesVigencia(wrapper)).toEqual([])

    wrapper.unmount()
  })

  // Y el caso más común de todos: una regla sin fechas —la mayoría de los
  // tipos ni siquiera muestran esos campos en el drawer— tampoco lleva badge.
  it('una regla sin fechaInicio ni fechaFin no muestra badge de vigencia', async () => {
    descuentosBackend = [descuento({ fechaInicio: null, fechaFin: null })]
    const wrapper = await montar()

    expect(badgesVigencia(wrapper)).toEqual([])

    wrapper.unmount()
  })

  // Bordes INCLUSIVOS — el docblock de `useVigenciaRegla` lo afirma explícitamente
  // (mismo criterio que `calculo-precios.service.ts` → `indexarReglas`) y hasta la
  // ronda de arreglo 1 ningún test tocaba el día exacto. Sin estos dos, un `<=` en
  // vez de `<` (o un `>=` en vez de `>`) en el composable pasaría toda la suite
  // igual: medido más abajo, revirtiendo después.
  it('una regla que empieza HOY es vigente: no muestra "Programada"', async () => {
    descuentosBackend = [descuento({ fechaInicio: hoyLocal(), fechaFin: null })]
    const wrapper = await montar()

    expect(badgesVigencia(wrapper)).toEqual([])

    wrapper.unmount()
  })

  it('una regla que termina HOY es vigente: no muestra "Vencida"', async () => {
    descuentosBackend = [descuento({ fechaInicio: null, fechaFin: hoyLocal() })]
    const wrapper = await montar()

    expect(badgesVigencia(wrapper)).toEqual([])

    wrapper.unmount()
  })
})

/**
 * El tipo de regla EMPUJA el default del radio "Se aplica", sin bloquearlo
 * (decisión del owner, 2026-08-25).
 *
 * El bug que fija: el radio nacía en *"A cada ítem"* para todos los tipos,
 * incluido `por_monto_venta`, cuyos escalones se llaman *por monto de la venta*.
 * Quien creaba uno y no tocaba el radio se llevaba una regla que la pantalla
 * nombra por el total y el motor mide contra la línea. Nada falla: cobra otra
 * cosa. El seeder ya había tenido que corregir sus dos filas a mano.
 *
 * ⚠️ **Cuatro tests del empujón. Tres tienen un mutante que los mata SOLO a ellos;
 * el cuarto no, y eso se dice en vez de disimularlo** (medido 2026-08-25):
 *
 * | Test | Qué prueba | Mutante |
 * |---|---|---|
 * | *ya eligió el nivel a mano* | que es un DEFAULT y no una imposición: sin esto, "empujar siempre" rompería el caso del vino | `onNivelChange` no registra el toque → **cae solo él** |
 * | *editar … NO le da vuelta el nivel* | el único que toca una regla YA EN USO, donde darle vuelta el nivel cambia en silencio contra qué se mide | `abrirEditar` no prende el testigo → **cae solo él** |
 * | *arrancar una regla nueva después de editar* | que `resetDrawer` apaga el testigo; sin eso el bug original vuelve en silencio | `resetDrawer` no lo apaga → **cae solo él** |
 * | *mueve el radio* | que el empujón existe | quitar el empujón entero → **caen DOS**: éste y el de `resetDrawer` |
 *
 * 📌 **O sea que el último NO es estrictamente necesario**: todo mutante que lo
 * mata mata también al de `resetDrawer`, que hace `crear → elegir tipo` por
 * dentro. Se conserva igual, y a propósito: es la expresión **más corta** de la
 * conducta —el ancla que se lee primero— mientras que el otro la ejerce de paso,
 * para probar otra cosa. Borrarlo no bajaría la cobertura; bajaría la
 * legibilidad.
 *
 * ⛔ **El segundo y el tercero parecen el mismo test y no lo son.** Un mutante que
 * quite el `if (!nivelTocado)` mata a los dos, así que ESE mutante no prueba que
 * hagan falta los dos; los de la tabla sí los separan, porque cubren dos caminos
 * distintos hacia el mismo `if`: el testigo que prende el **radio** y el que
 * prende **`abrirEditar`**.
 *
 * ⚠️ **Esta tabla ya estuvo mal dos veces, siempre por lo mismo:** se escribió con
 * un conteo de tests y después se agregaron tests sin volver a medirla. Si sumás
 * un caso a este bloque, **volvé a correr los mutantes** — no alcanza con agregar
 * una fila.
 *
 * 📌 **El tipo se elige emitiendo `update:modelValue` en el `USelectMenu`, no
 * abriendo su popup.** Se intentó por el DOM y jsdom **mata al worker** con un
 * `Maximum call stack size exceeded` al renderizar el listbox (medido
 * 2026-08-25). El contrato que ejercita este camino es el mismo que usa la
 * pantalla —el `@update:model-value` del template—, así que lo que se prueba es
 * la conducta, no un atajo: lo único que queda afuera es el render del popup,
 * que no es de esta feature. El radio de nivel SÍ se clickea por DOM, que ahí
 * funciona.
 */
describe('configuracion/descuentos — el tipo empuja el nivel, sin bloquearlo', () => {
  beforeEach(() => {
    reset()
    // ⚠️ `UModal` teletransporta su contenido al `body` y **desmontar el wrapper
    // no lo saca**: los drawers de los describes anteriores quedan ahí. Sin esta
    // limpieza, `dialogo()` —que devuelve el PRIMERO— entrega el drawer de
    // "Editar descuento" de otro test y este bloque mide la pantalla equivocada.
    // Medido: el test fallaba en la suite completa y pasaba aislado, que es la
    // firma de la contaminación y no del código.
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  /** Radio del drawer por su `value`. Reka UI los rinde como `button[role=radio]`. */
  function radioNivel(valor: string): HTMLElement {
    const el = dialogo()?.querySelector<HTMLElement>(`[role="radio"][value="${valor}"]`)
    expect(el, `radio de nivel "${valor}"`).toBeTruthy()
    return el!
  }

  function nivelElegido(): string | null {
    for (const valor of ['linea', 'venta']) {
      if (radioNivel(valor).getAttribute('aria-checked') === 'true') return valor
    }
    return null
  }

  async function abrirCrear(wrapper: Awaited<ReturnType<typeof montar>>) {
    useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
    const boton = wrapper.findAll('button').find(b => b.text().includes('Nuevo'))
    expect(boton, 'botón "Nuevo descuento"').toBeTruthy()
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
  }

  async function guardar(wrapper: Awaited<ReturnType<typeof montar>>) {
    const boton = [...(dialogo()?.querySelectorAll<HTMLElement>('button') ?? [])]
      .find(b => b.textContent?.trim() === 'Guardar')
    expect(boton, 'botón "Guardar" del drawer').toBeTruthy()
    boton!.click()
    await new Promise(r => setTimeout(r, 60))
    void wrapper
  }

  async function elegirTipo(
    wrapper: Awaited<ReturnType<typeof montar>>,
    tipoReglaId: string,
  ) {
    const select = wrapper.findComponent({ name: 'USelectMenu' })
    expect(select.exists(), 'USelectMenu del campo Tipo').toBe(true)
    select.vm.$emit('update:modelValue', tipoReglaId)
    await new Promise(r => setTimeout(r, 20))
  }

  it('elegir "Por monto de venta" mueve el radio a Al total de la venta', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)

    expect(nivelElegido()).toBe('linea')

    await elegirTipo(wrapper, 'tipo-2')

    expect(nivelElegido()).toBe('venta')

    wrapper.unmount()
  })

  /**
   * ⚠️ **`resetDrawer` APAGA el testigo, y sin esa línea el bug original vuelve en
   * silencio.** Camino: editar una regla —que lo prende— y después arrancar una
   * nueva. Si el testigo siguiera prendido, el tipo ya no empujaría nada en la
   * regla nueva y nada fallaría.
   *
   * Medido: quitar la línea de `resetDrawer` deja el resto de la suite en verde.
   *
   * 📌 **Va por "Nuevo" y no por "Cancelar" a propósito.** Los dos caminos pasan
   * por `resetDrawer` —`abrirCrear` lo llama directo, y cerrar lo llama por el
   * `watch(drawerOpen)`— así que el mutante cae igual. Pero cerrar dispara la
   * animación de salida de Reka UI (`usePresence`), y en jsdom eso tira un
   * `TypeError: Receiver must be an instance of class CSSStyleDeclaration` como
   * **rechazo no capturado**: la suite reporta todo verde y sale con código 1, o
   * sea que CI falla sin que ningún test falle. Medido el 2026-08-25.
   */
  it('arrancar una regla nueva después de editar vuelve a habilitar el empujón', async () => {
    const wrapper = await montar()
    // Editar prende el testigo.
    await abrirEdicionDeLaFila(wrapper)

    await abrirCrear(wrapper)
    expect(nivelElegido()).toBe('linea')

    await elegirTipo(wrapper, 'tipo-2')

    expect(nivelElegido()).toBe('venta')

    wrapper.unmount()
  })

  /**
   * ⚠️ **El camino que más caro sale si se rompe, y el que menos se piensa.** Una
   * regla que YA existe tomó su decisión de nivel cuando se creó; si cambiarle el
   * tipo se la diera vuelta sola, cambiaría **en silencio contra qué se mide** —o
   * sea cuánta plata cobra— en una regla que ya está en uso.
   *
   * Lo sostiene que `abrirEditar` prende el testigo DESPUÉS de poblar el form:
   * para el drawer, editar es "el nivel ya fue elegido".
   */
  it('editar una regla y cambiarle el tipo NO le da vuelta el nivel', async () => {
    // La regla vive en nivel línea. Su tipo pasa a uno que sugiere venta.
    descuentosBackend = [descuento({ nivel: 'linea' })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    expect(nivelElegido()).toBe('linea')

    await elegirTipo(wrapper, 'tipo-2')

    expect(nivelElegido()).toBe('linea')

    wrapper.unmount()
  })

  it('si el usuario ya eligió el nivel a mano, el tipo no lo pisa', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)

    // El caso del vino: nivel línea a mano, y DESPUÉS el tipo por monto de venta.
    radioNivel('linea').click()
    await new Promise(r => setTimeout(r, 20))

    await elegirTipo(wrapper, 'tipo-2')

    expect(nivelElegido()).toBe('linea')

    wrapper.unmount()
  })

  /**
   * ⚠️ **El pago VISIBLE de todo el cambio del backend**, y hasta acá se podía
   * borrar entero sin que la suite se enterara (medido cuando este archivo tenía
   * 33 tests: sacar el `description: await descripcionDeUso()` los dejaba a los
   * 33 en verde. Hoy son más, y ese mutante **cae**).
   *
   * ⚠️ **Alcance real de estos dos tests, para no sobrevenderlos:** afirman que
   * la pantalla CONSULTA el uso en la transición que produce el 400, y que no lo
   * consulta fuera de ella. **No afirman el texto del toast**: `mountSuspended`
   * monta la página sin `UApp`, así que los toasts no tienen dónde renderizar y
   * ningún test de este archivo mira su contenido. El texto —incluido el sufijo
   * *(en la papelera)*— lo fija `useNivelRegla.nuxt.spec.ts`, que prueba la
   * cadena en aislamiento.
   *
   * Entre los dos archivos queda cubierto el camino entero, y ninguno de los dos
   * cubre lo del otro: acá el CUÁNDO, allá el QUÉ.
   */
  it('al fallar el paso a nivel venta, consulta el uso para poder nombrar los ítems', async () => {
    usoPorId = {
      [DESCUENTO_ID]: [
        { id: 'i1', nombre: 'Café', eliminado: false },
        { id: 'i2', nombre: 'Torta vieja', eliminado: true },
      ],
    }
    patchGuardarFalla = true
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    // La transición que produce el 400: la regla es de línea y pasa a venta.
    radioNivel('venta').click()
    await new Promise(r => setTimeout(r, 20))
    await guardar(wrapper)

    expect(getsUso).toEqual([DESCUENTO_ID])

    wrapper.unmount()
  })

  // La otra mitad de la condición: un guardado que NO es esa transición no paga
  // la consulta extra. Sin esto, "pedirla siempre" pasaría el test de arriba.
  it('un guardado que no cambia el nivel no consulta el uso', async () => {
    usoPorId = { [DESCUENTO_ID]: [{ id: 'i1', nombre: 'Café', eliminado: false }] }
    patchGuardarFalla = true
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    // Sin tocar el nivel: sigue en línea.
    await guardar(wrapper)

    expect(getsUso).toEqual([])

    wrapper.unmount()
  })
})

/**
 * Cambiar el tipo de una regla a uno que no usa escalones **borra** los que
 * tenía, porque el backend rechaza con 400 la fila que dice dos cosas
 * (`validarValorUnico`, 2026-08-26) y solo reemplaza los hijos que vengan en el
 * body. El owner eligió **avisar antes** de borrarlos (2026-08-26).
 *
 * Es de RUNTIME y por eso vive acá: el freno depende de `escalonesGuardados`,
 * que se llena al abrir la edición y que `onTipoChange` **no** puede reponer —
 * cuando el usuario elige el tipo nuevo, el formulario ya vació sus escalones y
 * la sección donde se veían desapareció de la pantalla—. Ni el build ni el
 * typecheck ven eso.
 *
 * `abrirEdicionDeLaFila` se extrajo a nivel módulo al escribir este describe:
 * era su TERCER uso, y `CLAUDE.md` manda extraer a la tercera. `elegirTipo`
 * sigue duplicado —va por la segunda— y por eso queda local.
 */
describe('configuracion/descuentos — cambiar a un tipo sin escalones avisa antes de borrarlos', () => {
  beforeEach(() => {
    // Una regla POR ESCALONES, que es la única que tiene algo que perder.
    descuentosBackend = [descuento({
      tipoReglaId: 'tipo-2',
      valorPorcentaje: null,
      tramos: [{ minimo: '50000', valorMonto: null, valorPorcentaje: '0.10' }],
    })]
    reset()
    patchesGuardar = []
    // ⚠️ El PATCH rechaza A PROPÓSITO, y no es para probar el error: es para que
    // el drawer NO se cierre. Cerrarlo dispara la animación de salida de Reka UI
    // (`usePresence`) y en happy-dom eso tira un `TypeError: Receiver must be an
    // instance of class CSSStyleDeclaration` como **rechazo no capturado** — la
    // suite reporta todo verde y sale con código 1, o sea CI en rojo sin ningún
    // test fallado. Ya pasó el 2026-08-25 en el describe del nivel.
    // El body igual queda registrado: el fake lo empuja ANTES de rechazar.
    patchGuardarFalla = true
    // Ver la nota de contaminación del describe del nivel: `UModal` teletransporta
    // al `body` y desmontar el wrapper no lo saca.
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  async function elegirTipo(wrapper: Awaited<ReturnType<typeof montar>>, id: string) {
    const select = wrapper.findComponent({ name: 'USelectMenu' })
    expect(select.exists(), 'USelectMenu del campo Tipo').toBe(true)
    select.vm.$emit('update:modelValue', id)
    await new Promise(r => setTimeout(r, 20))
  }

  /** El drawer y el modal comparten el `[role=dialog]`; el drawer es el primero. */
  function botonPorTexto(texto: string): HTMLElement | undefined {
    const nodos = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"] button')]
    return nodos.find(b => b.textContent?.trim() === texto)
  }

  async function clickGuardar() {
    const boton = botonPorTexto('Guardar')
    expect(boton, 'botón "Guardar" del drawer').toBeTruthy()
    boton!.click()
    await new Promise(r => setTimeout(r, 60))
  }

  it('frena con el aviso en vez de guardar', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-1')

    await clickGuardar()

    expect(document.body.textContent).toContain('El tipo nuevo no usa ese importe')
    // Lo que importa no es el texto sino que NO guardó: si el modal apareciera
    // después del PATCH, el aviso llegaría tarde.
    expect(patchesGuardar).toEqual([])

    wrapper.unmount()
  })

  it('y al confirmar manda `tramos: []` para limpiar los huérfanos', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-1')
    await clickGuardar()

    const confirmar = botonPorTexto('Guardar y borrar')
    expect(confirmar, 'botón de confirmación del aviso').toBeTruthy()
    confirmar!.click()
    await new Promise(r => setTimeout(r, 60))

    expect(patchesGuardar).toHaveLength(1)
    // La key TIENE que viajar: omitirla deja los escalones vivos y el backend
    // contesta 400 — que es exactamente lo que este flujo existe para evitar.
    expect(patchesGuardar[0]?.body.tramos).toEqual([])

    wrapper.unmount()
  })

  /**
   * La otra mitad de la condición. Sin esta ancla, un modal que apareciera
   * SIEMPRE pasaría los dos tests de arriba, y el usuario tendría que confirmar
   * un borrado inexistente en cada guardado — que es la forma más rápida de
   * enseñar a confirmar sin leer.
   */
  it('una regla sin escalones guarda derecho, sin preguntar nada', async () => {
    descuentosBackend = [descuento({ tipoReglaId: 'tipo-1', valorPorcentaje: '0.10', tramos: [] })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    await clickGuardar()

    expect(document.body.textContent).not.toContain('El tipo nuevo no usa ese importe')
    expect(patchesGuardar).toHaveLength(1)

    wrapper.unmount()
  })

  /**
   * La dirección ESPEJO, que la primera versión de este frente dejó rota: pasar
   * de un tipo de valor único a uno POR ESCALONES. El campo del valor tampoco
   * está en pantalla en el tipo nuevo (`campoValor: false`), así que el usuario
   * no puede borrarlo a mano; y si el body no manda la columna, el backend lee
   * la PERSISTIDA (`importeResultante`) y contesta 400 nombrando un campo que
   * no se ve. Lo cazó la revisión independiente midiendo contra la API.
   */
  it('la dirección espejo también avisa', async () => {
    descuentosBackend = [descuento({ tipoReglaId: 'tipo-1', valorPorcentaje: '0.10' })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-2')

    await clickGuardar()

    expect(document.body.textContent).toContain('un valor único cargado')
    expect(patchesGuardar).toEqual([])

    wrapper.unmount()
  })

  it('y al confirmar apaga la columna del valor', async () => {
    descuentosBackend = [descuento({ tipoReglaId: 'tipo-1', valorPorcentaje: '0.10' })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-2')
    await clickGuardar()

    const confirmar = botonPorTexto('Guardar y borrar')
    expect(confirmar, 'botón de confirmación del aviso').toBeTruthy()
    confirmar!.click()
    await new Promise(r => setTimeout(r, 60))

    expect(patchesGuardar).toHaveLength(1)
    // `onTipoChange` deja el modo en `monto_fijo` para un tipo `libre`, así que
    // la columna que el body tiene que apagar es `valorMonto`. El `null` TIENE
    // que viajar: omitirlo deja vivo el valor persistido y el backend da 400.
    expect(patchesGuardar[0]?.body.valorMonto).toBeNull()

    wrapper.unmount()
  })
})
