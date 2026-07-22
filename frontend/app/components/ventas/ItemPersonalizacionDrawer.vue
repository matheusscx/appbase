<script setup lang="ts">
import Decimal from 'decimal.js'
import {
  buildPersonalizacionPayload,
  precioConExtras,
  resumenPersonalizacion,
  detallePersonalizacionPreview,
  sinStock,
  opcionSinStock,
  type PersonalizacionPayload,
  type PersonalizacionGrupoPayload,
  type RecetaDetallePersonalizacion,
  type GrupoPersonalizacion,
  type GrupoOpcionPersonalizacion,
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

/** Ítem personalizable (receta o combo) — la misma API/drawer sirve para ambos. */
const detalle = ref<RecetaDetallePersonalizacion | null>(null)
const loading = ref(false)
const incluidos = ref<Record<string, boolean>>({})
/** unidades por extra; ausente o 0 = no seleccionado. */
const extrasCantidad = ref<Record<string, number>>({})
const comentario = ref('')
/** grupoModificadorId -> itemId de la opción -> unidades elegidas. */
const gruposSeleccion = ref<Record<string, Record<string, number>>>({})

function resetForm(det: RecetaDetallePersonalizacion) {
  const nextIncluidos: Record<string, boolean> = {}
  for (const ing of det.ingredientes) {
    nextIncluidos[ing.ingredienteItemId] =
      !(!ing.bloqueante && sinStock(ing.stock))
  }
  incluidos.value = nextIncluidos
  extrasCantidad.value = {}
  comentario.value = ''
  gruposSeleccion.value = {}
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

async function cargarDetalle(id: string) {
  loading.value = true
  detalle.value = null
  try {
    const data = await useApiFetch<RecetaDetallePersonalizacion>(`${apiUrl}/items/${id}`)
    detalle.value = data
    resetForm(data)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar el ítem')
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
    if (isOpen && id) cargarDetalle(id)
    if (!isOpen) {
      detalle.value = null
      incluidos.value = {}
      extrasCantidad.value = {}
      comentario.value = ''
      gruposSeleccion.value = {}
    }
  },
)

function ingredienteDeshabilitado(ing: RecetaDetallePersonalizacion['ingredientes'][number]): boolean {
  return !ing.bloqueante && sinStock(ing.stock)
}

function extraDeshabilitado(extra: RecetaDetallePersonalizacion['extrasPermitidos'][number]): boolean {
  return sinStock(extra.stock)
}

// ── Grupos de modificadores ──────────────────────────────────────────────

const NINGUNA = '__ninguna__'

function reglaGrupo(g: GrupoPersonalizacion): string {
  if (g.min === g.max) return g.min === 1 ? 'Elige 1' : `Elige ${g.min}`
  if (g.min === 0) return `Elige hasta ${g.max}`
  return `Elige entre ${g.min} y ${g.max}`
}

/** Opción única (`max === 1`) → radio; varias (`max > 1`) → checkbox + stepper. */
function esGrupoUnico(g: GrupoPersonalizacion): boolean {
  return g.max === 1
}

function unidadesOpcion(grupoId: string, itemId: string): number {
  return gruposSeleccion.value[grupoId]?.[itemId] ?? 0
}

function opcionSeleccionada(grupoId: string, itemId: string): boolean {
  return unidadesOpcion(grupoId, itemId) >= 1
}

function totalUnidadesGrupo(g: GrupoPersonalizacion): number {
  const sel = gruposSeleccion.value[g.grupoModificadorId] ?? {}
  return Object.values(sel).reduce((acc, u) => acc + u, 0)
}

function opcionDeshabilitada(o: GrupoOpcionPersonalizacion): boolean {
  return !!o.esPendiente || opcionSinStock(o.stock)
}

/** Motivo de la opción no seleccionable, para mensaje y tooltip. */
function opcionMotivo(o: GrupoOpcionPersonalizacion): string | null {
  if (o.esPendiente) return 'No configurada para este item'
  if (opcionSinStock(o.stock)) return 'Sin stock disponible'
  return null
}

/** Grupo obligatorio (min ≥ 1) sin ninguna opción disponible: nunca se puede cumplir. */
function grupoAgotado(g: GrupoPersonalizacion): boolean {
  return g.min >= 1 && g.opciones.every((o) => opcionDeshabilitada(o))
}

function grupoValido(g: GrupoPersonalizacion): boolean {
  if (grupoAgotado(g)) return false
  const total = totalUnidadesGrupo(g)
  return total >= g.min && total <= g.max
}

const gruposValidos = computed(() =>
  (detalle.value?.grupos ?? []).every((g) => grupoValido(g)),
)

function radioSeleccionado(g: GrupoPersonalizacion): string {
  const sel = gruposSeleccion.value[g.grupoModificadorId] ?? {}
  const elegido = Object.entries(sel).find(([, u]) => u > 0)
  return elegido?.[0] ?? NINGUNA
}

interface RadioGrupoItem {
  label: string
  description?: string
  value: string
  disabled: boolean
}

function radioItems(g: GrupoPersonalizacion): RadioGrupoItem[] {
  const items: RadioGrupoItem[] = g.opciones.map((o) => ({
    label: o.itemNombre,
    description: opcionMotivo(o) ?? opcionDescripcion(o),
    value: o.itemId,
    disabled: opcionDeshabilitada(o),
  }))
  if (g.min === 0) {
    items.unshift({ label: 'Ninguna', value: NINGUNA, disabled: false })
  }
  return items
}

function onRadioChange(g: GrupoPersonalizacion, value: string) {
  const nuevo: Record<string, number> = {}
  if (value !== NINGUNA) nuevo[value] = 1
  gruposSeleccion.value = { ...gruposSeleccion.value, [g.grupoModificadorId]: nuevo }
}

function toggleOpcionMulti(g: GrupoPersonalizacion, itemId: string, checked: boolean | 'indeterminate') {
  const sel = { ...(gruposSeleccion.value[g.grupoModificadorId] ?? {}) }
  if (checked === true) sel[itemId] = 1
  else delete sel[itemId]
  gruposSeleccion.value = { ...gruposSeleccion.value, [g.grupoModificadorId]: sel }
}

function setUnidadesOpcion(g: GrupoPersonalizacion, itemId: string, unidades: number) {
  const sel = { ...(gruposSeleccion.value[g.grupoModificadorId] ?? {}) }
  sel[itemId] = Math.max(1, Math.floor(unidades || 1))
  gruposSeleccion.value = { ...gruposSeleccion.value, [g.grupoModificadorId]: sel }
}

function opcionDescripcion(o: GrupoOpcionPersonalizacion): string {
  return new Decimal(o.precioExtra || '0').greaterThan(0)
    ? `+${formatMonto(o.precioExtra, detalle.value?.monedaId ?? '')}`
    : 'Sin costo adicional'
}

const gruposOpcionesSeleccionadas = computed(() => {
  if (!detalle.value) return []
  const flat: { precioExtra: string, unidades: number }[] = []
  for (const g of detalle.value.grupos) {
    const sel = gruposSeleccion.value[g.grupoModificadorId] ?? {}
    for (const o of g.opciones) {
      const unidades = sel[o.itemId] ?? 0
      if (unidades > 0) flat.push({ precioExtra: o.precioExtra, unidades })
    }
  }
  return flat
})

const gruposResumen = computed(() => {
  if (!detalle.value) return []
  const partes: { grupoNombre: string, opcionNombre: string, unidades: number }[] = []
  for (const g of detalle.value.grupos) {
    const sel = gruposSeleccion.value[g.grupoModificadorId] ?? {}
    for (const o of g.opciones) {
      const unidades = sel[o.itemId] ?? 0
      if (unidades > 0) partes.push({ grupoNombre: g.nombre, opcionNombre: o.itemNombre, unidades })
    }
  }
  return partes
})

// ── Extras (recetas) ─────────────────────────────────────────────────────

const extrasSeleccionados = computed(() => {
  if (!detalle.value) return []
  return detalle.value.extrasPermitidos
    .filter((e) => extraSeleccionado(e.ingredienteItemId))
    .map((e) => ({ ...e, unidades: extrasCantidad.value[e.ingredienteItemId] ?? 1 }))
})

const precioPreview = computed(() => {
  if (!detalle.value) return '0'
  return precioConExtras(detalle.value.precioBase, [
    ...extrasSeleccionados.value,
    ...gruposOpcionesSeleccionadas.value,
  ])
})

const resumenPreview = computed(() => {
  if (!detalle.value) return ''
  const nombresOmitidos = detalle.value.ingredientes
    .filter((ing) => !incluidos.value[ing.ingredienteItemId])
    .map((ing) => ing.ingredienteNombre)
  const extras = extrasSeleccionados.value.map((e) => ({
    nombre: e.ingredienteNombre,
    unidades: e.unidades,
  }))
  return resumenPersonalizacion(nombresOmitidos, extras, comentario.value, gruposResumen.value)
})

const detallePreview = computed<PersonalizacionDetalleLinea[]>(() => {
  if (!detalle.value) return []
  const nombresOmitidos = detalle.value.ingredientes
    .filter((ing) => !incluidos.value[ing.ingredienteItemId])
    .map((ing) => ing.ingredienteNombre)
  const extras = extrasSeleccionados.value.map((e) => ({
    nombre: e.ingredienteNombre,
    unidades: e.unidades,
    precioExtra: e.precioExtra,
  }))
  return detallePersonalizacionPreview(nombresOmitidos, extras)
})

const confirmDisabled = computed(() => loading.value || !detalle.value || !gruposValidos.value)

function cancelar() {
  open.value = false
}

function agregar() {
  if (!detalle.value || !gruposValidos.value) return
  const omitidos = detalle.value.ingredientes
    .filter((ing) => !incluidos.value[ing.ingredienteItemId])
    .map((ing) => ing.ingredienteItemId)
  const extras = extrasSeleccionados.value.map((e) => ({
    ingredienteItemId: e.ingredienteItemId,
    unidades: e.unidades,
  }))
  const grupos: PersonalizacionGrupoPayload[] = detalle.value.grupos.map((g) => {
    const sel = gruposSeleccion.value[g.grupoModificadorId] ?? {}
    const opciones = Object.entries(sel)
      .filter(([, unidades]) => unidades > 0)
      .map(([itemId, unidades]) => ({ itemId, unidades }))
    return { grupoId: g.grupoModificadorId, opciones }
  })
  emit(
    'confirm',
    buildPersonalizacionPayload(omitidos, extras, comentario.value, grupos),
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
        <span class="font-semibold text-default">Personalizar</span>
        <p v-if="detalle" class="text-sm text-muted">{{ detalle.nombre }}</p>
      </div>
    </template>

    <template #body>
      <div v-if="loading" class="flex items-center justify-center py-12">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="detalle" class="space-y-6">
        <section
          v-for="grupo in detalle.grupos"
          :key="grupo.grupoModificadorId"
          class="space-y-3"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-sm font-medium text-default">{{ grupo.nombre }}</h3>
            <span class="text-xs text-muted shrink-0">{{ reglaGrupo(grupo) }}</span>
          </div>

          <p
            v-if="grupoAgotado(grupo)"
            class="flex items-center gap-1 text-xs text-error"
          >
            <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
            Sin opciones disponibles — no se puede agregar este ítem
          </p>

          <template v-else>
            <URadioGroup
              v-if="esGrupoUnico(grupo)"
              :model-value="radioSeleccionado(grupo)"
              :items="radioItems(grupo)"
              @update:model-value="onRadioChange(grupo, $event as string)"
            />

            <div v-else class="divide-y divide-default rounded-lg border border-default">
              <div
                v-for="opcion in grupo.opciones"
                :key="opcion.grupoOpcionId"
                class="px-4 py-3"
                :title="opcionMotivo(opcion) ?? undefined"
              >
                <div class="flex items-start justify-between gap-3">
                  <UCheckbox
                    :model-value="opcionSeleccionada(grupo.grupoModificadorId, opcion.itemId)"
                    :disabled="opcionDeshabilitada(opcion)"
                    :label="opcion.itemNombre"
                    :description="opcionDescripcion(opcion)"
                    @update:model-value="toggleOpcionMulti(grupo, opcion.itemId, $event)"
                  />
                  <UInputNumber
                    v-if="opcionSeleccionada(grupo.grupoModificadorId, opcion.itemId)"
                    :model-value="unidadesOpcion(grupo.grupoModificadorId, opcion.itemId)"
                    :min="1"
                    :disabled="opcionDeshabilitada(opcion)"
                    class="w-28 shrink-0"
                    :aria-label="`Unidades de ${opcion.itemNombre}`"
                    @update:model-value="setUnidadesOpcion(grupo, opcion.itemId, $event)"
                  />
                </div>
                <p
                  v-if="opcionMotivo(opcion)"
                  class="mt-1 flex items-center gap-1 pl-6 text-xs text-warning"
                >
                  <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
                  {{ opcionMotivo(opcion) }}
                </p>
              </div>
            </div>

            <p
              v-if="!grupoValido(grupo)"
              class="text-xs text-warning"
            >
              {{ reglaGrupo(grupo) }} para continuar
            </p>
          </template>
        </section>

        <section v-if="detalle.ingredientes.length" class="space-y-3">
          <h3 class="text-sm font-medium text-default">Ingredientes</h3>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="ing in detalle.ingredientes"
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

        <section v-if="detalle.extrasPermitidos.length" class="space-y-3">
          <h3 class="text-sm font-medium text-default">Extras</h3>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="extra in detalle.extrasPermitidos"
              :key="extra.ingredienteItemId"
              class="px-4 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <UCheckbox
                  :model-value="extraSeleccionado(extra.ingredienteItemId)"
                  :disabled="extraDeshabilitado(extra)"
                  :label="extra.ingredienteNombre"
                  :description="`+${formatMonto(extra.precioExtra, detalle.monedaId)} · ${extra.cantidad} ${extra.unidadCodigo}`"
                  @update:model-value="toggleExtra(extra.ingredienteItemId, $event as boolean)"
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
        :disabled="confirmDisabled"
        :label="detalle ? `Agregar · ${formatMonto(precioPreview, detalle.monedaId)}` : 'Agregar'"
        @click="agregar"
      />
    </template>
  </AppDrawer>
</template>
