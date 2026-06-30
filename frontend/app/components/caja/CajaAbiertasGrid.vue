<script setup lang="ts">

const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)
const aperturaModalOpen = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([cajaStore.cargarAbiertas(), cajaStore.cargarActiva()])
  }
  catch {
    toast.add({ title: 'Error al cargar las cajas abiertas', color: 'error' })
  }
  finally {
    loading.value = false
  }
})

const tieneCajaPropia = computed(() =>
  cajaStore.abiertas.some(c => c.esPropia),
)

const cajasOrdenadas = computed(() =>
  [...cajaStore.abiertas].sort((a, b) => Number(b.esPropia) - Number(a.esPropia)),
)

const { formatMonto, formatFecha } = useFormatters()

function onOpened(): void {
  aperturaModalOpen.value = false
  if (cajaStore.activa) {
    navigateTo(`/caja/${cajaStore.activa.id}`)
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando cajas…
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <!-- Card sintética de apertura cuando el usuario no tiene caja propia -->
      <UCard
        v-if="!tieneCajaPropia"
        class="cursor-pointer border-2 border-dashed border-primary-300 dark:border-primary-700 transition hover:border-primary-500"
        @click="aperturaModalOpen = true"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-plus-circle" class="w-5 h-5 text-primary-500" />
            <span class="font-semibold text-primary-600 dark:text-primary-400">Abrir mi caja</span>
          </div>
        </template>
        <p class="text-sm text-gray-500">
          No tenés una caja abierta. Hacé click para iniciar tu turno.
        </p>
      </UCard>

      <!-- Cards de cajas abiertas (propia primero) -->
      <UCard
        v-for="caja in cajasOrdenadas"
        :key="caja.id"
        class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
        @click="navigateTo(`/caja/${caja.id}`)"
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

      <!-- Estado vacío: el usuario tiene caja propia pero no hay otras -->
      <div
        v-if="tieneCajaPropia && cajasOrdenadas.length === 0"
        class="col-span-full py-12 text-center text-sm text-gray-500"
      >
        No hay otras cajas abiertas en este momento.
      </div>
    </div>

    <!-- Modal de apertura -->
    <UModal v-model:open="aperturaModalOpen" title="Abrir caja">
      <template #body>
        <CajaAperturaForm @opened="onOpened" />
      </template>
    </UModal>
  </div>
</template>
