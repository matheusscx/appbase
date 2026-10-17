<script setup lang="ts">
import { ESTADO_CAJA_LABEL } from '~/stores/caja'

const props = defineProps<{
  caja: {
    estado: string
    fechaApertura: string
    cajonNombre?: string | null
  }
  readonly?: boolean
  historialUrl?: string
  historialLabel?: string
}>()

const emit = defineEmits<{
  movimiento: []
  cerrar: []
}>()

const { formatFecha } = useFormatters()

const badgeColor = computed(() => {
  if (props.caja.estado === 'abierta') return 'success'
  if (props.caja.estado === 'en_conciliacion') return 'warning'
  return 'neutral'
})

// Las acciones de operación solo existen para la caja abierta propia.
const puedeOperar = computed(
  () => props.caja.estado === 'abierta' && !props.readonly,
)
</script>

<template>
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <div class="flex items-center gap-2">
        <h2 class="text-base font-semibold text-default">
          {{ caja.cajonNombre ?? 'Caja' }}
        </h2>
        <UBadge :color="badgeColor" variant="soft">
          {{ ESTADO_CAJA_LABEL[caja.estado] ?? caja.estado }}
        </UBadge>
      </div>
      <p class="text-sm text-muted mt-0.5">
        Apertura: {{ formatFecha(caja.fechaApertura) }}
      </p>
    </div>
    <div v-if="historialUrl || puedeOperar" class="flex flex-wrap items-center justify-end gap-3">
      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          v-if="historialUrl"
          :to="historialUrl"
          icon="i-lucide-history"
          color="neutral"
          variant="outline"
          size="xl"
          class="min-h-11"
          :label="historialLabel ?? 'Ver historial'"
        />
        <UButton
          v-if="puedeOperar"
          icon="i-lucide-circle-plus"
          color="neutral"
          variant="outline"
          size="xl"
          class="min-h-11"
          @click="emit('movimiento')"
        >
          + Movimiento
        </UButton>
      </div>
      <!-- Cerrar la caja es lo irreversible: aparte de lo que se usa todo el turno (03.7). -->
      <div v-if="puedeOperar" class="ms-4 border-s border-default ps-4">
        <UButton
          icon="i-lucide-lock"
          color="error"
          variant="soft"
          size="xl"
          class="min-h-11"
          @click="emit('cerrar')"
        >
          Cerrar caja
        </UButton>
      </div>
    </div>
  </div>
</template>
