<script setup lang="ts">
import Decimal from 'decimal.js'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

const cajaId = computed(() => route.params.id as string)

const totalEntradas = computed(() =>
  cajaStore.movimientos
    .filter(m => m.tipo === 'entrada')
    .reduce((acc, m) => acc.plus(m.monto), new Decimal(0)),
)
const totalSalidas = computed(() =>
  cajaStore.movimientos
    .filter(m => m.tipo === 'salida')
    .reduce((acc, m) => acc.plus(m.monto), new Decimal(0)),
)
const saldoEsperado = computed(() => {
  if (!cajaStore.detalle) return new Decimal(0)
  return new Decimal(cajaStore.detalle.saldoInicial)
    .plus(totalEntradas.value)
    .minus(totalSalidas.value)
})

function formatMonto(value: string | Decimal): string {
  const d = typeof value === 'string' ? new Decimal(value) : value
  return new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d.toNumber())
}

function formatFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

onMounted(async () => {
  loading.value = true
  try {
    await cajaStore.cargarDetalle(cajaId.value)
    if (!cajaStore.detalle) {
      throw new Error('not-found')
    }
    await cajaStore.cargarMovimientos(cajaId.value)
  }
  catch {
    toast.add({ title: 'No tenés acceso a esta caja o no existe', color: 'warning' })
    await navigateTo('/caja')
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 py-6">
    <ULink to="/caja" class="text-sm text-primary-600 inline-flex items-center gap-1">
      <UIcon name="i-heroicons-arrow-left" class="w-4 h-4" />
      Volver a Caja
    </ULink>

    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando…
    </div>

    <template v-else-if="cajaStore.detalle">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div>
              <h1 class="text-lg font-bold">
                Caja (solo lectura)
              </h1>
              <p class="text-xs text-gray-500 mt-1">
                Apertura: {{ formatFecha(cajaStore.detalle.fechaApertura) }}
              </p>
            </div>
            <UBadge
              :color="cajaStore.detalle.estado === 'abierta' ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ cajaStore.detalle.estado }}
            </UBadge>
          </div>
        </template>

        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-gray-500">
              Saldo inicial
            </dt>
            <dd class="font-medium">
              {{ formatMonto(cajaStore.detalle.saldoInicial) }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">
              Saldo esperado
            </dt>
            <dd class="font-medium">
              {{ formatMonto(saldoEsperado) }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">
              Entradas
            </dt>
            <dd class="text-green-600">
              + {{ formatMonto(totalEntradas) }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">
              Salidas
            </dt>
            <dd class="text-red-600">
              - {{ formatMonto(totalSalidas) }}
            </dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Movimientos
          </h2>
        </template>

        <p
          v-if="!cajaStore.movimientos.length"
          class="py-6 text-center text-sm text-gray-500"
        >
          Sin movimientos registrados en este turno.
        </p>

        <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <li
            v-for="mov in cajaStore.movimientos"
            :key="mov.id"
            class="flex items-center justify-between py-2 text-sm"
          >
            <div>
              <p class="font-medium">
                {{ mov.concepto }}
              </p>
              <p class="text-xs text-gray-400">
                {{ formatFecha(mov.fecha) }}
              </p>
            </div>
            <span :class="mov.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'">
              {{ mov.tipo === 'entrada' ? '+' : '-' }} {{ formatMonto(mov.monto) }}
            </span>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
