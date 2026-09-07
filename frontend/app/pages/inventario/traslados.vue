<script setup lang="ts">
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

// ── Interfaces ─────────────────────────────────────────────────────────────

interface TrasladoListItem {
  id: string
  creadoEl: string
  origenId: string
  origenNombre: string | null
  destinoId: string
  destinoNombre: string | null
  motivoTrasladoId: string
  motivoNombre: string | null
  comentario: string | null
  usuarioId: string | null
  usuarioNombre: string | null
  itemsMovidos: number
}

interface TrasladoLineaDetalle {
  itemId: string
  itemNombre: string
  cantidad: string
  unidadMedida: string | null
  movimientoSalidaId: string
  stockOrigenResultante: string
  movimientoEntradaId: string
  stockDestinoResultante: string
}

interface TrasladoDetalle extends TrasladoListItem {
  detalle: TrasladoLineaDetalle[]
}

interface ProductoOpt {
  id: string
  nombre: string
  modoInventario: string | null
  unidadMedida: string | null
  /** Neto de lo comprometido por cuentas abiertas — es el del LOCAL (spec § 5.4). */
  stockDisponible: string | null
}

interface MotivoOpt { id: string; nombre: string }

interface UnidadOpt {
  id: string
  serie: string
  condicion: string
  garantiaHasta: string | null
  ubicacionId: string
}

interface LoteOpt {
  id: string
  codigoLote: string
  desglosePorUbicacion: { ubicacionId: string; nombre: string; cantidad: string }[]
}

interface LoteConDisponible extends LoteOpt {
  /** Lo que ese lote tiene EN el origen elegido — no su total en todo el tenant. */
  cantidadEnOrigen: string
}

interface ItemDetalleStock {
  desglosePorUbicacion: { ubicacionId: string; nombre: string; stock: string }[]
}

interface LineaForm {
  key: string
  itemId: string
  modoInventario: string | null
  unidadMedida: string | null
  cantidad: string
  unidadIds: string[]
  loteId: string
  cargando: boolean
  /** Sale siempre del backend — nunca se resta en el cliente (spec § 5.3). */
  disponible: string | null
  unidadesEnOrigen: UnidadOpt[]
  lotesEnOrigen: LoteConDisponible[]
}

interface Opt { label: string; value: string }

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { formatFecha, formatStock } = useFormatters()
const { pageSize } = useUserPreferences()
const { ubicaciones, local, hayBodegas, cargar: cargarUbicaciones } = useUbicaciones()
const unidadesMedidaStore = useUnidadesMedidaStore()

// El nav abre esta página con Inventario/Leer, pero POST /traslados exige
// Inventario/Crear (mismo criterio que mermas.vue).
const { puedeCrear: puedeTrasladar } = usePermisosCrud('Inventario')

const { items: traslados, meta, page, loading } =
  usePaginatedList<TrasladoListItem>({ path: '/traslados', pageSize })

const origenOpts = computed<Opt[]>(() =>
  ubicaciones.value.map(u => ({ label: u.nombre, value: u.id })),
)
// El DESTINO tiene que estar activo — el backend lo rechaza si no. Se filtra
// acá contra el flag `activo` que ya trae `GET /ubicaciones`: no es un cálculo
// propio, es el mismo booleano que decide el 400 del servidor.
const destinoOpts = computed<Opt[]>(() =>
  ubicaciones.value.filter(u => u.activo).map(u => ({ label: u.nombre, value: u.id })),
)

const productos = ref<ProductoOpt[]>([])
const motivos = ref<MotivoOpt[]>([])
const catalogosCargados = ref(false)

const productoOpts = computed<Opt[]>(() =>
  productos.value.map(p => ({ label: p.nombre, value: p.id })),
)
const motivoOpts = computed<Opt[]>(() =>
  motivos.value.map(m => ({ label: m.nombre, value: m.id })),
)

async function cargarCatalogos() {
  try {
    await unidadesMedidaStore.ensureLoaded()
    const [prodRes, ingRes, motivosRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=ingrediente&pageSize=100`),
      useApiFetch<MotivoOpt[]>(`${apiUrl}/motivos-traslado?soloActivas=true`),
      cargarUbicaciones(),
    ])
    productos.value = [...prodRes.data, ...ingRes.data].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es'),
    )
    motivos.value = motivosRes
    catalogosCargados.value = true
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar catálogos'), color: 'error' })
  }
}

onMounted(() => {
  void cargarUbicaciones()
  void abrirDesdeQuery()
})

// ── Formulario ───────────────────────────────────────────────────────────

const drawerOpen = ref(false)
const saving = ref(false)
let lineaSeq = 0

function nuevaLinea(): LineaForm {
  return {
    key: `linea-${lineaSeq++}`,
    itemId: '',
    modoInventario: null,
    unidadMedida: null,
    cantidad: '',
    unidadIds: [],
    loteId: '',
    cargando: false,
    disponible: null,
    unidadesEnOrigen: [],
    lotesEnOrigen: [],
  }
}

function emptyForm() {
  return { origenId: '', destinoId: '', motivoTrasladoId: '', comentario: '' }
}
const form = ref(emptyForm())
const lineas = ref<LineaForm[]>([nuevaLinea()])

const origenNombre = computed(() =>
  ubicaciones.value.find(u => u.id === form.value.origenId)?.nombre ?? '',
)

// El backend rechaza origen === destino con 400; acá se corta ANTES, sin
// dejar que el usuario dispare un POST que ya sabemos que va a fallar.
const origenIgualDestino = computed(() =>
  !!form.value.origenId && form.value.origenId === form.value.destinoId,
)

const lineasValidas = computed(() =>
  lineas.value.filter((l) => {
    if (!l.itemId || !l.cantidad) return false
    if (l.modoInventario === 'serie') return l.unidadIds.length > 0
    if (l.modoInventario === 'lote') return !!l.loteId
    return true
  }),
)

const puedeConfirmar = computed(() =>
  !!form.value.origenId
  && !!form.value.destinoId
  && !origenIgualDestino.value
  && !!form.value.motivoTrasladoId
  && lineasValidas.value.length > 0,
)

// Cambiar el origen limpia las líneas ya cargadas: las cantidades, las
// unidades y los lotes elegidos se resolvieron contra el disponible del
// origen ANTERIOR, y dejarlos no los deja viejos — los deja reinterpretados.
// Mismo criterio que `mermas.vue` al cambiar de ubicación.
watch(() => form.value.origenId, (_nuevo, anterior) => {
  // `!anterior` es la asignación inicial al abrir el drawer, no un cambio.
  if (!anterior) return
  lineas.value = [nuevaLinea()]
})

function abrirCrear() {
  form.value = emptyForm()
  lineas.value = [nuevaLinea()]
  drawerOpen.value = true
  if (!catalogosCargados.value) void cargarCatalogos()
}

function agregarLinea() {
  lineas.value.push(nuevaLinea())
}

function quitarLinea(key: string) {
  lineas.value = lineas.value.filter(l => l.key !== key)
}

// ── Disponible por línea — sale del backend, nunca se resta en el cliente ──

async function onSeleccionarItem(linea: LineaForm, itemId: string) {
  linea.itemId = itemId
  const producto = productos.value.find(p => p.id === itemId)
  linea.modoInventario = producto?.modoInventario ?? 'cantidad'
  linea.unidadMedida = producto?.unidadMedida ?? null
  linea.cantidad = ''
  linea.unidadIds = []
  linea.loteId = ''
  linea.unidadesEnOrigen = []
  linea.lotesEnOrigen = []
  linea.disponible = null
  if (!itemId) return

  const origenId = form.value.origenId
  const origenUbicacion = ubicaciones.value.find(u => u.id === origenId)
  if (!origenUbicacion) return

  linea.cargando = true
  try {
    if (linea.modoInventario === 'serie') {
      const unidades = await useApiFetch<UnidadOpt[]>(
        `${apiUrl}/items/${itemId}/unidades?estado=disponible`,
      )
      // El origen o el ítem de ESTA línea pudieron cambiar mientras la
      // respuesta viajaba: una respuesta vieja no puede pintar sobre otro.
      if (linea.itemId !== itemId || form.value.origenId !== origenId) return
      linea.unidadesEnOrigen = unidades.filter(u => u.ubicacionId === origenId)
    } else if (linea.modoInventario === 'lote') {
      const lotes = await useApiFetch<LoteOpt[]>(`${apiUrl}/items/${itemId}/lotes`)
      if (linea.itemId !== itemId || form.value.origenId !== origenId) return
      linea.lotesEnOrigen = lotes
        .map(l => ({
          ...l,
          cantidadEnOrigen:
            l.desglosePorUbicacion.find(d => d.ubicacionId === origenId)?.cantidad ?? '0',
        }))
        .filter(l => l.cantidadEnOrigen !== '0' && l.cantidadEnOrigen !== '0.0000')
    } else if (origenUbicacion.tipo === 'local') {
      // El local ya viene neto de lo comprometido por las cuentas abiertas
      // (`stockDisponible` del listado, cargado una sola vez al montar el
      // drawer): no hace falta pedirlo de nuevo.
      linea.disponible = producto?.stockDisponible ?? null
    } else {
      // De una bodega no se resta comprometido (spec § 5.3): el físico ES el
      // disponible. Sale de `desglosePorUbicacion` de `GET /items/:id`.
      const detalle = await useApiFetch<ItemDetalleStock>(`${apiUrl}/items/${itemId}`)
      if (linea.itemId !== itemId || form.value.origenId !== origenId) return
      linea.disponible = detalle.desglosePorUbicacion.find(d => d.ubicacionId === origenId)?.stock ?? '0'
    }
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar disponibilidad'), color: 'error' })
  } finally {
    if (linea.itemId === itemId) linea.cargando = false
  }
}

/**
 * Tarea 15 ("bodegas y traslados"): el botón "Trasladar" del toast de "no hay
 * stock" (`useRechazoPorStock`, disparado desde el salón o el POS) trae al
 * garzón/cajero con permiso hasta acá con `?itemId=&origenId=&cantidad=` en
 * la URL, y esta función abre el drawer YA armado — "a un clic", como pide
 * la Tarea 15 — en vez de una pantalla vacía que hay que volver a completar
 * a mano. Mismo patrón de precarga por query que `ventas/index.vue` usa para
 * `?venta=`.
 *
 * `destinoId` no viaja en la URL —el toast solo conoce el origen, no a dónde
 * el garzón/cajero prefiere mandarlo— y se completa acá con el LOCAL del
 * tenant: es a donde tiene sentido que vaya la mercadería que faltó ahí. Las
 * dos, origen y destino, siguen siendo editables: esto es un punto de
 * partida, no una decisión tomada por la pantalla.
 */
async function abrirDesdeQuery() {
  const { itemId, origenId, cantidad } = route.query
  if (typeof itemId !== 'string' || !itemId) return

  if (!catalogosCargados.value) await cargarCatalogos()

  form.value = emptyForm()
  form.value.origenId = typeof origenId === 'string' ? origenId : ''
  form.value.destinoId = local.value?.id ?? ''
  lineas.value = [nuevaLinea()]
  drawerOpen.value = true

  const linea = lineas.value[0]
  if (!linea) return
  await onSeleccionarItem(linea, itemId)
  if (typeof cantidad === 'string' && cantidad) linea.cantidad = cantidad
}

// La URL no debe seguir prometiendo un traslado precargado después de que el
// drawer se cerró (cancelado o confirmado): un refresh o un "atrás" del
// navegador no puede reabrirlo solo. Mismo criterio que `ventas/index.vue`
// con `?venta=`.
watch(drawerOpen, (abierto) => {
  if (abierto) return
  if (!route.query.itemId && !route.query.origenId && !route.query.cantidad) return
  void router.replace({
    query: { ...route.query, itemId: undefined, origenId: undefined, cantidad: undefined },
  })
})

function toggleUnidad(linea: LineaForm, unidadId: string) {
  linea.unidadIds = linea.unidadIds.includes(unidadId)
    ? linea.unidadIds.filter(id => id !== unidadId)
    : [...linea.unidadIds, unidadId]
  // Mismo criterio que la salida serie del ajuste de stock
  // (`configuracion/items.vue` → `ejecutarAjusteStock`): la cantidad es la
  // cuenta de lo elegido, no un campo aparte que se pueda desincronizar.
  linea.cantidad = String(linea.unidadIds.length)
}

function onSeleccionarLote(linea: LineaForm, loteId: string) {
  linea.loteId = loteId
  linea.disponible = linea.lotesEnOrigen.find(l => l.id === loteId)?.cantidadEnOrigen ?? null
}

// ── Confirmar ───────────────────────────────────────────────────────────

async function confirmar() {
  // Doble guarda: el botón ya se deshabilita con `saving`, esto corta
  // también un segundo submit disparado por otro camino (Enter, etc.) — un
  // doble tap no puede mandar dos POST.
  if (!puedeConfirmar.value || saving.value) return
  saving.value = true
  try {
    const body = {
      origenId: form.value.origenId,
      destinoId: form.value.destinoId,
      motivoTrasladoId: form.value.motivoTrasladoId,
      comentario: form.value.comentario.trim() || undefined,
      lineas: lineasValidas.value.map((l) => {
        const linea: Record<string, unknown> = { itemId: l.itemId, cantidad: l.cantidad }
        if (l.modoInventario === 'serie') linea.unidadIds = l.unidadIds
        if (l.modoInventario === 'lote') linea.loteId = l.loteId
        return linea
      }),
    }
    const res = await useApiFetch<TrasladoDetalle>(`${apiUrl}/traslados`, {
      method: 'POST',
      body,
    })
    // Inserta en la página actual si corresponde; evita un refetch completo.
    if (page.value === 1) {
      const size = pageSize.value
      traslados.value = [res, ...traslados.value].slice(0, size)
      meta.value = {
        ...meta.value,
        total: meta.value.total + 1,
        totalPages: Math.max(1, Math.ceil((meta.value.total + 1) / size)),
      }
    }
    toast.add({ title: 'Traslado registrado', color: 'success' })
    drawerOpen.value = false
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al registrar el traslado'), color: 'error' })
  } finally {
    saving.value = false
  }
}

// ── Detalle (histórico) ────────────────────────────────────────────────────

const detalleOpen = ref(false)
const detalleLoading = ref(false)
const detalleTraslado = ref<TrasladoDetalle | null>(null)
// Id de la petición en vuelo: si el usuario abre otra fila (o cierra el
// modal) antes de que la respuesta llegue, esa respuesta vieja no puede
// pintar sobre el traslado que se está mirando ahora.
const detalleIdEnCurso = ref<string | null>(null)

async function verDetalle(_e: Event, row: Row<TrasladoListItem>) {
  const id = row.original.id
  detalleTraslado.value = null
  detalleOpen.value = true
  detalleLoading.value = true
  detalleIdEnCurso.value = id
  try {
    const res = await useApiFetch<TrasladoDetalle>(`${apiUrl}/traslados/${id}`)
    if (detalleIdEnCurso.value !== id) return
    detalleTraslado.value = res
  } catch (e: unknown) {
    if (detalleIdEnCurso.value !== id) return
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el traslado'), color: 'error' })
    detalleOpen.value = false
  } finally {
    if (detalleIdEnCurso.value === id) detalleLoading.value = false
  }
}

// ── Tabla ────────────────────────────────────────────────────────────────

const columns: TableColumn<TrasladoListItem>[] = [
  { accessorKey: 'creadoEl', header: 'Fecha' },
  { accessorKey: 'origenNombre', header: 'Origen' },
  { accessorKey: 'destinoNombre', header: 'Destino' },
  { accessorKey: 'motivoNombre', header: 'Motivo' },
  { accessorKey: 'itemsMovidos', header: 'Ítems', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'usuarioNombre', header: 'Usuario' },
  { accessorKey: 'comentario', header: 'Comentario' },
]

const columnsDetalle: TableColumn<TrasladoLineaDetalle>[] = [
  { accessorKey: 'itemNombre', header: 'Producto' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'stockOrigenResultante', header: 'Stock resultante (origen)', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'stockDestinoResultante', header: 'Stock resultante (destino)', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Traslados" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Traslados"
          description="Mueve mercadería entre el local y las bodegas del tenant, en un solo acto."
        >
          <template #actions>
            <UButton
              v-if="puedeTrasladar"
              icon="i-lucide-plus"
              :disabled="!hayBodegas"
              :title="!hayBodegas ? 'Hace falta al menos una bodega para trasladar' : undefined"
              @click="abrirCrear"
            >
              Nuevo traslado
            </UButton>
          </template>
        </CrudPageHeader>

        <CrudTable
          :data="traslados"
          :columns="columns"
          :loading="loading"
          :ui="{ tr: 'cursor-pointer' }"
          @select="verDetalle"
        >
          <template #creadoEl-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatFecha(row.original.creadoEl) }}</span>
          </template>
          <template #usuarioNombre-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.usuarioNombre || '—' }}</span>
          </template>
          <template #comentario-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.comentario || '—' }}</span>
          </template>
          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              <UIcon
                name="i-lucide-arrow-left-right"
                class="w-8 h-8 mx-auto mb-2 opacity-40"
              />
              No hay traslados registrados.
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

        <!-- Formulario: nuevo traslado -->
        <AppDrawer
          v-model:open="drawerOpen"
          width="lg"
        >
          <template #header>
            <span class="font-semibold text-default">Nuevo traslado</span>
          </template>

          <template #body>
            <UForm
              id="traslado-form"
              :state="form"
              class="space-y-6"
              @submit="confirmar"
            >
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Origen" required>
                  <USelectMenu
                    v-model="form.origenId"
                    :items="origenOpts"
                    value-key="value"
                    placeholder="De dónde sale"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Destino" required>
                  <USelectMenu
                    v-model="form.destinoId"
                    :items="destinoOpts"
                    value-key="value"
                    placeholder="A dónde llega"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <UAlert
                v-if="origenIgualDestino"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                title="El origen y el destino tienen que ser distintos"
              />

              <UFormField label="Motivo" required>
                <USelectMenu
                  v-model="form.motivoTrasladoId"
                  :items="motivoOpts"
                  value-key="value"
                  placeholder="Selecciona el motivo"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Comentario">
                <UTextarea
                  v-model="form.comentario"
                  :rows="2"
                  placeholder="Opcional"
                  class="w-full"
                />
              </UFormField>

              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-default">Líneas</span>
                  <UButton
                    size="xs"
                    variant="ghost"
                    icon="i-lucide-plus"
                    :disabled="!form.origenId"
                    @click="agregarLinea"
                  >
                    Agregar línea
                  </UButton>
                </div>

                <p v-if="!form.origenId" class="text-sm text-muted">
                  Elegí el origen para poder agregar líneas.
                </p>

                <div
                  v-for="linea in lineas"
                  :key="linea.key"
                  class="border border-default rounded-md p-4 space-y-3"
                >
                  <div class="flex items-start gap-3">
                    <UFormField label="Producto" class="flex-1">
                      <USelectMenu
                        :model-value="linea.itemId"
                        :items="productoOpts"
                        value-key="value"
                        searchable
                        :disabled="!form.origenId"
                        placeholder="Selecciona un producto"
                        class="w-full"
                        @update:model-value="(v: string) => onSeleccionarItem(linea, v)"
                      />
                    </UFormField>
                    <UButton
                      v-if="lineas.length > 1"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      size="sm"
                      class="mt-6"
                      @click="quitarLinea(linea.key)"
                    />
                  </div>

                  <div v-if="linea.itemId" class="space-y-2">
                    <div v-if="linea.cargando" class="flex items-center gap-2 text-sm text-muted">
                      <UIcon name="i-lucide-loader" class="w-4 h-4 animate-spin" />
                      Cargando disponibilidad…
                    </div>

                    <template v-else>
                      <!-- Modo cantidad -->
                      <template v-if="linea.modoInventario === 'cantidad' || !linea.modoInventario">
                        <UFormField label="Cantidad" required>
                          <UInput
                            v-model="linea.cantidad"
                            inputmode="decimal"
                            placeholder="0"
                            class="w-full"
                          />
                        </UFormField>
                        <p v-if="linea.disponible !== null" data-qa="linea-disponible" class="text-xs text-muted">
                          Disponible en {{ origenNombre }}: {{ formatStock(linea.disponible, linea.unidadMedida) }}
                        </p>
                      </template>

                      <!-- Modo serie: elegir unidades concretas -->
                      <template v-else-if="linea.modoInventario === 'serie'">
                        <p class="text-sm text-muted">
                          Selecciona unidades a trasladar ({{ linea.unidadIds.length }} seleccionadas)
                        </p>
                        <div v-if="!linea.unidadesEnOrigen.length" class="text-sm text-muted py-2">
                          No hay unidades disponibles en {{ origenNombre }}.
                        </div>
                        <div
                          v-for="u in linea.unidadesEnOrigen"
                          :key="u.id"
                          class="flex items-center gap-3 py-1.5 border-b border-default"
                        >
                          <input
                            type="checkbox"
                            :value="u.id"
                            :checked="linea.unidadIds.includes(u.id)"
                            class="w-4 h-4"
                            @change="toggleUnidad(linea, u.id)"
                          >
                          <span class="font-mono text-sm flex-1">{{ u.serie }}</span>
                          <UBadge :label="u.condicion" variant="subtle" size="sm" />
                        </div>
                      </template>

                      <!-- Modo lote: elegir un lote concreto + cantidad -->
                      <template v-else-if="linea.modoInventario === 'lote'">
                        <UFormField label="Lote" required>
                          <USelectMenu
                            :model-value="linea.loteId"
                            :items="linea.lotesEnOrigen.map(l => ({ label: `${l.codigoLote} (disp. ${l.cantidadEnOrigen})`, value: l.id }))"
                            value-key="value"
                            placeholder="Selecciona un lote"
                            class="w-full"
                            @update:model-value="(v: string) => onSeleccionarLote(linea, v)"
                          />
                        </UFormField>
                        <p v-if="!linea.lotesEnOrigen.length" class="text-sm text-muted">
                          No hay lotes con stock en {{ origenNombre }}.
                        </p>
                        <UFormField v-if="linea.loteId" label="Cantidad" required>
                          <UInput
                            v-model="linea.cantidad"
                            inputmode="decimal"
                            placeholder="0"
                            class="w-full"
                          />
                        </UFormField>
                        <p v-if="linea.disponible !== null" data-qa="linea-disponible" class="text-xs text-muted">
                          Disponible en {{ origenNombre }}: {{ formatStock(linea.disponible, linea.unidadMedida) }}
                        </p>
                      </template>
                    </template>
                  </div>
                </div>
              </div>
            </UForm>
          </template>

          <template #actions>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="() => { drawerOpen = false }"
            >
              Cancelar
            </UButton>
            <UButton
              type="submit"
              form="traslado-form"
              :loading="saving"
              :disabled="saving || !puedeConfirmar"
            >
              Confirmar traslado
            </UButton>
          </template>
        </AppDrawer>

        <!-- Detalle: histórico navegable -->
        <UModal v-model:open="detalleOpen" title="Detalle del traslado" :ui="{ content: 'max-w-3xl' }">
          <template #body>
            <div v-if="detalleLoading" class="flex items-center justify-center py-8">
              <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin text-muted" />
            </div>
            <div v-else-if="detalleTraslado" class="space-y-4">
              <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><span class="text-muted">Fecha:</span> {{ formatFecha(detalleTraslado.creadoEl) }}</div>
                <div><span class="text-muted">Usuario:</span> {{ detalleTraslado.usuarioNombre || '—' }}</div>
                <div><span class="text-muted">Origen:</span> {{ detalleTraslado.origenNombre || '—' }}</div>
                <div><span class="text-muted">Destino:</span> {{ detalleTraslado.destinoNombre || '—' }}</div>
                <div><span class="text-muted">Motivo:</span> {{ detalleTraslado.motivoNombre || '—' }}</div>
                <div v-if="detalleTraslado.comentario"><span class="text-muted">Comentario:</span> {{ detalleTraslado.comentario }}</div>
              </div>

              <UTable :data="detalleTraslado.detalle" :columns="columnsDetalle">
                <template #cantidad-cell="{ row }">
                  {{ formatStock(row.original.cantidad, row.original.unidadMedida) }}
                </template>
                <template #stockOrigenResultante-cell="{ row }">
                  <div>
                    {{ formatStock(row.original.stockOrigenResultante, row.original.unidadMedida) }}
                    <p class="text-xs text-muted font-mono">{{ row.original.movimientoSalidaId }}</p>
                  </div>
                </template>
                <template #stockDestinoResultante-cell="{ row }">
                  <div>
                    {{ formatStock(row.original.stockDestinoResultante, row.original.unidadMedida) }}
                    <p class="text-xs text-muted font-mono">{{ row.original.movimientoEntradaId }}</p>
                  </div>
                </template>
              </UTable>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
