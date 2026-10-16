<script setup lang="ts">
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { EstadoPagoCompra, PagoProveedorInfo } from '~/composables/useCompras'

/**
 * "Por pagar" (spec § 8 y § 10, decisión 9): una fila por proveedor con lo
 * que se le debe, ordenada por urgencia; al tocar uno, sus compras abiertas
 * y el botón Pagar. Pantalla entera detrás de `Compras:Pagar` con middleware
 * de ruta (pattern frontend § 1.2), no un `v-if` por control: "el bodeguero
 * recibe y el dueño paga" (decisión 12) hace que ESTA pantalla completa,
 * y no un botón suelto, sea del que paga.
 */
definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Compras:Pagar',
  permisoLabel: 'Compras (pagar)',
  layout: 'dashboard',
})

interface ProveedorPorPagar {
  proveedorId: string
  proveedorNombre: string | null
  deuda: string
  vencido: string
  venceProximos7Dias: string
  comprasTotalDesconocido: number
  saldoAFavor: string
}

interface CompraPorPagar {
  id: string
  fechaDocumento: string
  folio: string | null
  tipoDocumentoNombre: string | null
  total: string | null
  totalDocumento: string | null
  fechaVencimiento: string | null
  estadoPago: EstadoPagoCompra
  deuda: string | null
  /** La deuda mínima conocida ("al menos $X"): solo en `falta_precio` (spec § 4.1, decisión 8). */
  deudaMinima: string | null
  vencida: boolean
}

interface ProveedorDetalle {
  compras: CompraPorPagar[]
  pagos: PagoProveedorInfo[]
}

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const { insigniaPago, textoDeuda, montoEsPositivo, etiquetaDocumento } = useCompras()

const proveedores = ref<ProveedorPorPagar[]>([])
const loading = ref(false)
/** `por-pagar` no se pudo leer: la tabla lo dice en vez de "no hay deuda" (auditoría UX 07.3). */
const errorCarga = ref(false)
const seleccionado = ref<ProveedorPorPagar | null>(null)
const detalle = ref<ProveedorDetalle | null>(null)
const cargandoDetalle = ref(false)

/** Cargado el detalle y sin compras abiertas: no hay nada que pagar (auditoría UX 06.18). */
const alDia = computed(() => !!detalle.value && !cargandoDetalle.value && detalle.value.compras.length === 0)

const pagarOpen = ref(false)
const anularOpen = ref(false)
const pagoParaAnular = ref<PagoProveedorInfo | null>(null)

async function cargar() {
  loading.value = true
  errorCarga.value = false
  try {
    proveedores.value = await useApiFetch<ProveedorPorPagar[]>(`${apiUrl}/compras/por-pagar`)
  } catch (e: unknown) {
    errorCarga.value = true
    toast.add({ title: apiErrorMsg(e, 'Error al cargar lo que se debe'), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function cargarDetalle() {
  if (!seleccionado.value) return
  cargandoDetalle.value = true
  try {
    detalle.value = await useApiFetch<ProveedorDetalle>(
      `${apiUrl}/compras/por-pagar/${seleccionado.value.proveedorId}`,
    )
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el detalle del proveedor'), color: 'error' })
  } finally {
    cargandoDetalle.value = false
  }
}

function elegirProveedor(_e: Event, row: Row<ProveedorPorPagar>) {
  seleccionado.value = row.original
  detalle.value = null
  void cargarDetalle()
}

/** Tras pagar o anular: la deuda y el saldo a favor cambiaron en los dos lados. */
async function recargarTodo() {
  await Promise.all([cargar(), cargarDetalle()])
}

function abrirAnular(p: PagoProveedorInfo) {
  pagoParaAnular.value = p
  anularOpen.value = true
}

onMounted(cargar)

const columnsProveedores: TableColumn<ProveedorPorPagar>[] = [
  { accessorKey: 'proveedorNombre', header: 'Proveedor' },
  { accessorKey: 'deuda', header: 'Debe', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'vencido', header: 'Vencido', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'venceProximos7Dias', header: 'Vence en 7 días', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'saldoAFavor', header: 'A favor', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnsCompras: TableColumn<CompraPorPagar>[] = [
  { accessorKey: 'fechaDocumento', header: 'Fecha' },
  { accessorKey: 'folio', header: 'Documento' },
  { accessorKey: 'fechaVencimiento', header: 'Vence' },
  { accessorKey: 'estadoPago', header: 'Estado' },
  { accessorKey: 'deuda', header: 'Debe', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnsPagos: TableColumn<PagoProveedorInfo>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'metodoPagoNombre', header: 'Medio' },
  { accessorKey: 'sobranteAFavor', header: 'A favor', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'estado', header: 'Estado' },
  { id: 'acciones', header: '' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Por pagar" />
    </template>

    <template #body>
      <div class="w-full space-y-6" data-qa="por-pagar">
        <CrudPageHeader
          large
          title="Por pagar"
          description="Lo que se le debe a cada proveedor, ordenado por lo más urgente. Toca un proveedor para ver sus compras y pagar."
        />

        <CrudTable
          :data="proveedores"
          :columns="columnsProveedores"
          :loading="loading"
          :error="errorCarga"
          recurso="lo que se debe a los proveedores"
          @reintentar="cargar"
          :ui="{ tr: 'cursor-pointer' }"
          data-qa="por-pagar-proveedores"
          @select="elegirProveedor"
        >
          <template #proveedorNombre-cell="{ row }">
            <!-- Botón dentro de la fila: la fila entera sigue tocable, pero sin esto el
                 teclado y el lector de pantalla no llegan a ningún proveedor. -->
            <button
              type="button"
              class="text-left hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              :class="{ 'font-medium': row.original.proveedorId === seleccionado?.proveedorId }"
              :aria-pressed="row.original.proveedorId === seleccionado?.proveedorId"
              :data-qa="`por-pagar-proveedor-${row.original.proveedorId}`"
              @click.stop="elegirProveedor($event, row)"
            >
              {{ row.original.proveedorNombre || '—' }}
            </button>
          </template>
          <template #deuda-cell="{ row }">
            <span class="tabular-nums">{{ formatMonto(row.original.deuda) }}</span>
          </template>
          <template #vencido-cell="{ row }">
            <span class="tabular-nums" :class="{ 'text-error font-medium': montoEsPositivo(row.original.vencido) }">
              {{ formatMonto(row.original.vencido) }}
            </span>
          </template>
          <template #venceProximos7Dias-cell="{ row }">
            <span class="tabular-nums">{{ formatMonto(row.original.venceProximos7Dias) }}</span>
          </template>
          <template #saldoAFavor-cell="{ row }">
            <span class="tabular-nums">{{ formatMonto(row.original.saldoAFavor) }}</span>
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              <UIcon name="i-lucide-badge-check" class="w-8 h-8 mx-auto mb-2 opacity-40" />
              No hay deuda ni saldo a favor con ningún proveedor.
            </div>
          </template>
        </CrudTable>

        <UCard v-if="seleccionado" data-qa="por-pagar-detalle">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-medium text-default">
                {{ seleccionado.proveedorNombre || '—' }}
              </h2>
              <div class="flex items-center gap-2">
                <UBadge v-if="alDia" label="Al día" color="success" variant="subtle" data-qa="por-pagar-al-dia" />
                <UButton
                  icon="i-lucide-hand-coins"
                  label="Pagar"
                  :disabled="alDia"
                  data-qa="por-pagar-pagar-abrir"
                  @click="() => { pagarOpen = true }"
                />
              </div>
            </div>
          </template>

          <p v-if="cargandoDetalle" class="text-sm text-muted">
            Cargando…
          </p>
          <template v-else-if="detalle">
            <div class="space-y-2">
              <h3 class="text-sm font-medium text-default">
                Compras abiertas
              </h3>
              <CrudTable :data="detalle.compras" :columns="columnsCompras" data-qa="por-pagar-compras">
                <template #fechaDocumento-cell="{ row }">
                  <span class="whitespace-nowrap">{{ formatFecha(row.original.fechaDocumento) }}</span>
                </template>
                <template #folio-cell="{ row }">
                  <span class="text-sm">{{ etiquetaDocumento(row.original) }}</span>
                </template>
                <template #fechaVencimiento-cell="{ row }">
                  <span class="whitespace-nowrap">{{ row.original.fechaVencimiento ? formatFecha(row.original.fechaVencimiento) : '—' }}</span>
                </template>
                <template #estadoPago-cell="{ row }">
                  <UBadge
                    :label="insigniaPago(row.original, formatMonto).label"
                    :color="insigniaPago(row.original, formatMonto).color"
                    variant="subtle"
                    size="sm"
                  />
                </template>
                <template #deuda-cell="{ row }">
                  <span class="tabular-nums">{{ textoDeuda(row.original, formatMonto) }}</span>
                </template>
                <template #empty>
                  <div class="py-6 text-center text-sm text-muted">
                    Al día: no tiene compras abiertas.
                  </div>
                </template>
              </CrudTable>
            </div>

            <div class="mt-6 space-y-2">
              <h3 class="text-sm font-medium text-default">
                Pagos con saldo a favor
              </h3>
              <CrudTable :data="detalle.pagos" :columns="columnsPagos" data-qa="por-pagar-pagos">
                <template #fecha-cell="{ row }">
                  {{ row.original.fecha ? formatFecha(row.original.fecha) : '—' }}
                </template>
                <template #monto-cell="{ row }">
                  <span class="tabular-nums">{{ formatMonto(row.original.monto) }}</span>
                </template>
                <template #metodoPagoNombre-cell="{ row }">
                  {{ row.original.metodoPagoNombre || '—' }}
                </template>
                <template #sobranteAFavor-cell="{ row }">
                  <span class="tabular-nums">{{ formatMonto(row.original.sobranteAFavor) }}</span>
                </template>
                <template #estado-cell="{ row }">
                  <UBadge
                    :label="row.original.estado === 'anulado' ? 'Anulado' : 'Vigente'"
                    :color="row.original.estado === 'anulado' ? 'error' : 'success'"
                    variant="subtle"
                  />
                </template>
                <template #acciones-cell="{ row }">
                  <div class="flex justify-end">
                    <UButton
                      v-if="row.original.estado === 'vigente' && row.original.id"
                      size="xs"
                      variant="soft"
                      color="error"
                      label="Anular"
                      :data-qa="`por-pagar-anular-${row.original.id}`"
                      @click="abrirAnular(row.original)"
                    />
                  </div>
                </template>
                <template #empty>
                  <div class="py-6 text-center text-sm text-muted">
                    No hay pagos con saldo a favor.
                  </div>
                </template>
              </CrudTable>
            </div>
          </template>
        </UCard>

        <ComprasPagarProveedorModal
          v-if="seleccionado"
          v-model:open="pagarOpen"
          :proveedor-id="seleccionado.proveedorId"
          :proveedor-nombre="seleccionado.proveedorNombre || '—'"
          @success="recargarTodo"
        />
        <ComprasAnularPagoModal
          v-if="pagoParaAnular?.id"
          v-model:open="anularOpen"
          :pago-id="pagoParaAnular.id"
          :proveedor-nombre="seleccionado?.proveedorNombre || '—'"
          :monto="pagoParaAnular.monto"
          :fecha="pagoParaAnular.fecha"
          @success="recargarTodo"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
