// @vitest-environment nuxt
//
// Sexta pantalla con papelera y TERCER caso de la salida de colisión, tras
// `descuentos` (el molde) y `recargos`. `turnos` cierra la familia que
// garantiza la unicidad de nombre solo por código; los 5 que faltan la
// garantizan por índice único parcial y detectan el choque capturando el
// `23505`, o sea después de que falla el INSERT (`docs/agent/pendientes.md`).
//
// Lo PROPIO de esta pantalla, y por eso no alcanzaba con copiar el spec de
// `descuentos`: las otras tres son admin-only, `turnos` está gateada por
// permisos (`Salones`, porque no tiene módulo propio). El backend exige
// `Salones:Eliminar` para restaurar, así que la papelera entera —toggle
// incluido— tiene que estar detrás del mismo permiso: ofrecerla a quien no lo
// tiene es prometer una acción que termina en 403.
//
// El resto de los bugs que fija son de RUNTIME, los mismos del molde: el
// `eliminar()` que saca la fila con el toggle prendido, la carrera de
// `cargar()`, el doble submit del restaurar, y el 400 de colisión tratado como
// error terminal en vez de como pregunta.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Turnos from './turnos.vue'

const TURNO_ID = 'turno-1'
const BORRADO_EL = '2026-08-01T21:00:00.000Z'

interface TurnoFake {
  id: string
  nombre: string
  horaInicio: string
  horaFin: string
  activo: boolean
  creadoEl: string
  actualizadoEl: string
  eliminadoEl: string | null
  eliminadoPorNombre: string | null
}

function turno(over: Partial<TurnoFake> = {}): TurnoFake {
  return {
    id: TURNO_ID,
    nombre: 'Almuerzo',
    horaInicio: '12:00',
    horaFin: '16:00',
    activo: true,
    creadoEl: '2026-07-01T10:00:00.000Z',
    actualizadoEl: '2026-07-01T10:00:00.000Z',
    eliminadoEl: null,
    eliminadoPorNombre: null,
    ...over,
  }
}

function eliminado(over: Partial<TurnoFake> = {}): TurnoFake {
  return turno({
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

let turnosBackend: TurnoFake[] = []
let overrideConEliminados: Promise<unknown[]> | null = null
let overrideSinEliminados: Promise<unknown[]> | null = null
let postsRestaurar: { id: string, nombre?: string }[] = []
let restaurarRetenido: Promise<unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: { nombre?: string } }) => {
    if (typeof url !== 'string' || !url.includes('/turnos')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      const t = turnosBackend.find(x => x.id === id)
      if (t) {
        t.eliminadoEl = BORRADO_EL
        t.eliminadoPorNombre = 'admin.paris'
      }
      return Promise.resolve(undefined)
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      const nombreNuevo = opts?.body?.nombre
      postsRestaurar.push({ id, nombre: nombreNuevo })
      const t = turnosBackend.find(x => x.id === id)
      // El backend real da 404 si la fila ya no está en la papelera: un
      // segundo POST sobre la misma fila NO es inocuo.
      if (!t?.eliminadoEl) {
        return Promise.reject(errorApi(`Turno ${id} no está en la papelera`))
      }
      const nombre = nombreNuevo ?? t.nombre
      const vivos = turnosBackend
        .filter(x => !x.eliminadoEl && x.id !== id)
        .map(x => x.nombre)
      if (vivos.includes(nombre)) {
        return Promise.reject(
          errorApi(
            `Ya existe un turno activo con el nombre "${nombre}".`,
            { nombreSugerido: sugerir(nombre.replace(/ \d+$/, ''), vivos) },
          ),
        )
      }
      t.eliminadoEl = null
      t.eliminadoPorNombre = null
      t.nombre = nombre
      if (restaurarRetenido) return restaurarRetenido
      return Promise.resolve(undefined)
    }
    const incluirEliminados = url.includes('incluirEliminados=true')
    if (incluirEliminados && overrideConEliminados) return overrideConEliminados
    if (!incluirEliminados && overrideSinEliminados) return overrideSinEliminados
    const data = incluirEliminados
      ? turnosBackend
      : turnosBackend.filter(t => !t.eliminadoEl)
    return Promise.resolve(data.map(t => ({ ...t })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Turnos)
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
 * Los badges "Eliminado" como ELEMENTO, no como subcadena del texto de la
 * página: un `toContain('Eliminado')` queda subsumido por "Eliminado por
 * <autor> el <fecha>" y no cazaría que borren el badge. Se filtra también el
 * badge de estado ("Activo"/"Inactivo"), que esta pantalla tiene y las otras no.
 */
function badges(wrapper: Awaited<ReturnType<typeof montar>>): string[] {
  return wrapper.findAll('tbody span')
    .map(s => s.text().trim())
    .filter(t => t === 'Eliminado')
}

async function abrirRestaurarDeLaFila(
  wrapper: Awaited<ReturnType<typeof montar>>,
) {
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
  esAdmin = true
  permisos = []
  overrideConEliminados = null
  overrideSinEliminados = null
  postsRestaurar = []
  restaurarRetenido = null
}

describe('configuracion/turnos — papelera: eliminar respeta el toggle', () => {
  beforeEach(() => {
    turnosBackend = [turno()]
    reset()
  })

  it('con "Ver eliminados" activo, borrar deja la fila visible como eliminada (no la saca de la lista)', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Almuerzo')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    // Ancla positiva primero: si `eliminar()` nunca llegó a pegarle al
    // backend, las aserciones de abajo pasarían vacuamente.
    expect(turnosBackend[0]!.eliminadoEl).toBeTruthy()
    expect(wrapper.text()).toContain('Almuerzo')
    expect(wrapper.text()).toContain('Eliminado por admin.paris')
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })

  it('con el toggle apagado, borrar SÍ saca la fila de la lista (comportamiento de siempre)', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Almuerzo')

    await wrapper.find('[title="Eliminar"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await confirmarEnModal('Eliminar')

    expect(wrapper.text()).not.toContain('Almuerzo')

    wrapper.unmount()
  })
})

// Lo propio de `turnos`: es la primera pantalla de la papelera gateada por
// permisos en vez de admin-only. El backend pide `Salones:Eliminar` para
// restaurar, así que la papelera entera va detrás del mismo permiso.
describe('configuracion/turnos — papelera: gateada por `Salones:Eliminar`', () => {
  beforeEach(() => {
    turnosBackend = [eliminado()]
    reset()
  })

  it('sin `Salones:Eliminar` no hay toggle "Ver eliminados"', async () => {
    esAdmin = false
    permisos = ['Salones:Leer', 'Salones:Crear', 'Salones:Actualizar']

    const wrapper = await montar()

    // Ancla positiva: la pantalla SÍ cargó y muestra sus otros controles, así
    // que la ausencia del toggle es un gate y no una pantalla vacía.
    expect(wrapper.text()).toContain('Turnos')
    expect(wrapper.findAll('button').some(b => b.text().includes('Nuevo turno'))).toBe(true)
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

describe('configuracion/turnos — papelera: restaurar', () => {
  beforeEach(() => {
    turnosBackend = [eliminado()]
    reset()
  })

  it('restaurar devuelve la fila al estado vivo sin recargar la página', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    expect(wrapper.text()).toContain('Eliminado por admin.paris')

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(turnosBackend[0]!.eliminadoEl).toBeNull()
    expect(wrapper.text()).toContain('Almuerzo')
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

    expect(postsRestaurar).toEqual([{ id: TURNO_ID, nombre: undefined }])

    wrapper.unmount()
    restaurarRetenido = null
  })

  // La contracara del modal de colisión: un error que NO trae `nombreSugerido`
  // sigue siendo terminal.
  it('un error SIN sugerencia no abre el modal de colisión: cierra y avisa', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    turnosBackend[0]!.eliminadoEl = null

    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(1)
    expect(document.body.textContent).not.toContain('No se puede restaurar con ese nombre')

    wrapper.unmount()
  })
})

describe('configuracion/turnos — papelera: colisión de nombre al restaurar', () => {
  beforeEach(() => {
    turnosBackend = [
      eliminado(),
      turno({ id: 'turno-vivo', nombre: 'Almuerzo', horaInicio: '13:00' }),
    ]
    reset()
  })

  it('el 400 abre el modal con la sugerencia precargada y confirmar restaura CON ese nombre', async () => {
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    // El primer POST viajó sin nombre y volvió 400: no restauró nada.
    expect(postsRestaurar).toEqual([{ id: TURNO_ID, nombre: undefined }])
    expect(turnosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)

    // Y en vez de un toast rojo, el modal con el nombre libre precargado.
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(document.body.textContent).toContain(
      'Ya existe un turno activo con el nombre "Almuerzo".',
    )
    expect(campoNombre().value).toBe('Almuerzo 2')

    await confirmarEnModal('Restaurar')

    expect(postsRestaurar).toHaveLength(2)
    expect(postsRestaurar[1]).toEqual({ id: TURNO_ID, nombre: 'Almuerzo 2' })
    expect(turnosBackend[0]!.eliminadoEl).toBeNull()
    expect(turnosBackend[0]!.nombre).toBe('Almuerzo 2')
    // Los dos conviven vivos, que es el punto de toda la salida.
    expect(wrapper.text()).toContain('Almuerzo 2')
    expect(badges(wrapper)).toHaveLength(0)

    wrapper.unmount()
  })

  it('si el usuario edita a un nombre TAMBIÉN tomado, vuelve el modal con la sugerencia siguiente', async () => {
    turnosBackend.push(
      turno({ id: 'turno-vivo-2', nombre: 'Almuerzo 2', horaInicio: '14:00' }),
    )
    const wrapper = await montar()
    await activarVerEliminados(wrapper)
    await abrirRestaurarDeLaFila(wrapper)
    await confirmarEnModal('Restaurar')

    expect(campoNombre().value).toBe('Almuerzo 3')
    await escribirNombre('Almuerzo 2')
    await confirmarEnModal('Restaurar')

    // No restauró, no cerró el modal, y la sugerencia se actualizó.
    expect(turnosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(document.body.textContent).toContain('No se puede restaurar con ese nombre')
    expect(campoNombre().value).toBe('Almuerzo 3')

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

    expect(turnosBackend[0]!.eliminadoEl).toBe(BORRADO_EL)
    expect(postsRestaurar).toHaveLength(1)
    expect(badges(wrapper)).toContain('Eliminado')

    wrapper.unmount()
  })
})

describe('configuracion/turnos — papelera: la carrera de `cargar()` bajo toggles rápidos', () => {
  beforeEach(() => {
    turnosBackend = [
      turno(),
      eliminado({ id: 'turno-2', nombre: 'Turno viejo', horaInicio: '20:00' }),
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
      turnosBackend.filter(t => !t.eliminadoEl).map(t => ({ ...t })),
    )
    await new Promise(r => setTimeout(r, 20))
    resolverConEliminados(turnosBackend.map(t => ({ ...t })))
    await new Promise(r => setTimeout(r, 50))

    // El toggle terminó APAGADO: el listado final tiene que reflejar ESE
    // estado, sin importar que la respuesta "con eliminados" haya llegado
    // después y en teoría pisara el estado.
    expect(wrapper.text()).toContain('Almuerzo')
    expect(wrapper.text()).not.toContain('Turno viejo')

    wrapper.unmount()
  })
})
