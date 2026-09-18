<script setup lang="ts">
// Bloque "Cierres del día" de la zona "Ahora" (spec
// `2026-09-18-dashboard-inicio-design.md` § 3.1 y § 6). El permiso
// (`Cajas:Leer`) lo decide `index.vue`, que solo monta este componente si
// corresponde.
import Decimal from 'decimal.js'

const cajaStore = useCajaStore()
const { formatMonto, formatHora } = useFormatters()

const { datos, actualizadoEl, sinConexion, oculto } = useRefrescoPeriodico(
  () => cajaStore.cargarResumenDescuadresDia(),
)

/**
 * El signo del efectivo del día. Fuera de `components/caja/` (este bloque vive
 * en `components/inicio/`) no aplica la excepción de colores financieros que
 * `DESIGN-SYSTEM.md` reserva para ese módulo — tokens semánticos, como
 * `DesfasesPanel.vue` (`text-success`/`text-error`), no los literales de
 * `CajaPendientesRevision.vue`.
 */
function claseMonto(val: string | null): string {
  if (val == null) return 'text-muted'
  const d = new Decimal(val)
  if (d.isZero()) return 'text-muted'
  return d.gt(0) ? 'text-success' : 'text-error'
}
</script>

<template>
  <UCard
    v-if="!oculto"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
    @click="navigateTo('/cajas')"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Cierres del día</span>
        <UIcon name="i-lucide-scale" class="text-muted" />
      </div>
    </template>

    <div v-if="datos" class="grid grid-cols-3 gap-4">
      <div>
        <p class="text-xs text-muted">
          Cierres
        </p>
        <p class="text-lg font-semibold text-default">
          {{ datos.cierres }}
        </p>
      </div>
      <div>
        <p class="text-xs text-muted">
          Con descuadre
        </p>
        <p class="text-lg font-semibold text-default">
          {{ datos.conDescuadre }}
        </p>
      </div>
      <div>
        <p class="text-xs text-muted">
          Efectivo
        </p>
        <p class="text-lg font-semibold font-mono" :class="claseMonto(datos.efectivoSuma)">
          {{ formatMonto(datos.efectivoSuma) }}
        </p>
      </div>
    </div>
    <p v-else class="text-sm text-muted">
      Cargando…
    </p>

    <UAlert
      v-if="sinConexion"
      color="warning"
      variant="subtle"
      icon="i-lucide-wifi-off"
      title="Sin conexión — se reintenta en el próximo ciclo"
      class="mt-3"
    />

    <template #footer>
      <p class="text-xs text-muted">
        Actualizado {{ formatHora(actualizadoEl) }}
      </p>
    </template>
  </UCard>
</template>
