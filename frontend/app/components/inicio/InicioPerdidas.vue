<script setup lang="ts">
// Bloque "Pérdidas" de la zona "Hoy" (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.2 y § 4.4). SIN total: sumar anulaciones y mermas contaría dos veces un
// plato quemado en mesa (a la vez anulación tipo merma y merma de cocina), y
// los costos vienen en más de una moneda — mismo criterio que `PerdidasHoy`
// (`~/types/resumen-negocio.ts`). Dos destinos distintos (reporte de
// anulaciones y listado de mermas): no es un card-link único, sino un link
// por sección (spec § 6). `tipoMotivoBajaLabel` — auto-importado de
// `useSalones.ts`, mismo idioma que `AnularLineaModal.vue`.
//
// `sinValorizar` (regla 6 de la spec del costo sin tipear, `docs/agent/pendientes.md`
// § 3) aplica IGUAL de un lado que del otro: un costo que se cae en silencio porque
// algunas filas no tenían costo es lo que esa regla prohíbe, y `AnulacionPorTipo`
// también trae su propio `sinValorizar` (`anulaciones-reporte.service.ts`) — no solo
// `ResumenMermas`. Mismo aviso, mismo token, uno por tipo de anulación.
import type { PerdidasHoy } from '~/types/resumen-negocio'

defineProps<{ perdidas: PerdidasHoy }>()

const { formatMonto, formatCostoPorMoneda } = useFormatters()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Pérdidas</span>
        <UIcon name="i-lucide-trending-down" class="text-muted" />
      </div>
    </template>

    <div class="space-y-4">
      <div>
        <p class="text-xs text-muted mb-2">
          Anulaciones
        </p>
        <ul v-if="perdidas.anulaciones.length > 0" class="space-y-2">
          <li v-for="grupo in perdidas.anulaciones" :key="grupo.tipo" class="text-sm">
            <div class="flex items-center justify-between gap-2">
              <span class="text-default font-medium">{{ tipoMotivoBajaLabel(grupo.tipo) }}</span>
              <span class="text-muted">{{ grupo.platos }} platos</span>
            </div>
            <div class="flex items-center justify-between gap-2 text-xs text-muted">
              <span>Precio de carta: {{ formatMonto(grupo.precioCarta) }}</span>
              <span>Costo: {{ formatCostoPorMoneda(grupo.costo) }}</span>
            </div>
            <p v-if="grupo.sinValorizar > 0" class="text-xs text-warning">
              {{ grupo.sinValorizar }} sin costo cargado
            </p>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">
          Sin anulaciones hoy.
        </p>
        <ULink to="/salones/anulaciones" class="text-xs text-primary mt-2 inline-block">
          Ver anulaciones
        </ULink>
      </div>

      <div class="pt-4 border-t border-default">
        <p class="text-xs text-muted mb-2">
          Mermas
        </p>
        <p class="text-sm text-default">
          {{ perdidas.mermas.cantidad }} mermas · {{ formatCostoPorMoneda(perdidas.mermas.costo) }}
        </p>
        <p v-if="perdidas.mermas.sinValorizar > 0" class="text-xs text-warning">
          {{ perdidas.mermas.sinValorizar }} sin costo cargado
        </p>
        <ULink to="/mermas" class="text-xs text-primary mt-2 inline-block">
          Ver mermas
        </ULink>
      </div>
    </div>
  </UCard>
</template>
