import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref, type Ref } from 'vue'
import MoneyInput from './MoneyInput.vue'
import type { MonedaTenantApi } from '~/types/moneda'

// useMonedasStore() invoca useRuntimeConfig() en su setup: requiere una app Nuxt
// real (mismo problema que app/stores/monedas.spec.ts, ver mock ahí). Sin esto,
// mount plano revienta con "[nuxt] instance unavailable" apenas se instancia el
// store, antes de llegar a montar el componente.
vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

const { useMonedasStore } = await import('~/stores/monedas')

const CLP: MonedaTenantApi = {
  monedaId: 'clp-1',
  nombre: 'Peso Chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esDefault: true,
  esOficial: true,
  valorDelDia: null,
}

// Segunda moneda con decimales > 0, locale y separadores invertidos respecto de CLP: cubre
// el emit para una config distinta, no solo la del peso chileno.
const USD: MonedaTenantApi = {
  monedaId: 'usd-1',
  nombre: 'Dólar',
  codigoIso: 'USD',
  simbolo: 'US$',
  decimales: 2,
  separadorDecimal: '.',
  separadorMiles: ',',
  locale: 'en-US',
  habilitada: true,
  esDefault: false,
  esOficial: false,
  valorDelDia: null,
}

// Moneda sin decimales con los separadores INVERTIDOS respecto de CLP (miles ',',
// decimal '.'): el espejo exacto necesario para probar que el agrupado sigue la
// CONFIGURACIÓN de la moneda y no un carácter hardcodeado.
const JPY_MIRROR: MonedaTenantApi = {
  monedaId: 'jpy-1',
  nombre: 'Yen (espejo de separadores)',
  codigoIso: 'JPY',
  simbolo: '¥',
  decimales: 0,
  separadorDecimal: '.',
  separadorMiles: ',',
  locale: 'en-US',
  habilitada: true,
  esDefault: false,
  esOficial: false,
  valorDelDia: null,
}

// UInput (Nuxt UI) no monta sin contexto Nuxt real (ver AdvertenciasPrecio.spec.ts).
// Acá además `MoneyInput` lo usa como input controlado (`:model-value`,
// `:disabled`), así que el stub necesita un `<input>` real para que
// `wrapper.find('input')` refleje lo que ve el usuario, no un `true` genérico.
const stubs = {
  UInput: {
    props: ['modelValue', 'disabled'],
    template: '<input :value="modelValue" :disabled="disabled">',
  },
}

/**
 * Monta `MoneyInput` dentro de un padre con **`v-model` real**: lo que el
 * componente emite vuelve a entrar como `modelValue`, igual que en una página.
 *
 * ⚠️ No es un detalle de estilo. `MoneyInput` escribe su `display` desde DOS
 * fuentes —`onMaska` y el `watch` sobre `props.modelValue`—, así que montarlo con
 * un `modelValue: ''` fijo deja el watcher sin disparar nunca y el componente
 * corriendo a medio cablear. Las dos revisiones independientes señalaron que la
 * versión anterior de este archivo montaba así, y que por eso sus tests de tipeo
 * no podían ver los bugs que sí aparecían en la pantalla real. Todo test que
 * simule al usuario escribiendo usa este helper.
 */
function montarConVModel(
  props: Record<string, unknown>,
  inicial = '',
): { modelo: Ref<string>, input: DOMWrapper<HTMLInputElement>, wrapper: VueWrapper } {
  const modelo = ref(inicial)
  const wrapper = mount(
    {
      components: { MoneyInput },
      setup: () => ({ modelo, props }),
      template: '<MoneyInput v-model="modelo" v-bind="props" />',
    },
    { global: { stubs } },
  )
  return { modelo, input: wrapper.find('input'), wrapper }
}

/**
 * Simula tipeo real, tecla por tecla: cada carácter se agrega al valor que quedó
 * en el DOM DESPUÉS de que maska reformateó la tecla anterior — no al string
 * "ideal" que la persona tiene en la cabeza. Es la diferencia que importa: un
 * `setValue('1000.5')` de una sola pasada nunca pasa por el "1.000" intermedio
 * que maska deja tras la 4ª tecla, así que un test así puede certificar un
 * comportamiento que el tipeo real igual rompe.
 */
async function tipear(input: DOMWrapper<HTMLInputElement>, teclas: string[]) {
  for (const tecla of teclas) {
    // Secuencial a propósito: cada tecla depende del DOM que dejó la anterior.
    await input.setValue(input.element.value + tecla)
  }
}

/** Simula un backspace: le saca el último carácter al valor actual del input. */
async function backspace(input: DOMWrapper<HTMLInputElement>) {
  await input.setValue(input.element.value.slice(0, -1))
}

describe('MoneyInput', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useMonedasStore().hydrate([CLP, USD, JPY_MIRROR], 'tenant-1')
  })

  // Estos tres van con props fijas a propósito: fijan la dirección prop → pantalla
  // (qué se MUESTRA), no el tipeo.
  it('muestra el monto formateado según la moneda', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '1500000', monedaId: 'clp-1' },
      global: { stubs },
    })

    expect(wrapper.find('input').element.value).toBe('$1.500.000')
  })

  // formatMontoDisplay devuelve '—' para vacío; el input NO debe mostrar eso, tiene que
  // quedar vacío para que el usuario pueda escribir.
  it('con modelValue vacío el input queda vacío, no con el em dash', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '', monedaId: 'clp-1' },
      global: { stubs },
    })

    expect(wrapper.find('input').element.value).toBe('')
  })

  it('sin moneda resuelta el input queda deshabilitado', () => {
    const wrapper = mount(MoneyInput, {
      props: { modelValue: '1500000', monedaId: 'no-existe' },
      global: { stubs },
    })

    expect(wrapper.find('input').element.disabled).toBe(true)
  })

  // La máscara se arma con `number.fraction` = decimales de la moneda: es lo que
  // impide abrir una parte decimal donde la moneda no la admite (tarea 14, redondeo
  // de plata) y lo que la deja pasar donde sí. Lo que se fija acá es esa CONFIGURACIÓN
  // —un cambio de valor completo, como un pegado o un `modelValue` que llega de la
  // API—; el tipeo tecla por tecla tiene su propio describe abajo.
  describe('la máscara sigue los decimales de la moneda', () => {
    it('emite el monto sin máscara, no el texto formateado', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await input.setValue('1500000')

      expect(modelo.value).toBe('1500000')
      expect(input.element.value).toBe('1.500.000')
    })

    it('con una moneda de decimales > 0 conserva la parte decimal', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'usd-1' })

      await input.setValue('1500.55')

      expect(modelo.value).toBe('1500.55')
    })

    // `decimales` pisa los de la moneda: existe para costo/tasa (`ESCALA_COSTO` = 4 en
    // el backend), que se valida a una escala FIJA sin importar la moneda del ítem — un
    // costo en un ítem CLP (0 decimales de moneda) sigue admitiendo 4 decimales.
    it('con `decimales` fijo admite esa cantidad aunque la moneda no tenga', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1', decimales: 4 })

      await input.setValue('5,0500')

      expect(modelo.value).toBe('5.0500')
    })
  })

  /**
   * 🛑 La limitación MÁS grave del componente, y la razón de que `mermas.vue` y
   * `grupos-modificadores.vue` NO usen `MoneyInput` para sus campos de costo.
   *
   * Con `v-model` real y una moneda de más de 0 decimales (o con el prop
   * `decimales`), el input queda en **punto fijo tras la primera tecla**: el `watch`
   * de `props.modelValue` reformatea con `toFixed(decimales)` —rellenando la parte
   * decimal completa— y la tecla siguiente cae al final, donde `number.fraction` la
   * trunca de vuelta. Mecanismo completo en el docblock de `display`
   * (`MoneyInput.vue`).
   *
   * Estos tests **afirman el comportamiento actual, que NO es el deseable**. Están
   * para que nadie migre un campo de costo/tasa a `MoneyInput` sin enterarse: si
   * alguien arregla el punto fijo, estos dos tests DEBEN fallar, y ahí se borran y
   * se migran los campos.
   *
   * ⚠️ Solo se ve montando con `v-model` real y tecleando: un `setValue` de una sola
   * pasada (ver el describe de arriba) pasa perfecto, porque el valor completo ya
   * viene con la escala llena y el reformateo es idempotente.
   */
  describe('limitación conocida (documentada, no resuelta): con decimales > 0 el tecleo queda en punto fijo', () => {
    it('documenta que en USD, "1","2",".","5","0" tecla por tecla queda en 1.00 (input muerto)', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'usd-1' })

      await tipear(input, ['1', '2', '.', '5', '0'])

      // Lo DESEABLE sería '12.50'. Lo que hace hoy:
      expect(modelo.value).toBe('1.00')
      expect(input.element.value).toBe('1.00')
    })

    it('documenta que el prop `decimales` cae en lo mismo: por eso costo/tasa NO lo usa', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1', decimales: 4 })

      await tipear(input, ['5', ',', '0', '5', '0', '0'])

      // Lo DESEABLE sería '5.0500'. Lo que hace hoy: solo entra el primer dígito.
      expect(modelo.value).toBe('5.0000')
    })

    // La contraparte que explica por qué el bug pasó desapercibido: con 0 decimales
    // `toFixed(0)` es idempotente, no hay nada que rellenar y el ciclo no se traba.
    // La moneda oficial del seed es CLP (0 decimales, `seeder.service.ts`), así que
    // los campos que usan `oficial` —propinas, descuentos/recargos en monto fijo—
    // están a salvo.
    it('en cambio con 0 decimales (CLP, la oficial del seed) el tecleo NO se traba', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '2', '3', '4', '5'])

      expect(modelo.value).toBe('12345')
    })
  })

  describe('tecleo real, tecla por tecla, con v-model real', () => {
    // El caso chileno normal: en Chile "1.500" ES la forma de escribir mil quinientos,
    // y el `.` del pad numérico es la tecla que más gente usa por hábito. Un intento
    // previo de rechazar separadores en monedas sin decimales rompía justo esto
    // (emitía `1`), y como `1` es un monto VÁLIDO se guardaba en silencio. Se revirtió.
    it('en CLP, "1",".","5","0","0" tecla por tecla da 1500', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '.', '5', '0', '0'])

      expect(modelo.value).toBe('1500')
    })

    // Mismo gesto en la moneda espejo: el agrupador es ',' y también tiene que
    // atravesarse sin comerse los dígitos que siguen.
    it('en el espejo de JPY, "1",",","5","0","0" tecla por tecla da 1500', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'jpy-1' })

      await tipear(input, ['1', ',', '5', '0', '0'])

      expect(modelo.value).toBe('1500')
    })

    // El input NO puede quedar muerto: el intento revertido guardaba un flag "último
    // separador rechazado" que solo se limpiaba con un evento de borrado, y un input
    // vacío no dispara ninguno — tras teclear un separador primero, no había forma de
    // recuperarse escribiendo.
    it('en CLP, un separador como primera tecla en campo vacío no traba el input', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['.', '5', '0', '0'])

      expect(modelo.value).toBe('500')
    })

    it('en CLP, 5 dígitos seguidos extienden el entero a 10000', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '0', '0', '0', '0'])

      expect(modelo.value).toBe('10000')
    })

    it('en CLP, tipear 1234567 y un backspace da 123456, no menos', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '2', '3', '4', '5', '6', '7'])
      await backspace(input)

      expect(modelo.value).toBe('123456')
    })
  })

  /**
   * ⚠️ Estos tests DOCUMENTAN una limitación conocida y preexistente. NO la
   * resuelven, y el valor que afirman NO es el deseable: es el que el componente
   * produce hoy.
   *
   * En una moneda de 0 decimales, maska trata cualquier separador como agrupador de
   * miles, así que teclear `1000.5` no abre una parte decimal —la descarta— y pega
   * el `5` al entero: sale `10005`, diez veces lo tecleado.
   *
   * **Por qué se deja así:** ese monto no se persiste. El backend valida la escala
   * de la moneda y lo rechaza con 400 (`escala-moneda.pipe.ts`, tarea 11), o sea es
   * un error VISIBLE. El intento de taparlo desde el input (un `preProcess` con
   * memoria de la última tecla) rompía el caso chileno normal `1.500` → `1` y podía
   * dejar el input muerto: montos válidos, MENORES, guardados en silencio. Se
   * cambiaba un error visible por plata mal guardada, así que se revirtió.
   *
   * Antes de intentar parchearlo de nuevo: lo que haga falta escribir acá tiene que
   * pasar TODO el describe de "tecleo real" de arriba, montado con `v-model` real.
   */
  describe('limitación conocida (documentada, no resuelta): el separador se lee como miles', () => {
    it('documenta que en CLP teclear "1000.5" da 10005, y que el backend lo rechaza', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '0', '0', '0', '.', '5'])

      expect(modelo.value).toBe('10005')
    })

    it('documenta que en CLP la coma (su decimal) hace lo mismo: "1000,5" da 10005', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '0', '0', '0', ',', '5'])

      expect(modelo.value).toBe('10005')
    })

    it('documenta que pegar "1000.5" de una sola vez en CLP también da 10005', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await input.setValue('1000.5')

      expect(modelo.value).toBe('10005')
    })

    // Contraparte que sí es correcta y conviene no perder: una agrupación de a 3
    // válida se lee bien, no se recorta.
    it('en cambio "1.000" (agrupación válida) sí da 1000', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await input.setValue('1.000')

      expect(modelo.value).toBe('1000')
    })
  })
})
