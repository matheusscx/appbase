<script setup lang="ts">
import type { DiaRendicion, RendicionDetalle } from '~/types/paqueteria'

// Sin layout: la planilla se imprime, y el menú y la barra de la app no tienen que salir en el
// papel. Misma salida que la impresión de propinas.
definePageMeta({ middleware: ['auth', 'admin'], layout: false })

const SIN_TARIFA = 'sin_tarifa'

const route = useRoute()
const apiUrl = useRuntimeConfig().public.apiUrl
const monedasStore = useMonedasStore()
const { formatOficial } = useCurrency()
const { formatFecha } = useFormatters()
const { presentarSaldo, presentarNeto, rotuloMedio, fechaCorta, periodo: periodoDe } = usePaqueteria()

const rendicionId = String(route.params.id)
const rendicion = ref<RendicionDetalle | null>(null)
const cargando = ref(true)
const falloCarga = ref<string | null>(null)

async function cargar() {
  cargando.value = true
  falloCarga.value = null
  try {
    // Sin el layout nadie carga las monedas: el formateador de plata las necesita.
    await monedasStore.ensureLoaded()
    rendicion.value = await useApiFetch<RendicionDetalle>(`${apiUrl}/rendiciones/${rendicionId}`)
  }
  catch (e: unknown) {
    falloCarga.value = apiErrorMsg(e, 'No se pudo cargar la rendición')
  }
  finally {
    cargando.value = false
  }
}

onMounted(cargar)

interface Columna { id: string, nombre: string, monto: string | null }

/** Una columna por tarifa usada y, si hubo entregas anteriores a las tarifas, una última «Sin tarifa». */
const columnas = computed<Columna[]>(() => {
  const r = rendicion.value
  if (!r) return []
  const cols: Columna[] = r.tarifas.map(t => ({ id: t.id, nombre: t.nombre, monto: t.monto }))
  if (r.dias.some(d => (d.porTarifa[SIN_TARIFA] ?? 0) > 0)) {
    cols.push({ id: SIN_TARIFA, nombre: 'Sin tarifa', monto: null })
  }
  return cols
})

// Un conteo de paquetes se suma como entero: la plata sale toda del servidor.
const cantidadTotal = (columnaId: string) =>
  rendicion.value?.dias.reduce((suma, d) => suma + (d.porTarifa[columnaId] ?? 0), 0) ?? 0
const cantidadDia = (dia: DiaRendicion, columnaId: string) => dia.porTarifa[columnaId] ?? 0

const periodo = computed(() => {
  const dias = rendicion.value?.dias ?? []
  if (!dias.length) return ''
  return periodoDe(dias[0]!.fecha, dias[dias.length - 1]!.fecha, formatFecha)
})

const saldo = computed(() => rendicion.value ? presentarSaldo(rendicion.value.totales.saldo) : null)

function imprimir() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-muted px-4 py-8 print:min-h-0 print:bg-transparent print:p-0">
    <div class="mx-auto w-full max-w-5xl space-y-4">
      <div class="no-print flex flex-wrap items-center justify-between gap-3">
        <UButton
          to="/paquetes/rendiciones"
          label="Rendiciones"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="link"
          class="-ml-2.5"
        />
        <UButton
          v-if="rendicion"
          label="Imprimir"
          icon="i-lucide-printer"
          data-qa="rendicion-imprimir"
          @click="imprimir"
        />
      </div>

      <UAlert
        v-if="falloCarga"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="falloCarga"
        data-qa="rendicion-error"
      />

      <p v-else-if="cargando" class="no-print py-10 text-center text-sm text-muted">
        Cargando la rendición…
      </p>

      <article
        v-else-if="rendicion"
        class="space-y-8 rounded-xl bg-default p-8 shadow-sm ring-1 ring-default print:rounded-none print:bg-transparent print:p-0 print:shadow-none print:ring-0"
        data-qa="rendicion-planilla"
      >
        <header class="space-y-1">
          <p class="text-sm text-muted">
            Relación de entregas
          </p>
          <h1 class="text-2xl font-semibold text-highlighted" data-qa="rendicion-repartidor">
            {{ rendicion.repartidorNombre }}
          </h1>
          <p class="text-sm tabular-nums text-default" data-qa="rendicion-periodo">
            {{ periodo }}
            <span v-if="rendicion.rendidaEl" class="text-muted">· rendida el {{ formatFecha(rendicion.rendidaEl) }}</span>
          </p>
        </header>

        <div class="overflow-x-auto print:overflow-visible">
          <table class="w-full border-collapse text-sm tabular-nums" data-qa="rendicion-tabla">
            <thead>
              <tr class="border-b border-default text-left align-bottom text-muted">
                <th scope="col" class="py-2 pr-4 font-medium">
                  Día
                </th>
                <th
                  v-for="c in columnas"
                  :key="c.id"
                  scope="col"
                  class="px-2 py-2 text-right font-medium"
                  :data-qa="`rendicion-col-${c.id}`"
                >
                  {{ c.nombre }}
                  <span v-if="c.monto" class="block text-xs font-normal">{{ formatOficial(c.monto) }}</span>
                </th>
                <th scope="col" class="px-2 py-2 text-right font-medium">
                  Entregados
                </th>
                <th scope="col" class="px-2 py-2 text-right font-medium">
                  Pago
                </th>
                <th scope="col" class="px-2 py-2 text-right font-medium">
                  Cobrado en efectivo
                </th>
                <th scope="col" class="px-2 py-2 text-right font-medium">
                  Cobrado por transferencia
                </th>
                <th scope="col" class="py-2 pl-2 text-right font-medium">
                  Neto
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in rendicion.dias"
                :key="d.hojaId"
                class="border-b border-default"
                :data-qa="`rendicion-dia-${d.fecha}`"
              >
                <th scope="row" class="py-2 pr-4 text-left font-normal text-default">
                  {{ fechaCorta(d.fecha) }}
                </th>
                <td v-for="c in columnas" :key="c.id" class="px-2 py-2 text-right text-default">
                  {{ cantidadDia(d, c.id) || '' }}
                </td>
                <td class="px-2 py-2 text-right text-default">
                  {{ d.entregados }}
                </td>
                <td class="px-2 py-2 text-right text-default">
                  {{ formatOficial(d.montoPagoRepartidor) }}
                </td>
                <td class="px-2 py-2 text-right text-default">
                  {{ formatOficial(d.montoCobradoEfectivo) }}
                </td>
                <td class="px-2 py-2 text-right text-default">
                  {{ formatOficial(d.montoCobradoTransferencia) }}
                </td>
                <td
                  class="py-2 pl-2 text-right"
                  :class="presentarNeto(d.neto).negativo ? 'font-semibold text-error' : 'text-default'"
                >
                  {{ presentarNeto(d.neto).texto }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="font-semibold text-highlighted" data-qa="rendicion-totales">
                <th scope="row" class="py-3 pr-4 text-left font-semibold">
                  Totales
                </th>
                <td v-for="c in columnas" :key="c.id" class="px-2 py-3 text-right">
                  {{ cantidadTotal(c.id) }}
                </td>
                <td class="px-2 py-3 text-right" data-qa="rendicion-total-entregados">
                  {{ rendicion.totales.entregados }}
                </td>
                <td class="px-2 py-3 text-right" data-qa="rendicion-total-pago">
                  {{ formatOficial(rendicion.totales.montoPagoRepartidor) }}
                </td>
                <td class="px-2 py-3 text-right" data-qa="rendicion-total-efectivo">
                  {{ formatOficial(rendicion.totales.montoCobradoEfectivo) }}
                </td>
                <td class="px-2 py-3 text-right" data-qa="rendicion-total-transferencia">
                  {{ formatOficial(rendicion.totales.montoCobradoTransferencia) }}
                </td>
                <td class="py-3 pl-2" />
              </tr>
            </tfoot>
          </table>
        </div>

        <section v-if="rendicion.entregas.length" class="space-y-2" aria-label="Plata entregada a cuenta">
          <h2 class="text-base font-semibold text-highlighted">
            Plata entregada a cuenta
          </h2>
          <ul class="divide-y divide-default border-y border-default text-sm" data-qa="rendicion-entregas">
            <li v-for="e in rendicion.entregas" :key="e.id" class="flex flex-wrap items-baseline gap-x-4 py-2">
              <span class="w-16 tabular-nums text-muted">{{ fechaCorta(e.fecha) }}</span>
              <span class="w-32 text-default">{{ rotuloMedio(e.medio) }}</span>
              <span class="min-w-0 flex-1 text-muted">{{ e.nota }}</span>
              <span class="tabular-nums text-default">{{ formatOficial(e.monto) }}</span>
            </li>
          </ul>
        </section>

        <section class="ml-auto w-full max-w-sm space-y-2" aria-label="Cuenta final">
          <dl class="space-y-1 text-sm tabular-nums">
            <div class="flex justify-between gap-4">
              <dt class="text-muted">
                Cobrado en destino
              </dt>
              <dd class="text-default" data-qa="rendicion-cobrado">
                {{ formatOficial(rendicion.totales.montoCobradoDestino) }}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">
                Pago al repartidor
              </dt>
              <dd class="text-default">
                {{ formatOficial(rendicion.totales.montoPagoRepartidor) }}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">
                Entregado a cuenta
              </dt>
              <dd class="text-default" data-qa="rendicion-entregado">
                {{ formatOficial(rendicion.totales.montoEntregadoACuenta) }}
              </dd>
            </div>
          </dl>
          <p
            class="border-t border-default pt-3 text-right text-2xl font-semibold tabular-nums"
            :class="saldo?.negativo ? 'text-error' : 'text-highlighted'"
            data-qa="rendicion-saldo"
          >
            {{ saldo?.texto }}
          </p>
        </section>
      </article>
    </div>
  </div>
</template>

<style scoped>
@media print {
  .no-print { display: none !important; }
}
@page { size: A4 landscape; margin: 14mm; }
</style>
