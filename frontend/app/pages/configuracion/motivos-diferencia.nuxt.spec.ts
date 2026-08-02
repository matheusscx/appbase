// @vitest-environment nuxt
//
// Réplica del molde de `causas-merma.nuxt.spec.ts` para `motivos-diferencia`: la
// papelera (toggle "ver eliminados" + badge + botón Restaurar + modal de
// colisión de nombre). Los bugs que este spec fija son de RUNTIME: ni el
// build, ni el typecheck, ni una revisión de código los ven.
//   1. `eliminar()` sacando la fila del array local con el toggle prendido: la
//      fila desaparece en vez de pasar a "eliminada", justo el caso que el
//      toggle existe para mostrar.
//   2. La carrera de `cargar()` bajo toggles rápidos: gana el que responde
//      último, no el que se disparó último.
//   3. Doble submit al restaurar: el modal no se cierra durante el POST, así
//      que un segundo click manda un segundo `POST .../restaurar` sobre una
//      fila ya revivida → 404 → toast de ERROR encima de un éxito.
//   4. El 400 de colisión NO es un toast rojo sino un segundo modal con un
//      nombre libre editable. Si el catch lo tratara como error terminal, el
//      usuario quedaría sin salida más que renombrar a mano la fila viva que
//      le ocupa el nombre.
// Se prueba el síntoma observable en el DOM, no la implementación.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import MotivosDiferencia from './motivos-diferencia.vue'

const MOTIVO_ID = 'motivo-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface MotivoDiferenciaFake {
  id: string
  nombre: string
  activo: boolean
  requiereComentario: boolean
  esFijo: boolean
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function motivo(over: Partial<MotivoDiferenciaFake> = {}): MotivoDiferenciaFake {
  return {
    id: MOTIVO_ID,
    nombre: 'Error de vuelto',
    activo: true,
    requiereComentario: false,
    esFijo: false,
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function eliminado(over: Partial<MotivoDiferenciaFake> = {}): MotivoDiferenciaFake {
  return motivo({
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
let motivosBackend: MotivoDiferenciaFake[] = []

// Para el test de la carrera: retiene la respuesta de cada variante del `GET`
// en una promesa que el test resuelve a mano, en el orden que quiera.
// `null` = comportamiento normal (resuelve contra `motivosBackend`).
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null

/** Cada `POST .../restaurar` recibido, con el nombre que viajó (o `undefined`
 *  si el body no fue): el contador del doble submit y el testigo del renombre. */
let postsRestaurar: { id: string, nombre?: string }[] = []
/** Retiene la respuesta del restaurar para dejar el POST "en vuelo". */
let restaurarRetenido: Promise<unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: { nombre?: string } }) => {
    if (typeof url !== 'string' || !url.includes('/motivos-diferencia')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const m = motivosBackend.find(x => x.id === id)
      if (m) {
        m.eliminadoEl = BORRADO_EL
        m.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      const nombreNuevo = opts?.body?.nombre
      postsRestaurar.push({ id, nombre: nombreNuevo })
      const m = motivosBackend.find(x => x.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo, es el toast de error
      // que el guard de reentrancia existe para evitar.
      if (!m?.eliminadoEl) {
        return Promise.reject(
          errorApi(`Motivo de diferencia ${id} no está en la papelera`),
        )
      }
      const nombre = nombreNuevo ?? m.nombre
      const vivos = motivosBackend
        .filter(x => !x.eliminadoEl && x.id !== id)
        .map(x => x.nombre)
      if (vivos.includes(nombre)) {
        return Promise.reject(
          errorApi(
            `Ya existe un motivo de diferencia activo con el nombre "${nombre}".`,
            { nombreSugerido: sugerir(nombre.replace(/ \d+$/, ''), vivos) },
          ),
        )
      }
      m.eliminadoEl = null
      m.eliminadoPorNombre = null
      m.nombre = nombre
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? motivosBackend
      : motivosBackend.filter(m => !m.eliminadoEl)
    return Promise.resolve(data.map(m => ({ ...m })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(MotivosDiferencia)
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
 * párrafo "Eliminado por <autor> el <fecha>" que va debajo (y del badge
 * "Fijo" que puede convivir en la misma fila): un `toContain('Eliminado')`
 * sobre el texto de la página queda SUBSUMIDO por ese párrafo, así que borrar
 * el badge entero no lo pondría rojo.
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
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurar = []
  restaurarRetenido = null
}

describe('configuracion/motivos-diferencia — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    motivosBackend = [motivo()]
    reset()
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Error de vuelto')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(motivosBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Error de vuelto')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Error de vuelto')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Error de vuelto')

    wrapper.unmount()
  })

  it('el switch de activo está deshabilitado en una fila eliminada', async () => {
    motivosBackend = [eliminado()]
    const wrapper = await montar()
    await activarVerEliminados(wrapper)

    const sw = wrapper.findAll('tbody button[role="switch"]')
    expect(sw).toHaveLength(1)
    expect(sw[0]!.attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })
})

describe('configuracion/motivos-diferencia — papelera: restaurar', () => {
  beforeEach(() => {
    motivosBackend = [eliminado()]
    reset()
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(motivosBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Error de vuelto')
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

    expect(postsRestaurar).toEqual([{ id: MOTIVO_ID, nombre: undefined }])

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
    motivosBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(1)
    expect(document.body.textContent).not.toContain('No se puede restaurar con ese nombre')

    wrapper.unmount()
  })
})

// El backend devuelve 400 con `nombreSugerido` cuando el nombre de la fila
// borrada ya lo tomó una viva; la pantalla tiene que ofrecer ese nombre
// —editable— en vez de dejar al usuario sin salida.
describe('configuracion/motivos-diferencia — papelera: colisión de nombre al restaurar', () => {
  beforeEach(() => {
    motivosBackend = [
      eliminado(),
      motivo({ id: 'motivo-vivo', nombre: 'Error de vuelto' }),
    ]
    reset()
  })

  it('el 400 abre el modal con la sugerencia precargada y confirmar restaura CON ese nombre', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // El primer POST viajó sin nombre y volvió 400: no restauró nada.
    expect(postsRestaurar).toEqual([{ id: MOTIVO_ID, nombre: undefined }])
    expect(motivosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)

    // Y en vez de un toast rojo, el modal con el nombre libre precargado.
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(document.body.textContent).toContain(
      'Ya existe un motivo de diferencia activo con el nombre "Error de vuelto".',
    )
    expect(campoNombre().value).toBe('Error de vuelto 2')

    await confirmarEnModal('Restaurar')

    // El segundo POST sí llevó el nombre, y la fila revivió renombrada.
    expect(postsRestaurar).toHaveLength(2)
    expect(postsRestaurar[1]).toEqual({ id: MOTIVO_ID, nombre: 'Error de vuelto 2' })
    expect(motivosBackend[0]!.eliminadoEl).toBeNull()
    expect(motivosBackend[0]!.nombre).toBe('Error de vuelto 2')
    // Los dos conviven vivos en la tabla, que es el punto de toda la salida.
    expect(wrapper.text()).toContain('Error de vuelto 2')
    expect(badges(wrapper)).toHaveLength(0)

    wrapper.unmount()
  })

  it('si el usuario edita a un nombre TAMBIÉN tomado, vuelve el modal con la sugerencia siguiente', async () => {
    motivosBackend.push(
      motivo({ id: 'motivo-vivo-2', nombre: 'Error de vuelto 2' }),
    )
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // Con "Error de vuelto" y "Error de vuelto 2" vivos, la primera
    // sugerencia salta al 3; el usuario lo pisa a mano con uno que está
    // ocupado.
    expect(campoNombre().value).toBe('Error de vuelto 3')
    await escribirNombre('Error de vuelto 2')
    await confirmarEnModal('Restaurar')

    // No restauró, no cerró el modal, y la sugerencia se actualizó.
    expect(motivosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(campoNombre().value).toBe('Error de vuelto 3')

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

    expect(motivosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(postsRestaurar).toHaveLength(1)
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })
})

describe('configuracion/motivos-diferencia — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    // Una viva y otra ya eliminada: así el `GET` con el flag trae algo
    // (Motivo viejo) que el `GET` sin el flag no trae, y las dos respuestas
    // son distinguibles en el DOM.
    motivosBackend = [
      motivo(),
      eliminado({ id: 'motivo-2', nombre: 'Motivo viejo' }),
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
      motivosBackend.filter(m => !m.eliminadoEl).map(m => ({ ...m })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(motivosBackend.map(m => ({ ...m })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Error de vuelto')
    expect(wrapper.text()).not.toContain('Motivo viejo')

    wrapper.unmount()
  })
})
