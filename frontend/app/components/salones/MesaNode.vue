<script setup lang="ts">
import type { MesaResumen } from '~/composables/useSalones'
import { dimensionesMesaPx } from '~/utils/mesa-dimensiones'

const props = withDefaults(
  defineProps<{
    mesa: MesaResumen
    editable?: boolean
    selected?: boolean
    /** Tiene cuentas a nombre del garzón de esta tablet: se marca con texto, no solo con color. */
    propia?: boolean
  }>(),
  { editable: false, selected: false, propia: false },
)

// La tabla de tamaños vive en `~/utils/mesa-dimensiones`: la comparte el plano,
// que la necesita para detectar si una mesa se soltó encima de otra.
const dimensiones = computed(() => {
  const { width, height } = dimensionesMesaPx(props.mesa.forma, props.mesa.tamano)
  return { width: `${width}px`, height: `${height}px` }
})

// "hace 45 min": una mesa ocupada dice hace cuánto está abierta (auditoría UX 02.12). El reloj
// se mueve cada medio minuto solo mientras haya algo que mostrar.
const { formatHace } = useFormatters()
const ahora = ref(new Date())
let reloj: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  reloj = setInterval(() => { ahora.value = new Date() }, 30_000)
})
onBeforeUnmount(() => {
  if (reloj) clearInterval(reloj)
})
const tiempoAbierta = computed(() =>
  props.mesa.ocupada && props.mesa.abiertaDesde ? formatHace(props.mesa.abiertaDesde, ahora.value) : '',
)

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
      v-if="!tiempoAbierta"
      name="i-lucide-utensils"
      class="h-4 w-4"
      :class="mesa.ocupada ? 'text-warning' : 'text-muted'"
    />
    <span class="px-1 text-xs font-medium leading-tight text-default">
      {{ mesa.nombre }}
    </span>
    <span v-if="tiempoAbierta" class="px-1 text-xs leading-tight text-muted">
      {{ tiempoAbierta }}
    </span>
    <UBadge
      v-if="propia"
      label="Tuya"
      color="primary"
      variant="subtle"
      size="sm"
      class="absolute -left-1.5 -top-1.5 rounded-full"
    />
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
