<script setup lang="ts">
import {
  aCantidadCanonica,
  convertirPresentacion,
  esConteo,
  opcionesMismaMagnitud,
  puedeDecrementar,
  type UnidadCat,
} from '~/utils/cantidad-presentacion'

const props = defineProps<{
  modelValue: string | number
  unidadCodigo: string
  unidadBaseCodigo: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
  'update:unidadCodigo': [string]
  change: [{ presentacion: string, unidadCodigo: string, cantidadCanonica: string }]
}>()

const unidadesStore = useUnidadesMedidaStore()

onMounted(() => {
  void unidadesStore.ensureLoaded()
})

const catalogo = computed<UnidadCat[]>(() =>
  unidadesStore.unidades.map(u => ({
    codigo: u.codigo,
    magnitud: u.magnitud,
    factorBase: u.factorBase,
  })),
)

const opciones = computed(() =>
  opcionesMismaMagnitud(props.unidadBaseCodigo, catalogo.value),
)

const esConteoLocal = computed(() => esConteo(props.unidadCodigo, catalogo.value))

const puedeDec = computed(() =>
  puedeDecrementar(String(props.modelValue), props.unidadCodigo, catalogo.value),
)

function emitChange(presentacion: string, unidad: string) {
  const cantidadCanonica = aCantidadCanonica(
    presentacion,
    unidad,
    props.unidadBaseCodigo,
    catalogo.value,
  )
  emit('update:modelValue', presentacion)
  emit('update:unidadCodigo', unidad)
  emit('change', { presentacion, unidadCodigo: unidad, cantidadCanonica })
}

function onNumber(value: number | null) {
  if (value == null || Number.isNaN(value)) return
  const pres = esConteoLocal.value ? String(Math.max(1, Math.round(value))) : String(value)
  emitChange(pres, props.unidadCodigo)
}

function onUnidad(unidad: string) {
  if (unidad === props.unidadCodigo) return
  let pres: string
  try {
    pres = convertirPresentacion(
      String(props.modelValue),
      props.unidadCodigo,
      unidad,
      catalogo.value,
    )
  } catch {
    pres = String(props.modelValue)
  }
  emitChange(pres, unidad)
}
</script>

<template>
  <div class="flex items-center gap-1">
    <UInputNumber
      :model-value="Number(modelValue)"
      :min="esConteoLocal ? 1 : undefined"
      :step="1"
      :step-snapping="esConteoLocal"
      :disabled="disabled"
      :decrement-disabled="!puedeDec"
      size="sm"
      class="w-28"
      @update:model-value="onNumber"
    />
    <USelect
      v-if="opciones.length > 1"
      :model-value="unidadCodigo"
      :items="opciones.map(u => ({ label: u.codigo, value: u.codigo }))"
      size="sm"
      class="w-20"
      :disabled="disabled"
      @update:model-value="onUnidad"
    />
    <span v-else class="text-xs text-muted">{{ unidadCodigo }}</span>
  </div>
</template>
