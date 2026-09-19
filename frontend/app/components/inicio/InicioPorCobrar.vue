<script setup lang="ts">
// Bloque "Por cobrar" de la zona "Hoy" (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.2). Ventas `pendiente`/`pagada_parcial` de CUALQUIER fecha —lo que se debe
// ahora, no lo vendido hoy—; el backend ya resuelve esa distinción. El permiso y
// la carga los maneja `InicioHoy.vue`.
import type { PorCobrar } from '~/types/resumen-negocio'

defineProps<{ porCobrar: PorCobrar }>()

const { formatMonto } = useFormatters()
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
        <span class="font-semibold text-default">Por cobrar</span>
        <UIcon name="i-lucide-hand-coins" class="text-muted" />
      </div>
    </template>

    <p class="text-lg font-medium text-highlighted">
      {{ porCobrar.cantidad }} ventas · {{ formatMonto(porCobrar.saldo) }} por cobrar
    </p>
  </UCard>
</template>
