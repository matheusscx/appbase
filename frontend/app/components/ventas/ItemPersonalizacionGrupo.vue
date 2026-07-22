<script setup lang="ts">
import Decimal from 'decimal.js'
import {
  opcionSinStock,
  type GrupoPersonalizacion,
  type GrupoOpcionPersonalizacion,
} from '~/composables/useRecetaPersonalizacion'

/**
 * Control reutilizable de un grupo de modificadores: sirve tanto para los grupos
 * propios del item como para los grupos de cada componente/unidad de un combo.
 * El estado de selección (`grupoModificadorId` → itemId → unidades) lo posee el
 * padre; aquí solo se lee/escribe el sub-record de este grupo.
 */
const props = defineProps<{
  grupo: GrupoPersonalizacion
  monedaId: string
}>()

/** itemId de la opción → unidades elegidas. */
const seleccion = defineModel<Record<string, number>>('seleccion', { default: () => ({}) })

const { formatMonto } = useFormatters()

const NINGUNA = '__ninguna__'

function reglaGrupo(g: GrupoPersonalizacion): string {
  if (g.min === g.max) return g.min === 1 ? 'Elige 1' : `Elige ${g.min}`
  if (g.min === 0) return `Elige hasta ${g.max}`
  return `Elige entre ${g.min} y ${g.max}`
}

function opcionDeshabilitada(o: GrupoOpcionPersonalizacion): boolean {
  return !!o.esPendiente || opcionSinStock(o.stock)
}

/** Grupo obligatorio (min ≥ 1) sin ninguna opción disponible: nunca se puede cumplir. */
const grupoAgotado = computed(
  () => props.grupo.min >= 1 && props.grupo.opciones.every((o) => opcionDeshabilitada(o)),
)

function labelOpcion(o: GrupoOpcionPersonalizacion): string {
  return new Decimal(o.precioExtra || '0').greaterThan(0)
    ? `${o.itemNombre} · +${formatMonto(o.precioExtra, props.monedaId)}`
    : o.itemNombre
}

interface SelectItem {
  label: string
  value: string
}

/** Opciones seleccionables — se excluyen las no vendibles (`esPendiente`/sin stock). */
const items = computed<SelectItem[]>(() => {
  const base = props.grupo.opciones
    .filter((o) => !opcionDeshabilitada(o))
    .map((o) => ({ label: labelOpcion(o), value: o.itemId }))
  if (props.grupo.min === 0 && props.grupo.max === 1) {
    return [{ label: 'Ninguna', value: NINGUNA }, ...base]
  }
  return base
})

const esUnico = computed(() => props.grupo.max === 1)

const totalUnidades = computed(() =>
  Object.values(seleccion.value).reduce((acc, u) => acc + u, 0),
)

const grupoValido = computed(() => {
  if (grupoAgotado.value) return false
  return totalUnidades.value >= props.grupo.min && totalUnidades.value <= props.grupo.max
})

// ── Selector simple (max === 1) ──────────────────────────────────────────
const valorSimple = computed<string | undefined>(() => {
  const elegido = Object.entries(seleccion.value).find(([, u]) => u > 0)?.[0]
  if (elegido) return elegido
  return props.grupo.min === 0 ? NINGUNA : undefined
})

function onSimple(value: string | undefined) {
  seleccion.value = value && value !== NINGUNA ? { [value]: 1 } : {}
}

// ── Selector múltiple (max > 1) — el selector elige qué opciones; el stepper,
//    cuántas unidades de cada una (preserva el conteo por opción). ──────────
const valoresMultiple = computed<string[]>(() =>
  Object.entries(seleccion.value).filter(([, u]) => u > 0).map(([id]) => id),
)

function onMultiple(values: string[]) {
  const nuevo: Record<string, number> = {}
  for (const id of values) nuevo[id] = seleccion.value[id] ?? 1
  seleccion.value = nuevo
}

function setUnidades(itemId: string, unidades: number) {
  seleccion.value = { ...seleccion.value, [itemId]: Math.max(1, Math.floor(unidades || 1)) }
}

function nombreOpcion(itemId: string): string {
  return props.grupo.opciones.find((o) => o.itemId === itemId)?.itemNombre ?? itemId
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-sm font-medium text-default">{{ grupo.nombre }}</h3>
      <span class="text-xs text-muted shrink-0">{{ reglaGrupo(grupo) }}</span>
    </div>

    <p
      v-if="grupoAgotado"
      class="flex items-center gap-1 text-xs text-error"
    >
      <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
      Sin opciones disponibles — no se puede agregar este ítem
    </p>

    <template v-else>
      <USelectMenu
        v-if="esUnico"
        :model-value="valorSimple"
        :items="items"
        value-key="value"
        :placeholder="grupo.min === 0 ? 'Ninguna' : 'Selecciona una opción'"
        class="w-full"
        @update:model-value="onSimple"
      />

      <template v-else>
        <USelectMenu
          :model-value="valoresMultiple"
          :items="items"
          value-key="value"
          multiple
          placeholder="Selecciona opciones"
          class="w-full"
          @update:model-value="onMultiple"
        />

        <div
          v-if="valoresMultiple.length"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <div
            v-for="itemId in valoresMultiple"
            :key="itemId"
            class="flex items-center justify-between gap-3 px-4 py-2"
          >
            <span class="text-sm text-default">{{ nombreOpcion(itemId) }}</span>
            <UInputNumber
              :model-value="seleccion[itemId] ?? 1"
              :min="1"
              class="w-28 shrink-0"
              :aria-label="`Unidades de ${nombreOpcion(itemId)}`"
              @update:model-value="setUnidades(itemId, $event)"
            />
          </div>
        </div>
      </template>

      <p
        v-if="!grupoValido"
        class="text-xs text-warning"
      >
        {{ reglaGrupo(grupo) }} para continuar
      </p>
    </template>
  </div>
</template>
