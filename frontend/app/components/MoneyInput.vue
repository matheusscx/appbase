<script setup lang="ts">
import { vMaska } from 'maska/vue'
import type { MaskaDetail } from 'maska'
import { formatMontoDisplay } from '~/utils/currency-format'

const props = withDefaults(
  defineProps<{
    modelValue: string
    monedaId?: string
    oficial?: boolean
    /**
     * Fuerza la cantidad de decimales del componente, ignorando los de la moneda
     * resuelta. Existe para costo/tasa (`ESCALA_COSTO` = 4 en el backend,
     * `escala-moneda.pipe.ts`): esos campos se validan a una escala FIJA sin
     * importar la moneda del ítem —un costo de "5.0500"/g es válido incluso en un
     * ítem en CLP (0 decimales)—, a diferencia de un monto cobrado, que se valida
     * a los decimales que la moneda admite.
     *
     * Estuvo sin usar hasta el 2026-08-21 porque cualquier valor > 0 metía al input en
     * el punto fijo (ver el docblock de `display`). Arreglado eso, es el prop que usan
     * los campos de costo/tasa.
     */
    decimales?: number
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

const cfg = computed(() => {
  const base = props.oficial
    ? store.monedaOficial ?? undefined
    : props.monedaId ? store.getById(props.monedaId) : undefined
  if (!base) return undefined
  if (props.decimales === undefined) return base
  return { ...base, decimals: props.decimales }
})

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

function syncFromMaska(detail: MaskaDetail) {
  display.value = detail.masked
  ultimoEmitido = detail.unmasked || ''
  emit('update:modelValue', ultimoEmitido)
}

/**
 * `number.fraction` es lo que impide tipear más decimales de los que la moneda
 * admite: con `fraction: 0` (CLP) maska no deja abrir parte decimal.
 *
 * ⚠️ **Limitación conocida, preexistente, NO parcheada acá.** En una moneda de 0
 * decimales cuyo separador de MILES es `.` (el peso chileno), tipear `1000.5` deja
 * `10005`: maska lee ese `.` como agrupador, no como decimal, y pega los dígitos.
 * El monto sale ×10 de lo tecleado, pero **no se persiste**: el backend valida la
 * escala y lo rechaza con 400 (`escala-moneda.pipe.ts`), así que es un error
 * visible, no plata mal guardada.
 *
 * Se intentó taparlo con un `preProcess` con memoria de la última tecla y salió
 * peor: rompía el caso normal chileno (`1.500` = mil quinientos emitía `1`) y podía
 * dejar el input muerto, produciendo montos válidos pero MENORES que sí se
 * guardaban en silencio. Revertido. Antes de intentarlo de nuevo, ver en
 * `MoneyInput.spec.ts` el describe "limitación conocida (documentada, no resuelta)"
 * y, sobre todo, el de "tecleo real": cualquier parche tiene que pasar los dos.
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
  />
</template>
