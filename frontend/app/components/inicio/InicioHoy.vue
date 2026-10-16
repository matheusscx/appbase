<script setup lang="ts">
// Zona "Hoy" del dashboard de inicio (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.2 y § 6). El permiso (`Resumen del negocio:Leer`) lo decide `index.vue`,
// que solo monta este componente si corresponde — acá no se repite el chequeo.
// Se refresca sola cada 60 s con `useRefrescoPeriodico`, igual que "Ahora", y dice de qué hora son
// sus números; el botón "Actualizar" pide al instante (auditoría UX 04.3, decidido por el owner).
// Si una carga falla con números viejos a la vista, los marca como atrasados. Sin reintento
// adelantado: la próxima carga es la del ciclo o la que la persona pide. El 403 esconde la
// zona ENTERA sin aviso de error (un módulo no contratado, no una falla), como en "Ahora".
import type { ResumenNegocioHoy } from '~/types/resumen-negocio'

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const { formatHora } = useFormatters()

const { datos, actualizadoEl, sinConexion, oculto, refrescar } = useRefrescoPeriodico(
  () => useApiFetch<ResumenNegocioHoy>(`${apiUrl}/resumen-negocio/hoy`),
)

const cargando = ref(false)
async function actualizar(): Promise<void> {
  cargando.value = true
  try {
    await refrescar()
  }
  finally {
    cargando.value = false
  }
}
</script>

<template>
  <section v-if="!oculto" class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium text-muted">
        Hoy
      </h3>
      <div class="flex items-center gap-2">
        <p v-if="actualizadoEl" class="text-xs text-muted" data-qa="hoy-actualizado">
          Actualizado {{ formatHora(actualizadoEl) }}
        </p>
        <UButton
          size="md"
          class="min-h-11"
          variant="ghost"
          color="neutral"
          icon="i-lucide-refresh-cw"
          :loading="cargando"
          @click="actualizar"
        >
          Actualizar
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="sinConexion && datos"
      color="warning"
      variant="subtle"
      icon="i-lucide-clock"
      :title="`No pudimos actualizar. Estos números son de las ${formatHora(actualizadoEl)}.`"
      data-qa="hoy-atrasado"
    />

    <div v-if="datos" class="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4" data-qa="hoy-grilla">
      <InicioVentas class="lg:col-span-2" :ventas="datos.ventas" :fecha="datos.fecha" />
      <InicioPorCobrar :por-cobrar="datos.porCobrar" />
      <InicioPerdidas :perdidas="datos.perdidas" />
      <InicioMasVendidos class="lg:col-span-4" :mas-vendidos="datos.masVendidos" />
    </div>
    <InicioSinDatos v-else :fallo="sinConexion" @reintentar="actualizar" />
  </section>
</template>
