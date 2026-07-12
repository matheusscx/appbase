<script setup lang="ts">
import Decimal from 'decimal.js'

const props = defineProps<{
  caja: {
    id: string
    estado: string
    saldoInicial: string
    fechaApertura: string
  }
  readonly?: boolean
}>()

const cajaStore = useCajaStore()
const toast = useToast()

const movimientoDrawerOpen = ref(false)
const cierreDrawerOpen = ref(false)
const movimientosTableRef = useTemplateRef('movimientosTable')

const loadingResumen = computed(() => cajaStore.loadingResumenTurno)

const totalEntradas = computed(() =>
  new Decimal(cajaStore.resumenTurno?.totalEntradas ?? '0'),
)
const totalSalidas = computed(() =>
  new Decimal(cajaStore.resumenTurno?.totalSalidas ?? '0'),
)
const saldoEsperado = computed(() =>
  new Decimal(cajaStore.resumenTurno?.saldoEsperado ?? props.caja.saldoInicial),
)

async function cargarResumen() {
  try {
    await cajaStore.cargarResumenTurno(props.caja.id)
  }
  catch {
    toast.add({ title: 'Error al cargar resumen del turno', color: 'error' })
  }
}

async function recargar() {
  await Promise.all([
    movimientosTableRef.value?.recargar(),
    cargarResumen(),
  ])
}

onMounted(cargarResumen)

watch(() => props.caja.id, () => {
  cargarResumen()
})
</script>

<template>
  <div class="w-full space-y-6">
    <UCard class="w-full">
      <template #header>
        <CajaTurnoHeader
          :caja="caja"
          :readonly="readonly"
          @movimiento="movimientoDrawerOpen = true"
          @cerrar="cierreDrawerOpen = true"
        />
      </template>

      <CajaTurnoResumen
        :saldo-inicial="caja.saldoInicial"
        :total-entradas="totalEntradas"
        :total-salidas="totalSalidas"
        :saldo-esperado="saldoEsperado"
        :loading="loadingResumen"
      />
    </UCard>

    <CajaMovimientosTable ref="movimientosTable" :caja-id="caja.id" />

    <template v-if="!readonly">
      <CajaMovimientoDrawer
        v-model:open="movimientoDrawerOpen"
        :caja-id="caja.id"
        @saved="recargar"
      />
      <CajaCierreDrawer
        v-model:open="cierreDrawerOpen"
        :caja-id="caja.id"
        :saldo-esperado="saldoEsperado"
      />
    </template>
  </div>
</template>
