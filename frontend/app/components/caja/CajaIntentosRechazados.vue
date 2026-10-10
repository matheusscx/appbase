<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { IntentoRechazado } from '~/stores/caja'

const props = defineProps<{ cajaId: string }>()

const { formatMonto, formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()

const listFilters = computed(() => ({ cajaId: props.cajaId }))

const { items: intentos, meta, page, loading } = usePaginatedList<IntentoRechazado>({
  path: '/caja/intentos-rechazados',
  pageSize,
  filters: listFilters,
})

const TIPO_LABEL: Record<string, string> = {
  retiro: 'Retiro de caja',
  devolucion_nc: 'Devolución (nota de crédito)',
  // spec compras-deuda-proveedor § 5.3 (tarea 2): un pago a proveedor en
  // efectivo sin plata en la caja. Mismo mecanismo que 'retiro', rótulo propio.
  pago_proveedor: 'Pago a proveedor',
  // El tope del esperado (owner, 2026-10-09): plata que ENTRA y dejaría el
  // saldo en un monto que el sistema no puede guardar. Mismo oráculo, mismo rastro.
  ingreso: 'Ingreso a caja',
  cobro: 'Cobro de una venta',
  reversa_pago_proveedor: 'Anulación de un pago a proveedor',
}

const MOTIVO_LABEL: Record<string, string> = {
  saldo_insuficiente: 'Pidió más de lo que había en la caja',
  supera_efectivo_de_la_venta: 'Pidió más efectivo del que esa venta cobró en efectivo',
  esperado_no_cabe: 'El saldo de la caja pasaría el máximo que el sistema puede guardar',
}

const columns: TableColumn<IntentoRechazado>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'usuarioNombre', header: 'Quién' },
  { accessorKey: 'tipo', header: 'Qué intentó' },
  { accessorKey: 'motivo', header: 'Por qué se rechazó' },
  {
    accessorKey: 'montoSolicitado',
    header: 'Monto pedido',
    meta: { class: { th: 'text-right', td: 'text-right' } },
  },
]
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <div class="space-y-2">
        <h3 class="text-sm font-semibold text-default">
          Intentos rechazados
          <span class="text-muted font-normal">({{ meta.total }})</span>
        </h3>
        <!-- Lo que hay que saber para leer esta tabla: una fila suelta es
             normal (el cajero se equivocó de monto). Lo que delata es la
             RÁFAGA — muchos intentos seguidos con montos que se van acercando
             a un número. Eso es alguien buscando el esperado del turno a
             fuerza de rechazos, no un error de tipeo. -->
        <p class="text-sm text-muted">
          Movimientos que el sistema <strong>no dejó pasar</strong>: retiros y
          devoluciones por falta de plata, y entradas que llevarían el saldo más allá
          de lo que el sistema puede guardar. Una fila suelta suele ser un error de
          tipeo; lo que importa es la <strong>ráfaga</strong>: muchos intentos seguidos, con montos que se van
          acercando entre sí, es alguien deduciendo cuánto hay en la caja.
        </p>
      </div>
    </template>

    <div v-if="loading" class="py-8 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader" class="w-5 h-5 animate-spin mx-auto mb-1" />
      Cargando intentos…
    </div>

    <UTable
      v-else
      :data="intentos"
      :columns="columns"
      :ui="{
        root: 'max-h-[min(480px,60vh)] overflow-y-auto',
        thead: 'sticky top-0 z-10 bg-default',
      }"
    >
      <template #fecha-cell="{ row }">
        <span class="whitespace-nowrap">{{ formatFecha(row.original.fecha) }}</span>
      </template>
      <template #tipo-cell="{ row }">
        <div class="min-w-0">
          <p class="truncate">{{ TIPO_LABEL[row.original.tipo] ?? row.original.tipo }}</p>
          <NuxtLink
            v-if="row.original.ventaId"
            :to="{ path: '/ventas', query: { venta: row.original.ventaId } }"
            class="text-xs text-highlighted hover:underline"
          >
            Ver venta
          </NuxtLink>
        </div>
      </template>
      <template #motivo-cell="{ row }">
        <span class="text-muted">
          {{ MOTIVO_LABEL[row.original.motivo] ?? row.original.motivo }}
        </span>
      </template>
      <template #montoSolicitado-cell="{ row }">
        <span class="font-mono font-semibold text-red-600 dark:text-red-400">
          {{ formatMonto(row.original.montoSolicitado) }}
        </span>
      </template>
      <template #empty>
        <div class="py-10 text-center text-sm text-muted">
          <UIcon name="i-lucide-shield-check" class="w-8 h-8 mx-auto mb-2 opacity-40" />
          Ningún intento rechazado en esta caja.
        </div>
      </template>
    </UTable>

    <div v-if="meta.total > pageSize" class="flex justify-end pt-4">
      <UPagination v-model:page="page" :items-per-page="pageSize" :total="meta.total" />
    </div>
  </UCard>
</template>
