<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { hoyLocal } from '~/composables/useVigenciaRegla'
import type { RendicionFila, RepartidorFila } from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard` en todo el módulo.
definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })

const DIAS_POR_DEFECTO = 30
const TODOS = 'todos'

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { formatOficial } = useCurrency()
const { formatFecha } = useFormatters()
const { presentarSaldo, diasAntes, periodo } = usePaqueteria()

const desde = ref<string | null>(null)
const hasta = ref<string | null>(null)
const repartidorId = ref<string>(TODOS)
const repartidores = ref<RepartidorFila[]>([])
const rendiciones = ref<RendicionFila[]>([])
const cargando = ref(false)
// Cada carga invalida a las anteriores que sigan en vuelo: cambiar el filtro rápido no pisa con el viejo.
let secuencia = 0

const repartidorOptions = computed(() => [
  { label: 'Todos los repartidores', value: TODOS },
  ...repartidores.value.map(r => ({ label: r.nombre, value: r.id })),
])

async function cargar() {
  const mia = ++secuencia
  if (!desde.value || !hasta.value) {
    rendiciones.value = []
    cargando.value = false
    return
  }
  cargando.value = true
  const filtro = repartidorId.value === TODOS ? '' : `&repartidorId=${repartidorId.value}`
  try {
    const filas = await useApiFetch<RendicionFila[]>(
      `${apiUrl}/rendiciones?desde=${desde.value}&hasta=${hasta.value}${filtro}`,
    )
    if (mia !== secuencia) return
    rendiciones.value = filas
  }
  catch (e: unknown) {
    if (mia !== secuencia) return
    rendiciones.value = []
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las rendiciones'), color: 'error' })
  }
  finally {
    if (mia === secuencia) cargando.value = false
  }
}

watch([desde, hasta, repartidorId], cargar)

onMounted(async () => {
  // El rango por defecto y la lista de repartidores no dependen uno del otro.
  const fin = hoyLocal()
  desde.value = diasAntes(fin, DIAS_POR_DEFECTO - 1)
  hasta.value = fin
  try {
    repartidores.value = await useApiFetch<RepartidorFila[]>(`${apiUrl}/repartidores`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar los repartidores'), color: 'error' })
  }
})

const derecha = { class: { th: 'text-right', td: 'text-right' } }

const columns: TableColumn<RendicionFila>[] = [
  { accessorKey: 'repartidorNombre', header: 'Repartidor' },
  { id: 'periodo', header: 'Período' },
  { accessorKey: 'hojas', header: 'Hojas', meta: derecha },
  { id: 'entregados', header: 'Entregados', meta: derecha },
  { id: 'pago', header: 'Pago', meta: derecha },
  { id: 'saldo', header: 'Saldo', meta: derecha },
  { accessorKey: 'rendidaEl', header: 'Rendida el' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Rendiciones" />
    </template>

    <template #body>
      <div class="w-full space-y-6" data-qa="rendiciones-pantalla">
        <CrudPageHeader
          title="Rendiciones"
          description="Las cuentas cerradas con cada repartidor. Abre una para ver la planilla e imprimirla."
        >
          <template #actions>
            <UButton
              label="Nueva rendición"
              icon="i-lucide-plus"
              to="/paquetes/rendiciones/nueva"
              data-qa="rendiciones-nueva"
            />
          </template>
        </CrudPageHeader>

        <div class="flex flex-wrap items-end gap-4">
          <AppRangoFechas v-model:desde="desde" v-model:hasta="hasta" qa="rendiciones-rango" />
          <UFormField label="Repartidor" class="w-full sm:w-64">
            <USelect
              v-model="repartidorId"
              :items="repartidorOptions"
              class="w-full"
              aria-label="Repartidor"
              data-qa="rendiciones-repartidor"
            />
          </UFormField>
        </div>

        <UCard class="w-full">
          <UTable :data="rendiciones" :columns="columns" :loading="cargando" data-qa="rendiciones-tabla">
            <template #repartidorNombre-cell="{ row }">
              <NuxtLink
                :to="`/paquetes/rendiciones/${row.original.id}`"
                class="font-medium text-highlighted underline-offset-2 hover:underline focus-visible:underline"
                :data-qa="`rendiciones-fila-${row.original.id}`"
              >
                {{ row.original.repartidorNombre }}
              </NuxtLink>
            </template>

            <template #periodo-cell="{ row }">
              <span class="tabular-nums">{{ periodo(row.original.desde, row.original.hasta) }}</span>
            </template>

            <template #hojas-cell="{ row }">
              <span class="tabular-nums">{{ row.original.hojas }}</span>
            </template>

            <template #entregados-cell="{ row }">
              <span class="tabular-nums">{{ row.original.totales.entregados }}</span>
            </template>

            <template #pago-cell="{ row }">
              <span class="text-sm tabular-nums">{{ formatOficial(row.original.totales.montoPagoRepartidor) }}</span>
            </template>

            <template #saldo-cell="{ row }">
              <span
                class="text-sm"
                :class="presentarSaldo(row.original.totales.saldo).negativo ? 'font-semibold text-error' : 'text-highlighted'"
              >
                {{ presentarSaldo(row.original.totales.saldo).texto }}
              </span>
            </template>

            <template #rendidaEl-cell="{ row }">
              <span class="tabular-nums">{{ formatFecha(row.original.rendidaEl) }}</span>
            </template>

            <template #empty>
              <div class="py-10 text-center text-sm text-muted" data-qa="rendiciones-vacio">
                <UIcon name="i-lucide-handshake" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                {{ desde && hasta ? 'No hay rendiciones en estas fechas.' : 'Elige el rango de fechas para ver las rendiciones.' }}
              </div>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
