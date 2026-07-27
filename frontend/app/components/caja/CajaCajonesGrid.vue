<script setup lang="ts">
const cajaStore = useCajaStore()
const toast = useToast()
const loading = ref(false)

const { formatMonto, formatFecha } = useFormatters()

onMounted(async () => {
  loading.value = true
  try {
    await cajaStore.cargarCajonesEstado()
  }
  catch {
    toast.add({ title: 'Error al cargar los cajones', color: 'error' })
  }
  finally {
    loading.value = false
  }
})

const cajonesOrdenados = computed(() =>
  [...cajaStore.cajonesEstado].sort((a, b) => {
    const ocupA = a.sesion ? 1 : 0
    const ocupB = b.sesion ? 1 : 0
    if (ocupA !== ocupB) return ocupB - ocupA
    const propiaA = a.sesion?.esPropia ? 1 : 0
    const propiaB = b.sesion?.esPropia ? 1 : 0
    if (propiaA !== propiaB) return propiaB - propiaA
    return a.nombre.localeCompare(b.nombre, 'es')
  }),
)
</script>

<template>
  <div class="w-full">
    <div v-if="loading" class="py-12 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando cajones…
    </div>

    <div v-else-if="cajonesOrdenados.length === 0" class="py-12 text-center text-sm text-muted">
      No hay cajones activos definidos.
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="cajon in cajonesOrdenados"
        :key="cajon.cajonId"
        class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
        @click="cajon.sesion
          ? navigateTo(`/cajas/${cajon.sesion.cajaId}`)
          : navigateTo(`/cajas/historial?cajonId=${cajon.cajonId}`)"
      >
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-default truncate">{{ cajon.nombre }}</span>
            <UBadge v-if="cajon.sesion?.esPropia" color="primary" variant="subtle" size="xs">
              Mía
            </UBadge>
            <UBadge v-else-if="!cajon.sesion" color="neutral" variant="subtle" size="xs">
              Libre
            </UBadge>
          </div>
        </template>

        <dl v-if="cajon.sesion" class="space-y-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">
              Usuario
            </dt>
            <dd class="text-default truncate">{{ cajon.sesion.usuarioNombre }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">
              Saldo inicial
            </dt>
            <dd class="text-default">{{ formatMonto(cajon.sesion.saldoInicial) }}</dd>
          </div>
          <div class="flex justify-between font-medium">
            <dt class="text-muted">
              Saldo esperado
            </dt>
            <dd v-if="cajon.sesion.saldoEsperado !== null" class="text-default">
              {{ formatMonto(cajon.sesion.saldoEsperado) }}
            </dd>
            <!-- Modo ciego con la caja abierta: el backend retiene el esperado. -->
            <dd v-else class="text-muted">
              —
            </dd>
          </div>
          <div class="flex justify-between text-xs text-muted pt-1">
            <dt>Apertura</dt>
            <dd>{{ formatFecha(cajon.sesion.fechaApertura) }}</dd>
          </div>
        </dl>

        <p v-else class="text-sm text-muted">
          Sin caja abierta. Ver historial.
        </p>
      </UCard>
    </div>
  </div>
</template>
