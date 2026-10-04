<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'
import type { SerieGrafica } from '~/components/AppGrafica.vue'

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
  /** La comida del personal dentro del local: consumo explicado, no pérdida. */
  personal: string | null
  sinExplicacion: string | null
  otros: string | null
  costoSinExplicacion: CostoPorMoneda[]
  faltaCosto: boolean
}

interface TopVarianza {
  itemId: string
  itemNombre: string
  merma: string
  cortesia: string
  sinExplicacion: string
  monedaId: string
}

interface ResumenVarianza {
  top: TopVarianza[]
  fueraDelTop: number
  totales: {
    teorico: CostoPorMoneda[]
    merma: CostoPorMoneda[]
    cortesia: CostoPorMoneda[]
    personal: CostoPorMoneda[]
    sinExplicacion: CostoPorMoneda[]
    otros: CostoPorMoneda[]
  }
  faltaCosto: boolean
  perdiendoSinCosto: number
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
const { formatFecha, formatMonto, formatStock, formatCostoPorMoneda } = useFormatters()
const monedasStore = useMonedasStore()
const { pageSize } = useUserPreferences()
const { ubicaciones, local, hayBodegas, cargar: cargarUbicaciones } = useUbicaciones()

// Arranca optimista en "este mes" con el reloj del navegador (`hoyLocal()`,
// por componentes locales: recortar un string ya local no pasa por UTC) y se
// corrige cuando resuelve el día de negocio del servidor — mismo patrón que
// `salones/anulaciones.vue`. Entre las 00:00 y la hora de corte del tenant (o
// con el navegador en otro huso) el día 1 local todavía no es el día 1 del
// tenant, y pedir "este mes" con esa fecha deja la tabla vacía. `hoyLocalInicial`
// y `desdeInicial` congelan los valores de arranque: si al resolver los dos
// filtros siguen en ellos, se ajustan a `[1 del mes de diaNegocioHoy,
// diaNegocioHoy]`; si el usuario ya tocó cualquiera de los dos, no se pisa.
const hoyLocalInicial = hoyLocal()
const desdeInicial = `${hoyLocalInicial.slice(0, 8)}01`
const filtroDesde = ref<string | null>(desdeInicial)
const filtroHasta = ref<string | null>(hoyLocalInicial)
const filtroUbicacion = ref(TODAS)
// Arranca prendido. ⚠️ El owner decidió QUÉ esconde el filtro (2026-09-20),
// no su default: el default lo eligió el agente al implementar, leyendo esa
// misma respuesta —prefiere la lista corta que va derecho a lo que perdió
// plata—. Qué esconde, en `QueryVarianzaDto`.
const soloConVarianza = ref(true)
// El link del aviso de "sin costo". Arranca apagado: lo prende el aviso.
const soloSinCosto = ref(false)

const { diaNegocioHoy, cargar: cargarDiaNegocio } = useDiaNegocio()

/** Corrige el arranque optimista de arriba contra el día de negocio real. */
async function ajustarAlDiaDeNegocio() {
  await cargarDiaNegocio()
  if (!diaNegocioHoy.value || diaNegocioHoy.value === hoyLocalInicial) return
  if (filtroDesde.value !== desdeInicial || filtroHasta.value !== hoyLocalInicial) return
  filtroDesde.value = `${diaNegocioHoy.value.slice(0, 8)}01`
  filtroHasta.value = diaNegocioHoy.value
}

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

// El resumen EXIGE desde/hasta (400 si falta uno): sin rango completo no se pide.
const rangoCompleto = computed(() => !!filtroDesde.value && !!filtroHasta.value)

const listFilters = computed(() => ({
  ...filtrosComunes.value,
  soloConVarianza: soloConVarianza.value ? 'true' : undefined,
  // ⚠️ Solo con rango completo: el aviso que lo prende y lo apaga vive en el
  // resumen, y sin rango no se dibuja. Filtrar sin él dejaría la tabla recortada
  // sin nada en pantalla que lo diga ni lo deshaga.
  soloSinCosto: soloSinCosto.value && rangoCompleto.value ? 'true' : undefined,
}))

const { items: filas, meta, page, loading } = usePaginatedList<VarianzaFila>({
  path: '/reportes/varianza',
  pageSize,
  filters: listFilters,
})

const resumen = ref<ResumenVarianza | null>(null)
const loadingResumen = ref(false)
// Distinto de "no hay datos": la gráfica dice que no pudo cargar, no que no hay pérdidas.
const resumenFallo = ref(false)

// `ajustarAlDiaDeNegocio()` (sin `await`, ver `onMounted`) corre en paralelo
// con `prepararUbicaciones()`, así que dos invocaciones de `cargarResumen()`
// pueden quedar en vuelo a la vez: sin esto gana la que RESPONDA última, no
// la que se LLAMÓ última. Mismo patrón que `usePaginatedList.fetch` /
// `configuracion/categorias.vue` → `cargar()`: cada invocación encadena sobre
// la promesa de la anterior y recién entonces lee los filtros y escribe
// `resumen`, así que quedan en orden de invocación.
let resumenEnCurso: Promise<void> | null = null

async function cargarResumen() {
  const previa = resumenEnCurso
  const actual = (async () => {
    await previa
    if (!rangoCompleto.value) {
      resumen.value = null
      return
    }
    loadingResumen.value = true
    resumenFallo.value = false
    try {
      // Solo los filtros comunes: `ResumenVarianzaDto` no declara
      // `soloConVarianza` —los totales no siguen esa llave—, y el pipe global
      // rechaza con 400 lo que el DTO no declara: mandarlo tumba el resumen.
      const params = new URLSearchParams()
      for (const [clave, valor] of Object.entries(filtrosComunes.value)) {
        if (valor) params.set(clave, valor)
      }
      resumen.value = await useApiFetch<ResumenVarianza>(
        `${apiUrl}/reportes/varianza/resumen?${params.toString()}`,
      )
    }
    catch (e: unknown) {
      resumenFallo.value = true
      toast.add({ title: apiErrorMsg(e, 'Error al cargar el resumen'), color: 'error' })
    }
    finally {
      loadingResumen.value = false
    }
  })()
  resumenEnCurso = actual
  await actual
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

// ⚠️ El resumen explícito de acá abajo espera a las ubicaciones, para no
// pedirlo dos veces cuando `prepararUbicaciones` cambia el filtro (ese cambio
// ya dispara el `watch(filtrosComunes, …)`). `ajustarAlDiaDeNegocio()` corre
// SIN esperar esto, así que puede terminar antes, después o en medio —y si
// corrige desde/hasta dispara el mismo `watch`—: dos invocaciones de
// `cargarResumen()` pueden quedar en vuelo a la vez. No hace falta
// coordinarlas DESDE ACÁ porque `cargarResumen()` ya se serializa sola
// (`resumenEnCurso`, arriba): la que se invoca última es la que escribe
// última, sin importar en qué orden responda la red.
onMounted(async () => {
  // El layout ya lo pide al montar; se repite acá (es idempotente) para que
  // entrar a la pantalla reintente si aquella carga falló.
  monedasStore.ensureLoaded()
  // Sin await: si corrige desde/hasta, el `watch(filtrosComunes, …)` de abajo
  // y el refetch interno de `usePaginatedList` ya reaccionan solos.
  ajustarAlDiaDeNegocio()
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
    // Fuera de la gráfica de pérdidas: es gasto de la operación (spec 2026-10-04).
    { clave: 'personal', titulo: 'Comida del personal', monto: t?.personal ?? [] },
    { clave: 'teorico', titulo: 'Teórico (vendido)', monto: t?.teorico ?? [] },
  ]
})

const sinConteo = computed(() => resumen.value?.sinConteo ?? null)

/**
 * Las filas que perdieron mercadería sin costo cargado. El orden de la tabla va
 * por plata y a estas no la conoce, así que se hunden entre las que no perdieron
 * nada; el orden no se toca (owner, 2026-09-27) y las rescata esta línea. El
 * número es exactamente el total que trae el listado con `soloSinCosto`: los dos
 * salen del mismo predicado en el backend.
 */
const perdiendoSinCosto = computed(() => resumen.value?.perdiendoSinCosto ?? 0)
// Con el filtro puesto la línea queda aunque el número baje a cero (cambió el
// rango o la ubicación): es lo único que lo deshace.
const avisoSinCosto = computed(() => perdiendoSinCosto.value > 0 || soloSinCosto.value)
function alternarSinCosto() {
  soloSinCosto.value = !soloSinCosto.value
}
const textoSinCosto = computed(() => {
  const n = perdiendoSinCosto.value
  if (n === 0) return 'Ningún producto sin costo está perdiendo plata.'
  return n === 1
    ? '1 producto no tiene costo y puede estar perdiendo plata.'
    : `${n} productos no tienen costo y pueden estar perdiendo plata.`
})

/**
 * El top viene ordenado por magnitud cruda y puede mezclar monedas: una barra
 * en pesos y otra en dólares no se comparan por largo. Se grafica solo la
 * moneda oficial —conserva el orden— y el resto se cuenta al pie; la tabla
 * los tiene a todos.
 */
const monedasListas = computed(() => !!monedasStore.monedaOficial)
// ⚠️ "Todavía no" y "no va a llegar" son dos estados: si `/monedas` falló, esperar
// dejaba el esqueleto de carga para siempre. Con error es un fallo; cargado sin
// moneda oficial, `topGraficado` vacío y la gráfica dice que no hay nada.
const monedasCargando = computed(() => !monedasStore.isLoaded && !monedasStore.error)
const topGraficado = computed(() => {
  const oficial = monedasStore.monedaOficial?.monedaId
  // Sin la moneda oficial todavía (el store carga en paralelo con el resumen)
  // no se grafica nada: caer al top entero mezclaba monedas hasta que llegaba.
  if (!oficial) return []
  return (resumen.value?.top ?? []).filter(t => t.monedaId === oficial)
})
const topEnOtraMoneda = computed(() =>
  monedasListas.value ? (resumen.value?.top.length ?? 0) - topGraficado.value.length : 0)

// ⛔ «Otros» no entra: es un detector de que la cuenta no cerró, no una parte
// de la pérdida. Apilarlo lo haría leer como una categoría más de plata perdida.
// ⚠️ Un sobrante llega con `sinExplicacion` negativo. Apilado, se superpone con
// la merma y acorta la barra; y no es plata perdida. Se dibuja en cero y el pie
// lo cuenta —la tabla tiene el número—.
const esSobrante = (t: TopVarianza) => new Decimal(t.sinExplicacion).isNegative()
const conSobrante = computed(() => topGraficado.value.filter(esSobrante).length)

const seriesGrafica = computed<SerieGrafica[]>(() => [
  { nombre: 'Sin explicación', color: 'error', valores: topGraficado.value.map(t => (esSobrante(t) ? '0' : t.sinExplicacion)) },
  { nombre: 'Merma', color: 'warning', valores: topGraficado.value.map(t => t.merma) },
  { nombre: 'Cortesía', color: 'info', valores: topGraficado.value.map(t => t.cortesia) },
])
const categoriasGrafica = computed(() => topGraficado.value.map(t => t.itemNombre))

function formatoGrafica(valor: string, i: number): string {
  return formatMonto(valor, topGraficado.value[i]?.monedaId)
}

// El eje solo tiene barras de la moneda oficial (ver `topGraficado`).
function formatoEjeGrafica(valor: number): string {
  return formatMonto(String(valor), monedasStore.monedaOficial?.monedaId)
}

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
  { accessorKey: 'personal', header: 'Personal', meta: DERECHA },
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
          <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
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

          <UCard>
            <template #header>
              <span class="font-medium text-default">Dónde se va la plata — los 10 que más perdieron</span>
            </template>
            <AppGrafica
              :series="seriesGrafica"
              :categorias="categoriasGrafica"
              :formato="formatoGrafica"
              :formato-eje="formatoEjeGrafica"
              :cargando="loadingResumen || monedasCargando"
              :fallo="resumenFallo || !!monedasStore.error"
              :vacio="topGraficado.length === 0"
            />
            <p
              v-if="resumen && (resumen.fueraDelTop > 0 || topEnOtraMoneda > 0 || conSobrante > 0)"
              class="text-xs text-muted mt-3"
              data-qa="varianza-grafica-pie"
            >
              <template v-if="resumen.fueraDelTop > 0">
                Y {{ productos(resumen.fueraDelTop) }} más.
              </template>
              <template v-if="topEnOtraMoneda > 0">
                {{ topEnOtraMoneda }} en otra moneda no se {{ topEnOtraMoneda === 1 ? 'grafica' : 'grafican' }}.
              </template>
              <template v-if="conSobrante > 0">
                {{ conSobrante }} con sobrante: el sobrante no es pérdida y no se dibuja.
              </template>
              La tabla los tiene todos.
            </p>
          </UCard>

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

          <p
            v-if="avisoSinCosto"
            class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted"
            data-qa="varianza-sin-costo"
          >
            <span class="inline-flex items-center gap-1">
              {{ textoSinCosto }}
              <UButton
                :label="soloSinCosto ? 'Ver todos' : 'Ver cuáles'"
                variant="link"
                size="xs"
                class="px-0"
                data-qa="varianza-sin-costo-link"
                @click="alternarSinCosto"
              />
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
          <template #personal-cell="{ row }">
            <span v-if="row.original.medible">{{ formatStock(row.original.personal, row.original.unidadMedida) }}</span>
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
              {{ listFilters.soloSinCosto
                ? 'Ningún producto sin costo con faltante en el rango filtrado.'
                : soloConVarianza
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
