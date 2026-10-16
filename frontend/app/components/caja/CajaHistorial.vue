<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import { ESTADO_CAJA_LABEL, type Caja } from '~/stores/caja'

const props = defineProps<{ usuarioId?: string; cajonId?: string; basePath: string; todas?: boolean }>()

const route = useRoute()

const { formatMonto, formatFecha } = useFormatters()
const { pageSize } = useUserPreferences()

const usuarioIdEfectivo = computed(() => {
  if (props.usuarioId) return props.usuarioId
  const id = route.query.usuarioId
  return typeof id === 'string' && id ? id : undefined
})

const cajonIdEfectivo = computed(() => {
  if (props.cajonId) return props.cajonId
  const id = route.query.cajonId
  return typeof id === 'string' && id ? id : undefined
})

const listFilters = computed(() => ({
  usuarioId: usuarioIdEfectivo.value,
  cajonId: cajonIdEfectivo.value,
  todas: !usuarioIdEfectivo.value && !cajonIdEfectivo.value && props.todas ? 'true' : undefined,
}))

const { items: historial, meta, page, loading, error, sinPermiso, fetch: fetchHistorial } = usePaginatedList<Caja>({
  path: '/caja',
  pageSize,
  filters: listFilters,
})

// A 768 la tabla de siete columnas medía 822 px en 672 y "Diferencia" quedaba fuera de la vista.
// Ahora: una sola fecha (la de apertura vive en el detalle), "Diferencia" pegada a "Caja" y
// "Saldo inicial" solo desde lg (auditoría UX 03.2).
const soloDesdeLg = { class: { th: 'hidden lg:table-cell text-right', td: 'hidden lg:table-cell text-right' } }
const columns: TableColumn<Caja>[] = [
  { accessorKey: 'fechaCierre', header: 'Cierre' },
  { accessorKey: 'cajonNombre', header: 'Caja' },
  { accessorKey: 'diferenciaTotal', header: 'Diferencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'saldoInicial', header: 'Saldo inicial', meta: soloDesdeLg },
  { accessorKey: 'saldoFinal', header: 'Saldo final', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function diferenciaPositiva(val: string | null | undefined): boolean {
  if (val === null || val === undefined) return true
  return new Decimal(val).gte(0)
}

// Cero no es ni sobrante ni faltante: sin signo y sin color (03.22).
function diferenciaEsCero(val: string): boolean {
  return new Decimal(val).isZero()
}

// Por quién (o qué caja) está filtrado el listado, para que el título no mienta (03.16).
// Solo el filtro que llegó por la URL se puede quitar; el que fija la pantalla (props) no.
const filtroDeLaUrl = computed(() => {
  const nombre = historial.value[0]
  if (!props.usuarioId && usuarioIdEfectivo.value) {
    return `Cajero: ${nombre?.usuarioNombre ?? 'el elegido'}`
  }
  if (!props.cajonId && cajonIdEfectivo.value) {
    return `Caja: ${nombre?.cajonNombre ?? 'la elegida'}`
  }
  return null
})

function quitarFiltro() {
  navigateTo({ path: route.path, query: {} })
}

function onSelectCaja(_e: Event, row: Row<Caja>) {
  navigateTo(`${props.basePath}/${row.original.id}`)
}
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <h2 class="text-base font-semibold text-default">
        Historial de cajas
        <span v-if="meta.total" class="text-muted font-normal text-sm">
          ({{ meta.total }})
        </span>
      </h2>
      <div v-if="filtroDeLaUrl" class="mt-2 flex items-center gap-2" data-qa="filtro-activo">
        <UBadge color="neutral" variant="subtle" :label="filtroDeLaUrl" />
        <UButton
          label="Quitar filtro"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="quitarFiltro"
        />
      </div>
    </template>

    <div v-if="loading" class="py-8 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader" class="w-5 h-5 animate-spin mx-auto mb-1" />
      Cargando historial…
    </div>

    <template v-else>
      <UTable
        :data="historial"
        :columns="columns"
        :ui="{ tr: 'cursor-pointer' }"
        @select="onSelectCaja"
      >
        <template #fechaCierre-cell="{ row }">
          <span class="text-default whitespace-nowrap">
            {{ row.original.fechaCierre ? formatFecha(row.original.fechaCierre) : `Abierta desde ${formatFecha(row.original.fechaApertura)}` }}
          </span>
        </template>
        <template #cajonNombre-cell="{ row }">
          <span class="text-default">{{ row.original.cajonNombre ?? '—' }}</span>
          <!-- El cajero va bajo la caja y no en columna propia: a 768 la tabla ya no tenía ancho (03.2). -->
          <p v-if="row.original.usuarioNombre" class="text-xs text-muted">
            {{ row.original.usuarioNombre }}
          </p>
        </template>
        <template #estado-cell="{ row }">
          <UBadge
            :color="row.original.estado === 'abierta' ? 'success' : row.original.estado === 'en_conciliacion' ? 'warning' : 'neutral'"
            variant="subtle"
            size="sm"
          >
            {{ ESTADO_CAJA_LABEL[row.original.estado] ?? row.original.estado }}
          </UBadge>
        </template>
        <template #saldoInicial-cell="{ row }">
          <span class="tabular-nums">{{ formatMonto(row.original.saldoInicial) }}</span>
        </template>
        <template #saldoFinal-cell="{ row }">
          <span class="tabular-nums" data-qa="saldo-final">{{ formatMonto(row.original.saldoFinal) }}</span>
        </template>
        <!-- Suma de TODAS las líneas del arqueo, no solo el efectivo: con la
             columna sobre `diferencia` una caja cerrada con -500 en tarjeta se
             veía como "+0" acá y como "-500" al abrir el detalle. -->
        <template #diferenciaTotal-cell="{ row }">
          <span
            v-if="row.original.diferenciaTotal != null"
            data-qa="diferencia-total"
            class="tabular-nums"
            :class="diferenciaEsCero(row.original.diferenciaTotal)
              ? 'text-muted'
              : diferenciaPositiva(row.original.diferenciaTotal)
                ? 'text-success'
                : 'text-error'"
          >
            {{ !diferenciaEsCero(row.original.diferenciaTotal) && diferenciaPositiva(row.original.diferenciaTotal) ? '+' : '' }}{{ formatMonto(row.original.diferenciaTotal) }}
          </span>
          <span v-else class="text-muted">—</span>
        </template>
        <template #empty>
          <AppEstadoLista
            recurso="el historial de cajas"
            vacio="No hay cajas en el historial."
            :error="error"
            :sin-permiso="sinPermiso"
            @reintentar="fetchHistorial"
          />
        </template>
      </UTable>

      <div v-if="meta.total > pageSize" class="flex justify-end pt-4">
        <UPagination
          v-model:page="page"
          :items-per-page="pageSize"
          :total="meta.total"
        />
      </div>
    </template>
  </UCard>
</template>
