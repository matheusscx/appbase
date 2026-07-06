<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Suscripcion } from '~/composables/useSuscripciones'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { suscripciones, loading, pausar, reanudar, cancelar } = useSuscripciones()
const { formatMonto, formatFecha } = useFormatters()

const frecuenciaLabel: Record<Suscripcion['frecuencia'], string> = {
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function detalleDia(s: Suscripcion): string {
  if (s.frecuencia === 'semanal' && s.diaSemana !== null)
    return `los ${DIAS_SEMANA[s.diaSemana]}`
  if (s.frecuencia === 'quincenal' && s.diaMes !== null)
    return `los días ${s.diaMes} y ${s.diaMes + 15}`
  if (s.diaMes !== null) return `el día ${s.diaMes}`
  return ''
}

function subtitulo(s: Suscripcion): string {
  const dia = detalleDia(s)
  const frecuencia = dia ? `${frecuenciaLabel[s.frecuencia]} ${dia}` : frecuenciaLabel[s.frecuencia]
  return `${formatMonto(s.precio, s.monedaId ?? undefined)} · ${frecuencia} · próximo cobro ${formatFecha(s.proximoCobro)}`
}

const estadoColor: Record<Suscripcion['estado'], 'success' | 'warning' | 'neutral'> = {
  activa: 'success',
  pausada: 'warning',
  cancelada: 'neutral',
}

const estadoLabel: Record<Suscripcion['estado'], string> = {
  activa: 'Activa',
  pausada: 'Pausada',
  cancelada: 'Cancelada',
}

const columns: TableColumn<Suscripcion>[] = [
  { accessorKey: 'itemNombre', header: 'Suscripción' },
  { id: 'estado', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Suscripciones">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <CrudPageHeader
          title="Suscripciones"
          description="Compras recurrentes de items del catálogo — pausá, reanudá o cancelá cuando quieras."
        />

        <CrudTable :data="suscripciones" :columns="columns" :loading="loading">
          <template #itemNombre-cell="{ row }">
            <CrudListItem
              :title="row.original.itemNombre"
              :subtitle="subtitulo(row.original)"
            />
          </template>

          <template #estado-cell="{ row }">
            <UBadge :color="estadoColor[row.original.estado]" variant="subtle">
              {{ estadoLabel[row.original.estado] }}
            </UBadge>
          </template>

          <template #acciones-cell="{ row }">
            <div class="flex justify-end gap-2">
              <UButton
                v-if="row.original.estado === 'activa'"
                label="Pausar"
                icon="i-lucide-pause"
                color="neutral"
                variant="soft"
                size="sm"
                @click="pausar(row.original.id)"
              />
              <UButton
                v-else-if="row.original.estado === 'pausada'"
                label="Reanudar"
                icon="i-lucide-play"
                color="primary"
                variant="soft"
                size="sm"
                @click="reanudar(row.original.id)"
              />
              <UButton
                v-if="row.original.estado !== 'cancelada'"
                label="Cancelar"
                icon="i-lucide-x"
                color="error"
                variant="soft"
                size="sm"
                @click="cancelar(row.original.id)"
              />
            </div>
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              No tenés suscripciones activas.
            </div>
          </template>
        </CrudTable>
      </div>
    </template>
  </UDashboardPanel>
</template>
