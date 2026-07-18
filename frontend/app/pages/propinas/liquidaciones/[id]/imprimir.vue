<script setup lang="ts">
import type { LiquidacionDetalle } from '~/composables/usePropinaLiquidaciones'
import type { Garzon } from '~/composables/useGarzones'
import type { GrupoImpresion } from '~/composables/usePropinaImpresion'
import { agruparParaImpresion } from '~/composables/usePropinaImpresion'

definePageMeta({ middleware: 'auth', layout: false })

type TipoImpresion = 'persona' | 'resumen' | 'grupo'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const api = usePropinaLiquidaciones()
const garzonesApi = useGarzones()
const { formatMonto, formatFecha } = useFormatters()

const id = computed(() => String(route.params.id))
const tipo = computed<TipoImpresion>(() => {
  const t = route.query.tipo
  return t === 'persona' || t === 'grupo' ? t : 'resumen'
})

const detalle = ref<LiquidacionDetalle | null>(null)
const grupos = ref<GrupoImpresion[]>([])
const loading = ref(false)

const personasPlanas = computed(() =>
  grupos.value.flatMap(g => g.personas.map(p => ({ ...p, grupoNombre: g.nombre }))),
)

const tipoItems = [
  { label: 'Resumen', value: 'resumen' },
  { label: 'Por grupo', value: 'grupo' },
  { label: 'Por persona', value: 'persona' },
]

function setTipo(value: TipoImpresion) {
  router.replace({ query: { ...route.query, tipo: value } })
}

function imprimir() {
  window.print()
}

async function cargar() {
  loading.value = true
  try {
    const [d, gz] = await Promise.all([api.detalle(id.value), garzonesApi.listar()])
    detalle.value = d
    grupos.value = agruparParaImpresion(d, gz as Garzon[])
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar la liquidación'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="mx-auto max-w-4xl p-6 print:p-0">
    <!-- Barra de acciones (no se imprime) -->
    <div class="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
      <UButton icon="i-lucide-arrow-left" variant="ghost" label="Volver" @click="router.push('/propinas')" />
      <div class="flex items-center gap-2">
        <UButton
          v-for="opt in tipoItems"
          :key="opt.value"
          size="sm"
          :variant="tipo === opt.value ? 'solid' : 'outline'"
          :label="opt.label"
          @click="setTipo(opt.value as TipoImpresion)"
        />
        <UButton icon="i-lucide-printer" label="Imprimir" @click="imprimir" />
      </div>
    </div>

    <div v-if="loading" class="py-12 text-center text-sm text-muted">Cargando…</div>

    <div v-else-if="detalle" class="print-doc">
      <!-- RESUMEN: todo en una hoja -->
      <template v-if="tipo === 'resumen'">
        <header class="mb-6">
          <h1 class="text-xl font-bold">Liquidación de propinas</h1>
          <p class="text-sm">{{ formatFecha(detalle.fechaDesde) }} → {{ formatFecha(detalle.fechaHasta) }}</p>
          <p class="mt-2 text-lg font-semibold">Fondo total: {{ formatMonto(detalle.poolTotal, detalle.monedaId) }}</p>
        </header>
        <section v-for="g in grupos" :key="g.id" class="mb-6">
          <div class="mb-2 flex items-center justify-between border-b border-default pb-1">
            <h2 class="font-semibold">{{ g.nombre }}</h2>
            <span class="font-semibold">{{ formatMonto(g.montoGrupo, detalle.monedaId) }}</span>
          </div>
          <table class="w-full text-sm">
            <tbody>
              <tr v-for="p in g.personas" :key="p.garzonId" class="border-b border-default/50">
                <td class="py-1">{{ p.nombre }}</td>
                <td class="py-1 text-right">{{ formatMonto(p.monto, detalle.monedaId) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>

      <!-- GRUPO: una hoja por grupo -->
      <template v-else-if="tipo === 'grupo'">
        <section v-for="g in grupos" :key="g.id" class="page-break mb-6">
          <header class="mb-4">
            <h1 class="text-xl font-bold">{{ g.nombre }}</h1>
            <p class="text-sm">{{ formatFecha(detalle.fechaDesde) }} → {{ formatFecha(detalle.fechaHasta) }}</p>
            <p class="mt-1 font-semibold">Total del grupo: {{ formatMonto(g.montoGrupo, detalle.monedaId) }}</p>
          </header>
          <table class="w-full text-sm">
            <tbody>
              <tr v-for="p in g.personas" :key="p.garzonId" class="border-b border-default/50">
                <td class="py-1">{{ p.nombre }}</td>
                <td class="py-1 text-right">{{ formatMonto(p.monto, detalle.monedaId) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>

      <!-- PERSONA: un comprobante por persona -->
      <template v-else>
        <section
          v-for="p in personasPlanas"
          :key="p.garzonId"
          class="page-break comprobante mb-6 border border-default p-6"
        >
          <h1 class="text-lg font-bold">Comprobante de propina</h1>
          <p class="text-sm">{{ formatFecha(detalle.fechaDesde) }} → {{ formatFecha(detalle.fechaHasta) }}</p>
          <p class="mt-4 text-base">{{ p.nombre }} · {{ p.grupoNombre }}</p>
          <p class="my-4 text-3xl font-bold">{{ formatMonto(p.monto, detalle.monedaId) }}</p>
          <div class="firma mt-10 border-t border-default pt-2 text-sm">Firma: ______________________________</div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
@media print {
  .no-print { display: none !important; }
  .page-break { page-break-after: always; }
}
@page { size: A4; margin: 16mm; }
</style>
