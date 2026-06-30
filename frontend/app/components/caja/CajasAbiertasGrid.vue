<script setup lang="ts">
import Decimal from 'decimal.js'

const emit = defineEmits<{ (e: 'operar-propia'): void }>()

const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    await cajaStore.cargarAbiertas()
  }
  catch {
    toast.add({ title: 'Error al cargar las cajas abiertas', color: 'error' })
  }
  finally {
    loading.value = false
  }
})

function formatMonto(value: string): string {
  return new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(new Decimal(value).toNumber())
}

function formatFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

function abrir(caja: { id: string, esPropia: boolean }): void {
  if (caja.esPropia) {
    emit('operar-propia')
    return
  }
  navigateTo(`/caja/${caja.id}`)
}
</script>

<template>
  <div>
    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando cajas…
    </div>

    <div
      v-else-if="!cajaStore.abiertas.length"
      class="py-12 text-center text-sm text-gray-500"
    >
      No hay cajas abiertas en este momento.
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="caja in cajaStore.abiertas"
        :key="caja.id"
        class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
        @click="abrir(caja)"
      >
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold truncate">{{ caja.usuarioNombre }}</span>
            <UBadge v-if="caja.esPropia" color="primary" variant="subtle" size="xs">
              Mía
            </UBadge>
          </div>
        </template>

        <dl class="space-y-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-gray-500">
              Saldo inicial
            </dt>
            <dd>{{ formatMonto(caja.saldoInicial) }}</dd>
          </div>
          <div class="flex justify-between font-medium">
            <dt class="text-gray-500">
              Saldo esperado
            </dt>
            <dd>{{ formatMonto(caja.saldoEsperado) }}</dd>
          </div>
          <div class="flex justify-between text-xs text-gray-400 pt-1">
            <dt>Apertura</dt>
            <dd>{{ formatFecha(caja.fechaApertura) }}</dd>
          </div>
        </dl>
      </UCard>
    </div>
  </div>
</template>
