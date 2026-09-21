<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Reporte de varianza (AVT): lo que el kardex dice que se consumió contra lo que
 * los recuentos dicen que falta. Spec
 * `docs/superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md` § 8.
 *
 * Gate declarativo (spec § 3.2): el chequeo manual en `onMounted` corría después
 * de montar y la pantalla parpadeaba antes del rebote.
 */
definePageMeta({
  middleware: ['auth', 'permiso'],
  layout: 'dashboard',
  permiso: 'Varianza:Leer',
})

interface CostoPorMoneda { monedaId: string, monto: string }
interface ItemBreve { itemId: string, nombre: string }

interface VarianzaFila {
  itemId: string
  itemNombre: string
  unidadMedida: string
  ubicacionId: string
  ubicacionNombre: string
  medible: boolean
  desdeEl: string | null
  hastaEl: string | null
  teorico: string | null
  merma: string | null
  cortesia: string | null
  sinExplicacion: string | null
  otros: string | null
  costoSinExplicacion: CostoPorMoneda[]
  faltaCosto: boolean
}

interface ResumenVarianza {
  totales: {
    teorico: CostoPorMoneda[]
    merma: CostoPorMoneda[]
    cortesia: CostoPorMoneda[]
    sinExplicacion: CostoPorMoneda[]
    otros: CostoPorMoneda[]
  }
  faltaCosto: boolean
  sinConteo: {
    nuncaContado: { total: number, items: ItemBreve[] }
    contadoUnaSolaVez: { total: number, items: ItemBreve[] }
  }
}

interface Opt { label: string, value: string }

const TODAS = 'todas'

/** Texto del botón de «Otros», en lenguaje del local y no del kardex (spec § 8.1). */
const OTROS_EXPLICACION =
  'Hay movimientos de stock que este reporte no supo clasificar; el número de al lado puede estar incompleto.'

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatFecha, formatStock, formatCostoPorMoneda } = useFormatters()
const { pageSize } = useUserPreferences()
const { ubicaciones, local, hayBodegas, cargar: cargarUbicaciones } = useUbicaciones()

// Arranca en "este mes": del 1 a hoy. La fecha sale de `hoyLocal()`, que la arma
// por componentes locales —recortar un string ya local no pasa por UTC—.
const hoy = hoyLocal()
const filtroDesde = ref<string | null>(`${hoy.slice(0, 8)}01`)
const filtroHasta = ref<string | null>(hoy)
const filtroUbicacion = ref(TODAS)
// Arranca prendido. ⚠️ El owner decidió QUÉ esconde el filtro (2026-09-20),
// no su default: el default lo eligió el agente al implementar, leyendo esa
// misma respuesta —prefiere la lista corta que va derecho a lo que perdió
// plata—. Qué esconde, en `QueryVarianzaDto`.
const soloConVarianza = ref(true)

const ubicacionOpts = computed<Opt[]>(() => [
  { label: 'Todas las ubicaciones', value: TODAS },
  ...ubicaciones.value.map(u => ({ label: u.nombre, value: u.id })),
])

/** Filtros que comparten el listado y el resumen. */
const filtrosComunes = computed(() => ({
  desde: filtroDesde.value ?? undefined,
  hasta: filtroHasta.value ?? undefined,
  ubicacionId: filtroUbicacion.value !== TODAS ? filtroUbicacion.value : undefined,
}))

const listFilters = computed(() => ({
  ...filtrosComunes.value,
  soloConVarianza: soloConVarianza.value ? 'true' : undefined,
}))

const { items: filas, meta, page, loading } = usePaginatedList<VarianzaFila>({
  path: '/reportes/varianza',
  pageSize,
  filters: listFilters,
})

const resumen = ref<ResumenVarianza | null>(null)
const loadingResumen = ref(false)

// El resumen EXIGE desde/hasta (400 si falta uno): sin rango completo no se pide.
const rangoCompleto = computed(() => !!filtroDesde.value && !!filtroHasta.value)

async function cargarResumen() {
  if (!rangoCompleto.value) {
    resumen.value = null
    return
  }
  loadingResumen.value = true
  try {
    // Solo los filtros comunes: `ResumenVarianzaDto` no declara
    // `soloConVarianza`, y el pipe global (`whitelist` sin
    // `forbidNonWhitelisted`) lo borraría callado — medido: 200, no 400.
    // Mandarlo haría creer que los totales siguen la llave, y no la siguen.
    const params = new URLSearchParams()
    for (const [clave, valor] of Object.entries(filtrosComunes.value)) {
      if (valor) params.set(clave, valor)
    }
    resumen.value = await useApiFetch<ResumenVarianza>(
      `${apiUrl}/reportes/varianza/resumen?${params.toString()}`,
    )
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el resumen'), color: 'error' })
  }
  finally {
    loadingResumen.value = false
  }
}

watch(filtrosComunes, cargarResumen, { deep: true })

async function prepararUbicaciones() {
  try {
    await cargarUbicaciones()
    // Con bodegas, arranca en el local (spec § 7.1): es donde se vende, y el
    // teórico sale de las ventas. Sin bodegas el selector ni se dibuja.
    if (hayBodegas.value && local.value && filtroUbicacion.value === TODAS) {
      filtroUbicacion.value = local.value.id
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar ubicaciones'), color: 'error' })
  }
}

// ⚠️ El primer resumen espera a las ubicaciones. Pedirlo en paralelo lanzaba
// dos —"todas" y, al llegar las ubicaciones, "el local"— sin nada que
// descartara la vieja: si "todas" volvía última, las tarjetas sumaban todas
// las ubicaciones y la tabla mostraba solo el local. Si prepararUbicaciones
// cambió el filtro, el `watch` ya pidió el resumen; si no, se pide acá.
onMounted(async () => {
  const antes = filtroUbicacion.value
  await prepararUbicaciones()
  if (filtroUbicacion.value === antes) cargarResumen()
})

const tarjetas = computed(() => {
  const t = resumen.value?.totales
  return [
    { clave: 'sinExplicacion', titulo: 'Sin explicación', monto: t?.sinExplicacion ?? [] },
    { clave: 'merma', titulo: 'Merma', monto: t?.merma ?? [] },
    { clave: 'cortesia', titulo: 'Cortesía', monto: t?.cortesia ?? [] },
    { clave: 'teorico', titulo: 'Teórico (vendido)', monto: t?.teorico ?? [] },
  ]
})

const sinConteo = computed(() => resumen.value?.sinConteo ?? null)

function productos(n: number): string {
  return `${n} ${n === 1 ? 'producto' : 'productos'}`
}

/** `'0.0000'` o `null` (fila no medible): no compite por la atención. */
function otrosEsCero(otros: string | null): boolean {
  return otros === null || Number(otros) === 0
}

const DERECHA = { class: { th: 'text-right', td: 'text-right' } }

// ⛔ «Otros» va siempre, aunque todas las filas den cero (spec § 8.1): una
// columna que aparece y desaparece entrena a no buscarla.
const columns: TableColumn<VarianzaFila>[] = [
  { accessorKey: 'itemNombre', header: 'Producto' },
  { accessorKey: 'ubicacionNombre', header: 'Lugar' },
  { id: 'ventana', header: 'Ventana' },
  { accessorKey: 'teorico', header: 'Teórico', meta: DERECHA },
  { accessorKey: 'merma', header: 'Merma', meta: DERECHA },
  { accessorKey: 'cortesia', header: 'Cortesía', meta: DERECHA },
  { accessorKey: 'sinExplicacion', header: 'Sin explicación', meta: DERECHA },
  { accessorKey: 'costoSinExplicacion', header: '$ sin explicación', meta: DERECHA },
  { accessorKey: 'otros', header: 'Otros', meta: DERECHA },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Varianza" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Varianza"
          description="Lo que las ventas dicen que se usó, contra lo que los recuentos dicen que falta — entre dos conteos."
        />

        <div class="flex flex-wrap items-end gap-4">
          <AppRangoFechas
            v-model:desde="filtroDesde"
            v-model:hasta="filtroHasta"
            qa="varianza-rango"
          />
          <UFormField v-if="hayBodegas" label="Ubicación">
            <USelectMenu
              v-model="filtroUbicacion"
              :items="ubicacionOpts"
              value-key="value"
              class="w-52"
            />
          </UFormField>
          <USwitch
            v-model="soloConVarianza"
            label="Solo con diferencia"
            data-qa="varianza-solo-con-diferencia"
          />
        </div>

        <div v-if="!rangoCompleto" class="rounded-lg bg-muted p-4 text-sm text-muted">
          Selecciona desde y hasta para ver los totales.
        </div>

        <template v-else>
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              v-for="t in tarjetas"
              :key="t.clave"
              class="rounded-lg bg-muted p-4"
              :data-qa="`varianza-total-${t.clave}`"
            >
              <p class="text-xs text-muted uppercase tracking-wide">
                {{ t.titulo }}
              </p>
              <p class="text-lg font-semibold mt-1">
                {{ loadingResumen ? '…' : formatCostoPorMoneda(t.monto) }}
              </p>
            </div>
          </div>

          <UAlert
            v-if="resumen?.faltaCosto"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Algún movimiento del período no tenía costo: los totales en plata están cortos."
          />

          <p
            v-if="sinConteo && (sinConteo.nuncaContado.total > 0 || sinConteo.contadoUnaSolaVez.total > 0)"
            class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted"
            data-qa="varianza-sin-conteo"
          >
            <span class="inline-flex items-center gap-1">
              {{ productos(sinConteo.nuncaContado.total) }} sin contar
              <AppInfoButton
                v-if="sinConteo.nuncaContado.total > 0"
                title="Sin contar en el período"
              >
                <p class="mb-2">
                  Nadie los contó entre estas fechas, así que no se puede saber si falta algo.
                </p>
                <ul class="list-disc pl-5">
                  <li v-for="i in sinConteo.nuncaContado.items" :key="i.itemId">
                    {{ i.nombre }}
                  </li>
                </ul>
              </AppInfoButton>
            </span>
            <span class="inline-flex items-center gap-1">
              {{ sinConteo.contadoUnaSolaVez.total }} a medio contar
              <AppInfoButton
                v-if="sinConteo.contadoUnaSolaVez.total > 0"
                title="A medio contar"
              >
                <p class="mb-2">
                  Se contaron una sola vez: falta el segundo conteo para saber cuánto se fue entre los dos.
                </p>
                <ul class="list-disc pl-5">
                  <li v-for="i in sinConteo.contadoUnaSolaVez.items" :key="i.itemId">
                    {{ i.nombre }}
                  </li>
                </ul>
              </AppInfoButton>
            </span>
          </p>
        </template>

        <CrudTable
          :data="filas"
          :columns="columns"
          :loading="loading"
        >
          <template #ventana-cell="{ row }">
            <span class="whitespace-nowrap">
              {{ formatFecha(row.original.desdeEl) }}
              <template v-if="row.original.medible">→ {{ formatFecha(row.original.hastaEl) }}</template>
            </span>
          </template>

          <!-- Una fila sin dos conteos no tiene números: un cero se leería como "cerró perfecto". -->
          <template #teorico-cell="{ row }">
            <span v-if="!row.original.medible" class="text-muted italic">falta contarlo</span>
            <span v-else>{{ formatStock(row.original.teorico, row.original.unidadMedida) }}</span>
          </template>
          <template #merma-cell="{ row }">
            <span v-if="row.original.medible">{{ formatStock(row.original.merma, row.original.unidadMedida) }}</span>
          </template>
          <template #cortesia-cell="{ row }">
            <span v-if="row.original.medible">{{ formatStock(row.original.cortesia, row.original.unidadMedida) }}</span>
          </template>
          <template #sinExplicacion-cell="{ row }">
            <span v-if="row.original.medible" class="font-medium">
              {{ formatStock(row.original.sinExplicacion, row.original.unidadMedida) }}
            </span>
          </template>
          <template #costoSinExplicacion-cell="{ row }">
            <template v-if="row.original.medible">
              <UBadge
                v-if="row.original.faltaCosto"
                label="Sin costo"
                color="warning"
                variant="subtle"
                size="sm"
              />
              <span v-else>{{ formatCostoPorMoneda(row.original.costoSinExplicacion) }}</span>
            </template>
          </template>
          <template #otros-cell="{ row }">
            <span
              v-if="row.original.medible"
              data-qa="varianza-otros"
              class="inline-flex items-center justify-end gap-1"
              :class="otrosEsCero(row.original.otros) ? 'text-muted' : 'text-warning font-medium'"
            >
              {{ formatStock(row.original.otros, row.original.unidadMedida) }}
              <AppInfoButton
                v-if="!otrosEsCero(row.original.otros)"
                title="Movimientos sin clasificar"
                :text="OTROS_EXPLICACION"
              />
            </span>
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              <UIcon
                name="i-lucide-scale"
                class="w-8 h-8 mx-auto mb-2 opacity-40"
              />
              {{ soloConVarianza
                ? 'Ningún producto con diferencia en el rango filtrado.'
                : 'Ningún producto con recuentos en el rango filtrado.' }}
            </div>
          </template>
        </CrudTable>

        <div
          v-if="meta.total > pageSize"
          class="flex justify-end"
        >
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="meta.total"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
