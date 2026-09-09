<script setup lang="ts">
import { vMaska } from 'maska/vue'
import type { MaskaDetail } from 'maska'
import { formatMontoDisplay, parseMontoPegado } from '~/utils/currency-format'

const props = withDefaults(
  defineProps<{
    modelValue: string
    monedaId?: string
    oficial?: boolean
    placeholder?: string
    disabled?: boolean
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    class?: string
  }>(),
  {
    placeholder: '0',
    oficial: false,
    size: 'md',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const store = useMonedasStore()

/**
 * La moneda que manda en este campo, y con ella los decimales que se pueden tipear.
 *
 * 📌 **No hay forma de pedir otra escala.** Hubo un prop `decimales` para forzarla a
 * 4 —la escala fija de `@EsCosto()` en el backend— y se sacó el 2026-09-08: un campo
 * de 4 decimales sobre un ítem en pesos es donde `1.500` significa a la vez `1500` y
 * `1,5`, y maska elige una lectura en silencio. Sacar el prop no mata esa
 * configuración —una moneda de 4 decimales, como la UF, la trae por su cuenta—, saca la
 * forma de fabricarla sobre un ítem cuya moneda no tiene decimales.
 * La escala del backend sigue en 4 porque el motor promedia y genera fracciones; lo
 * que sigue a la moneda es el teclado humano, y la precisión de un costo por gramo la
 * da elegir la unidad (owner, 2026-08-28 — `docs/patterns/frontend.md` §8).
 */
const cfg = computed(() =>
  props.oficial
    ? store.monedaOficial ?? undefined
    : props.monedaId ? store.getById(props.monedaId) : undefined,
)

/**
 * Texto enmascarado mostrado en el input.
 *
 * 🛑 **`display` lo escriben DOS fuentes** —`syncFromMaska` (lo que maska acaba de
 * enmascarar) y el `watch` de abajo (lo que `formatMontoDisplay` arma desde
 * `props.modelValue`)—, y arbitrar entre las dos es todo el problema de este
 * componente. La regla es: **el watch NO pisa lo que la persona está tecleando.**
 *
 * De no arbitrarlo salía el bug más grave que tuvo: con `v-model` y una moneda de
 * más de 0 decimales, el input quedaba en **punto fijo tras la primera tecla**.
 * Medido entonces, tecla por tecla, en USD sobre campo vacío:
 *
 * ```
 *   "1" -> "1.00"   "2" -> "1.00"   "." -> "1.00"   "5" -> "1.00"   "0" -> "1.00"
 * ```
 *
 * El mecanismo: se emitía `unmasked` (`"1"`), el padre lo devolvía por
 * `props.modelValue`, el watch escribía `formatMontoDisplay("1")` y
 * `formatMontoManual` hace `abs.toFixed(cfg.decimals)` —o sea **rellena la escala
 * completa** → `"1.00"`—; la tecla siguiente caía al final (`"1.002"`) y
 * `fraction: 2` la truncaba de vuelta. Con `decimals: 0` no pasaba, porque
 * `toFixed(0)` es idempotente: por eso la moneda oficial del seed (CLP) nunca lo
 * exhibió y el bug vivió meses sin que se viera.
 *
 * Lo que lo cierra es el guard del eco en el watch: el valor que vuelve del padre
 * después de nuestro propio `emit` **no se reformatea**. Un cambio que viene de
 * afuera (abrir un formulario, un reset) sí, que es cuando el relleno a la escala
 * completa es lo que se quiere.
 *
 * ⚠️ Esto **solo se ve tecleando**, y por eso el spec tiene su helper `tipear`: un
 * `setValue` de una sola pasada pasaba perfecto incluso con el bug vivo, porque el
 * valor completo ya viene con la escala llena y el reformateo es idempotente. Todo
 * test de tipeo va tecla por tecla y con `v-model` real.
 */
const display = ref('')

/**
 * Lo último que este componente emitió, para distinguir el **eco** de nuestro propio
 * `update:modelValue` de un cambio que viene de afuera (abrir un formulario, un
 * reset del padre). No es estado reactivo a propósito: nadie lo lee para renderizar,
 * solo el `watch` de abajo para decidir si le toca reformatear.
 */
let ultimoEmitido: string | null = null

/**
 * Marca que el `watch` deja puesta cuando pinta `display` con un valor que vino de
 * AFUERA (abrir un formulario, un reset, un cambio de moneda).
 *
 * 🛑 Existe porque `v-maska` corre en `mounted` **y en `updated`**, así que ese texto
 * recién pintado vuelve a pasar por `syncFromMaska` — y si de ahí sale un `emit`, el
 * componente **le reescribe el modelo al padre sin que nadie toque el campo**. Cuando
 * el valor entra en la escala de la moneda el emit devuelve el mismo número y no se
 * nota; cuando no entra, devuelve el redondeado y **eso** es lo que se guarda: medido
 * el 2026-09-08, un `1234.5678` en CLP dejaba el modelo del padre en `1235`. Es el
 * mismo modo de falla del 7,69% que se midió en `mermas.vue` el 2026-08-28.
 *
 * La regla que fija: **este componente solo emite lo que la persona escribió.** Un
 * valor que no se puede mostrar entero se muestra redondeado —no hay otra— pero el
 * modelo del padre queda intacto hasta que alguien lo edite.
 *
 * ⚠️ **Guarda el TEXTO pintado, no un booleano, y eso no es estilo.** Una marca que
 * dijera solo "el próximo `onMaska` es mío" se queda pegada cuando maska no vuelve a
 * correr, y entonces **se come la primera tecla de la persona**. Y maska no siempre
 * vuelve a correr: solo llama a su callback si el texto del input **cambia** al
 * re-enmascararlo, y lo que hace que cambie es el símbolo de la moneda
 * —`formatMontoDisplay` antepone `$`, maska lo desnuda—. Medido tecla por tecla el
 * 2026-09-08 con una moneda **sin símbolo** (`moneda.simbolo` es nullable): el texto
 * pintado ya era estable, `syncFromMaska` no corría, y el modelo se quedaba en `1500`
 * mientras la pantalla mostraba `1.5007`.
 *
 * Comparando el texto, una marca vieja solo puede silenciar un `emit` que devuelve
 * exactamente **lo que ya se está mostrando**. Eso no es "no cambia nada": si el modelo
 * está fuera de la escala de la moneda, tipear a mano el número redondeado que el campo
 * ya muestra no lo cambiaría. Es el residuo aceptado —invisible en pantalla y en la misma
 * dirección que el diseño quiere—, y no se puede achicar sin volver a depender de que
 * maska corra. Los dos caminos, con símbolo y sin, tienen su test en el describe
 * *"un valor que entra de afuera se muestra, pero no se reescribe"*.
 *
 * 📌 Un `modelValue` **negativo** queda fuera de la comparación y se re-emite sin signo:
 * `formatMontoManual` pone el `-` antes del símbolo (`-$1.500`) y maska, con
 * `unsigned: true`, devuelve `1.500`, así que ninguna de las dos formas matchea. Hoy ningún
 * consumidor le pasa negativos —el input tampoco los deja tipear— y antes de este guard se
 * re-emitía siempre, así que no es una regresión; queda anotado porque la regla de arriba,
 * leída en absoluto, no lo cubre.
 */
let pintadoDesdeProps: string | null = null

function syncFromMaska(detail: MaskaDetail) {
  // maska devuelve el texto SIN el prefijo, así que el eco de lo que pintamos se
  // reconoce por cualquiera de las dos formas.
  const prefijo = cfg.value?.prefix ?? ''
  const esEcoDelPintado = pintadoDesdeProps !== null
    && (detail.masked === pintadoDesdeProps
      || `${prefijo}${detail.masked}` === pintadoDesdeProps)
  pintadoDesdeProps = null

  display.value = detail.masked
  if (esEcoDelPintado) {
    // No hay eco pendiente que cuidar: lo que está en el input vino de `props`, no de
    // un `emit` nuestro. Sin este `null`, `ultimoEmitido` se queda con lo último que
    // la persona tipeó y el `watch` de abajo se saltea un repintado legítimo — el
    // padre escribe otro valor y después vuelve a ese, y la pantalla queda mostrando
    // el intermedio. Latente: ningún consumidor de hoy escribe el modelo dos veces
    // con valores distintos; lo levantó la revisión independiente.
    ultimoEmitido = null
    return
  }
  ultimoEmitido = detail.unmasked || ''
  emit('update:modelValue', ultimoEmitido)
}

/**
 * `number.fraction` es lo que impide tipear más decimales de los que la moneda
 * admite: con `fraction: 0` (CLP) maska no deja abrir parte decimal.
 *
 * ⚠️ **Limitación conocida, preexistente, NO parcheada acá.** En una moneda cuyo
 * separador de MILES es `.` (el peso chileno), tipear `1000.5` deja `10005`: maska
 * lee ese `.` como agrupador, no como decimal, y pega los dígitos. El monto sale
 * ×10 de lo tecleado.
 * ⛔ **Y se persiste.** Esta doc decía hasta el 2026-08-26 que el backend lo
 * rechazaba con 400 por escala (`escala-moneda.pipe.ts`), o sea que era un error
 * visible y no plata mal guardada. **Es falso:** el resultado del error es un
 * **entero**, y un entero es válido en cualquier escala —0 decimales incluidos—, así
 * que ningún validador de escala lo puede ver. El riesgo, y por dónde se podría
 * atacar, están anotados en `docs/agent/resueltos.md`; acá solo se corrige la
 * afirmación.
 *
 * Se intentó taparlo con un `preProcess` con memoria de la última tecla y salió
 * peor: rompía el caso normal chileno (`1.500` = mil quinientos emitía `1`) y podía
 * dejar el input muerto, produciendo montos válidos pero MENORES que sí se
 * guardaban en silencio. Revertido. Antes de intentarlo de nuevo, ver en
 * `MoneyInput.spec.ts` el describe "limitación conocida (documentada, no resuelta)"
 * y, sobre todo, el de "tecleo real": cualquier parche tiene que pasar los dos.
 *
 * 📌 **Y no es que se haya intentado mal: tecleando la información no existe.**
 * `1`,`.`,`5`,`0`,`0` y `1`,`0`,`0`,`.`,`5` son el mismo gesto; lo único que los
 * distingue son los dígitos que siguen al punto, y maska ya colapsó el texto
 * cuando llegan. Por eso el arreglo que sí se pudo hacer vive en `onPaste`, que
 * es el camino donde la cadena entra entera.
 */
const maskaOptions = computed(() => {
  const c = cfg.value
  if (!c) return undefined
  return {
    number: {
      locale: c.locale,
      fraction: c.decimals,
      unsigned: true,
    },
    onMaska: syncFromMaska,
  }
})

/**
 * El pegado es el **único** camino donde se puede saber qué quiso decir la
 * persona, y por eso se ataja acá y no en la máscara.
 *
 * Tecleando la información no existe (ver el docblock de `maskaOptions`): en
 * es-CL, `1`,`.`,`5`,`0`,`0` y `1`,`0`,`0`,`.`,`5` son el mismo gesto y solo los
 * dígitos que siguen al punto los distinguen — que es justo lo que maska ya
 * colapsó cuando llegan. Pegando, la cadena entra entera y la agrupación se
 * puede juzgar: `1.500` agrupa de a 3, `1000.5` no agrupa nada. El veredicto lo
 * da `parseMontoPegado`, que es puro y tiene sus casos en
 * `currency-format.spec.ts`.
 *
 * ⚠️ **No se redondea ni se recorta lo que no cabe.** Pegar `1000,5` en pesos no
 * guarda `1001` ni `1000`: no guarda nada y el campo queda como estaba, que es
 * lo único visible. Recortar en silencio es exactamente lo que hacía el intento
 * revertido —montos válidos y MENORES guardados sin avisar—.
 */
function onPaste(evento: ClipboardEvent) {
  const c = cfg.value
  if (!c) return
  const el = evento.target as HTMLInputElement | null
  if (!el) return
  // Solo cuando el pegado REEMPLAZA el campo entero. Pegar sobre parte de lo ya
  // escrito produce un texto que no es el del portapapeles, y ahí volver a
  // opinar sería adivinar.
  const reemplazaTodo = el.selectionStart === 0 && el.selectionEnd === el.value.length
  if (!reemplazaTodo) return

  const veredicto = parseMontoPegado(evento.clipboardData?.getData('text') ?? '', c)
  if (veredicto.tipo === 'sin-cambios') return

  evento.preventDefault()
  if (veredicto.tipo === 'rechazado') return

  // Reescrito con el separador decimal de la moneda: maska lo lee bien y el
  // camino de emitir sigue siendo el de siempre (`syncFromMaska`).
  el.value = veredicto.texto
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

watch(
  [() => props.modelValue, cfg],
  ([valor, c], previo) => {
    if (!c) {
      display.value = ''
      return
    }
    if (valor === '' || valor === undefined) {
      display.value = ''
      return
    }
    // El eco de nuestro propio emit NO se reformatea: el texto que la persona está
    // tecleando ya está en `display`, puesto por maska. Reformatearlo acá era el
    // punto fijo — `formatMontoDisplay` rellena la parte decimal completa
    // (`toFixed`), y la tecla siguiente caía al final, donde `number.fraction` la
    // truncaba de vuelta.
    //
    // La comparación incluye la moneda porque **cambiar de moneda invalida el eco**:
    // el mismo string se formatea distinto y ahí sí hay que reformatear. En la
    // primera corrida (`immediate`) `previo` es `undefined`, así que formatea, que
    // es lo correcto para un valor que llega de afuera.
    if (previo && previo[1] === c && valor === ultimoEmitido) return
    display.value = formatMontoDisplay(valor, c)
    pintadoDesdeProps = display.value
  },
  { immediate: true },
)
</script>

<template>
  <UInput
    v-maska="maskaOptions"
    :model-value="display"
    :placeholder="placeholder"
    :disabled="disabled || !cfg"
    :size="size"
    :class="props.class"
    inputmode="decimal"
    autocomplete="off"
    @paste="onPaste"
  />
</template>
