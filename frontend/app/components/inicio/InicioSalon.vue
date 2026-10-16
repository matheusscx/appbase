<script setup lang="ts">
// Bloque "Salón" de la zona "Ahora" (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.1 y § 6). El permiso (`Salones:Ver todas`) lo decide `index.vue`, que
// solo monta este componente si corresponde — acá no se repite el chequeo.

/** Espejo de `OcupacionSalones` (`backend/src/modules/salones/salones.service.ts`). */
interface OcupacionSalones {
  mesasOcupadas: number
  mesasTotal: number
  cuentasAbiertas: number
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const { formatHora } = useFormatters()

const { datos, actualizadoEl, sinConexion, oculto, refrescar } = useRefrescoPeriodico(
  () => useApiFetch<OcupacionSalones>(`${apiUrl}/salones/ocupacion`),
)
</script>

<template>
  <UCard
    v-if="!oculto"
    as="a"
    href="/salones"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
    @click.prevent="navigateTo('/salones')"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Salón</span>
        <UIcon name="i-lucide-utensils" class="text-muted" />
      </div>
    </template>

    <p v-if="datos" class="flex flex-wrap gap-x-3 text-lg font-medium text-highlighted">
      <span class="whitespace-nowrap">{{ datos.mesasOcupadas }} de {{ datos.mesasTotal }} {{ datos.mesasTotal === 1 ? 'mesa ocupada' : 'mesas ocupadas' }}</span>
      <span class="whitespace-nowrap">{{ datos.cuentasAbiertas }} {{ datos.cuentasAbiertas === 1 ? 'cuenta abierta' : 'cuentas abiertas' }}</span>
    </p>
    <InicioSinDatos v-else :fallo="sinConexion" @reintentar="refrescar" />

    <UAlert
      v-if="sinConexion && datos"
      color="warning"
      variant="subtle"
      icon="i-lucide-wifi-off"
      title="No pudimos actualizar — se vuelve a intentar en el próximo ciclo"
      class="mt-3"
    />

    <template v-if="actualizadoEl" #footer>
      <p class="text-xs text-muted">
        Actualizado {{ formatHora(actualizadoEl) }}
      </p>
    </template>
  </UCard>
</template>
