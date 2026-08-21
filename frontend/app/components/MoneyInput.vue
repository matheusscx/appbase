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
     * ⚠️ **Hoy NINGÚN campo lo usa**, y no es casualidad: cualquier valor > 0 mete al
     * input en el punto fijo descrito en el docblock de `display` (queda muerto tras
     * la primera tecla). Se deja el prop porque la necesidad es real y el contrato es
     * correcto, pero antes de usarlo hay que arreglar ese punto fijo.
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
 * `props.modelValue`)— y de ahí sale la limitación más grave de este componente:
 *
 * **Con `v-model` y una moneda de MÁS de 0 decimales (o con el prop `decimales`),
 * el input queda en punto fijo tras la primera tecla.** Medido, tecla por tecla,
 * sobre el componente montado con un padre que hace `v-model` de verdad:
 *
 * ```
 * USD (2 decimales), campo vacío:
 *   tecla "1" -> "1.00"      tecla "2" -> "1.00"      tecla "." -> "1.00"
 *   tecla "5" -> "1.00"      tecla "0" -> "1.00"
 * ```
 *
 * El mecanismo: se emite `unmasked` (`"1"`), el padre lo devuelve por
 * `props.modelValue`, este `watch` escribe
 * `formatMontoDisplay("1")` y `formatMontoManual` hace `abs.toFixed(cfg.decimals)`
 * (`currency-format.ts`), o sea **rellena a la escala completa** → `"1.00"`. La
 * tecla siguiente se agrega al final (`"1.002"`) y `fraction: 2` la trunca de vuelta
 * a `"1.00"`. Punto fijo: no entra ni un dígito más.
 *
 * Con `decimals: 0` (CLP) no pasa, porque `toFixed(0)` es idempotente y no hay nada
 * que rellenar — por eso la moneda oficial del seed (CLP, `seeder.service.ts`) no lo
 * exhibe y el bug pasó desapercibido.
 *
 * ⚠️ **Por eso los campos de costo/tasa (escala 4) NO usan este componente**:
 * `mermas.vue` (`costoUnitario`) y `grupos-modificadores.vue` (`precioExtra`,
 * `lotePrecio`) se migraron a `MoneyInput :decimales="4"` y se **revirtieron a
 * `UInput inputmode="decimal"`** al medir que quedaban muertos. La escala de esos
 * campos la sigue validando el backend con `@EsCosto()`; lo que se resigna es la
 * ayuda visual, no el control. **No los vuelvas a migrar sin arreglar antes este
 * punto fijo** — el describe "limitación conocida" de `MoneyInput.spec.ts` lo fija.
 *
 * Arreglarlo es su propia tarea: hay que sacar la doble escritura de `display`
 * (que el `watch` no pise lo que la persona está tecleando), y toca ~17 consumidores.
 */
const display = ref('')

function syncFromMaska(detail: MaskaDetail) {
  display.value = detail.masked
  emit('update:modelValue', detail.unmasked || '')
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
  () => {
    const c = cfg.value
    if (!c) {
      display.value = ''
      return
    }
    if (props.modelValue === '' || props.modelValue === undefined) {
      display.value = ''
      return
    }
    display.value = formatMontoDisplay(props.modelValue, c)
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
