<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { EstadoCompra } from '~/composables/useCompras'
import { hoyLocal } from '~/composables/useVigenciaRegla'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

// ── Interfaces ─────────────────────────────────────────────────────────────

interface TipoDocumento { id: string, nombre: string, codigo: string | null, requiereFolio: boolean }
interface Proveedor { id: string, nombre: string, rut: string | null }
interface ProductoOpt {
  id: string
  nombre: string
  modoInventario: string | null
  unidadMedida: string | null
}

interface LineaDetalle {
  id: string
  orden: number
  itemId: string
  itemNombre: string | null
  modoInventario: string | null
  unidadMedidaBase: string | null
  cantidad: string
  unidadCodigo: string
  precioUnitario: string | null
  series: { serie: string }[] | null
  lote: { codigoLote: string, fechaVencimiento?: string } | null
}

interface CompraDetalle {
  id: string
  estado: EstadoCompra
  faltaCosto: boolean
  fechaDocumento: string
  proveedorId: string
  proveedorNombre: string | null
  tipoDocumentoCompraId: string
  tipoDocumentoNombre: string | null
  folio: string | null
  ubicacionId: string
  ubicacionNombre: string | null
  observacion: string | null
  descuentoTotal: string | null
  total: string | null
  lineas: LineaDetalle[]
}

interface LineaForm {
  key: string
  itemId: string
  modoInventario: string | null
  unidadMedida: string | null
  cantidad: string
  unidadCodigo: string
  /** String vacío = falta costo: se completa cuando llega la factura. */
  precioUnitario: string
  /** Modo serie: una serie por renglón. */
  seriesTexto: string
  codigoLote: string
  fechaVencimiento: string
}

interface Opt { label: string, value: string }

// ── Estado ─────────────────────────────────────────────────────────────────

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { formatMonto } = useFormatters()
const { ubicaciones, cargar: cargarUbicaciones } = useUbicaciones()
const unidadesMedidaStore = useUnidadesMedidaStore()
const { totalLinea, subtotal, faltaAlgunPrecio, insigniaEstado } = useCompras()
const { puedeCrear } = usePermisosCrud('Compras')

const esNueva = computed(() => route.params.id === 'nueva')
const compra = ref<CompraDetalle | null>(null)
const cargando = ref(true)
const guardando = ref(false)

/** Solo un borrador (o una compra nueva) se edita acá. */
const editable = computed(() =>
  puedeCrear.value && (esNueva.value || compra.value?.estado === 'borrador'),
)

const tipos = ref<TipoDocumento[]>([])
const proveedores = ref<Proveedor[]>([])
const productos = ref<ProductoOpt[]>([])

const tipoOpts = computed<Opt[]>(() => tipos.value.map(t => ({ label: t.nombre, value: t.id })))
const proveedorOpts = computed<Opt[]>(() => proveedores.value.map(p => ({ label: p.nombre, value: p.id })))
const productoOpts = computed<Opt[]>(() => productos.value.map(p => ({ label: p.nombre, value: p.id })))
// Solo las activas: el backend rechaza recibir en una desactivada.
const ubicacionOpts = computed<Opt[]>(() =>
  ubicaciones.value.filter(u => u.activo).map(u => ({ label: u.nombre, value: u.id })),
)

function emptyForm() {
  return {
    proveedorId: '',
    tipoDocumentoCompraId: '',
    folio: '',
    // `hoyLocal`, no `toISOString()`: en Chile la fecha UTC va un día adelante
    // desde las 21:00.
    fechaDocumento: hoyLocal(),
    ubicacionId: '',
    observacion: '',
  }
}
const form = ref(emptyForm())
const folioError = ref<string | null>(null)

let lineaSeq = 0
function nuevaLinea(): LineaForm {
  return {
    key: `linea-${lineaSeq++}`,
    itemId: '',
    modoInventario: null,
    unidadMedida: null,
    cantidad: '',
    unidadCodigo: '',
    precioUnitario: '',
    seriesTexto: '',
    codigoLote: '',
    fechaVencimiento: '',
  }
}
const lineas = ref<LineaForm[]>([nuevaLinea()])

const tipoSeleccionado = computed(() =>
  tipos.value.find(t => t.id === form.value.tipoDocumentoCompraId) ?? null,
)
const pideFolio = computed(() => tipoSeleccionado.value?.requiereFolio ?? true)

// ── Carga ──────────────────────────────────────────────────────────────────

async function cargarCatalogos() {
  await unidadesMedidaStore.ensureLoaded()
  // Producto e ingrediente: los dos llevan stock, y un restaurante compra sobre
  // todo ingredientes (mismo par que traslados y mermas).
  const [tiposRes, provRes, prodRes, ingRes] = await Promise.all([
    useApiFetch<TipoDocumento[]>(`${apiUrl}/compras/tipos-documento`),
    useApiFetch<Proveedor[]>(`${apiUrl}/compras/proveedores`),
    useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
    useApiFetch<PaginatedResponse<ProductoOpt>>(`${apiUrl}/items?tipo=ingrediente&pageSize=100`),
    cargarUbicaciones(),
  ])
  tipos.value = tiposRes
  proveedores.value = provRes
  productos.value = [...prodRes.data, ...ingRes.data].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function lineaDesdeDetalle(l: LineaDetalle): LineaForm {
  return {
    ...nuevaLinea(),
    itemId: l.itemId,
    modoInventario: l.modoInventario,
    unidadMedida: l.unidadMedidaBase,
    cantidad: l.cantidad,
    unidadCodigo: l.unidadCodigo,
    precioUnitario: l.precioUnitario ?? '',
    seriesTexto: (l.series ?? []).map(s => s.serie).join('\n'),
    codigoLote: l.lote?.codigoLote ?? '',
    fechaVencimiento: l.lote?.fechaVencimiento ?? '',
  }
}

function llenarDesde(c: CompraDetalle) {
  compra.value = c
  form.value = {
    proveedorId: c.proveedorId,
    tipoDocumentoCompraId: c.tipoDocumentoCompraId,
    folio: c.folio ?? '',
    fechaDocumento: c.fechaDocumento,
    ubicacionId: c.ubicacionId,
    observacion: c.observacion ?? '',
  }
  lineas.value = c.lineas.length ? c.lineas.map(lineaDesdeDetalle) : [nuevaLinea()]
}

onMounted(async () => {
  try {
    await cargarCatalogos()
    if (!esNueva.value) {
      llenarDesde(await useApiFetch<CompraDetalle>(`${apiUrl}/compras/${route.params.id as string}`))
    }
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar la compra'), color: 'error' })
  } finally {
    cargando.value = false
  }
})

// ── Líneas ─────────────────────────────────────────────────────────────────

function unidadesCompatibles(linea: LineaForm): Opt[] {
  // Serie y lote solo admiten su unidad base (el backend lo rechaza si no).
  if (linea.modoInventario !== 'cantidad') {
    return linea.unidadMedida ? [{ label: linea.unidadMedida, value: linea.unidadMedida }] : []
  }
  const magnitud = unidadesMedidaStore.magnitudDe(linea.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: u.codigo, value: u.codigo }))
}

function onSeleccionarItem(linea: LineaForm, itemId: string) {
  const producto = productos.value.find(p => p.id === itemId)
  linea.itemId = itemId
  linea.modoInventario = producto?.modoInventario ?? 'cantidad'
  linea.unidadMedida = producto?.unidadMedida ?? null
  linea.unidadCodigo = producto?.unidadMedida ?? ''
  linea.seriesTexto = ''
  linea.codigoLote = ''
  linea.fechaVencimiento = ''
}

function seriesDe(linea: LineaForm): string[] {
  return linea.seriesTexto.split('\n').map(s => s.trim()).filter(Boolean)
}

// En serie, la cantidad es la cuenta de las series, no un campo aparte que se
// pueda desincronizar (mismo criterio que traslados).
function onSeriesChange(linea: LineaForm, texto: string) {
  linea.seriesTexto = texto
  linea.cantidad = String(seriesDe(linea).length)
}

function agregarLinea() {
  lineas.value.push(nuevaLinea())
}

function quitarLinea(key: string) {
  lineas.value = lineas.value.filter(l => l.key !== key)
  if (!lineas.value.length) lineas.value.push(nuevaLinea())
}

/** Una línea a medio cargar (sin producto o sin cantidad) no viaja. */
const lineasCargadas = computed(() => lineas.value.filter(l => l.itemId && l.cantidad))

const subtotalMostrado = computed(() =>
  subtotal(lineasCargadas.value.map(l => ({ cantidad: l.cantidad, precioUnitario: l.precioUnitario || null }))),
)
const faltanPrecios = computed(() =>
  faltaAlgunPrecio(lineasCargadas.value.map(l => ({ precioUnitario: l.precioUnitario || null }))),
)

// ── Guardar / descartar ────────────────────────────────────────────────────

const puedeGuardar = computed(() =>
  !!form.value.proveedorId
  && !!form.value.tipoDocumentoCompraId
  && !!form.value.ubicacionId
  && !!form.value.fechaDocumento
  && (!pideFolio.value || !!form.value.folio.trim()),
)

function armarBody() {
  return {
    proveedorId: form.value.proveedorId,
    tipoDocumentoCompraId: form.value.tipoDocumentoCompraId,
    folio: pideFolio.value ? form.value.folio.trim() : null,
    fechaDocumento: form.value.fechaDocumento,
    ubicacionId: form.value.ubicacionId,
    observacion: form.value.observacion.trim() || null,
    lineas: lineasCargadas.value.map((l) => {
      const linea: Record<string, unknown> = {
        itemId: l.itemId,
        cantidad: l.cantidad,
        unidadCodigo: l.unidadCodigo,
        // Vacío viaja como null explícito: "falta costo".
        precioUnitario: l.precioUnitario || null,
      }
      if (l.modoInventario === 'serie') {
        linea.series = seriesDe(l).map(serie => ({ serie }))
      }
      if (l.modoInventario === 'lote') {
        linea.lote = {
          codigoLote: l.codigoLote.trim(),
          ...(l.fechaVencimiento ? { fechaVencimiento: l.fechaVencimiento } : {}),
        }
      }
      return linea
    }),
  }
}

async function guardar() {
  if (!puedeGuardar.value || guardando.value) return
  guardando.value = true
  folioError.value = null
  try {
    const body = armarBody()
    const res = esNueva.value
      ? await useApiFetch<CompraDetalle>(`${apiUrl}/compras`, { method: 'POST', body })
      : await useApiFetch<CompraDetalle>(`${apiUrl}/compras/${compra.value!.id}`, { method: 'PATCH', body })
    llenarDesde(res)
    toast.add({ title: 'Borrador guardado', color: 'success' })
    if (esNueva.value) await router.replace(`/compras/${res.id}`)
  } catch (e: unknown) {
    const status = (e as { status?: number, statusCode?: number }).status
      ?? (e as { statusCode?: number }).statusCode
    const mensaje = apiErrorMsg(e, 'Error al guardar la compra')
    // El folio repetido se muestra al lado del campo, que es donde se arregla.
    if (status === 409) folioError.value = mensaje
    else toast.add({ title: mensaje, color: 'error' })
  } finally {
    guardando.value = false
  }
}

const descartarOpen = ref(false)
async function descartar() {
  if (!compra.value) return
  try {
    await useApiFetch(`${apiUrl}/compras/${compra.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Borrador descartado', color: 'success' })
    await router.push('/compras')
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al descartar el borrador'), color: 'error' })
  } finally {
    descartarOpen.value = false
  }
}

// ── Solo lectura (confirmada o anulada) ────────────────────────────────────

const columnsDetalle: TableColumn<LineaDetalle>[] = [
  { accessorKey: 'itemNombre', header: 'Producto' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'precioUnitario', header: 'Precio unitario', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const titulo = computed(() => {
  if (esNueva.value) return 'Nueva compra'
  const c = compra.value
  if (!c) return 'Compra'
  return `${c.tipoDocumentoNombre ?? 'Compra'}${c.folio ? ` ${c.folio}` : ''}`
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar :title="titulo" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <div class="flex items-center justify-between gap-3">
          <UButton variant="ghost" icon="i-lucide-arrow-left" to="/compras">
            Compras
          </UButton>
          <div v-if="compra" class="flex flex-wrap gap-1">
            <UBadge
              v-for="i in insigniaEstado(compra)"
              :key="i.label"
              :label="i.label"
              :color="i.color"
              variant="subtle"
            />
          </div>
        </div>

        <div v-if="cargando" class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-loader" class="w-4 h-4 animate-spin" />
          Cargando…
        </div>

        <!-- ── Carga del borrador ─────────────────────────────────────────── -->
        <UForm
          v-else-if="editable"
          id="compra-form"
          :state="form"
          class="space-y-6"
          @submit="guardar"
        >
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <UFormField label="Proveedor" required>
              <USelectMenu
                v-model="form.proveedorId"
                :items="proveedorOpts"
                value-key="value"
                searchable
                placeholder="A quién se le compró"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Documento" required>
              <USelectMenu
                v-model="form.tipoDocumentoCompraId"
                :items="tipoOpts"
                value-key="value"
                placeholder="Factura, boleta, sin documento…"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="pideFolio"
              label="Folio"
              required
              :error="folioError ?? undefined"
            >
              <UInput
                v-model="form.folio"
                placeholder="Número del documento"
                class="w-full"
                data-qa="compra-folio"
                @update:model-value="folioError = null"
              />
            </UFormField>
            <UFormField label="Fecha del documento" required>
              <UInput v-model="form.fechaDocumento" type="date" class="w-full" />
            </UFormField>
            <UFormField label="Entra a" required>
              <USelectMenu
                v-model="form.ubicacionId"
                :items="ubicacionOpts"
                value-key="value"
                placeholder="Local o bodega"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Observación">
              <UInput v-model="form.observacion" placeholder="Opcional" class="w-full" />
            </UFormField>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-default">Líneas</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="agregarLinea">
                Agregar línea
              </UButton>
            </div>

            <div
              v-for="linea in lineas"
              :key="linea.key"
              class="border border-default rounded-md p-4 space-y-3"
              data-qa="compra-linea"
            >
              <div class="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                <UFormField label="Producto" class="md:col-span-4">
                  <USelectMenu
                    :model-value="linea.itemId"
                    :items="productoOpts"
                    value-key="value"
                    searchable
                    placeholder="Selecciona un producto"
                    class="w-full"
                    @update:model-value="(v: string) => onSeleccionarItem(linea, v)"
                  />
                </UFormField>
                <UFormField label="Cantidad" class="md:col-span-2">
                  <UInput
                    v-model="linea.cantidad"
                    inputmode="decimal"
                    placeholder="0"
                    :disabled="linea.modoInventario === 'serie'"
                    class="w-full"
                    data-qa="compra-cantidad"
                  />
                </UFormField>
                <UFormField label="Unidad" class="md:col-span-2">
                  <USelect
                    v-model="linea.unidadCodigo"
                    :items="unidadesCompatibles(linea)"
                    :disabled="!linea.itemId"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Precio unitario" class="md:col-span-2">
                  <MoneyInput
                    v-model="linea.precioUnitario"
                    oficial
                    placeholder="Sin precio"
                    class="w-full"
                    data-qa="compra-precio"
                  />
                </UFormField>
                <div class="md:col-span-2 flex items-center justify-between gap-2">
                  <span class="text-sm tabular-nums text-muted" data-qa="compra-total-linea">
                    {{ totalLinea(linea.cantidad, linea.precioUnitario || null) != null
                      ? formatMonto(totalLinea(linea.cantidad, linea.precioUnitario || null))
                      : '—' }}
                  </span>
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    size="sm"
                    @click="quitarLinea(linea.key)"
                  />
                </div>
              </div>

              <UFormField
                v-if="linea.modoInventario === 'serie'"
                label="Series (una por renglón)"
              >
                <UTextarea
                  :model-value="linea.seriesTexto"
                  :rows="3"
                  class="w-full"
                  @update:model-value="(v: string) => onSeriesChange(linea, v)"
                />
              </UFormField>
              <div v-if="linea.modoInventario === 'lote'" class="grid grid-cols-2 gap-3">
                <UFormField label="Lote" required>
                  <UInput v-model="linea.codigoLote" placeholder="Código del lote" class="w-full" />
                </UFormField>
                <UFormField label="Vence">
                  <UInput v-model="linea.fechaVencimiento" type="date" class="w-full" />
                </UFormField>
              </div>
            </div>
          </div>

          <div class="flex flex-col items-end gap-2 border-t border-default pt-4">
            <div class="flex items-center gap-3 text-sm">
              <span class="text-muted">Subtotal</span>
              <span class="tabular-nums" data-qa="compra-subtotal">
                {{ subtotalMostrado != null ? formatMonto(subtotalMostrado) : '—' }}
              </span>
            </div>
            <UFormField label="Descuento al total" class="w-56">
              <MoneyInput model-value="" oficial disabled class="w-full" />
            </UFormField>
            <p class="text-xs text-muted" data-qa="compra-descuento-ayuda">
              Se carga cuando todas las líneas tienen precio.
            </p>
            <p v-if="faltanPrecios" class="text-xs text-muted">
              Hay líneas sin precio: entran igual y se completan cuando llegue la factura.
            </p>
          </div>

          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              v-if="!esNueva"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              @click="() => { descartarOpen = true }"
            >
              Descartar
            </UButton>
            <UButton
              icon="i-lucide-package-check"
              disabled
              title="Disponible cuando se habilite la recepción"
            >
              Confirmar recepción
            </UButton>
            <UButton
              type="submit"
              form="compra-form"
              icon="i-lucide-save"
              :loading="guardando"
              :disabled="!puedeGuardar"
              data-qa="compra-guardar"
            >
              Guardar borrador
            </UButton>
          </div>
        </UForm>

        <!-- ── Solo lectura ───────────────────────────────────────────────── -->
        <div v-else-if="compra" class="space-y-4">
          <dl class="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div><dt class="text-muted">Proveedor</dt><dd>{{ compra.proveedorNombre || '—' }}</dd></div>
            <div><dt class="text-muted">Fecha del documento</dt><dd>{{ compra.fechaDocumento }}</dd></div>
            <div><dt class="text-muted">Entró a</dt><dd>{{ compra.ubicacionNombre || '—' }}</dd></div>
          </dl>
          <CrudTable :data="compra.lineas" :columns="columnsDetalle">
            <template #itemNombre-cell="{ row }">
              {{ row.original.itemNombre || '—' }}
            </template>
            <template #cantidad-cell="{ row }">
              <span class="tabular-nums">{{ row.original.cantidad }} {{ row.original.unidadCodigo }}</span>
            </template>
            <template #precioUnitario-cell="{ row }">
              <span class="tabular-nums">
                {{ row.original.precioUnitario != null ? formatMonto(row.original.precioUnitario) : 'Falta costo' }}
              </span>
            </template>
          </CrudTable>
          <div class="flex justify-end text-sm">
            <span class="text-muted mr-3">Total</span>
            <span class="tabular-nums">{{ compra.total != null ? formatMonto(compra.total) : '—' }}</span>
          </div>
        </div>

        <UModal v-model:open="descartarOpen" title="¿Descartar este borrador?">
          <template #body>
            <p class="text-sm text-default">
              Se borra el borrador con sus líneas. No se movió stock ni costo, así que no hay nada más que deshacer.
            </p>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2 w-full">
              <UButton variant="ghost" @click="() => { descartarOpen = false }">
                Cancelar
              </UButton>
              <UButton color="error" @click="descartar">
                Descartar
              </UButton>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
