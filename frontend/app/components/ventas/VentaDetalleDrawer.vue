<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'
import { formatCantidadTicket } from '~/utils/cantidad-presentacion'

interface PagoAplicacion {
  tipo: string
  monto: string
  referenciaId: string | null
}

interface Pago {
  id: string
  metodoPagoId: string
  monto: string
  vuelto: string
  fecha: string
  referencia: string | null
  aplicaciones?: PagoAplicacion[]
  montoAplicadoVenta?: string
  montoAplicadoPropina?: string
}

interface PropinaVenta {
  id: string
  porcentajeSugerido: string
  montoSugerido: string
  montoPagado: string
  tipo: string
  estado: string
  garzonId: string
  garzonNombre: string | null
}

interface Detalle {
  id: string
  itemId: string
  descripcion: string
  cantidad: string
  cantidadPresentacion?: string | null
  unidadCodigoPresentacion?: string | null
  precioUnitario: string
  totalLinea: string
  modoInventario: string | null
  cantidadDevuelta: string
}

interface Reembolso {
  id: string
  monto: string
  estado: string
  fecha: string
  ordenId: string
  codigoOrden: string
}

interface NotaCredito {
  id: string
  totalFinal: string
  fecha: string
  comentario: string | null
}

interface VentaDetalle {
  id: string
  canal: string
  estado: string
  fecha: string
  creadoEl: string
  totalBruto: string
  totalDescuentos: string
  totalRecargos: string
  totalImpuestos: string
  totalFinal: string
  ventaReferenciaId: string | null
  tipoDocumento: { id: string, codigo: string | null, nombre: string | null } | null
  reembolsos: Reembolso[]
  notasCredito: NotaCredito[]
  detalles: Detalle[]
  pagos: Pago[]
  customer: { nombre: string; rut?: string } | null
  propina: PropinaVenta | null
}

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const props = defineProps<{
  ventaId: string | null
}>()

export interface VentaDetallePatch {
  id: string
  estado: string
  montoPagado: string
  saldo: string
}

const emit = defineEmits<{ updated: [VentaDetallePatch] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const cajaStore = useCajaStore()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const venta = ref<VentaDetalle | null>(null)
const metodos = ref<MetodoPago[]>([])
const loading = ref(false)
const abonoOpen = ref(false)
const ncOpen = ref(false)
const permissionsStore = usePermissionsStore()

const montoPagado = computed(() => {
  if (!venta.value) return '0'
  return venta.value.pagos.reduce((acc, p) => {
    // Preferir aplicaciones tipo venta (excluye propina del saldo de la venta).
    if (p.montoAplicadoVenta != null) {
      return new Decimal(acc).plus(p.montoAplicadoVenta).toString()
    }
    return new Decimal(acc).plus(new Decimal(p.monto)).minus(new Decimal(p.vuelto ?? '0')).toString()
  }, '0')
})

const saldo = computed(() => {
  if (!venta.value) return '0'
  return Decimal.max(0, new Decimal(venta.value.totalFinal).minus(new Decimal(montoPagado.value))).toString()
})

const puedeAbonar = computed(() =>
  !!venta.value && ['pendiente', 'pagada_parcial'].includes(venta.value.estado),
)

const esNotaCredito = computed(() => venta.value?.tipoDocumento?.codigo === '61')

// Máximo emitible: total de la venta menos las NCs ya emitidas (validado también en backend)
const disponibleNC = computed(() => {
  if (!venta.value) return '0'
  const previas = venta.value.notasCredito.reduce(
    (acc, nc) => new Decimal(acc).plus(nc.totalFinal).toString(),
    '0',
  )
  return Decimal.max(0, new Decimal(venta.value.totalFinal).minus(previas)).toString()
})

const puedeCrearNC = computed(() =>
  !!venta.value
  && ['pagada', 'pagada_parcial'].includes(venta.value.estado)
  && !esNotaCredito.value
  && new Decimal(disponibleNC.value).gt(0)
  && permissionsStore.can('Ventas', 'Nota de crédito'),
)

const totalReembolsado = computed(() => {
  if (!venta.value) return '0'
  return venta.value.reembolsos
    .filter(r => r.estado === 'aprobada')
    .reduce((acc, r) => new Decimal(acc).plus(r.monto).toString(), '0')
})

// Derivado de las transacciones de pasarela: NO es un estado de la venta en BD
const leyendaReembolso = computed(() => {
  if (!venta.value) return null
  const total = new Decimal(totalReembolsado.value)
  if (total.lte(0)) return null
  return total.gte(venta.value.totalFinal) ? 'Reembolsada totalmente' : 'Reembolsada parcialmente'
})

function reembolsoColor(estado: string): 'success' | 'error' | 'warning' | 'neutral' {
  const map: Record<string, 'success' | 'error' | 'warning'> = {
    aprobada: 'success',
    rechazada: 'error',
    error: 'warning',
  }
  return map[estado] ?? 'neutral'
}

function estadoColor(estado: string): 'warning' | 'success' | 'error' | 'neutral' | 'info' {
  const map: Record<string, 'warning' | 'success' | 'error' | 'neutral' | 'info'> = {
    pendiente: 'warning',
    pagada_parcial: 'info',
    pagada: 'success',
    cancelada: 'error',
    borrador: 'neutral',
  }
  return map[estado] ?? 'neutral'
}

function cantidadDetalleLabel(det: Detalle): string {
  if (det.cantidadPresentacion && det.unidadCodigoPresentacion) {
    return formatCantidadTicket(det.cantidadPresentacion, det.unidadCodigoPresentacion)
  }
  return det.cantidad
}

function estadoLabel(estado: string): string {
  const map: Record<string, string> = {
    pendiente: 'Pendiente',
    pagada_parcial: 'Parcial',
    pagada: 'Pagada',
    cancelada: 'Cancelada',
    borrador: 'Borrador',
  }
  return map[estado] ?? estado
}

const detalleColumns: TableColumn<Detalle>[] = [
  { accessorKey: 'descripcion', header: 'Descripción' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'precioUnitario', header: 'Precio unit.', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'totalLinea', header: 'Total línea', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function cargar(id: string) {
  loading.value = true
  venta.value = null
  try {
    const [ventaData, metodosData] = await Promise.all([
      useApiFetch<VentaDetalle>(`${apiUrl}/ventas/${id}`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
    ])
    venta.value = ventaData
    metodos.value = metodosData
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar venta')
    toast.add({ title: msg, color: 'error' })
    open.value = false
  }
  finally {
    loading.value = false
  }
}

watch(
  () => [open.value, props.ventaId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) cargar(id)
    else if (!isOpen) {
      venta.value = null
      abonoOpen.value = false
      ncOpen.value = false
    }
  },
)

function emitPatch() {
  if (!venta.value) return
  emit('updated', {
    id: venta.value.id,
    estado: venta.value.estado,
    montoPagado: montoPagado.value,
    saldo: saldo.value,
  })
}

function onAbonoSuccess(payload: {
  pagos: Pago[]
  venta: { id: string, estado: string, saldo: string }
}) {
  abonoOpen.value = false
  if (!venta.value) return
  venta.value.pagos = [...venta.value.pagos, ...payload.pagos]
  venta.value.estado = payload.venta.estado
  const neto = payload.pagos.reduce(
    (acc, p) => acc.plus(p.monto).minus(p.vuelto ?? '0'),
    new Decimal(0),
  )
  cajaStore.aplicarCobroLocal(neto.toFixed(4), payload.pagos.length)
  emitPatch()
}

function onNcSuccess(payload: {
  id: string
  totalFinal: string
  fecha: string
  comentario: string | null
  devoluciones: Array<{ itemId: string, cantidad: string }>
}) {
  ncOpen.value = false
  if (!venta.value) return
  venta.value.notasCredito = [
    ...venta.value.notasCredito,
    {
      id: payload.id,
      totalFinal: payload.totalFinal,
      fecha: payload.fecha,
      comentario: payload.comentario,
    },
  ]
  for (const d of payload.devoluciones) {
    for (const det of venta.value.detalles) {
      if (det.itemId === d.itemId) {
        det.cantidadDevuelta = new Decimal(det.cantidadDevuelta)
          .plus(d.cantidad)
          .toString()
      }
    }
  }
  emitPatch()
}
</script>

<template>
  <AppDrawer v-model:open="open" width="50%">
    <template #header>
      <div class="flex items-center gap-2">
        <span class="font-semibold text-default">Detalle de venta</span>
        <UBadge
          v-if="venta"
          :color="estadoColor(venta.estado)"
          :label="estadoLabel(venta.estado)"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-if="esNotaCredito"
          color="info"
          label="Nota de Crédito"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-if="leyendaReembolso"
          color="warning"
          :label="leyendaReembolso"
          variant="subtle"
          size="xs"
        />
      </div>
    </template>

    <template #body>
      <div v-if="loading" class="py-12 text-center text-muted">
        <UIcon name="i-lucide-loader" class="mx-auto mb-2 h-6 w-6 animate-spin" />
        Cargando venta…
      </div>

      <div v-else-if="venta" class="space-y-4">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Información general
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-muted">
                Fecha
              </dt>
              <dd class="font-medium">
                {{ formatFecha(venta.fecha) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Canal
              </dt>
              <dd class="font-medium capitalize">
                {{ venta.canal }}
              </dd>
            </div>
            <div v-if="venta.customer">
              <dt class="text-muted">
                Cliente
              </dt>
              <dd class="font-medium">
                {{ venta.customer.nombre }}
                <span v-if="venta.customer.rut" class="ml-1 text-muted">({{ venta.customer.rut }})</span>
              </dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Líneas de venta
            </h2>
          </template>
          <UTable :data="venta.detalles" :columns="detalleColumns">
            <template #cantidad-cell="{ row }">
              <span class="font-mono">{{ cantidadDetalleLabel(row.original) }}</span>
            </template>
            <template #precioUnitario-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.precioUnitario) }}</span>
            </template>
            <template #totalLinea-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.totalLinea) }}</span>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                Sin líneas de venta.
              </div>
            </template>
          </UTable>
        </UCard>

        <div class="grid gap-4 md:grid-cols-2">
          <UCard>
            <template #header>
              <h2 class="text-base font-semibold">
                Totales
              </h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between">
                <dt class="text-muted">
                  Subtotal bruto
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalBruto) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Descuentos
                </dt>
                <dd class="font-mono text-success">
                  -{{ formatMonto(venta.totalDescuentos) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Recargos
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalRecargos) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Impuestos
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalImpuestos) }}
                </dd>
              </div>
              <div class="flex justify-between border-t border-default pt-2 font-semibold">
                <dt>Total final</dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalFinal) }}
                </dd>
              </div>
            </dl>
          </UCard>

          <UCard v-if="venta.propina">
            <template #header>
              <h2 class="text-base font-semibold">
                Propina
              </h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between">
                <dt class="text-muted">
                  % sugerido
                </dt>
                <dd>{{ new Decimal(venta.propina.porcentajeSugerido).mul(100).toFixed(0) }}%</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Monto sugerido
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.propina.montoSugerido) }}
                </dd>
              </div>
              <div class="flex justify-between font-semibold">
                <dt>Monto pagado</dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.propina.montoPagado) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Garzón
                </dt>
                <dd>{{ venta.propina.garzonNombre ?? '—' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-base font-semibold">
                  Pagos
                </h2>
                <NuxtLink
                  v-if="venta.pagos.length"
                  :to="{ path: '/pagos', query: { ventaId: venta.id } }"
                  class="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                >
                  Ver en Pagos
                  <UIcon name="i-lucide-arrow-right" class="h-3 w-3" />
                </NuxtLink>
              </div>
            </template>

            <div v-if="!venta.pagos.length" class="py-2 text-sm text-muted">
              Sin pagos registrados
            </div>
            <ul v-else class="mb-4 divide-y divide-default text-sm">
              <li
                v-for="(p, i) in venta.pagos"
                :key="p.id"
                class="flex flex-col gap-1 py-2"
              >
                <div class="flex justify-between gap-2">
                  <span class="text-muted">Pago {{ i + 1 }}</span>
                  <span class="font-mono">{{ formatMonto(p.monto) }}</span>
                  <span v-if="p.vuelto && new Decimal(p.vuelto).gt(0)" class="text-xs text-muted">
                    (vuelto: {{ formatMonto(p.vuelto) }})
                  </span>
                  <span class="text-xs text-muted">{{ formatFecha(p.fecha) }}</span>
                </div>
                <p
                  v-if="p.aplicaciones?.length"
                  class="text-xs text-muted"
                >
                  <template v-for="(a, ai) in p.aplicaciones" :key="ai">
                    <span v-if="ai > 0"> · </span>
                    {{ a.tipo }}: {{ formatMonto(a.monto) }}
                  </template>
                </p>
              </li>
            </ul>

            <div class="space-y-1 border-t border-default pt-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted">Monto pagado</span>
                <span class="font-mono font-medium">{{ formatMonto(montoPagado) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">Saldo pendiente</span>
                <span class="font-mono font-medium" :class="new Decimal(saldo).gt(0) ? 'text-warning' : ''">
                  {{ formatMonto(saldo) }}
                </span>
              </div>
            </div>
          </UCard>
        </div>

        <UCard v-if="venta.reembolsos.length">
          <template #header>
            <h2 class="text-base font-semibold">
              Reembolsos
            </h2>
          </template>
          <ul class="divide-y divide-default text-sm">
            <li
              v-for="r in venta.reembolsos"
              :key="r.id"
              class="flex items-center justify-between gap-2 py-2"
            >
              <span class="text-muted">{{ formatFecha(r.fecha) }}</span>
              <span class="font-mono">{{ formatMonto(r.monto) }}</span>
              <UBadge :color="reembolsoColor(r.estado)" :label="r.estado" variant="subtle" size="xs" />
              <span class="font-mono text-xs text-muted">{{ r.codigoOrden }}</span>
            </li>
          </ul>
          <div class="mt-3 flex justify-between border-t border-default pt-3 text-sm font-medium">
            <span class="text-muted">Total reembolsado (aprobado)</span>
            <span class="font-mono">{{ formatMonto(totalReembolsado) }}</span>
          </div>
        </UCard>

        <UCard v-if="venta.notasCredito.length || venta.ventaReferenciaId">
          <template #header>
            <h2 class="text-base font-semibold">
              Documentos relacionados
            </h2>
          </template>
          <ul class="divide-y divide-default text-sm">
            <li v-if="venta.ventaReferenciaId" class="py-2">
              <NuxtLink
                :to="{ path: '/ventas', query: { venta: venta.ventaReferenciaId } }"
                class="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <UIcon name="i-lucide-arrow-left" class="h-3 w-3" />
                Venta original
              </NuxtLink>
            </li>
            <li
              v-for="nc in venta.notasCredito"
              :key="nc.id"
              class="flex items-center justify-between gap-2 py-2"
            >
              <NuxtLink
                :to="{ path: '/ventas', query: { venta: nc.id } }"
                class="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Nota de crédito
                <UIcon name="i-lucide-arrow-right" class="h-3 w-3" />
              </NuxtLink>
              <span class="font-mono">{{ formatMonto(nc.totalFinal) }}</span>
              <span class="text-xs text-muted">{{ formatFecha(nc.fecha) }}</span>
            </li>
          </ul>
        </UCard>
      </div>

      <div v-else class="py-12 text-center text-muted">
        <UIcon name="i-lucide-triangle-alert" class="mx-auto mb-2 h-8 w-8 opacity-40" />
        No se encontró la venta.
      </div>
    </template>

    <template #actions>
      <UButton
        color="neutral"
        variant="ghost"
        @click="open = false"
      >
        Cerrar
      </UButton>
      <UButton
        v-if="puedeCrearNC"
        label="Nota de crédito"
        icon="i-lucide-file-minus"
        color="neutral"
        variant="outline"
        @click="ncOpen = true"
      />
      <UButton
        v-if="puedeAbonar"
        label="Registrar pago"
        icon="i-lucide-plus"
        @click="abonoOpen = true"
      />
    </template>
  </AppDrawer>

  <PagosAbonoModal
    v-if="venta"
    v-model:open="abonoOpen"
    :venta-id="venta.id"
    :saldo="saldo"
    :metodos="metodos"
    @success="onAbonoSuccess"
  />

  <VentasNotaCreditoModal
    v-if="venta"
    v-model:open="ncOpen"
    :venta-id="venta.id"
    :disponible="disponibleNC"
    :detalles="venta.detalles"
    @success="onNcSuccess"
  />
</template>
