// @vitest-environment nuxt
//
// `recargos.vue` recibió el MISMO `onModoChange` que `descuentos.vue` y quedó sin
// test análogo: el código es simétrico y su spec seguía verde, que es justo el
// problema — la simetría es una intención, no una garantía, y nada avisa si una
// de las dos pantallas la pierde.
//
// Acá va solo esa conducta. El resto de la pantalla (papelera, carrera de
// `cargar()`, colisión de nombre) lo cubre `descuentos.nuxt.spec.ts`; duplicarlo
// entero sería copiar 800 líneas para cubrir 5.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Recargos from './recargos.vue'

interface ReglaFake {
  id: string
  nombre: string
  /** Ausente en las filas viejas del fixture: el backend las trata como `linea`. */
  nivel?: 'linea' | 'venta'
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

let recargosBackend: ReglaFake[] = []

/** `general` es el `modo: 'libre'` con `campoValor` de `RECARGO_CONFIG`: el tipo
 *  que hace rendir el radio Porcentaje/Monto fijo y el campo de importe, que
 *  desde el 2026-08-23 son DOS —`valorMonto` y `valorPorcentaje`, uno por modo—.
 *  Es el gemelo de `directo` en descuentos. */
const TIPOS_REGLA = [
  { id: 'tipo-1', nombre: 'General', codigo: 'general', descripcion: null },
  // Su `nivelSugerido` es `'venta'`: es el que empuja el radio "Se aplica".
  {
    id: 'tipo-2',
    nombre: 'Por monto de venta',
    codigo: 'recargo_por_monto_venta',
    descripcion: null,
  },
  // Entró el 2026-08-29 con los caminos nuevos de perder la forma de importe: es
  // el único tipo de recargos con las DOS banderas, o sea el único donde
  // aparece el radio "Cómo cobra".
  {
    id: 'tipo-3',
    nombre: 'Por método de pago',
    codigo: 'recargo_metodo_pago',
    descripcion: null,
  },
]

/** Sin la moneda oficial, `MoneyInput` no resuelve config y se rinde
 *  deshabilitado y vacío: el test pasaría por el motivo equivocado (vacío por
 *  apagado, no vacío por reseteado). */
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

/** Ítems que `GET /recargos/:id/uso` devuelve por id. Ausente = ninguno. */
let usoPorId: Record<string, { id: string, nombre: string, eliminado?: boolean }[]> = {}
/** Cada `GET .../uso` recibido: el testigo de CUÁNDO la pantalla lo consulta. */
let getsUso: string[] = []
/** Hace fallar el PATCH de guardado del drawer: el 400 del cambio de nivel. */
let patchGuardarFalla = false
/** Cada `PATCH` de guardado del drawer, con el body entero: es el único lugar
 *  donde se puede ver si la key `tramos` viajó, que es lo que limpia los
 *  escalones huérfanos al cambiar de tipo. */
let patchesGuardar: { id: string, body: Record<string, unknown> }[] = []

mockNuxtImport('useApiFetch', () => {
  return (
    url: string,
    opts?: { method?: string, body?: Record<string, unknown> },
  ) => {
    if (typeof url === 'string' && url.includes('/tipos-regla')) {
      return Promise.resolve(TIPOS_REGLA)
    }
    if (typeof url !== 'string' || !url.includes('/recargos')) {
      return Promise.resolve([])
    }
    const method = opts?.method ?? 'GET'
    // El drawer chequea el nombre ANTES de guardar y aborta si no está libre.
    // Sin esta rama el fake devuelve la lista, `res.disponible` queda `undefined`
    // y `guardar()` vuelve sin mandar nada: el test fallaría por otro motivo.
    if (method === 'GET' && url.includes('/nombre-disponible')) {
      return Promise.resolve({ disponible: true })
    }
    if (method === 'GET' && url.endsWith('/uso')) {
      const id = url.split('/').slice(-2)[0] ?? ''
      getsUso.push(id)
      return Promise.resolve({
        nivel: recargosBackend.find(x => x.id === id)?.nivel ?? 'linea',
        items: usoPorId[id] ?? [],
      })
    }
    // El toggle de la grilla y el drawer pegan al MISMO endpoint, y los dos
    // mandan `activo`. Lo que los separa es `nombre`: el drawer manda el form
    // entero, el toggle manda solo el switch.
    if (method === 'PATCH' && typeof opts?.body?.nombre === 'string') {
      patchesGuardar.push({
        id: url.split('/').pop() ?? '',
        body: opts.body,
      })
    }
    if (method === 'PATCH' && patchGuardarFalla) {
      return Promise.reject(
        Object.assign(new Error('No se puede pasar a nivel venta'), {
          data: { message: 'No se puede pasar a nivel venta' },
        }),
      )
    }
    return Promise.resolve(recargosBackend.map(r => ({ ...r })))
  }
})

async function montar() {
  const wrapper = await mountSuspended(Recargos)
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


function dialogo(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"]')
}

/**
 * Un radio del drawer por su `value`. Reka UI los rinde como
 * `button[role="radio"]`, no como `<input type=radio>`.
 *
 * Vive a nivel módulo porque lo usan tres describes —modo, nivel y, desde el
 * 2026-08-29, la forma de importe—: el tercer uso es el umbral que fija
 * `CLAUDE.md`. Gemelo de `radioPorValor` en `descuentos.nuxt.spec.ts`.
 */
function radioPorValor(valor: string): HTMLElement {
  const radio = dialogo()?.querySelector<HTMLElement>(`[role="radio"][value="${valor}"]`)
  expect(radio, `radio "${valor}" dentro del drawer`).toBeTruthy()
  return radio!
}

/**
 * Gemelo del de descuentos. ⚠️ **Cuál de los dos tests caza el bug cambió con las
 * columnas partidas:** el primero —de porcentaje a monto fijo— ya NO muere si se
 * apaga el reset, porque `abrirEditar` puebla `valorMonto` desde la fila y en una
 * regla de porcentaje eso es `null`: el campo aparece vacío haya reset o no. Queda
 * como ancla de render. **El que fija la conducta es el segundo** —volver a
 * porcentaje después de tipear un monto—. Medido apagando `onModoChange`.
 */
describe('configuracion/recargos — cambiar de modo no deja un valor de la otra escala', () => {
  beforeEach(() => {
    recargosBackend = [{
      id: 'rec-1',
      nombre: 'Recargo nocturno',
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
    }]
  })

  /** El input del campo "Valor" dentro del drawer, sea la rama MoneyInput o la
   *  de porcentaje: las dos rinden un `<input>` y solo una está montada. */
  function inputValor(): HTMLInputElement {
    const campos = [...(dialogo()?.querySelectorAll<HTMLInputElement>('input') ?? [])]
    const input = campos.find(i => i.getAttribute('inputmode') === 'decimal')
    expect(input, 'campo "Valor" dentro del drawer').toBeTruthy()
    return input!
  }

  async function clickModo(valor: string) {
    radioPorValor(valor).click()
    await new Promise(r => setTimeout(r, 20))
  }

  it('de porcentaje a monto fijo, el campo queda vacío en vez de mostrar 0 con 0.10 adentro', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    expect(inputValor().value).toBe('0.10')

    await clickModo('monto_fijo')

    const campo = inputValor()
    // Vacío por RESETEADO, no por apagado.
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

/**
 * El badge de vigencia (`useVigenciaRegla`, compartido con `descuentos.vue`) usa
 * exactamente el mismo `v-if`/`color`/`label` en las dos pantallas — la lógica de
 * `estadoVigencia` ya está cubierta a fondo en `descuentos.nuxt.spec.ts` (Vencida,
 * Programada, vigente sin badge, sin fechas). Acá va solo la comprobación de que
 * ESTA pantalla lo tiene cableado: mismo motivo que el describe de arriba —
 * "simétrico" es una intención del código, no una garantía, y esta pantalla ya
 * tuvo un caso donde perdió la simetría sin que nada avisara.
 */
describe('configuracion/recargos — badge de vigencia', () => {
  it('un recargo cuyo rango ya pasó se muestra como Vencida', async () => {
    recargosBackend = [{
      id: 'rec-2',
      nombre: 'Recargo temporada',
      tipoReglaId: 'tipo-1',
      modo: 'porcentaje',
      valorMonto: null,
      valorPorcentaje: '0.10',
      metodoPagoIds: [],
      tramos: [],
      diasVencimiento: null,
      fechaInicio: null,
      fechaFin: '2020-01-01',
      activo: true,
      eliminadoEl: null,
      eliminadoPorNombre: null,
    }]
    const wrapper = await montar()

    const textosBadge = wrapper.findAll('tbody span')
      .map(s => s.text().trim())
      .filter(t => t === 'Vencida' || t === 'Programada')
    expect(textosBadge).toEqual(['Vencida'])

    wrapper.unmount()
  })
})

// Mismo motivo que el bloque de arriba: el badge de nivel se agregó en las dos
// pantallas por copia, y la copia es lo que deriva. Acá va solo el badge — el
// modal de pausa y `usePausaRegla` son compartidos y los cubre
// `descuentos.nuxt.spec.ts`.
describe('configuracion/recargos — badge de nivel', () => {
  it('marca el recargo de nivel venta, y no marca el de línea', async () => {
    const base: ReglaFake = {
      id: 'rec-3',
      nombre: 'Recargo del total',
      nivel: 'venta',
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
    }

    recargosBackend = [base]
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Por venta')
    wrapper.unmount()

    recargosBackend = [{ ...base, nivel: 'linea' }]
    const otro = await montar()
    expect(otro.text()).not.toContain('Por venta')
    otro.unmount()
  })
})

/**
 * El gemelo de `configuracion/descuentos` — mismo bloque, mismo porqué.
 *
 * ⚠️ **Existe porque las dos pantallas son copias y el empujón está duplicado en
 * las dos** (`nivelTocado` / `onNivelChange` viven por página, no en un
 * composable). Con tests en una sola, la deriva entre gemelos no la vería nadie:
 * `recargos` podía quedarse sin el empujón —o con cualquiera de las tres líneas
 * del testigo mal— y la suite seguiría en verde. Lo mismo vale para
 * `descripcionDeUso`, que también vive por página: sus dos tests están más abajo.
 *
 * 📌 **Lo que SÍ se cubre una sola vez es lo que vive en código compartido**: el
 * filtro del modal de pausa (`usePausaRegla`) y el armado del mensaje
 * (`useNivelRegla`). La regla no es "descuentos vs recargos" sino **dónde vive el
 * código**: lo duplicado se prueba dos veces, lo compartido una.
 *
 * 📌 **Son cuatro casos, los mismos cuatro que el gemelo**, y cubren las tres
 * líneas del testigo: la que prende el radio, la que prende `abrirEditar` y la
 * que apaga `resetDrawer`. Una versión anterior de este bloque tenía solo tres
 * —le faltaba el de `resetDrawer`— mientras este mismo párrafo afirmaba cubrir
 * "el testigo mal": lo cazó la revisión independiente midiendo el mutante.
 *
 * ⚠️ **La tabla test↔mutante de `descuentos.nuxt.spec.ts` NO se aplica tal cual
 * acá**, y por eso no se remite a ella sin más: su última fila dice que quitar el
 * empujón entero mata DOS tests, y eso depende de qué tests tenga cada archivo.
 * Si tocás este bloque, medí los mutantes **sobre `recargos.vue`**. El porqué de
 * la decisión sí es común y vive allá.
 */
describe('configuracion/recargos — el tipo empuja el nivel, sin bloquearlo', () => {
  beforeEach(() => {
    recargosBackend = [{
      id: 'rec-1',
      nombre: 'Recargo nocturno',
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
      nivel: 'linea',
      eliminadoEl: null,
      eliminadoPorNombre: null,
    }]
    usoPorId = {}
    getsUso = []
    patchGuardarFalla = false
    // `UModal` teletransporta al `body` y desmontar el wrapper no lo saca: sin
    // esto, `dialogo()` entrega el drawer de otro describe. Medido en el gemelo.
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  const radioNivel = radioPorValor

  function nivelElegido(): string | null {
    for (const valor of ['linea', 'venta']) {
      if (radioNivel(valor).getAttribute('aria-checked') === 'true') return valor
    }
    return null
  }

  async function abrirCrear(wrapper: Awaited<ReturnType<typeof montar>>) {
    useMonedasStore().hydrate([MONEDA_CLP], 'tenant-1')
    const boton = wrapper.findAll('button').find(b => b.text().includes('Nuevo'))
    expect(boton, 'botón "Nuevo recargo"').toBeTruthy()
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

  /**
   * Se emite `update:modelValue` en el `USelectMenu` en vez de abrir su popup:
   * manejarlo por DOM en jsdom **mata al worker** con un `Maximum call stack size
   * exceeded`. Es el mismo contrato que usa el template.
   */
  async function elegirTipo(
    wrapper: Awaited<ReturnType<typeof montar>>,
    tipoReglaId: string,
  ) {
    const select = wrapper.findComponent({ name: 'USelectMenu' })
    expect(select.exists(), 'USelectMenu del campo Tipo').toBe(true)
    select.vm.$emit('update:modelValue', tipoReglaId)
    await new Promise(r => setTimeout(r, 20))
  }

  /**
   * ⚠️ **`descripcionDeUso` está duplicado en las dos pantallas** —vive en el
   * `.vue`, no en el composable, porque el CUÁNDO es propio de cada una— así que
   * sin estos dos, borrar `description: await descripcionDeUso()` de
   * `recargos.vue` dejaba la suite entera en verde. Es la misma deriva entre
   * gemelos que este bloque existe para cubrir; lo cazó la revisión independiente.
   *
   * El QUÉ (la cadena, el sufijo de papelera, el tope) lo fija
   * `useNivelRegla.nuxt.spec.ts`, que es compartido. Acá solo el cuándo.
   */
  it('al fallar el paso a nivel venta, consulta el uso para poder nombrar los ítems', async () => {
    usoPorId = { 'rec-1': [{ id: 'i1', nombre: 'Café', eliminado: false }] }
    patchGuardarFalla = true
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    radioNivel('venta').click()
    await new Promise(r => setTimeout(r, 20))
    await guardar(wrapper)

    expect(getsUso).toEqual(['rec-1'])

    wrapper.unmount()
  })

  it('un guardado que no cambia el nivel no consulta el uso', async () => {
    usoPorId = { 'rec-1': [{ id: 'i1', nombre: 'Café', eliminado: false }] }
    patchGuardarFalla = true
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    await guardar(wrapper)

    expect(getsUso).toEqual([])

    wrapper.unmount()
  })

  it('elegir "Por monto de venta" mueve el radio a Al total de la venta', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)

    expect(nivelElegido()).toBe('linea')
    await elegirTipo(wrapper, 'tipo-2')
    expect(nivelElegido()).toBe('venta')

    wrapper.unmount()
  })

  it('si el usuario ya eligió el nivel a mano, el tipo no lo pisa', async () => {
    const wrapper = await montar()
    await abrirCrear(wrapper)

    radioNivel('linea').click()
    await new Promise(r => setTimeout(r, 20))

    await elegirTipo(wrapper, 'tipo-2')
    expect(nivelElegido()).toBe('linea')

    wrapper.unmount()
  })

  /**
   * ⚠️ **La línea más silenciosa de las tres del testigo**: sin ella, el camino
   * *editar → arrancar uno nuevo* lo deja prendido y el default engañoso vuelve
   * —`recargo_por_monto_venta` naciendo en línea— sin que nada falle.
   *
   * Va por "Nuevo" y no por "Cancelar": cerrar dispara la animación de salida de
   * Reka UI y en jsdom eso tira un rechazo no capturado que hace salir la suite
   * en 1 con todo verde. Los dos caminos pasan por `resetDrawer` igual.
   */
  it('arrancar un recargo nuevo después de editar vuelve a habilitar el empujón', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    await abrirCrear(wrapper)
    expect(nivelElegido()).toBe('linea')

    await elegirTipo(wrapper, 'tipo-2')

    expect(nivelElegido()).toBe('venta')

    wrapper.unmount()
  })

  it('editar un recargo y cambiarle el tipo NO le da vuelta el nivel', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    expect(nivelElegido()).toBe('linea')
    await elegirTipo(wrapper, 'tipo-2')
    expect(nivelElegido()).toBe('linea')

    wrapper.unmount()
  })
})

/**
 * Perder la forma de importe que la fila tenía guardada **avisa antes**
 * (owner: 2026-08-26 el primer camino, 2026-08-29 los otros tres), porque el
 * backend rechaza con 400 la fila que dice dos cosas (`validarValorUnico`) y
 * solo reemplaza los hijos que vengan en el body.
 *
 * Gemelo del describe homónimo de `descuentos.nuxt.spec.ts`, y por el mismo
 * motivo que el resto de este archivo: la simetría entre las dos pantallas es
 * una intención, no una garantía, y nada avisa si una la pierde.
 *
 * ⚠️ **Una diferencia real, no una omisión:** el camino 3 —cambiar entre dos
 * tipos que los dos usan escalones— acá sale de `recargo_metodo_pago` en forma
 * "por escalones", no de dos tipos por escalones como en descuentos.
 * `RECARGO_CONFIG` tiene **un solo** tipo por escalones puro
 * (`recargo_por_monto_venta`), así que el par no existe de este lado.
 *
 * Es de RUNTIME y por eso vive acá: el freno depende de `escalonesGuardados`,
 * que se llena al abrir la edición y que `onTipoChange` **no** puede reponer —
 * cuando el usuario elige el tipo nuevo, el formulario ya vació sus escalones y
 * la sección donde se veían desapareció de la pantalla—. Ni el build ni el
 * typecheck ven eso.
 *
 * `abrirEdicionDeLaFila` y `radioPorValor` se extrajeron a nivel módulo al
 * escribir este describe: era el TERCER uso de cada uno, y `CLAUDE.md` manda
 * extraer a la tercera. ⚠️ La primera versión de este comentario decía que el
 * click de radio "iba por la segunda" y **era falso**: ya estaba en `clickModo`
 * y en `radioNivel`, o sea que éste era el tercero — un conteo escrito de
 * memoria en vez de grepeado, cazado por la revisión del diff integrado.
 * `elegirTipo` sí va por la segunda y por eso queda local.
 */
describe('configuracion/recargos — perder la forma de importe avisa por los cuatro caminos', () => {
  beforeEach(() => {
    // Una regla POR ESCALONES, que es la única que tiene algo que perder.
    recargosBackend = [fila({
      tipoReglaId: 'tipo-2',
      valorPorcentaje: null,
      tramos: [{ minimo: '50000', valorMonto: null, valorPorcentaje: '0.10' }],
    })]
    getsUso = []
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

  /** Este spec no tiene factory de filas; ésta cubre solo lo que el describe
   *  necesita. */
  function fila(over: Partial<ReglaFake> = {}): ReglaFake {
    return {
      id: 'rec-1',
      nombre: 'Recargo por monto',
      tipoReglaId: 'tipo-2',
      modo: 'porcentaje',
      valorMonto: null,
      valorPorcentaje: null,
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

  /** El radio "Cómo cobra", que solo existe en los tipos que ELIGEN forma
   *  (`recargo_metodo_pago` acá) y que es el gesto del segundo camino. */
  async function elegirForma(valor: 'valor' | 'tramos') {
    radioPorValor(valor).click()
    await new Promise(r => setTimeout(r, 20))
  }

  /** El campo "Valor" del drawer, en su rama de porcentaje. Con la forma en "un
   *  valor único" la sección de escalones no está montada, así que es el único
   *  input con `inputmode="decimal"` adentro del drawer. */
  async function tipearValor(valor: string) {
    const input = dialogo()?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    expect(input, 'campo "Valor" dentro del drawer').toBeTruthy()
    input!.value = valor
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
  }

  /** Dos escalones, no uno: el aviso tiene que decir el número REAL, y con uno
   *  solo un `2` hardcodeado pasaría igual. */
  const DOS_ESCALONES = [
    { minimo: '50000', valorMonto: null, valorPorcentaje: '0.10' },
    { minimo: '90000', valorMonto: null, valorPorcentaje: '0.15' },
  ]

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
    recargosBackend = [fila({ tipoReglaId: 'tipo-1', valorPorcentaje: '0.10' })]
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
    recargosBackend = [fila({ tipoReglaId: 'tipo-1', valorPorcentaje: '0.10' })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-2')

    await clickGuardar()

    expect(document.body.textContent).toContain('un valor único cargado')
    expect(patchesGuardar).toEqual([])

    wrapper.unmount()
  })

  it('y al confirmar apaga la columna del valor', async () => {
    recargosBackend = [fila({ tipoReglaId: 'tipo-1', valorPorcentaje: '0.10' })]
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

  // ── Camino 2: el radio de forma, en los tipos que ELIGEN ──────────────────
  //
  // Hasta el 2026-08-29 este camino borraba los escalones **sin preguntar**
  // (decisión del 2026-08-25), y era la asimetría que abrió la entrada del
  // backlog: la misma pérdida preguntaba por un camino y no por el otro.

  it('mover el radio a "un valor único" también avisa, y dice cuántos escalones', async () => {
    recargosBackend = [fila({ tipoReglaId: 'tipo-3', tramos: DOS_ESCALONES })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    await elegirForma('valor')
    await clickGuardar()

    // El número sale de la fila, no de una constante del código.
    expect(document.body.textContent).toContain('tiene 2 escalones')
    // Y no dice "el tipo": acá el tipo no cambió, cambió la forma.
    expect(document.body.textContent).toContain('La forma de importe que quedó elegida no lo usa')
    expect(patchesGuardar).toEqual([])

    wrapper.unmount()
  })

  it('y al confirmar manda `tramos: []`, que es lo que de verdad los borra', async () => {
    recargosBackend = [fila({ tipoReglaId: 'tipo-3', tramos: DOS_ESCALONES })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirForma('valor')
    // El valor único va ANTES de confirmar, y no es decoración: es el flujo
    // real. Sin él el body viaja con `valorPorcentaje: ''`, que muere en el
    // `ValidationPipe` (`@IsOptional()` saltea `null`/`undefined`, no `''`), o
    // sea que el borrado que el modal promete nunca llega a pasar y el test
    // congelaría como correcto un estado que la API rechaza. Lo levantó la
    // revisión independiente.
    await tipearValor('0.03')
    await clickGuardar()

    const confirmar = botonPorTexto('Guardar y borrar')
    expect(confirmar, 'botón de confirmación del aviso').toBeTruthy()
    confirmar!.click()
    await new Promise(r => setTimeout(r, 60))

    expect(patchesGuardar).toHaveLength(1)
    expect(patchesGuardar[0]?.body.tramos).toEqual([])
    expect(patchesGuardar[0]?.body.valorPorcentaje).toBe('0.03')

    wrapper.unmount()
  })

  /**
   * La dirección espejo del camino 2, que la entrada del backlog nunca nombró
   * —enumeraba solo "mover el radio a valor único"—.
   */
  it('y el espejo: mover el radio a "por escalones" avisa por el valor único', async () => {
    recargosBackend = [fila({ tipoReglaId: 'tipo-3', valorPorcentaje: '0.10' })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    await elegirForma('tramos')
    await clickGuardar()

    expect(document.body.textContent).toContain('un valor único cargado')
    expect(document.body.textContent).toContain('La forma de importe que quedó elegida no lo usa')
    expect(patchesGuardar).toEqual([])

    wrapper.unmount()
  })

  // ── Camino 3: el tipo nuevo también usa escalones, y la sección queda vacía ─

  /**
   * `recargo_metodo_pago` en forma "por escalones" (tipo-3) →
   * `recargo_por_monto_venta` (tipo-2): los dos usan escalones, así que la
   * sección NO desaparece; `onTipoChange` la deja vacía y el guardado se iba
   * derecho al 400 *"requiere al menos un tramo"*. Ese 400 sigue siendo del
   * backend y no se toca: lo que cambia es que el usuario se entera antes.
   */
  it('cambiar a otro tipo que también usa escalones avisa, con la sección a la vista', async () => {
    recargosBackend = [fila({ tipoReglaId: 'tipo-3', tramos: DOS_ESCALONES })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-2')

    await clickGuardar()

    expect(document.body.textContent).toContain('tiene 2 escalones, y el formulario quedó sin ninguno')
    // El único de los cuatro que NO promete un borrado, porque no lo hay: el
    // backend rechaza el guardado vacío y la fila queda como estaba.
    expect(botonPorTexto('Guardar igual'), 'botón "Guardar igual"').toBeTruthy()
    expect(botonPorTexto('Guardar y borrar'), 'el label del borrado NO va acá').toBeFalsy()
    expect(patchesGuardar).toEqual([])

    wrapper.unmount()
  })

  /**
   * El ancla del camino 3, y la que evita el modal que sale siempre: el aviso
   * mira lo que quedó EN EL FORMULARIO, no el cambio de tipo.
   */
  it('pero volver a cargar un escalón lo apaga', async () => {
    recargosBackend = [fila({ tipoReglaId: 'tipo-3', tramos: DOS_ESCALONES })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-2')

    const agregar = botonPorTexto('Agregar tramo')
    expect(agregar, 'botón "Agregar tramo" de la sección de escalones').toBeTruthy()
    agregar!.click()
    await new Promise(r => setTimeout(r, 20))

    await clickGuardar()

    expect(document.body.textContent).not.toContain('quedó sin ninguno')
    expect(patchesGuardar).toHaveLength(1)

    wrapper.unmount()
  })

  /**
   * La otra ancla: una regla POR ESCALONES que no cambia nada tiene
   * `escalonesGuardados > 0` todo el tiempo. Si el camino 3 mirara el tipo en
   * vez del formulario, el modal saldría en CADA guardado.
   */
  it('un recargo por escalones que no cambia nada guarda derecho, sin preguntar', async () => {
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)

    await clickGuardar()

    expect(document.body.textContent).not.toContain('quedó sin ninguno')
    expect(document.body.textContent).not.toContain('no usa ese importe')
    expect(patchesGuardar).toHaveLength(1)

    wrapper.unmount()
  })

  // ── Camino 4: el tipo nuevo ELIGE forma, y el radio queda en "valor único" ─

  /**
   * `recargo_por_monto_venta` (tipo-2) → `recargo_metodo_pago` (tipo-3). Es el
   * camino que la entrada del backlog **no enumeraba** y que apareció al
   * implementar los otros tres: nadie mueve el radio —`onTipoChange` lo deja en
   * "un valor único"—, la sección desaparece y los escalones se borraban
   * callados. Owner, 2026-08-29: avisa como los demás.
   */
  it('el cuarto camino también avisa: cambiar a un tipo que ELIGE forma', async () => {
    recargosBackend = [fila({ tipoReglaId: 'tipo-2', tramos: DOS_ESCALONES })]
    const wrapper = await montar()
    await abrirEdicionDeLaFila(wrapper)
    await elegirTipo(wrapper, 'tipo-3')

    await clickGuardar()

    expect(document.body.textContent).toContain('tiene 2 escalones')
    // Dice "la forma", no "el tipo": el tipo nuevo SÍ usa escalones. Lo que no
    // los usa es la forma en la que el cambio de tipo dejó el radio.
    expect(document.body.textContent).toContain('La forma de importe que quedó elegida no lo usa')
    expect(patchesGuardar).toEqual([])

    wrapper.unmount()
  })
})
