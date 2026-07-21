<script setup lang="ts">
import {
  buildPersonalizacionPayload,
  precioConExtras,
  resumenPersonalizacion,
  detallePersonalizacionPreview,
  sinStock,
  type PersonalizacionPayload,
  type RecetaDetallePersonalizacion,
} from '~/composables/useRecetaPersonalizacion'
import type { PersonalizacionDetalleLinea } from '~/utils/ticket-builder'

const props = defineProps<{
  itemId: string | null
}>()

const emit = defineEmits<{
  confirm: [PersonalizacionPayload, string, string, PersonalizacionDetalleLinea[]]
}>()

const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const receta = ref<RecetaDetallePersonalizacion | null>(null)
const loading = ref(false)
const incluidos = ref<Record<string, boolean>>({})
/** unidades por extra; ausente o 0 = no seleccionado. */
const extrasCantidad = ref<Record<string, number>>({})
const comentario = ref('')

function resetForm(detalle: RecetaDetallePersonalizacion) {
  const nextIncluidos: Record<string, boolean> = {}
  for (const ing of detalle.ingredientes) {
    nextIncluidos[ing.ingredienteItemId] =
      !(!ing.bloqueante && sinStock(ing.stock))
  }
  incluidos.value = nextIncluidos
  extrasCantidad.value = {}
  comentario.value = ''
}

function extraSeleccionado(id: string): boolean {
  return (extrasCantidad.value[id] ?? 0) >= 1
}

function toggleExtra(id: string, checked: boolean) {
  if (checked) extrasCantidad.value[id] = 1
  else delete extrasCantidad.value[id]
}

function setExtraCantidad(id: string, unidades: number) {
  extrasCantidad.value[id] = Math.max(1, Math.floor(unidades || 1))
}

async function cargarReceta(id: string) {
  loading.value = true
  receta.value = null
  try {
    const data = await useApiFetch<RecetaDetallePersonalizacion>(`${apiUrl}/items/${id}`)
    receta.value = data
    resetForm(data)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar la receta')
    toast.add({ title: msg, color: 'error' })
    open.value = false
  }
  finally {
    loading.value = false
  }
}

watch(
  () => [open.value, props.itemId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) cargarReceta(id)
    if (!isOpen) {
      receta.value = null
      incluidos.value = {}
      extrasCantidad.value = {}
      comentario.value = ''
    }
  },
)

function ingredienteDeshabilitado(ing: RecetaDetallePersonalizacion['ingredientes'][number]): boolean {
  return !ing.bloqueante && sinStock(ing.stock)
}

function extraDeshabilitado(extra: RecetaDetallePersonalizacion['extrasPermitidos'][number]): boolean {
  return sinStock(extra.stock)
}

const extrasSeleccionados = computed(() => {
  if (!receta.value) return []
  return receta.value.extrasPermitidos
    .filter((e) => extraSeleccionado(e.ingredienteItemId))
    .map((e) => ({ ...e, unidades: extrasCantidad.value[e.ingredienteItemId] ?? 1 }))
})

const precioPreview = computed(() => {
  if (!receta.value) return '0'
  return precioConExtras(receta.value.precioBase, extrasSeleccionados.value)
})

const resumenPreview = computed(() => {
  if (!receta.value) return ''
  const nombresOmitidos = receta.value.ingredientes
    .filter((ing) => !incluidos.value[ing.ingredienteItemId])
    .map((ing) => ing.ingredienteNombre)
  const extras = extrasSeleccionados.value.map((e) => ({
    nombre: e.ingredienteNombre,
    unidades: e.unidades,
  }))
  return resumenPersonalizacion(nombresOmitidos, extras, comentario.value)
})

const detallePreview = computed<PersonalizacionDetalleLinea[]>(() => {
  if (!receta.value) return []
  const nombresOmitidos = receta.value.ingredientes
    .filter((ing) => !incluidos.value[ing.ingredienteItemId])
    .map((ing) => ing.ingredienteNombre)
  const extras = extrasSeleccionados.value.map((e) => ({
    nombre: e.ingredienteNombre,
    unidades: e.unidades,
    precioExtra: e.precioExtra,
  }))
  return detallePersonalizacionPreview(nombresOmitidos, extras)
})

function cancelar() {
  open.value = false
}

function agregar() {
  if (!receta.value) return
  const omitidos = receta.value.ingredientes
    .filter((ing) => !incluidos.value[ing.ingredienteItemId])
    .map((ing) => ing.ingredienteItemId)
  const extras = extrasSeleccionados.value.map((e) => ({
    ingredienteItemId: e.ingredienteItemId,
    unidades: e.unidades,
  }))
  emit(
    'confirm',
    buildPersonalizacionPayload(omitidos, extras, comentario.value),
    resumenPreview.value,
    precioPreview.value,
    detallePreview.value,
  )
  open.value = false
}
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <div class="space-y-1">
        <span class="font-semibold text-default">Personalizar receta</span>
        <p v-if="receta" class="text-sm text-muted">{{ receta.nombre }}</p>
      </div>
    </template>

    <template #body>
      <div v-if="loading" class="flex items-center justify-center py-12">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="receta" class="space-y-6">
        <section v-if="receta.ingredientes.length" class="space-y-3">
          <h3 class="text-sm font-medium text-default">Ingredientes</h3>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="ing in receta.ingredientes"
              :key="ing.ingredienteItemId"
              class="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div class="min-w-0 flex-1 space-y-1">
                <p class="text-sm font-medium text-default">{{ ing.ingredienteNombre }}</p>
                <p class="text-xs text-muted">
                  {{ ing.cantidad }} {{ ing.unidadCodigo }}
                  <span v-if="ing.bloqueante"> · Bloqueante</span>
                </p>
                <p
                  v-if="sinStock(ing.stock) && incluidos[ing.ingredienteItemId]"
                  class="flex items-center gap-1 text-xs text-warning"
                >
                  <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
                  Sin stock disponible
                </p>
                <p
                  v-else-if="ingredienteDeshabilitado(ing)"
                  class="flex items-center gap-1 text-xs text-warning"
                >
                  <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
                  Sin stock — no se puede incluir
                </p>
              </div>
              <UFormField label="Incluir" class="shrink-0">
                <USwitch
                  :model-value="incluidos[ing.ingredienteItemId] ?? false"
                  :disabled="ingredienteDeshabilitado(ing)"
                  @update:model-value="incluidos[ing.ingredienteItemId] = $event"
                />
              </UFormField>
            </div>
          </div>
        </section>

        <section v-if="receta.extrasPermitidos.length" class="space-y-3">
          <h3 class="text-sm font-medium text-default">Extras</h3>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="extra in receta.extrasPermitidos"
              :key="extra.ingredienteItemId"
              class="px-4 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <UCheckbox
                  :model-value="extraSeleccionado(extra.ingredienteItemId)"
                  :disabled="extraDeshabilitado(extra)"
                  :label="extra.ingredienteNombre"
                  :description="`+${formatMonto(extra.precioExtra, receta.monedaId)} · ${extra.cantidad} ${extra.unidadCodigo}`"
                  @update:model-value="toggleExtra(extra.ingredienteItemId, $event)"
                />
                <UInputNumber
                  v-if="extraSeleccionado(extra.ingredienteItemId)"
                  :model-value="extrasCantidad[extra.ingredienteItemId] ?? 1"
                  :min="1"
                  :disabled="extraDeshabilitado(extra)"
                  class="w-28 shrink-0"
                  :aria-label="`Cantidad de ${extra.ingredienteNombre}`"
                  @update:model-value="setExtraCantidad(extra.ingredienteItemId, $event)"
                />
              </div>
              <p
                v-if="extraDeshabilitado(extra)"
                class="mt-1 flex items-center gap-1 pl-6 text-xs text-warning"
              >
                <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
                Sin stock disponible
              </p>
            </div>
          </div>
        </section>

        <section class="space-y-2">
          <UFormField label="Comentario">
            <UTextarea
              v-model="comentario"
              placeholder="Ej. término medio, sin sal..."
              :maxlength="200"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <p class="text-xs text-muted">{{ comentario.length }}/200</p>
        </section>

        <p v-if="resumenPreview" class="rounded-lg border border-default bg-muted px-4 py-3 text-sm text-default">
          {{ resumenPreview }}
        </p>
      </div>
    </template>

    <template #actions>
      <UButton label="Cancelar" color="neutral" variant="ghost" @click="cancelar" />
      <UButton
        color="primary"
        icon="i-lucide-plus"
        :disabled="loading || !receta"
        :label="receta ? `Agregar · ${formatMonto(precioPreview, receta.monedaId)}` : 'Agregar'"
        @click="agregar"
      />
    </template>
  </AppDrawer>
</template>
