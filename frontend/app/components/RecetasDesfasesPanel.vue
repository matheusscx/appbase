<script setup lang="ts">
import Decimal from 'decimal.js'

export interface DesfaseIngredienteDto {
  itemId: string
  nombre: string
  costoActual: string | null
}

export interface DesfaseRecetaDto {
  recetaItemId: string
  nombre: string
  costoActual: string
  costoPropuesto: string
  deltaCosto: string
  precioBase: string
  margenPctActual: string | null
  margenPctPropuesto: string | null
  precioSugerido: string | null
  ingredientesAfectados: DesfaseIngredienteDto[]
}

export interface AplicarDesfaseItem {
  recetaItemId: string
  actualizarPrecio?: boolean
  precioBase?: string
}

const props = withDefaults(
  defineProps<{
    filas: DesfaseRecetaDto[]
    highlightIngredienteId?: string | null
    loading?: boolean
  }>(),
  {
    highlightIngredienteId: null,
    loading: false,
  },
)

const emit = defineEmits<{
  aplicar: [items: AplicarDesfaseItem[]]
  descartar: [recetaItemIds: string[]]
  cerrar: []
}>()

const { formatMonto, formatPorcentaje } = useFormatters()

interface RowState {
  actualizarPrecio: boolean
  precioEditado: string
}

const selected = ref<Set<string>>(new Set())
const rowState = ref<Record<string, RowState>>({})

function initFromFilas(filas: DesfaseRecetaDto[]) {
  const nextSelected = new Set<string>()
  const nextState: Record<string, RowState> = {}
  for (const f of filas) {
    nextSelected.add(f.recetaItemId)
    nextState[f.recetaItemId] = {
      actualizarPrecio: false,
      precioEditado: f.precioSugerido ?? f.precioBase,
    }
  }
  selected.value = nextSelected
  rowState.value = nextState
}

watch(
  () => props.filas,
  (filas) => initFromFilas(filas),
  { immediate: true },
)

const allSelected = computed(
  () => props.filas.length > 0 && props.filas.every((f) => selected.value.has(f.recetaItemId)),
)

const someSelected = computed(() =>
  props.filas.some((f) => selected.value.has(f.recetaItemId)),
)

function toggleAll(value: boolean | 'indeterminate') {
  if (value === true) {
    selected.value = new Set(props.filas.map((f) => f.recetaItemId))
  } else {
    selected.value = new Set()
  }
}

function toggleOne(id: string, value: boolean | 'indeterminate') {
  const next = new Set(selected.value)
  if (value === true) next.add(id)
  else next.delete(id)
  selected.value = next
}

function isHighlighted(fila: DesfaseRecetaDto): boolean {
  const hid = props.highlightIngredienteId
  if (!hid) return false
  return fila.ingredientesAfectados.some((i) => i.itemId === hid)
}

function deltaClass(delta: string): string {
  try {
    const d = new Decimal(delta)
    if (d.isZero()) return 'text-muted'
    return d.isPositive() ? 'text-error' : 'text-success'
  } catch {
    return 'text-muted'
  }
}

function onAplicar() {
  const items: AplicarDesfaseItem[] = props.filas
    .filter((f) => selected.value.has(f.recetaItemId))
    .map((f) => {
      const st = rowState.value[f.recetaItemId]
      const item: AplicarDesfaseItem = { recetaItemId: f.recetaItemId }
      if (st?.actualizarPrecio) {
        item.actualizarPrecio = true
        item.precioBase = st.precioEditado
      }
      return item
    })
  if (!items.length) return
  emit('aplicar', items)
}

function onDescartar() {
  const ids = props.filas
    .filter((f) => selected.value.has(f.recetaItemId))
    .map((f) => f.recetaItemId)
  if (!ids.length) return
  emit('descartar', ids)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-muted">
      Estas recetas tienen un costo de insumos distinto al registrado. Puedes aplicar el nuevo costo,
      descartar el aviso o revisar más tarde.
    </p>

    <div class="overflow-x-auto rounded-lg border border-default">
      <table class="w-full min-w-[44rem] text-sm">
        <thead class="bg-elevated text-left text-muted">
          <tr class="border-b border-default">
            <th class="w-10 px-3 py-2">
              <UCheckbox
                :model-value="allSelected ? true : someSelected ? 'indeterminate' : false"
                aria-label="Seleccionar todas"
                @update:model-value="toggleAll"
              />
            </th>
            <th class="px-3 py-2 font-medium">Receta</th>
            <th class="px-3 py-2 font-medium text-right">Costo</th>
            <th class="px-3 py-2 font-medium text-right">Margen</th>
            <th class="px-3 py-2 font-medium">Precio</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-if="loading">
            <td colspan="5" class="px-3 py-8 text-center text-muted">Cargando…</td>
          </tr>
          <tr v-else-if="!filas.length">
            <td colspan="5" class="px-3 py-8 text-center text-muted">Sin recetas desfasadas.</td>
          </tr>
          <tr
            v-for="fila in filas"
            v-else
            :key="fila.recetaItemId"
            :class="isHighlighted(fila) ? 'bg-elevated' : 'bg-default'"
          >
            <td class="px-3 py-3 align-top">
              <UCheckbox
                :model-value="selected.has(fila.recetaItemId)"
                :aria-label="`Seleccionar ${fila.nombre}`"
                @update:model-value="(v) => toggleOne(fila.recetaItemId, v)"
              />
            </td>
            <td class="px-3 py-3 align-top">
              <div class="font-medium text-default">{{ fila.nombre }}</div>
              <div
                v-if="fila.ingredientesAfectados.length"
                class="mt-1 text-xs text-muted"
              >
                {{ fila.ingredientesAfectados.map((i) => i.nombre).join(', ') }}
              </div>
            </td>
            <td class="px-3 py-3 align-top text-right font-mono tabular-nums">
              <div class="text-default">
                {{ formatMonto(fila.costoActual) }}
                <span class="text-muted">→</span>
                {{ formatMonto(fila.costoPropuesto) }}
              </div>
              <div class="text-xs" :class="deltaClass(fila.deltaCosto)">
                Δ {{ formatMonto(fila.deltaCosto) }}
              </div>
            </td>
            <td class="px-3 py-3 align-top text-right tabular-nums">
              <span class="text-default">{{ formatPorcentaje(fila.margenPctActual) }}</span>
              <span class="text-muted"> → </span>
              <span class="text-default">{{ formatPorcentaje(fila.margenPctPropuesto) }}</span>
            </td>
            <td class="px-3 py-3 align-top">
              <div class="flex min-w-40 flex-col gap-2">
                <MoneyInput
                  v-if="rowState[fila.recetaItemId]"
                  v-model="rowState[fila.recetaItemId]!.precioEditado"
                  oficial
                  size="sm"
                  class="w-full"
                  :disabled="!rowState[fila.recetaItemId]?.actualizarPrecio"
                />
                <UCheckbox
                  v-if="rowState[fila.recetaItemId]"
                  v-model="rowState[fila.recetaItemId]!.actualizarPrecio"
                  label="Actualizar precio"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <UButton color="neutral" variant="ghost" @click="emit('cerrar')">
        Después
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="!someSelected || loading"
        @click="onDescartar"
      >
        Descartar seleccionadas
      </UButton>
      <UButton
        color="primary"
        :disabled="!someSelected || loading"
        @click="onAplicar"
      >
        Aplicar seleccionadas
      </UButton>
    </div>
  </div>
</template>
