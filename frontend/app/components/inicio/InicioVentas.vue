<script setup lang="ts">
// Bloque "Ventas" de la zona "Hoy" (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.2 y § 4). El permiso (`Resumen del negocio:Leer`) y la carga los maneja
// `InicioHoy.vue`, que pasa los datos ya resueltos por props — este bloque no
// hace fetch propio. Vendido y cobrado van grandes; cantidad, ticket promedio
// y local/online, chicos (spec § 3.2). Las variaciones las calculó el backend
// con Decimal (spec § 4.3): acá no se hace ninguna cuenta con los montos.
import type { VentasHoy } from '~/types/resumen-negocio'

const props = defineProps<{
  ventas: VentasHoy
  /** `fecha` (`YYYY-MM-DD`) de `ResumenNegocioHoy`: la semana pasada cae en el
   *  mismo día de semana, así que un solo "vs. <día> pasado" sirve para las
   *  cuatro comparaciones del bloque. */
  fecha: string
}>()

const { formatMonto, formatPorcentaje, formatDiaSemana } = useFormatters()

const diaLabel = computed(() => formatDiaSemana(props.fecha))
</script>

<template>
  <UCard
    as="a"
    href="/ventas"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
    @click.prevent="navigateTo('/ventas')"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Ventas</span>
        <UIcon name="i-lucide-receipt" class="text-muted" />
      </div>
    </template>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-xs text-muted">
          Vendido <span class="italic">(antes de notas de crédito)</span>
        </p>
        <p class="text-lg font-semibold text-highlighted">
          {{ formatMonto(ventas.vendido.hoy) }}
        </p>
        <p class="text-xs text-muted">
          vs. {{ diaLabel }} pasado: {{ formatPorcentaje(ventas.vendido.variacion, 0) }}
        </p>
      </div>
      <div>
        <p class="text-xs text-muted">
          Cobrado
        </p>
        <p class="text-lg font-semibold text-highlighted">
          {{ formatMonto(ventas.cobrado.hoy) }}
        </p>
        <p class="text-xs text-muted">
          vs. {{ diaLabel }} pasado: {{ formatPorcentaje(ventas.cobrado.variacion, 0) }}
        </p>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-default">
      <div>
        <p class="text-xs text-muted">
          Cantidad
        </p>
        <p class="text-sm font-medium text-default">
          {{ ventas.cantidad.hoy }}
        </p>
        <p class="text-xs text-muted">
          vs. {{ diaLabel }} pasado: {{ formatPorcentaje(ventas.cantidad.variacion, 0) }}
        </p>
      </div>
      <div>
        <p class="text-xs text-muted">
          Ticket promedio
        </p>
        <p class="text-sm font-medium text-default">
          {{ formatMonto(ventas.ticketPromedio.hoy) }}
        </p>
        <p class="text-xs text-muted">
          vs. {{ diaLabel }} pasado: {{ formatPorcentaje(ventas.ticketPromedio.variacion, 0) }}
        </p>
      </div>
      <div>
        <p class="text-xs text-muted">
          Local / Online
        </p>
        <p class="text-sm font-medium text-default">
          {{ formatMonto(ventas.porCanal.fisico) }} / {{ formatMonto(ventas.porCanal.online) }}
        </p>
      </div>
    </div>
  </UCard>
</template>
