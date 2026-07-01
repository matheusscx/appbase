<script setup lang="ts">
defineProps<{
  caja: {
    estado: string
    fechaApertura: string
  }
  readonly?: boolean
}>()

const emit = defineEmits<{
  movimiento: []
  cerrar: []
}>()

const { formatFecha } = useFormatters()
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
    <div v-if="!readonly" class="flex gap-2">
      <UButton
        icon="i-lucide-circle-plus"
        color="neutral"
        variant="outline"
        @click="emit('movimiento')"
      >
        + Movimiento
      </UButton>
      <UButton
        icon="i-lucide-lock"
        color="error"
        variant="soft"
        @click="emit('cerrar')"
      >
        Cerrar caja
      </UButton>
    </div>
  </div>
</template>
