import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick, ref, type Ref } from 'vue'
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

/**
 * Simula un pegado real, que NO es un `setValue`: lo que distingue pegar de
 * tipear es el **evento**, y es toda la información que hace resoluble este caso
 * (ver `parseMontoPegado`). Un `setValue` entra por el mismo camino que una
 * tecla, así que un test que use `setValue` no puede probar nada de esto.
 *
 * happy-dom no trae un `ClipboardEvent` con datos ni inserta el texto solo, así
 * que las dos mitades se arman acá: el evento con su `clipboardData`, y —si
 * nadie lo frenó— la inserción que el navegador haría después.
 */
async function pegar(input: DOMWrapper<HTMLInputElement>, texto: string) {
  const el = input.element
  el.setSelectionRange(0, el.value.length)
  const evento = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(evento, 'clipboardData', { value: { getData: () => texto } })
  el.dispatchEvent(evento)
  await nextTick()
  if (!evento.defaultPrevented) await input.setValue(texto)
  await nextTick()
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
   * El punto fijo con decimales > 0, que hasta el 2026-08-21 dejaba el input muerto
   * tras la primera tecla y era la razón de que `mermas.vue` y
   * `grupos-modificadores.vue` NO usaran `MoneyInput` para sus campos de costo.
   *
   * La causa era la doble escritura de `display`: el `watch` de `props.modelValue`
   * reformateaba con `toFixed(decimales)` —rellenando la parte decimal completa—
   * también cuando el valor entrante era el **eco del propio emit**, y la tecla
   * siguiente caía al final, donde `number.fraction` la truncaba de vuelta.
   *
   * ⚠️ Solo se ve montando con `v-model` real y **tecleando**: un `setValue` de una
   * sola pasada pasa perfecto aun con el bug, porque el valor completo ya viene con
   * la escala llena y el reformateo es idempotente. Si estos tests se reescriben con
   * `setValue`, dejan de proteger nada.
   */
  describe('con decimales > 0 el tecleo entra completo (era el punto fijo)', () => {
    it('en USD, "1","2",".","5","0" tecla por tecla da 12.50', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'usd-1' })

      await tipear(input, ['1', '2', '.', '5', '0'])

      expect(modelo.value).toBe('12.50')
      expect(input.element.value).toBe('12.50')
    })

    it('con el prop `decimales` (costo/tasa, escala 4) también entra completo', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1', decimales: 4 })

      await tipear(input, ['5', ',', '0', '5', '0', '0'])

      expect(modelo.value).toBe('5.0500')
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

    // Desde el 2026-08-24 un TRAMO de descuento/recargo puede valer 0 —es cómo
    // se escribe "envío gratis sobre $30.000"— y este campo es por donde se
    // tipea. El cero es el único monto que el componente podría confundir con
    // "campo vacío": emite `detail.unmasked || ''`, así que si maska devolviera
    // `''` para un cero solo, el importe llegaría ausente al backend y el 400
    // sería "el tramo tiene que expresar su importe" — un error que le echa la
    // culpa a quien escribió bien.
    it('en CLP, tipear un "0" solo emite "0" y no vacío', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['0'])

      expect(modelo.value).toBe('0')
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

  describe('pegado: el único camino donde se puede saber qué quiso decir', () => {
    // La escena: un costo copiado de una planilla. Es el camino más probable en
    // un campo de 4 decimales, justamente porque ahí el decimal es legítimo.
    it('en un campo de 4 decimales, pegar "1000.5" guarda 1000.5 y no 10005', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1', decimales: 4 })

      await pegar(input, '1000.5')

      expect(modelo.value).toBe('1000.5')
    })

    // En el peso el monto no existe, así que no hay nada correcto que guardar:
    // redondear a 1001 o recortar a 1000 son las dos formas de guardar un número
    // que nadie escribió, y recortar es exactamente lo que hacía el intento
    // revertido. El campo se queda como estaba y se ve que el pegado no entró.
    it('en CLP, pegar "1000.5" no guarda nada: el peso no tiene decimales', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' }, '750')

      await pegar(input, '1000.5')

      expect(modelo.value).toBe('750')
    })

    it('en CLP, pegar "1000,5" tampoco: la coma es su decimal y tampoco cabe', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' }, '750')

      await pegar(input, '1000,5')

      expect(modelo.value).toBe('750')
    })

    // Ancla del otro lado, y la que rompió el intento anterior: en Chile "1.500"
    // ES mil quinientos. Si esto se rompe, el arreglo está guardando de MENOS.
    it('en CLP, pegar "1.500" sigue siendo mil quinientos', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await pegar(input, '1.500')

      expect(modelo.value).toBe('1500')
    })

    it('un pegado PARCIAL no se toca: el texto que queda no es el del portapapeles', async () => {
      // Límite deliberado, y anotado como tal en las docs: con el caret en medio
      // de lo ya escrito, lo que queda en el campo no es lo que llegó pegado, y
      // volver a opinar sería adivinar. Este test existe para que el límite se
      // vea, no para bendecirlo.
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' }, '750')
      const el = input.element
      el.setSelectionRange(el.value.length, el.value.length)
      const evento = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(evento, 'clipboardData', { value: { getData: () => '1000.5' } })
      el.dispatchEvent(evento)
      await nextTick()

      expect(evento.defaultPrevented).toBe(false)
      // Y el navegador inserta, como en cualquier pegado que nadie frena. Lo que
      // queda medido —y no solo narrado en las docs— es la consecuencia: los dos
      // números se pegan y sale un monto que no es ninguno de los dos.
      await input.setValue(el.value + '1000.5')
      expect(modelo.value).toBe('75010005')
    })

    it('en CLP, pegar "1.500,00" guarda mil quinientos y no ciento cincuenta mil', async () => {
      // El entero como lo escribe cualquier planilla. Con `fraction: 0` la
      // máscara se comía los dos separadores y salía 150000, ×100.
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await pegar(input, '1.500,00')

      expect(modelo.value).toBe('1500')
    })

    it('en USD, pegar "1000.5" pasa derecho: ahí el punto ES el decimal', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'usd-1' })

      await pegar(input, '1000.5')

      expect(modelo.value).toBe('1000.5')
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
   * **Por qué se deja así:** el intento de taparlo desde el input (un `preProcess`
   * con memoria de la última tecla) rompía el caso chileno normal `1.500` → `1` y
   * podía dejar el input muerto: montos válidos, MENORES, guardados en silencio. Se
   * revirtió.
   *
   * ⛔ **Corregido el 2026-08-26 — este bloque decía que el monto ×10 "no se
   * persiste" porque el backend lo rechaza con 400 por escala
   * (`escala-moneda.pipe.ts`). Es falso:** el resultado del error es un **entero**
   * (`10005`), y un entero es válido en cualquier escala —los 0 decimales del peso
   * incluidos—, así que ningún validador de escala lo ve. O sea que esto **no** es
   * un error visible: es plata ×10 guardada en silencio. Sigue sin resolverse, pero
   * que se sepa lo que cuesta: `docs/agent/pendientes.md`.
   *
   * Antes de intentar parchearlo de nuevo: lo que haga falta escribir acá tiene que
   * pasar TODO el describe de "tecleo real" de arriba, montado con `v-model` real.
   *
   * ✅ **El PEGADO ya no está acá: se atajó el 2026-09-01** y vive en el describe
   * "pegado" de arriba. Estos tres siguen siendo del camino de TECLEO —`setValue`
   * entra por donde entra una tecla, no por donde entra un pegado—, y ahí la
   * información para distinguir `1.500` de `1000.5` no existe. Lo que cambió es
   * que ya no son *todo* lo que pasa: el mismo `1000.5` copiado de una planilla
   * hoy no se guarda.
   */
  describe('limitación conocida (documentada, no resuelta): el separador se lee como miles', () => {
    it('documenta que en CLP TECLEAR "1000.5" da 10005, y que ahí nadie lo ataja', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '0', '0', '0', '.', '5'])

      expect(modelo.value).toBe('10005')
    })

    it('documenta que en CLP la coma (su decimal) hace lo mismo: "1000,5" da 10005', async () => {
      const { modelo, input } = montarConVModel({ monedaId: 'clp-1' })

      await tipear(input, ['1', '0', '0', '0', ',', '5'])

      expect(modelo.value).toBe('10005')
    })

    it('documenta que SETEAR el valor de una sola vez en CLP también da 10005', async () => {
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
