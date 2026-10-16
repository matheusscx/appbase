<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { hoyLocal } from '~/composables/useVigenciaRegla'
import type { HojaRutaFila, ResumenPaqueteria } from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard` en todo el módulo.
definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })

const DIAS_POR_DEFECTO = 7

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { formatOficial } = useCurrency()
const { rotuloEstadoHoja, colorEstadoHoja, presentarNeto, fechaCorta } = usePaqueteria()
const { diaNegocioHoy, cargar: cargarDiaNegocio } = useDiaNegocio()

const desde = ref<string | null>(null)
const hasta = ref<string | null>(null)
const hojas = ref<HojaRutaFila[]>([])
const resumen = ref<ResumenPaqueteria | null>(null)
const cargando = ref(false)
// Cada carga invalida a las anteriores que sigan en vuelo: cambiar el rango rápido no pisa con el viejo.
let secuencia = 0

/** `fecha` menos `dias`, armado por componentes locales: `toISOString` daría el día en UTC. */
function diasAntes(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number]
  const d = new Date(anio, mes - 1, dia - dias)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

async function cargar() {
  const mia = ++secuencia
  if (!desde.value || !hasta.value) {
    hojas.value = []
    resumen.value = null
    cargando.value = false
    return
  }
  cargando.value = true
  const rango = `desde=${desde.value}&hasta=${hasta.value}`
  try {
    const [filas, kpis] = await Promise.all([
      useApiFetch<HojaRutaFila[]>(`${apiUrl}/hojas-ruta?${rango}`),
      useApiFetch<ResumenPaqueteria>(`${apiUrl}/hojas-ruta/resumen?${rango}`),
    ])
    if (mia !== secuencia) return
    hojas.value = filas
    resumen.value = kpis
  }
  catch (e: unknown) {
    if (mia !== secuencia) return
    hojas.value = []
    resumen.value = null
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las hojas de ruta'), color: 'error' })
  }
  finally {
    if (mia === secuencia) cargando.value = false
  }
}

watch([desde, hasta], cargar)

onMounted(async () => {
  await cargarDiaNegocio()
  // Si el usuario ya tocó el rango mientras llegaba el día de negocio, no se le pisa.
  if (desde.value || hasta.value) return
  const fin = diaNegocioHoy.value ?? hoyLocal()
  desde.value = diasAntes(fin, DIAS_POR_DEFECTO - 1)
  hasta.value = fin
})

// ── Tabla ─────────────────────────────────────────────────────────────────

const derecha = { class: { th: 'text-right', td: 'text-right' } }

const columns: TableColumn<HojaRutaFila>[] = [
  { accessorKey: 'repartidorNombre', header: 'Repartidor' },
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'asignados', header: 'Asignados', meta: derecha },
  { accessorKey: 'entregados', header: 'Entregados', meta: derecha },
  { accessorKey: 'montoCobradoDestino', header: 'Cobro en destino', meta: derecha },
  { accessorKey: 'netoARendir', header: 'Neto a rendir', meta: derecha },
  { accessorKey: 'estado', header: 'Estado' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Rutas" />
    </template>

    <template #body>
      <div class="w-full space-y-6" data-qa="rutas-pantalla">
        <CrudPageHeader
          title="Rutas"
          description="Las hojas de ruta de cada repartidor. Entra a una para marcar lo que entregó y rendirla."
        />

        <AppRangoFechas v-model:desde="desde" v-model:hasta="hasta" qa="rutas-rango" />

        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4" data-qa="rutas-kpis">
          <UCard>
            <p class="text-sm text-muted">
              Entregados
            </p>
            <p class="text-2xl font-semibold tabular-nums text-highlighted" data-qa="rutas-kpi-entregados">
              {{ resumen ? resumen.entregados : '—' }}
            </p>
            <p class="text-sm tabular-nums text-muted" data-qa="rutas-kpi-asignados">
              <template v-if="resumen">
                de {{ resumen.asignados }} asignados
              </template>
              <template v-else>
                &nbsp;
              </template>
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">
              Cobro en destino
            </p>
            <p class="text-2xl font-semibold tabular-nums text-highlighted" data-qa="rutas-kpi-cobro-monto">
              {{ resumen ? formatOficial(resumen.montoCobradoDestino) : '—' }}
            </p>
            <p class="text-sm tabular-nums text-muted" data-qa="rutas-kpi-cobro-cantidad">
              <template v-if="resumen">
                {{ resumen.cobroDestino }} {{ resumen.cobroDestino === 1 ? 'paquete' : 'paquetes' }}
              </template>
              <template v-else>
                &nbsp;
              </template>
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">
              Total general
            </p>
            <p class="text-2xl font-semibold tabular-nums text-highlighted" data-qa="rutas-kpi-total-general">
              {{ resumen ? formatOficial(resumen.montoTotalGeneral) : '—' }}
            </p>
            <p class="text-sm text-muted">
              Envíos de lo entregado
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">
              Total a pagar
            </p>
            <p class="text-2xl font-semibold tabular-nums text-highlighted" data-qa="rutas-kpi-total-pagar">
              {{ resumen ? formatOficial(resumen.montoPagoRepartidor) : '—' }}
            </p>
            <p class="text-sm text-muted">
              A los repartidores
            </p>
          </UCard>
        </div>

        <UCard class="w-full">
          <UTable :data="hojas" :columns="columns" :loading="cargando" data-qa="rutas-tabla">
            <template #repartidorNombre-cell="{ row }">
              <NuxtLink
                :to="`/paquetes/rutas/${row.original.id}`"
                class="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
                :data-qa="`rutas-fila-${row.original.id}`"
              >
                {{ row.original.repartidorNombre }}
              </NuxtLink>
            </template>

            <template #fecha-cell="{ row }">
              <span class="tabular-nums">{{ fechaCorta(row.original.fecha) }}</span>
            </template>

            <template #asignados-cell="{ row }">
              <span class="tabular-nums">{{ row.original.asignados }}</span>
            </template>
            <template #entregados-cell="{ row }">
              <span class="tabular-nums">{{ row.original.entregados }}</span>
            </template>

            <template #montoCobradoDestino-cell="{ row }">
              <span class="text-sm">{{ formatOficial(row.original.montoCobradoDestino) }}</span>
            </template>

            <template #netoARendir-cell="{ row }">
              <span
                class="text-sm"
                :class="presentarNeto(row.original.netoARendir).negativo ? 'font-semibold text-error' : 'text-highlighted'"
              >
                {{ presentarNeto(row.original.netoARendir).texto }}
              </span>
            </template>

            <template #estado-cell="{ row }">
              <UBadge
                :label="rotuloEstadoHoja(row.original.estado)"
                :color="colorEstadoHoja(row.original.estado)"
                variant="subtle"
                size="sm"
              />
            </template>

            <template #empty>
              <div class="py-10 text-center text-sm text-muted" data-qa="rutas-vacio">
                <UIcon name="i-lucide-route" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                {{ desde && hasta ? 'No hay hojas de ruta en estas fechas.' : 'Elige el rango de fechas para ver las hojas de ruta.' }}
              </div>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
