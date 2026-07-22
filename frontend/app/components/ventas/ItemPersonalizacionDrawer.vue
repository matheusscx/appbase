<script setup lang="ts">
import {
  buildPersonalizacionPayload,
  precioConExtras,
  resumenPersonalizacion,
  detallePersonalizacionPreview,
  sinStock,
  opcionSinStock,
  type PersonalizacionPayload,
  type PersonalizacionGrupoPayload,
  type PersonalizacionComponentePayload,
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
/** Selección de grupos de componentes: clave `componenteItemId#unidad` → grupoId → itemId → unidades. */
const componentesSeleccion = ref<Record<string, Record<string, Record<string, number>>>>({})

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
  componentesSeleccion.value = {}
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
      componentesSeleccion.value = {}
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

function opcionDeshabilitada(o: GrupoOpcionPersonalizacion): boolean {
  return !!o.esPendiente || opcionSinStock(o.stock)
}

/** Grupo obligatorio (min ≥ 1) sin ninguna opción disponible: nunca se puede cumplir. */
function grupoAgotado(g: GrupoPersonalizacion): boolean {
  return g.min >= 1 && g.opciones.every((o) => opcionDeshabilitada(o))
}

function totalUnidadesGrupoEn(sel: Record<string, number>): number {
  return Object.values(sel).reduce((acc, u) => acc + u, 0)
}

function grupoValidoEn(g: GrupoPersonalizacion, sel: Record<string, number>): boolean {
  if (grupoAgotado(g)) return false
  const total = totalUnidadesGrupoEn(sel)
  return total >= g.min && total <= g.max
}

const gruposValidos = computed(() =>
  (detalle.value?.grupos ?? []).every((g) =>
    grupoValidoEn(g, gruposSeleccion.value[g.grupoModificadorId] ?? {}),
  ),
)

/** Cada (componente, unidad) cumple min/max de todos sus grupos. */
const componentesValidos = computed(() => {
  for (const comp of detalle.value?.componentes ?? []) {
    if (!comp.grupos.length) continue
    for (let u = 1; u <= Number(comp.cantidad); u++) {
      const sel = componentesSeleccion.value[`${comp.componenteItemId}#${u}`] ?? {}
      for (const g of comp.grupos) {
        if (!grupoValidoEn(g, sel[g.grupoModificadorId] ?? {})) return false
      }
    }
  }
  return true
})

/** Escribe la selección de un grupo de (componente, unidad) manteniendo el resto. */
function setComponenteSeleccion(
  componenteItemId: string,
  unidad: number,
  grupoId: string,
  sel: Record<string, number>,
) {
  const key = `${componenteItemId}#${unidad}`
  const actual = componentesSeleccion.value[key] ?? {}
  componentesSeleccion.value = {
    ...componentesSeleccion.value,
    [key]: { ...actual, [grupoId]: sel },
  }
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

/** Opciones elegidas en los grupos de cada (componente, unidad), aplanadas para el preview de precio. */
const componentesOpcionesSeleccionadas = computed(() => {
  if (!detalle.value) return []
  const flat: { precioExtra: string, unidades: number }[] = []
  for (const comp of detalle.value.componentes ?? []) {
    if (!comp.grupos.length) continue
    for (let u = 1; u <= Number(comp.cantidad); u++) {
      const sel = componentesSeleccion.value[`${comp.componenteItemId}#${u}`] ?? {}
      for (const g of comp.grupos) {
        const selGrupo = sel[g.grupoModificadorId] ?? {}
        for (const o of g.opciones) {
          const unidades = selGrupo[o.itemId] ?? 0
          if (unidades > 0) flat.push({ precioExtra: o.precioExtra, unidades })
        }
      }
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
  for (const comp of detalle.value.componentes ?? []) {
    if (!comp.grupos.length) continue
    for (let u = 1; u <= Number(comp.cantidad); u++) {
      const sel = componentesSeleccion.value[`${comp.componenteItemId}#${u}`] ?? {}
      const sufijoUnidad = Number(comp.cantidad) > 1 ? ` #${u}` : ''
      for (const g of comp.grupos) {
        const selGrupo = sel[g.grupoModificadorId] ?? {}
        for (const o of g.opciones) {
          const unidades = selGrupo[o.itemId] ?? 0
          if (unidades > 0) {
            partes.push({
              grupoNombre: `${comp.componenteNombre}${sufijoUnidad} · ${g.nombre}`,
              opcionNombre: o.itemNombre,
              unidades,
            })
          }
        }
      }
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
    ...componentesOpcionesSeleccionadas.value,
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

const confirmDisabled = computed(() =>
  loading.value || !detalle.value || !gruposValidos.value || !componentesValidos.value,
)

function cancelar() {
  open.value = false
}

function opcionesDe(sel: Record<string, number>): PersonalizacionGrupoPayload['opciones'] {
  return Object.entries(sel)
    .filter(([, unidades]) => unidades > 0)
    .map(([itemId, unidades]) => ({ itemId, unidades }))
}

function agregar() {
  if (!detalle.value || !gruposValidos.value || !componentesValidos.value) return
  const omitidos = detalle.value.ingredientes
    .filter((ing) => !incluidos.value[ing.ingredienteItemId])
    .map((ing) => ing.ingredienteItemId)
  const extras = extrasSeleccionados.value.map((e) => ({
    ingredienteItemId: e.ingredienteItemId,
    unidades: e.unidades,
  }))
  const grupos: PersonalizacionGrupoPayload[] = detalle.value.grupos.map((g) => ({
    grupoId: g.grupoModificadorId,
    opciones: opcionesDe(gruposSeleccion.value[g.grupoModificadorId] ?? {}),
  }))
  const componentes: PersonalizacionComponentePayload[] = []
  for (const comp of detalle.value.componentes ?? []) {
    if (!comp.grupos.length) continue
    for (let u = 1; u <= Number(comp.cantidad); u++) {
      const sel = componentesSeleccion.value[`${comp.componenteItemId}#${u}`] ?? {}
      componentes.push({
        componenteItemId: comp.componenteItemId,
        unidad: u,
        grupos: comp.grupos.map((g) => ({
          grupoId: g.grupoModificadorId,
          opciones: opcionesDe(sel[g.grupoModificadorId] ?? {}),
        })),
      })
    }
  }
  emit(
    'confirm',
    buildPersonalizacionPayload(omitidos, extras, comentario.value, grupos, componentes),
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
        <VentasItemPersonalizacionGrupo
          v-for="grupo in detalle.grupos"
          :key="grupo.grupoModificadorId"
          :grupo="grupo"
          :moneda-id="detalle.monedaId"
          :seleccion="gruposSeleccion[grupo.grupoModificadorId] ?? {}"
          @update:seleccion="gruposSeleccion[grupo.grupoModificadorId] = $event"
        />

        <section
          v-for="comp in (detalle.componentes ?? []).filter((c) => c.grupos.length)"
          :key="comp.componenteItemId"
          class="space-y-4"
        >
          <div
            v-for="u in Number(comp.cantidad)"
            :key="`${comp.componenteItemId}#${u}`"
            class="space-y-3 rounded-lg border border-default p-4"
          >
            <p class="text-sm font-semibold text-default">
              {{ comp.componenteNombre }}<span v-if="Number(comp.cantidad) > 1" class="text-muted"> #{{ u }}</span>
            </p>
            <VentasItemPersonalizacionGrupo
              v-for="grupo in comp.grupos"
              :key="grupo.grupoModificadorId"
              :grupo="grupo"
              :moneda-id="detalle.monedaId"
              :seleccion="componentesSeleccion[`${comp.componenteItemId}#${u}`]?.[grupo.grupoModificadorId] ?? {}"
              @update:seleccion="setComponenteSeleccion(comp.componenteItemId, u, grupo.grupoModificadorId, $event)"
            />
          </div>
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
