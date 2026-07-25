<script setup lang="ts">
const props = defineProps<{
  caja: {
    estado: string
    fechaApertura: string
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

const enConciliacion = computed(() => props.caja.estado === 'en_conciliacion')
</script>

<template>
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <div class="flex items-center gap-2">
        <h2 class="text-base font-semibold text-default">
          Caja
        </h2>
        <UBadge :color="caja.estado === 'abierta' ? 'success' : 'neutral'" variant="soft">
          {{ caja.estado.toUpperCase() }}
        </UBadge>
      </div>
      <p class="text-sm text-muted mt-0.5">
        Apertura: {{ formatFecha(caja.fechaApertura) }}
      </p>
    </div>
    <div v-if="historialUrl || !readonly" class="flex flex-wrap justify-end gap-2">
      <UButton
        v-if="historialUrl"
        :to="historialUrl"
        icon="i-lucide-history"
        color="neutral"
        variant="outline"
        :label="historialLabel ?? 'Ver historial'"
      />
      <template v-if="!readonly">
        <!-- Una caja en_conciliacion queda congelada: no admite movimientos. -->
        <UButton
          v-if="!enConciliacion"
          icon="i-lucide-circle-plus"
          color="neutral"
          variant="outline"
          @click="emit('movimiento')"
        >
          + Movimiento
        </UButton>
        <UButton
          v-if="enConciliacion"
          icon="i-lucide-scale"
          color="warning"
          variant="soft"
          @click="emit('cerrar')"
        >
          Continuar conciliación
        </UButton>
        <UButton
          v-else
          icon="i-lucide-lock"
          color="error"
          variant="soft"
          @click="emit('cerrar')"
        >
          Cerrar caja
        </UButton>
      </template>
    </div>
  </div>
</template>
