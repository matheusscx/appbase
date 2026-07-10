<script setup lang="ts">
import Decimal from 'decimal.js'

interface PagoDetalle {
  id: string
  ventaId: string
  monto: string
  vuelto: string
  fecha: string
  cajaId: string | null
  referencia: string | null
  metodoNombre: string
  ventaEstado: string
  totalFinal: string
  customerNombre: string | null
  numeroCuotas: number | null
  tipoPago: string | null
  tarjetaUltimos4: string | null
}

defineProps<{
  pago: PagoDetalle | null
}>()

const open = defineModel<boolean>('open', { default: false })

const { formatMonto, formatFecha, formatTipoPago } = useFormatters()

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
  <AppDrawer v-model:open="open" width="sm">
    <template #header>
      <span class="font-semibold text-default">Detalle del pago</span>
    </template>

    <template #body>
      <div v-if="pago" class="space-y-4">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Pago
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt class="text-muted">
                Fecha
              </dt>
              <dd class="font-medium">
                {{ formatFecha(pago.fecha) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Método
              </dt>
              <dd class="font-medium">
                {{ pago.metodoNombre }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Monto
              </dt>
              <dd class="font-mono font-medium">
                {{ formatMonto(pago.monto) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Vuelto
              </dt>
              <dd class="font-mono font-medium">
                {{ pago.vuelto && new Decimal(pago.vuelto).gt(0) ? formatMonto(pago.vuelto) : '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Cliente
              </dt>
              <dd class="font-medium">
                {{ pago.customerNombre ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Referencia
              </dt>
              <dd class="font-medium">
                {{ pago.referencia ?? '—' }}
              </dd>
            </div>
          </dl>
        </UCard>

        <UCard v-if="pago.tipoPago">
          <template #header>
            <h2 class="text-base font-semibold">
              Tarjeta
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt class="text-muted">
                Tipo de pago
              </dt>
              <dd class="font-medium">
                {{ formatTipoPago(pago.tipoPago) }}
              </dd>
            </div>
            <div v-if="pago.tarjetaUltimos4">
              <dt class="text-muted">
                Tarjeta
              </dt>
              <dd class="font-mono font-medium">
                ····{{ pago.tarjetaUltimos4 }}
              </dd>
            </div>
            <div v-if="pago.numeroCuotas && pago.numeroCuotas > 1">
              <dt class="text-muted">
                Cuotas
              </dt>
              <dd class="font-medium">
                {{ pago.numeroCuotas }}
              </dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Venta
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt class="text-muted">
                Estado
              </dt>
              <dd>
                <UBadge
                  :color="estadoColor(pago.ventaEstado)"
                  :label="estadoLabel(pago.ventaEstado)"
                  variant="subtle"
                  size="sm"
                />
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Total venta
              </dt>
              <dd class="font-mono font-medium">
                {{ formatMonto(pago.totalFinal) }}
              </dd>
            </div>
          </dl>
        </UCard>
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
        v-if="pago"
        :to="{ path: '/ventas', query: { venta: pago.ventaId } }"
        label="Ver venta"
        icon="i-lucide-arrow-right"
        variant="subtle"
      />
    </template>
  </AppDrawer>
</template>
