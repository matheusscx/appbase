<script setup lang="ts">
// Zona "Ahora" del dashboard de inicio: el título, UNA hora para toda la zona y la grilla de
// tarjetas. Antes cada tarjeta repetía "Actualizado 12:42" en un pie con divisor, cinco veces,
// y eso empujaba "Hoy" bajo el pliegue (auditoría UX 04.12 y 04.2). Las tarjetas avanzan esta
// hora al cargar (`useRefrescoPeriodico` la inyecta); acá solo se muestra.
// Las tarjetas miden lo suyo (`items-start`): igualar los altos dejaba huecos (04.26).
import { ACTUALIZADO_DE_LA_ZONA } from '~/composables/useRefrescoPeriodico'

const actualizadoEl = ref<Date | null>(null)
provide(ACTUALIZADO_DE_LA_ZONA, actualizadoEl)

const { formatHora } = useFormatters()
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-medium text-muted">
        Ahora
      </h3>
      <p v-if="actualizadoEl" class="text-xs text-muted" data-qa="ahora-actualizado">
        Actualizado {{ formatHora(actualizadoEl) }}
      </p>
    </div>
    <div class="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3" data-qa="ahora-grilla">
      <slot />
    </div>
  </section>
</template>
