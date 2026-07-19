<script setup lang="ts">
import Decimal from 'decimal.js'
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
const monedasStore = useMonedasStore()
const { formatMonto } = useFormatters()

const id = computed(() => String(route.params.id))
const tipo = computed<TipoImpresion>(() => {
  const t = route.query.tipo
  return t === 'persona' || t === 'grupo' ? t : 'resumen'
})

const detalle = ref<LiquidacionDetalle | null>(null)
const grupos = ref<GrupoImpresion[]>([])
const loading = ref(false)

const monedaId = computed(() => detalle.value?.monedaId)

const personasPlanas = computed(() =>
  grupos.value.flatMap(g => g.personas.map(p => ({ ...p, grupoNombre: g.nombre }))),
)

// Folio corto derivado del UUID — identifica el documento sin exponerlo entero.
const folio = computed(() => id.value.slice(0, 8).toUpperCase())

const totalGarzones = computed(() => personasPlanas.value.length)
const totalVentas = computed(() => detalle.value?.fuentes.length ?? 0)

const estadoConfig: Record<string, { label: string, color: 'success' | 'warning' | 'error' }> = {
  borrador: { label: 'Borrador', color: 'warning' },
  confirmada: { label: 'Confirmada', color: 'success' },
  anulada: { label: 'Anulada', color: 'error' },
}
const estado = computed(() =>
  estadoConfig[detalle.value?.estado ?? ''] ?? { label: detalle.value?.estado ?? '', color: 'warning' as const },
)

const criterioLabels: Record<string, string> = {
  PARTES_IGUALES: 'Partes iguales',
  VENTAS_NETAS: 'Ventas netas',
  HORAS_TRABAJADAS: 'Horas trabajadas',
  CANTIDAD_CUENTAS: 'Cantidad de cuentas',
  MANUAL: 'Manual',
}
function criterioLabel(criterio: string): string {
  return criterioLabels[criterio] ?? criterio
}

const rangoFmt = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—'
  return rangoFmt.format(new Date(iso)).replace('.', '')
}

/** Participación de una persona dentro del total de su grupo, 0–100. */
function sharePct(monto: string, totalGrupo: string): number {
  try {
    const total = new Decimal(totalGrupo)
    if (total.lte(0)) return 0
    return new Decimal(monto).div(total).mul(100).toDecimalPlaces(0).toNumber()
  }
  catch {
    return 0
  }
}

const tipoItems: { label: string, value: TipoImpresion, icon: string }[] = [
  { label: 'Resumen', value: 'resumen', icon: 'i-lucide-receipt-text' },
  { label: 'Por grupo', value: 'grupo', icon: 'i-lucide-users' },
  { label: 'Por persona', value: 'persona', icon: 'i-lucide-user' },
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
    const [d, gz] = await Promise.all([
      api.detalle(id.value),
      garzonesApi.listar(),
      monedasStore.ensureLoaded(),
    ])
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
  <div class="min-h-screen bg-muted px-4 py-8 print:min-h-0 print:bg-transparent print:p-0">
    <div class="mx-auto max-w-3xl">
      <!-- Barra de acciones (no se imprime) -->
      <div class="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          label="Volver"
          @click="router.push('/propinas')"
        />
        <div class="flex items-center gap-2">
          <div class="flex rounded-lg bg-elevated p-0.5">
            <UButton
              v-for="opt in tipoItems"
              :key="opt.value"
              :icon="opt.icon"
              size="sm"
              :variant="tipo === opt.value ? 'solid' : 'ghost'"
              :color="tipo === opt.value ? 'primary' : 'neutral'"
              :aria-label="opt.label"
              @click="setTipo(opt.value)"
            >
              <span class="hidden sm:inline">{{ opt.label }}</span>
            </UButton>
          </div>
          <UButton icon="i-lucide-printer" label="Imprimir" @click="imprimir" />
        </div>
      </div>

      <div v-if="loading" class="py-16 text-center text-sm text-muted">
        Cargando liquidación…
      </div>

      <div v-else-if="!detalle" class="py-16 text-center text-sm text-muted">
        No se encontró la liquidación.
      </div>

      <template v-else>
        <!-- RESUMEN: todo en una hoja -->
        <article
          v-if="tipo === 'resumen'"
          class="rounded-xl bg-default p-8 shadow-sm ring-1 ring-default print:rounded-none print:bg-transparent print:p-0 print:shadow-none print:ring-0"
        >
          <!-- Masthead -->
          <header class="flex items-start justify-between gap-4 border-b border-default pb-5">
            <div>
              <p class="text-xs font-medium uppercase tracking-wider text-muted">
                Comprobante de liquidación
              </p>
              <h1 class="mt-1 text-2xl font-semibold text-default">
                Propinas
              </h1>
              <p class="mt-1 text-sm text-muted">
                {{ fechaCorta(detalle.fechaDesde) }} – {{ fechaCorta(detalle.fechaHasta) }}
                <span class="text-dimmed">·</span>
                Folio <span class="font-mono text-default">{{ folio }}</span>
              </p>
            </div>
            <UBadge :color="estado.color" variant="subtle" size="lg" :label="estado.label" />
          </header>

          <!-- Hero: fondo total -->
          <div class="flex flex-wrap items-end justify-between gap-4 py-6">
            <div>
              <p class="text-xs font-medium uppercase tracking-wider text-muted">
                Fondo total repartido
              </p>
              <p class="mt-1 text-4xl font-bold tabular-nums tracking-tight text-default">
                {{ formatMonto(detalle.poolTotal, monedaId) }}
              </p>
            </div>
            <dl class="flex gap-6 text-sm">
              <div>
                <dt class="text-muted">Garzones</dt>
                <dd class="font-semibold tabular-nums text-default">{{ totalGarzones }}</dd>
              </div>
              <div>
                <dt class="text-muted">Ventas</dt>
                <dd class="font-semibold tabular-nums text-default">{{ totalVentas }}</dd>
              </div>
              <div>
                <dt class="text-muted">Grupos</dt>
                <dd class="font-semibold tabular-nums text-default">{{ grupos.length }}</dd>
              </div>
            </dl>
          </div>

          <!-- Grupos y personas -->
          <section v-for="g in grupos" :key="g.id" class="border-t border-default pt-5">
            <div class="mb-1 flex items-baseline justify-between gap-4">
              <div>
                <h2 class="font-semibold text-default">{{ g.nombre }}</h2>
                <p class="text-xs text-muted">
                  {{ criterioLabel(g.criterio) }}
                </p>
              </div>
              <span class="font-semibold tabular-nums text-default">
                {{ formatMonto(g.montoGrupo, monedaId) }}
              </span>
            </div>
            <ul class="divide-y divide-default">
              <li
                v-for="p in g.personas"
                :key="p.garzonId"
                class="flex items-center justify-between gap-4 py-3"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-default">{{ p.nombre }}</p>
                  <div class="mt-1.5 flex items-center gap-2 print:hidden">
                    <div class="h-1.5 w-full max-w-44 overflow-hidden rounded-full bg-elevated">
                      <div
                        class="h-full rounded-full bg-primary"
                        :style="{ width: `${sharePct(p.monto, g.montoGrupo)}%` }"
                      />
                    </div>
                    <span class="w-9 shrink-0 text-xs tabular-nums text-muted">
                      {{ sharePct(p.monto, g.montoGrupo) }}%
                    </span>
                  </div>
                </div>
                <span class="shrink-0 font-semibold tabular-nums text-default">
                  {{ formatMonto(p.monto, monedaId) }}
                </span>
              </li>
            </ul>
          </section>

          <!-- Pie -->
          <footer class="mt-6 flex flex-wrap gap-x-2 border-t border-default pt-4 text-xs text-muted">
            <span v-if="detalle.estado === 'confirmada' && detalle.confirmadoEl">
              Confirmada el {{ fechaCorta(detalle.confirmadoEl) }}.
            </span>
            <span v-else-if="detalle.estado === 'anulada' && detalle.anuladoEl">
              Anulada el {{ fechaCorta(detalle.anuladoEl) }}.
            </span>
            <span>Documento generado por el sistema · Folio {{ folio }}</span>
          </footer>
        </article>

        <!-- POR GRUPO: una hoja por grupo -->
        <div v-else-if="tipo === 'grupo'" class="space-y-6 print:space-y-0">
          <article
            v-for="g in grupos"
            :key="g.id"
            class="page-break rounded-xl bg-default p-8 shadow-sm ring-1 ring-default print:rounded-none print:bg-transparent print:p-0 print:shadow-none print:ring-0"
          >
            <header class="flex items-start justify-between gap-4 border-b border-default pb-5">
              <div>
                <p class="text-xs font-medium uppercase tracking-wider text-muted">
                  {{ criterioLabel(g.criterio) }}
                </p>
                <h1 class="mt-1 text-2xl font-semibold text-default">{{ g.nombre }}</h1>
                <p class="mt-1 text-sm text-muted">
                  {{ fechaCorta(detalle.fechaDesde) }} – {{ fechaCorta(detalle.fechaHasta) }}
                  <span class="text-dimmed">·</span>
                  Folio <span class="font-mono text-default">{{ folio }}</span>
                </p>
              </div>
              <UBadge :color="estado.color" variant="subtle" size="lg" :label="estado.label" />
            </header>

            <div class="py-6">
              <p class="text-xs font-medium uppercase tracking-wider text-muted">
                Total del grupo
              </p>
              <p class="mt-1 text-4xl font-bold tabular-nums tracking-tight text-default">
                {{ formatMonto(g.montoGrupo, monedaId) }}
              </p>
            </div>

            <ul class="divide-y divide-default border-t border-default">
              <li
                v-for="p in g.personas"
                :key="p.garzonId"
                class="flex items-center justify-between gap-4 py-3"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-default">{{ p.nombre }}</p>
                  <div class="mt-1.5 flex items-center gap-2 print:hidden">
                    <div class="h-1.5 w-full max-w-44 overflow-hidden rounded-full bg-elevated">
                      <div
                        class="h-full rounded-full bg-primary"
                        :style="{ width: `${sharePct(p.monto, g.montoGrupo)}%` }"
                      />
                    </div>
                    <span class="w-9 shrink-0 text-xs tabular-nums text-muted">
                      {{ sharePct(p.monto, g.montoGrupo) }}%
                    </span>
                  </div>
                </div>
                <span class="shrink-0 font-semibold tabular-nums text-default">
                  {{ formatMonto(p.monto, monedaId) }}
                </span>
              </li>
            </ul>
          </article>
        </div>

        <!-- POR PERSONA: un comprobante por persona -->
        <div v-else class="space-y-6 print:space-y-0">
          <article
            v-for="p in personasPlanas"
            :key="p.garzonId"
            class="page-break rounded-xl bg-default p-8 shadow-sm ring-1 ring-default print:rounded-none print:bg-transparent print:p-0 print:shadow-none print:ring-0"
          >
            <div class="flex items-start justify-between gap-4 border-b border-default pb-4">
              <div>
                <p class="text-xs font-medium uppercase tracking-wider text-muted">
                  Comprobante de propina
                </p>
                <p class="mt-1 text-sm text-muted">
                  {{ fechaCorta(detalle.fechaDesde) }} – {{ fechaCorta(detalle.fechaHasta) }}
                  <span class="text-dimmed">·</span>
                  Folio <span class="font-mono text-default">{{ folio }}</span>
                </p>
              </div>
              <UBadge :color="estado.color" variant="subtle" :label="estado.label" />
            </div>

            <div class="py-8">
              <p class="text-lg font-medium text-default">{{ p.nombre }}</p>
              <p class="text-sm text-muted">{{ p.grupoNombre }}</p>
              <p class="mt-4 text-4xl font-bold tabular-nums tracking-tight text-default">
                {{ formatMonto(p.monto, monedaId) }}
              </p>
            </div>

            <div class="mt-10 flex items-end justify-between gap-8">
              <div class="flex-1 border-t border-default pt-2 text-sm text-muted">
                Firma
              </div>
              <div class="flex-1 border-t border-default pt-2 text-sm text-muted">
                Fecha de recepción
              </div>
            </div>
          </article>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
@media print {
  .no-print { display: none !important; }
  .page-break { page-break-after: always; }
  .page-break:last-child { page-break-after: auto; }
}
@page { size: A4; margin: 16mm; }
</style>
