<script setup lang="ts">
import type { CompraDetalle, LineaCompra as LineaDetalle } from '~/composables/useCompras'
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
const { totalLinea, subtotal, totalConDescuento, faltaAlgunPrecio, insigniaEstado, cantidadParaEditar } = useCompras()
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
    descuentoTotal: '',
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
  // La lista es de Compras y no `/items`: quien recibe mercadería no necesita
  // permiso sobre el catálogo de ítems (owner, 2026-09-19). Trae producto e
  // ingrediente, los dos con stock, ya ordenados.
  const [tiposRes, provRes, prodRes] = await Promise.all([
    useApiFetch<TipoDocumento[]>(`${apiUrl}/compras/tipos-documento`),
    useApiFetch<Proveedor[]>(`${apiUrl}/compras/proveedores`),
    useApiFetch<ProductoOpt[]>(`${apiUrl}/compras/productos`),
    cargarUbicaciones(),
  ])
  tipos.value = tiposRes
  proveedores.value = provRes
  productos.value = prodRes
}

function lineaDesdeDetalle(l: LineaDetalle): LineaForm {
  return {
    ...nuevaLinea(),
    itemId: l.itemId,
    modoInventario: l.modoInventario,
    unidadMedida: l.unidadMedidaBase,
    cantidad: cantidadParaEditar(l.cantidad),
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
    descuentoTotal: c.descuentoTotal ?? '',
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
// El descuento se reparte según el valor de cada línea: sin todos los precios
// (o sin líneas) no hay cómo, y el backend lo rechaza (spec § 6).
const descuentoHabilitado = computed(() =>
  editable.value && lineasCargadas.value.length > 0 && !faltanPrecios.value,
)
// Si se borra un precio, el descuento cargado deja de poder existir: se vacía a
// la vista, con el campo deshabilitado diciendo por qué.
watch(faltanPrecios, (falta) => {
  if (falta) form.value.descuentoTotal = ''
})
const totalMostrado = computed(() =>
  totalConDescuento(subtotalMostrado.value, form.value.descuentoTotal || null),
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
    descuentoTotal: form.value.descuentoTotal || null,
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

/**
 * Guarda lo que está en pantalla (POST si es nueva, PATCH si no) y devuelve la
 * compra guardada, o `null` si falló, con el error ya mostrado. La usan
 * "Guardar borrador" y "Confirmar recepción": confirmar sin guardar primero
 * recibiría lo último guardado, no lo que el encargado ve.
 */
async function persistirBorrador(): Promise<CompraDetalle | null> {
  folioError.value = null
  try {
    const body = armarBody()
    const eraNueva = esNueva.value
    const res = eraNueva
      ? await useApiFetch<CompraDetalle>(`${apiUrl}/compras`, { method: 'POST', body })
      : await useApiFetch<CompraDetalle>(`${apiUrl}/compras/${compra.value!.id}`, { method: 'PATCH', body })
    llenarDesde(res)
    if (eraNueva) await router.replace(`/compras/${res.id}`)
    return res
  } catch (e: unknown) {
    const status = (e as { status?: number, statusCode?: number }).status
      ?? (e as { statusCode?: number }).statusCode
    const mensaje = apiErrorMsg(e, 'Error al guardar la compra')
    // El folio repetido se muestra al lado del campo, que es donde se arregla.
    if (status === 409) folioError.value = mensaje
    else toast.add({ title: mensaje, color: 'error' })
    return null
  }
}

async function guardar() {
  if (!puedeGuardar.value || guardando.value) return
  guardando.value = true
  try {
    if (await persistirBorrador()) {
      toast.add({ title: 'Borrador guardado', color: 'success' })
    }
  } finally {
    guardando.value = false
  }
}

// ── Confirmar ───────────────────────────────────────────────────────────────

const confirmarOpen = ref(false)
const puedeConfirmar = computed(() => puedeGuardar.value && lineasCargadas.value.length > 0)

const ubicacionNombre = computed(() =>
  ubicaciones.value.find(u => u.id === form.value.ubicacionId)?.nombre ?? '',
)
const lineasSinPrecio = computed(() =>
  lineasCargadas.value.filter(l => !l.precioUnitario).length,
)

/**
 * Guarda y confirma. Confirmar mueve stock y costo: por eso pasa por un modal
 * que dice cuánto entra y adónde antes de mandar nada.
 */
async function confirmarRecepcion() {
  if (!puedeConfirmar.value || guardando.value) return
  guardando.value = true
  try {
    const guardada = await persistirBorrador()
    if (!guardada) return
    const res = await useApiFetch<CompraDetalle>(
      `${apiUrl}/compras/${guardada.id}/confirmar`,
      { method: 'POST' },
    )
    llenarDesde(res)
    toast.add({ title: 'Recepción confirmada: la mercadería ya entró al stock', color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al confirmar la recepción'), color: 'error' })
  } finally {
    guardando.value = false
    confirmarOpen.value = false
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
              <MoneyInput
                v-model="form.descuentoTotal"
                oficial
                :disabled="!descuentoHabilitado"
                class="w-full"
                data-qa="compra-descuento"
              />
            </UFormField>
            <p v-if="!descuentoHabilitado" class="text-xs text-muted" data-qa="compra-descuento-ayuda">
              Se carga cuando todas las líneas tienen precio.
            </p>
            <div class="flex items-center gap-3 text-sm font-medium">
              <span>Total</span>
              <span class="tabular-nums" data-qa="compra-total">
                {{ totalMostrado != null ? formatMonto(totalMostrado) : '—' }}
              </span>
            </div>
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
              color="success"
              :disabled="!puedeConfirmar || guardando"
              data-qa="compra-confirmar"
              @click="() => { confirmarOpen = true }"
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

        <!-- ── Confirmada o anulada ────────────────────────────────────────── -->
        <ComprasCompraConfirmada
          v-else-if="compra"
          :compra="compra"
          @actualizada="llenarDesde"
        />

        <UModal v-model:open="confirmarOpen" title="¿Confirmar la recepción?">
          <template #body>
            <div class="space-y-2 text-sm text-default" data-qa="compra-confirmar-resumen">
              <p>
                Entran {{ lineasCargadas.length }} {{ lineasCargadas.length === 1 ? 'línea' : 'líneas' }}
                a <strong>{{ ubicacionNombre }}</strong>: el stock sube ahora.
              </p>
              <p v-if="lineasSinPrecio > 0" class="text-muted">
                {{ lineasSinPrecio }} {{ lineasSinPrecio === 1 ? 'línea entra' : 'líneas entran' }} sin precio:
                el costo se completa cuando llegue la factura.
              </p>
              <p class="text-muted">
                Una compra confirmada ya no se edita como borrador.
              </p>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2 w-full">
              <UButton variant="ghost" @click="() => { confirmarOpen = false }">
                Cancelar
              </UButton>
              <UButton
                color="success"
                :loading="guardando"
                data-qa="compra-confirmar-si"
                @click="confirmarRecepcion"
              >
                Confirmar recepción
              </UButton>
            </div>
          </template>
        </UModal>

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
