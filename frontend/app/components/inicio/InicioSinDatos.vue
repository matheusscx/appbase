<script setup lang="ts">
/**
 * Lo que un bloque de Inicio dice cuando todavía no tiene datos: "Cargando…" mientras espera, y si la
 * primera carga falló, que no pudo y un botón para volver a pedir. Antes un 500 dejaba "Cargando…" para
 * siempre (y a "Ahora" le sumaba un "Sin conexión" que no era cierto: el servidor había respondido).
 * Reintentar lo toca la persona; la app no reintenta sola (auditoría UX 04.7).
 */
defineProps<{ fallo: boolean }>()
const emit = defineEmits<{ reintentar: [] }>()
</script>

<template>
  <div v-if="fallo" class="flex flex-col items-start gap-2">
    <p class="text-sm text-default" role="alert">
      No pudimos cargar los datos. Reintenta.
    </p>
    <UButton
      label="Reintentar"
      icon="i-lucide-rotate-cw"
      size="xs"
      color="neutral"
      variant="outline"
      data-qa="inicio-reintentar"
      @click="emit('reintentar')"
    />
  </div>
  <p v-else class="text-sm text-muted">
    Cargando…
  </p>
</template>
