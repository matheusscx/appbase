// @vitest-environment nuxt
//
// El candado que pone el país sobre las dos perillas de redondeo. Los bugs que
// este spec fija son de RUNTIME —ni el build ni el typecheck ven que un control
// quedó tocable, ni que el motivo no se muestra—:
//   1. La perilla cerrada tiene que quedar DESHABILITADA. Sin eso el admin la
//      mueve, guarda y se come un 400 del backend que la pantalla no anticipó.
//   2. El motivo tiene que estar A LA VISTA. Un candado sin explicación se lee
//      como un bug del sistema, no como una regla del país.
//   3. Con la perilla cerrada, la pantalla muestra el valor que impone la
//      NORMA, no el guardado. Un tenant creado antes de que la regla existiera
//      tiene persistido otro valor: si la pantalla le mostrara ese, el backend
//      le rebotaría con 400 todos sus guardados —incluidos los de las demás
//      preferencias— y sin ninguna salida por la UI.
//   4. Sin ley, los dos controles siguen habilitados y sin aviso: el candado es
//      por perilla y por país, no una decoración permanente.
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import PreferenciasFinancieras from './preferencias-financieras.vue'

interface PrefsFake {
  calculoDescuentos: string
  calculoRecargos: string
  formula: string[]
  escalaCalculo: number
  modoRedondeo: string
  nivelRedondeo: string
  montoTolerancia: string
  umbralDescuadreAviso: string
  umbralDescuadreAlto: string
  promosAcumulanDescuentos: boolean
  modoRedondeoBloqueado: boolean
  modoRedondeoImpuesto: string | null
  modoRedondeoNorma: string | null
  nivelRedondeoBloqueado: boolean
  nivelRedondeoImpuesto: string | null
  nivelRedondeoNorma: string | null
}

/** Un tenant chileno: su país sugiere, no impone. Es el estado por defecto. */
function sinLey(over: Partial<PrefsFake> = {}): PrefsFake {
  return {
    calculoDescuentos: 'base',
    calculoRecargos: 'base',
    formula: ['descuentos', 'recargos', 'impuestos'],
    escalaCalculo: 6,
    modoRedondeo: 'HALF_UP',
    nivelRedondeo: 'linea',
    montoTolerancia: '0',
    umbralDescuadreAviso: '0',
    umbralDescuadreAlto: '0',
    promosAcumulanDescuentos: false,
    modoRedondeoBloqueado: false,
    modoRedondeoImpuesto: null,
    modoRedondeoNorma: null,
    nivelRedondeoBloqueado: false,
    nivelRedondeoImpuesto: null,
    nivelRedondeoNorma: null,
    ...over,
  }
}

let prefsBackend: PrefsFake = sinLey()
/** Lo que viajó en el `PUT`, para probar qué se guarda con la perilla cerrada. */
let guardado: Record<string, unknown> | null = null
/** El `PUT` rechaza: sirve para probar que el aviso NO se apaga con un error. */
let fallaElPut = false

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string' || !url.includes('/preferencias-financieras')) {
      return Promise.resolve([])
    }
    if ((opts?.method ?? 'GET') === 'PUT') {
      guardado = opts?.body ?? null
      if (fallaElPut) return Promise.reject(new Error('400 del backend'))
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ ...prefsBackend })
  }
})

/**
 * El `URadioGroup` que contiene la opción `valor` — 'HALF_UP' identifica al del
 * modo, 'linea' al del nivel. Se busca así y no por el label porque es el DOM
 * real de Reka: `role="radiogroup"` con `button[role=radio][value]` adentro.
 */
function grupo(wrapper: VueWrapper, valor: string) {
  const g = wrapper
    .findAll('[role="radiogroup"]')
    .find(el => el.findAll(`[role="radio"][value="${valor}"]`).length > 0)
  if (!g) throw new Error(`No encontré el radiogroup de "${valor}"`)
  return g
}

/** Deshabilitado de verdad: todos sus radios con `disabled` en el DOM. */
function deshabilitado(wrapper: VueWrapper, valor: string): boolean {
  const radios = grupo(wrapper, valor).findAll('[role="radio"]')
  expect(radios.length).toBeGreaterThan(0)
  return radios.every(r => r.attributes('disabled') !== undefined)
}

function marcado(wrapper: VueWrapper, valor: string): boolean {
  return (
    grupo(wrapper, valor)
      .find(`[role="radio"][value="${valor}"]`)
      .attributes('aria-checked') === 'true'
  )
}

/**
 * El motivo que muestra ESA perilla, o `''` si no muestra ninguno. Se sube
 * desde el radio hasta el `UFormField` que lo contiene y se lee su
 * `description` — contar la frase en la página entera no ataba el aviso a su
 * control, y dejaba pasar el candado explicado debajo de la perilla vecina.
 */
function motivo(wrapper: VueWrapper, valor: string): string {
  const radio = grupo(wrapper, valor)
    .find(`[role="radio"][value="${valor}"]`).element
  const campo = radio.closest('[data-slot="root"]:not([role="radiogroup"])')
  if (!campo) throw new Error(`No encontré el UFormField de "${valor}"`)
  return (
    campo.querySelector(
      ':scope > [data-slot="wrapper"] > [data-slot="description"]',
    )?.textContent ?? ''
  )
}

describe('preferencias financieras — el candado del país', () => {
  beforeEach(() => {
    prefsBackend = sinLey()
    guardado = null
    fallaElPut = false
  })

  it('con la perilla cerrada por ley, el control está deshabilitado y el motivo a la vista', async () => {
    prefsBackend = sinLey({
      modoRedondeo: 'HALF_EVEN',
      modoRedondeoBloqueado: true,
      modoRedondeoImpuesto: 'HALF_EVEN',
      modoRedondeoNorma: 'DIAN, anexo técnico v1.9 — norma técnica colombiana NTC 3711.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)

    expect(deshabilitado(wrapper, 'HALF_UP')).toBe(true)
    // El motivo se MUESTRA, no se oculta, y va debajo de SU perilla.
    expect(motivo(wrapper, 'HALF_UP')).toContain('NTC 3711')
    expect(motivo(wrapper, 'HALF_UP')).toContain('no se puede cambiar')
    // Lo guardado ya es lo que impone la norma: nada que avisar de más.
    expect(motivo(wrapper, 'HALF_UP')).not.toContain('todavía tiene otro valor')
    expect(motivo(wrapper, 'linea')).toBe('')
  })

  it('el candado es por PERILLA: la otra sigue abierta y sin aviso', async () => {
    // El control que descarta una pantalla que trabe todo cuando el país impone
    // algo. México fija el nivel y deja libre el modo; Argentina al revés. Si se
    // leyera "el tenant es de un país con ley", esto fallaría.
    //
    // La escala 4 no es decorado del fixture: un tenant que nace con
    // 'documento' nace con escala 4, y el backend rechaza 'documento' con
    // escala 6. Con la escala del default, este mock congelaría un estado que
    // el backend real no produce ni acepta.
    prefsBackend = sinLey({
      escalaCalculo: 4,
      nivelRedondeo: 'documento',
      nivelRedondeoBloqueado: true,
      nivelRedondeoImpuesto: 'documento',
      nivelRedondeoNorma: 'SAT, Anexo 20.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)

    expect(deshabilitado(wrapper, 'linea')).toBe(true)
    // El motivo del NIVEL es el del nivel, no el del modo: sin esta aserción,
    // colgarle la norma equivocada —o ninguna— pasa desapercibido.
    expect(motivo(wrapper, 'linea')).toContain('Anexo 20')
    // Y este tenant está alineado —nace con 'documento' y escala 4—: avisar
    // siempre le diría a TODO mexicano correcto que le cambiamos algo.
    expect(motivo(wrapper, 'linea')).not.toContain('todavía tiene otro valor')
    expect(motivo(wrapper, 'linea')).not.toContain('escala de cálculo a 4')

    expect(deshabilitado(wrapper, 'HALF_UP')).toBe(false)
    expect(motivo(wrapper, 'HALF_UP')).toBe('')
  })

  it('sin ley los dos controles siguen habilitados y sin aviso', async () => {
    const wrapper = await mountSuspended(PreferenciasFinancieras)

    expect(deshabilitado(wrapper, 'HALF_UP')).toBe(false)
    expect(deshabilitado(wrapper, 'linea')).toBe(false)
    expect(motivo(wrapper, 'HALF_UP')).toBe('')
    expect(motivo(wrapper, 'linea')).toBe('')
  })

  it('si lo guardado NO es lo que impone la norma, gana la norma — y se avisa', async () => {
    // El caso del tenant creado antes de que la regla existiera. Sin esto la
    // pantalla le muestra HALF_UP trabado y cada guardado suyo vuelve 400,
    // también los de las preferencias que nada tienen que ver con el redondeo.
    prefsBackend = sinLey({
      modoRedondeo: 'HALF_UP',
      modoRedondeoBloqueado: true,
      modoRedondeoImpuesto: 'HALF_EVEN',
      modoRedondeoNorma: 'ARCA/AFIP, RG 4291.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)

    expect(marcado(wrapper, 'HALF_EVEN')).toBe(true)
    expect(marcado(wrapper, 'HALF_UP')).toBe(false)
    // Y se dice, porque hasta que alguien guarde el motor sigue con el viejo.
    expect(motivo(wrapper, 'HALF_UP')).toContain('todavía tiene otro valor')

    await (wrapper.vm as unknown as { guardar: () => Promise<void> }).guardar()
    expect(guardado?.modoRedondeo).toBe('HALF_EVEN')
  })

  it('lo mismo del lado del NIVEL: es la mitad mexicana, y arrastra la escala', async () => {
    // Gemelo del de arriba, con el estado REAL de un tenant legado: nació con
    // el default viejo, escala 6 y nivel 'linea'. Pisarle solo el nivel lo deja
    // sin salida — 'documento' con escala 6 es un 400 del backend, y la salida
    // que sugiere ese error («usá linea») es el radio que acabamos de
    // deshabilitar. Por eso la escala baja acá también.
    prefsBackend = sinLey({
      escalaCalculo: 6,
      nivelRedondeo: 'linea',
      nivelRedondeoBloqueado: true,
      nivelRedondeoImpuesto: 'documento',
      nivelRedondeoNorma: 'SAT, Anexo 20.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)

    expect(marcado(wrapper, 'documento')).toBe(true)
    expect(marcado(wrapper, 'linea')).toBe(false)
    expect(motivo(wrapper, 'linea')).toContain('Anexo 20')
    expect(motivo(wrapper, 'linea')).toContain('todavía tiene otro valor')
    expect(motivo(wrapper, 'linea')).toContain('escala de cálculo a 4')

    await (wrapper.vm as unknown as { guardar: () => Promise<void> }).guardar()
    expect(guardado?.nivelRedondeo).toBe('documento')
    // Lo que hace guardable al guardado: sin esto el PUT vuelve 400.
    expect(guardado?.escalaCalculo).toBe(4)
    // Y el aviso del NIVEL se apaga igual que el del modo: son dos líneas
    // idénticas y sin esta aserción solo una de las dos tiene red. El
    // `toContain` es el ancla: sin él, un guardado que soltara el candado
    // entero borraría el `description` y el `not.toContain` pasaría en vacío.
    await nextTick()
    expect(motivo(wrapper, 'linea')).toContain('Anexo 20')
    expect(motivo(wrapper, 'linea')).not.toContain('todavía tiene otro valor')
  })

  it('guardado con éxito, el aviso se apaga: ya no queda nada desalineado', async () => {
    // El espejo del bug de arriba: la frase afirma en presente que el motor
    // sigue con el valor viejo. Después de un 200 eso es falso, y dejarla
    // debajo del toast de éxito contradice al toast.
    prefsBackend = sinLey({
      modoRedondeo: 'HALF_UP',
      modoRedondeoBloqueado: true,
      modoRedondeoImpuesto: 'HALF_EVEN',
      modoRedondeoNorma: 'ARCA/AFIP, RG 4291.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)
    expect(motivo(wrapper, 'HALF_UP')).toContain('todavía tiene otro valor')

    await (wrapper.vm as unknown as { guardar: () => Promise<void> }).guardar()
    await nextTick()

    // El candado sigue —la norma no cambió—, el aviso de desalineado no.
    expect(motivo(wrapper, 'HALF_UP')).toContain('RG 4291')
    expect(motivo(wrapper, 'HALF_UP')).not.toContain('todavía tiene otro valor')
  })

  it('sin candado, la escala del admin no se toca — ahí él SÍ tiene salida', async () => {
    // El control del guard de la baja de escala. Sin `Bloqueado` en la
    // condición, este tenant pierde en silencio la precisión que eligió, y con
    // ella la decisión que sí podía tomar: volver a «Por línea».
    // La escala 5 y no la 6: 6 es el default del ref, así que un test con 6
    // pasaría también si `cargar()` no hubiera corrido nunca.
    //
    // 📌 El backend de hoy no produce este estado —rechaza 'documento' con
    // escala > 4— así que la cláusula `Bloqueado` de la condición es
    // deliberadamente defensiva. El test fija la intención: el día que la
    // combinación exista sin ley, la decisión sigue siendo del admin.
    prefsBackend = sinLey({ escalaCalculo: 5, nivelRedondeo: 'documento' })
    const wrapper = await mountSuspended(PreferenciasFinancieras)

    expect(deshabilitado(wrapper, 'linea')).toBe(false)
    await (wrapper.vm as unknown as { guardar: () => Promise<void> }).guardar()
    expect(guardado?.escalaCalculo).toBe(5)
  })

  it('con candado y ya alineado, la escala igual baja — y se dice', async () => {
    // El legado que la validación de la escala pilló después: su nivel ya es el
    // que impone la norma, así que no está "desalineado", pero su escala 6 hace
    // que el backend le rechace el guardado igual. Cambiarle el número sin
    // decírselo no es opción.
    prefsBackend = sinLey({
      escalaCalculo: 6,
      nivelRedondeo: 'documento',
      nivelRedondeoBloqueado: true,
      nivelRedondeoImpuesto: 'documento',
      nivelRedondeoNorma: 'SAT, Anexo 20.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)

    expect(motivo(wrapper, 'linea')).not.toContain('todavía tiene otro valor')
    expect(motivo(wrapper, 'linea')).toContain('escala de cálculo a 4')

    await (wrapper.vm as unknown as { guardar: () => Promise<void> }).guardar()
    expect(guardado?.escalaCalculo).toBe(4)
    // Y deja de decirlo: guardado el 4, la frase pasó a ser falsa. El candado
    // sí sigue —la norma no cambió—, y eso es lo que ancla al `not`.
    await nextTick()
    expect(motivo(wrapper, 'linea')).toContain('Anexo 20')
    expect(motivo(wrapper, 'linea')).not.toContain('escala de cálculo a 4')
  })

  it('si el guardado FALLA, el aviso se queda: la base sigue desalineada', async () => {
    // El gemelo del test de arriba, y el que impide "apagarlo siempre": movido
    // al `finally`, el toast diría "Error al guardar" y el aviso desaparecería
    // igual — la peor de las dos mentiras.
    prefsBackend = sinLey({
      modoRedondeo: 'HALF_UP',
      modoRedondeoBloqueado: true,
      modoRedondeoImpuesto: 'HALF_EVEN',
      modoRedondeoNorma: 'ARCA/AFIP, RG 4291.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)
    fallaElPut = true

    await (wrapper.vm as unknown as { guardar: () => Promise<void> }).guardar()
    await nextTick()

    expect(motivo(wrapper, 'HALF_UP')).toContain('todavía tiene otro valor')
  })

  it('con "Por documento" el input de escala no deja tipear más de 4', async () => {
    // El 400 que quedaba a una tecla de distancia: la pantalla le baja la
    // escala a 4 y acto seguido lo dejaba tipear 6 otra vez.
    prefsBackend = sinLey({
      escalaCalculo: 4,
      nivelRedondeo: 'documento',
      nivelRedondeoBloqueado: true,
      nivelRedondeoImpuesto: 'documento',
      nivelRedondeoNorma: 'SAT, Anexo 20.',
    })
    const wrapper = await mountSuspended(PreferenciasFinancieras)
    expect(wrapper.find('input[type="number"]').attributes('max')).toBe('4')
  })

  it('sin "Por documento" la escala sigue llegando a 12', async () => {
    // El control: un tope fijo en 4 le sacaría precisión a todos los demás.
    const wrapper = await mountSuspended(PreferenciasFinancieras)
    expect(wrapper.find('input[type="number"]').attributes('max')).toBe('12')
  })

  it('si el admin elige "Por documento", la escala baja ahí mismo y no al guardar', async () => {
    // El `max="4"` en un input controlado por Vue no clampea: sin el watcher la
    // pantalla muestra "0–4" con un 6 adentro y el 400 llega igual al guardar.
    const wrapper = await mountSuspended(PreferenciasFinancieras)
    const vm = wrapper.vm as unknown as {
      escalaCalculo: number
      nivelRedondeo: string
      guardar: () => Promise<void>
    }
    expect(vm.escalaCalculo).toBe(6)

    vm.nivelRedondeo = 'documento'
    await nextTick()

    expect(vm.escalaCalculo).toBe(4)
    await vm.guardar()
    expect(guardado?.escalaCalculo).toBe(4)
  })

  it('al volver a "Por línea" la escala NO se toca: ahí 6 es válido', async () => {
    // El control del `nivel === 'documento'`. El caso es alcanzable de verdad:
    // el `max="4"` frena la flechita del spinner pero **no impide tipear** un 6,
    // así que un admin puede quedar en 'documento' con escala 6 y después
    // volver a 'linea' — donde 6 es perfectamente válido. Un watcher que
    // clampeara en cualquier cambio de nivel le pisaría ese número.
    const wrapper = await mountSuspended(PreferenciasFinancieras)
    const vm = wrapper.vm as unknown as { escalaCalculo: number, nivelRedondeo: string }

    vm.nivelRedondeo = 'documento'
    await nextTick()
    expect(vm.escalaCalculo).toBe(4)

    vm.escalaCalculo = 6 // lo que el admin puede tipear igual
    vm.nivelRedondeo = 'linea'
    await nextTick()

    expect(vm.escalaCalculo).toBe(6)
  })
})
