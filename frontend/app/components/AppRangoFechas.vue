<script setup lang="ts">
/**
 * Selector de rango `desde`/`hasta` para cualquier pantalla con filtro de fecha.
 *
 * ⛔ **Emite `YYYY-MM-DD`, nunca un `Date` ni un timestamp.** El backend acepta
 * fecha pura y la expande al **día del negocio** del tenant —un bar con corte a
 * las 05:00 cuenta la venta de la 01:30 del domingo en el sábado—; mandar un
 * timestamp saltea esa expansión y el encargado ve números que no son los suyos.
 * Por eso además monta `DiaNegocioNota`: el rango se lee en días de negocio y
 * quien lo mira tiene que saberlo.
 *
 * ⚠️ **No arma ninguna fecha: pasa strings.** Es a propósito —hay una invariante
 * (`invariants/fecha-local.invariant.spec.ts`) que rechaza armar el día desde
 * UTC, porque `toISOString()` elige UTC siempre y en husos negativos adelanta un
 * día desde las ~21:00 local—. Lo que no construye no puede equivocarse. La
 * pantalla que necesite un default ("este mes") arma la fecha con `hoyLocal()` de
 * `useVigenciaRegla`, que ya la arma por componentes locales.
 *
 * 📌 **El plan pedía importar `hoyLocal()` acá y no se importó**: sin un valor por
 * defecto que ofrecer, quedaba como import sin uso. Se importa donde se use.
 *
 * ⛔ **El cruce se valida acá y no en cada pantalla.** Un rango invertido llega al
 * backend como un 400 críptico o —peor, en el listado, donde las fechas son
 * opcionales— como una tabla vacía que se lee igual que "no pasó nada". Si cada
 * pantalla lo resuelve por su cuenta, la que se olvide lo manda igual.
 */
const props = withDefaults(
  defineProps<{
    desde?: string | null
    hasta?: string | null
    disabled?: boolean
    /** data-qa para E2E; sufija cada punta con `-desde` / `-hasta`. */
    qa?: string
  }>(),
  {
    desde: null,
    hasta: null,
    disabled: false,
    qa: undefined,
  },
)

const emit = defineEmits<{
  'update:desde': [value: string | null]
  'update:hasta': [value: string | null]
}>()

const aviso = ref('')

/** `''` es lo que emite `AppDateInput` al limpiarse; acá vale `null`. */
function normalizar(valor: string): string | null {
  return valor === '' ? null : valor
}

/**
 * Las fechas `YYYY-MM-DD` se comparan como string: ordenan igual que
 * cronológicamente, sin construir ningún `Date`. Mismo criterio que
 * `useVigenciaRegla` y que el motor de precios al indexar reglas.
 */
function invertido(desde: string | null, hasta: string | null): boolean {
  return desde !== null && hasta !== null && desde > hasta
}

function cambiar(punta: 'desde' | 'hasta', valor: string): void {
  const nuevo = normalizar(valor)
  const desde = punta === 'desde' ? nuevo : props.desde
  const hasta = punta === 'hasta' ? nuevo : props.hasta

  if (invertido(desde, hasta)) {
    aviso.value = 'El desde no puede ser posterior al hasta'
    return
  }

  aviso.value = ''
  if (punta === 'desde') emit('update:desde', nuevo)
  else emit('update:hasta', nuevo)
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="Desde">
        <AppDateInput
          :model-value="props.desde"
          :disabled="props.disabled"
          :qa="props.qa ? `${props.qa}-desde` : undefined"
          @update:model-value="cambiar('desde', $event)"
        />
      </UFormField>
      <UFormField label="Hasta">
        <AppDateInput
          :model-value="props.hasta"
          :disabled="props.disabled"
          :qa="props.qa ? `${props.qa}-hasta` : undefined"
          @update:model-value="cambiar('hasta', $event)"
        />
      </UFormField>
    </div>

    <p v-if="aviso" class="text-xs text-error" :data-qa="props.qa ? `${props.qa}-aviso` : undefined">
      {{ aviso }}
    </p>

    <DiaNegocioNota />
  </div>
</template>
