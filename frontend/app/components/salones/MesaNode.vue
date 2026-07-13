<script setup lang="ts">
import type { MesaResumen } from '~/composables/useSalones'

const props = withDefaults(
  defineProps<{
    mesa: MesaResumen
    editable?: boolean
    selected?: boolean
  }>(),
  { editable: false, selected: false },
)

// Tamaño base (px) por tamaño de mesa; rectangular multiplica el ancho.
const TAMANO_PX: Record<MesaResumen['tamano'], number> = {
  pequeno: 64,
  mediano: 80,
  grande: 96,
  extra_grande: 112,
}

const dimensiones = computed(() => {
  const base = TAMANO_PX[props.mesa.tamano]
  const width = props.mesa.forma === 'rectangular' ? base * 1.5 : base
  return { width: `${width}px`, height: `${base}px` }
})

const formaClass = computed(() =>
  props.mesa.forma === 'redonda' ? 'rounded-full' : 'rounded-lg',
)
</script>

<template>
  <div
    class="flex select-none flex-col items-center justify-center gap-1 border-2 text-center shadow-sm transition-colors"
    :class="[
      formaClass,
      editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
      selected ? 'border-primary ring-2 ring-primary' : 'border-default',
      mesa.ocupada ? 'bg-warning/15 border-warning' : 'bg-elevated hover:bg-muted',
    ]"
    :style="dimensiones"
  >
    <UIcon
      name="i-lucide-utensils"
      class="h-4 w-4"
      :class="mesa.ocupada ? 'text-warning' : 'text-muted'"
    />
    <span class="px-1 text-xs font-medium leading-tight text-default">
      {{ mesa.nombre }}
    </span>
    <UBadge
      v-if="mesa.ocupada"
      :label="String(mesa.cuentasAbiertas)"
      color="warning"
      variant="solid"
      size="sm"
      class="absolute -right-1.5 -top-1.5 rounded-full"
    />
  </div>
</template>
