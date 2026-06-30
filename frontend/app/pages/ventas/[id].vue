<script setup lang="ts">
import Decimal from 'decimal.js'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface Pago {
  id: string
  metodoPagoId: string
  monto: string
  vuelto: string
  fecha: string
  referencia: string | null
}

interface Detalle {
  id: string
  descripcion: string
  cantidad: string
  precioUnitario: string
  totalLinea: string
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
  detalles: Detalle[]
  pagos: Pago[]
  customer: { nombre: string; rut?: string } | null
}

const route = useRoute()
const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const apiUrl = config.public.apiUrl

const venta = ref<VentaDetalle | null>(null)
const loading = ref(false)
const abonoOpen = ref(false)

const montoPagado = computed(() => {
  if (!venta.value) return '0'
  return venta.value.pagos.reduce((acc, p) => {
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

async function cargar() {
  loading.value = true
  try {
    venta.value = await useApiFetch<VentaDetalle>(`${apiUrl}/ventas/${route.params.id}`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar venta', color: 'error' })
  }
  finally {
    loading.value = false
  }
}

onMounted(cargar)

async function onAbonoSuccess() {
  abonoOpen.value = false
  await cargar()
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
</script>

<template>
  <div class="space-y-4">
    <!-- Header row: back + title + estado -->
    <div class="flex items-center gap-3">
      <UButton
        icon="i-heroicons-arrow-left"
        color="neutral"
        variant="ghost"
        label="Volver"
        @click="navigateTo('/ventas/historial')"
      />
      <h1 class="text-lg font-semibold flex-1">
        Detalle de venta
      </h1>
      <UBadge
        v-if="venta"
        :color="estadoColor(venta.estado)"
        :label="estadoLabel(venta.estado)"
        variant="subtle"
        size="md"
      />
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center text-muted py-12">
      Cargando...
    </div>

    <template v-else-if="venta">
      <!-- Metadata -->
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold">Información general</h2>
        </template>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt class="text-muted">Fecha</dt>
            <dd class="font-medium">{{ formatFecha(venta.fecha) }}</dd>
          </div>
          <div>
            <dt class="text-muted">Canal</dt>
            <dd class="font-medium capitalize">{{ venta.canal }}</dd>
          </div>
          <div v-if="venta.customer">
            <dt class="text-muted">Cliente</dt>
            <dd class="font-medium">
              {{ venta.customer.nombre }}
              <span v-if="venta.customer.rut" class="text-muted ml-1">({{ venta.customer.rut }})</span>
            </dd>
          </div>
        </dl>
      </UCard>

      <!-- Detalles table -->
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold">Líneas de venta</h2>
        </template>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-left text-muted">
                <th class="py-2 pr-4">Descripción</th>
                <th class="py-2 pr-4 text-right">Cantidad</th>
                <th class="py-2 pr-4 text-right">Precio unit.</th>
                <th class="py-2 text-right">Total línea</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in venta.detalles"
                :key="d.id"
                class="border-b border-default last:border-0"
              >
                <td class="py-2 pr-4">{{ d.descripcion }}</td>
                <td class="py-2 pr-4 text-right font-mono">{{ d.cantidad }}</td>
                <td class="py-2 pr-4 text-right font-mono">{{ formatMonto(d.precioUnitario) }}</td>
                <td class="py-2 text-right font-mono">{{ formatMonto(d.totalLinea) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <!-- Totals + Pagos + Saldo -->
      <div class="grid gap-4 md:grid-cols-2">
        <!-- Totals -->
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">Totales</h2>
          </template>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between">
              <dt class="text-muted">Subtotal bruto</dt>
              <dd class="font-mono">{{ formatMonto(venta.totalBruto) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">Descuentos</dt>
              <dd class="font-mono text-green-600 dark:text-green-400">
                -{{ formatMonto(venta.totalDescuentos) }}
              </dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">Recargos</dt>
              <dd class="font-mono">{{ formatMonto(venta.totalRecargos) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">Impuestos</dt>
              <dd class="font-mono">{{ formatMonto(venta.totalImpuestos) }}</dd>
            </div>
            <div class="flex justify-between border-t border-default pt-2 font-semibold">
              <dt>Total final</dt>
              <dd class="font-mono">{{ formatMonto(venta.totalFinal) }}</dd>
            </div>
          </dl>
        </UCard>

        <!-- Pagos + Saldo -->
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">Pagos</h2>
          </template>

          <div v-if="!venta.pagos.length" class="text-sm text-muted py-2">
            Sin pagos registrados
          </div>
          <ul v-else class="divide-y divide-default text-sm mb-4">
            <li
              v-for="(p, i) in venta.pagos"
              :key="p.id"
              class="py-2 flex justify-between gap-2"
            >
              <span class="text-muted">Pago {{ i + 1 }}</span>
              <span class="font-mono">{{ formatMonto(p.monto) }}</span>
              <span v-if="p.vuelto && new Decimal(p.vuelto).gt(0)" class="text-muted text-xs">
                (vuelto: {{ formatMonto(p.vuelto) }})
              </span>
              <span class="text-muted text-xs">{{ formatFecha(p.fecha) }}</span>
            </li>
          </ul>

          <div class="border-t border-default pt-3 space-y-1 text-sm">
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

          <div v-if="puedeAbonar" class="mt-4">
            <!-- AbonoModal — implemented in Task E -->
            <!-- <PagosAbonoModal v-model:open="abonoOpen" :venta-id="venta.id" :saldo="saldo" @success="onAbonoSuccess" /> -->
            <UButton
              label="Registrar pago"
              icon="i-heroicons-plus"
              class="w-full"
              @click="abonoOpen = true"
            />
          </div>
        </UCard>
      </div>
    </template>

    <div v-else class="text-center text-muted py-12">
      No se encontró la venta.
    </div>
  </div>
</template>
