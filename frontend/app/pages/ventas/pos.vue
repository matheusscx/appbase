<script setup lang="ts">
import Decimal from 'decimal.js'
import { useVenta, descontarStockCatalogo, tieneCustomerData, toVentaLineasBody, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import { personalizacionVacia, type PersonalizacionPayload } from '~/composables/useRecetaPersonalizacion'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { CustomerForm } from '~/components/ventas/ClienteForm.vue'
import { formatCantidadLinea, unidadBaseItem } from '~/utils/cantidad-presentacion'
import { agregarImpuestosVenta, agregarPromocionesVenta, type PersonalizacionDetalleLinea } from '~/utils/ticket-builder'
import type { DropdownMenuItem } from '@nuxt/ui'
import { fetchPorcentajeSugeridoVenta, PROPINA_PORCENTAJE_DEFAULT } from '~/composables/usePropina'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface TipoDoc { id: string; nombre: string; customerRequerido: boolean }
interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const cajaStore = useCajaStore()
const authStore = useAuthStore()
const { emisor, cargar: cargarEmisor } = useRazonSocialEmisor()

const { lineas, resultado, loadingCalculo, vigente, asegurarVigente, add, quitar, cambiarCantidadPresentacion, limpiar } = useVenta()
const unidadesStore = useUnidadesMedidaStore()
const impresorasApi = useImpresoras()
const { formatMonto } = useFormatters()

const items = ref<ItemCatalogo[]>([])
const metodos = ref<MetodoPago[]>([])
const tiposDocumento = ref<TipoDoc[]>([])
const loadingCatalogo = ref(false)

/** Catálogo restando lo ya en el carrito (stock / disponible), reactivo. */
const itemsVisibles = computed(() => descontarStockCatalogo(items.value, lineas.value))

const tipoDocumentoId = ref<string | undefined>(undefined)
const customer = ref<CustomerForm>({ nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null })
const customerExpandido = ref(false)

const cobroOpen = ref(false)
const submitting = ref(false)
const propinaMonto = ref('0')
const propinaPorcentaje = ref(PROPINA_PORCENTAJE_DEFAULT)
const propinaHabilitada = ref(true)
const movimientoDrawerOpen = ref(false)
const cierreDrawerOpen = ref(false)
const recetaDrawerOpen = ref(false)
const recetaItemId = ref<string | null>(null)

function onCatalogoAdd(item: ItemCatalogo) {
  if (item.tipo === 'receta' || (item.tipo === 'combo' && item.disponibleCondicional)) {
    recetaItemId.value = item.id
    recetaDrawerOpen.value = true
    return
  }
  add(item)
}

function onRecetaConfirm(payload: PersonalizacionPayload, resumen: string, precioPreview: string, detalle: PersonalizacionDetalleLinea[]) {
  const item = items.value.find((i) => i.id === recetaItemId.value)
  if (!item) return
  if (personalizacionVacia(payload)) {
    add(item)
  }
  else {
    add(item, payload, resumen || undefined, precioPreview, detalle)
  }
  recetaDrawerOpen.value = false
  recetaItemId.value = null
}

function abrirMovimientoDrawer() { movimientoDrawerOpen.value = true }
function abrirCierreDrawer() { cierreDrawerOpen.value = true }

const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')

/** El modal de cobro pide el `totalFinal` que sale de `resultado`, y entre el
 *  último cambio del carrito y su cálculo hay una ventana (debounce + ida y
 *  vuelta). Se abre recién cuando ese total es el del carrito que se está
 *  viendo, no el del anterior. */
async function abrirCobro() {
  if (await asegurarVigente()) {
    cobroOpen.value = true
    return
  }
  toast.add({ title: 'No se pudo calcular el total. Intentá de nuevo.', color: 'error' })
}

const cajaMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: 'Registrar movimiento',
      icon: 'i-lucide-circle-plus',
      onSelect: abrirMovimientoDrawer,
    },
    {
      label: 'Cerrar caja',
      icon: 'i-lucide-lock',
      color: 'error' as const,
      onSelect: abrirCierreDrawer,
    },
  ],
])

watch(
  () => cajaStore.activa,
  async (activa) => {
    if (activa) {
      try {
        await cajaStore.cargarResumenTurno(activa.id)
      }
      catch {
        // no crítico — saldoEsperado quedará en saldoInicial si falla
      }
    }
  },
  { immediate: true },
)

watch(tipoDocumentoId, () => {
  if (tieneCustomerData(customer.value)) return
  customerExpandido.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
})

async function cargar() {
  loadingCatalogo.value = true
  try {
    const [productosRes, recetasRes, combosRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=producto&activo=true&pageSize=100`,
      ),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=receta&activo=true&pageSize=100`,
      ),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=combo&activo=true&pageSize=100`,
      ),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    // Los pausados no vienen: `activo=true` va en la query. Filtrarlos acá no
    // era equivalente —el pausado igual ocupaba uno de los 100 lugares pedidos,
    // así que en un catálogo grande empujaba fuera del POS a uno vendible—.
    items.value = [...productosRes.data, ...recetasRes.data, ...combosRes.data]
    metodos.value = metodosRes
    tiposDocumento.value = tiposRes
    tipoDocumentoId.value = tiposRes[0]?.id
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el POS'), color: 'error' })
  } finally {
    loadingCatalogo.value = false
  }
}

onMounted(async () => {
  await Promise.all([cajaStore.cargarActiva(), cargar(), unidadesStore.ensureLoaded(), cargarEmisor()])
  const { porcentajeSugerido, habilitado } = await fetchPorcentajeSugeridoVenta()
  propinaPorcentaje.value = porcentajeSugerido
  propinaHabilitada.value = habilitado
})

function onCambiarCantidadPresentacion(
  index: number,
  payload: { presentacion: string, unidadCodigo: string, cantidadCanonica: string },
) {
  cambiarCantidadPresentacion(
    index,
    payload.presentacion,
    payload.unidadCodigo,
    payload.cantidadCanonica,
  )
}

const estadoToastTitle: Record<string, string> = {
  pagada: 'Venta pagada',
  pagada_parcial: 'Venta con pago parcial',
  pendiente: 'Venta registrada — pendiente de pago',
}

async function confirmarCobro(pagos: PagoInput[], vuelto: string) {
  const docSel = tiposDocumento.value.find((t) => t.id === tipoDocumentoId.value)
  const incluirCustomer = docSel?.customerRequerido || customerExpandido.value

  if (incluirCustomer && !customer.value.nombre.trim()) {
    cobroOpen.value = false
    toast.add({ title: 'El nombre del cliente es requerido', color: 'error' })
    return
  }

  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      lineas: toVentaLineasBody(lineas.value),
      pagos,
      tipoDocumentoId: tipoDocumentoId.value,
    }
    if (propinaHabilitada.value && new Decimal(propinaMonto.value || '0').gt(0)) {
      body.propinaDirecta = {
        montoPagado: propinaMonto.value,
        porcentajeSugerido: propinaPorcentaje.value,
      }
    }
    if (incluirCustomer) {
      body.customer = {
        nombre: customer.value.nombre,
        rut: customer.value.rut || undefined,
        direccion: customer.value.direccion || undefined,
        telefono: customer.value.telefono || undefined,
        email: customer.value.email || undefined,
        terceroId: customer.value.terceroId || undefined,
      }
    }
    // La boleta cruza `resultadoVenta.lineas[i]` con `lineasVenta[i]`: los dos
    // se toman del mismo cálculo vigente, si no el ticket mezcla el nombre de
    // una línea con el monto de otra.
    const resultadoVenta = await asegurarVigente()
    const lineasVenta = [...lineas.value]

    const venta = await useApiFetch<{ estado: string; advertencias?: string[] }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body,
    })
    toast.add({ title: estadoToastTitle[venta.estado] ?? 'Venta registrada', color: 'success' })
    for (const advertencia of venta.advertencias ?? []) {
      toast.add({ title: advertencia, color: 'warning' })
    }
    cobroOpen.value = false
    propinaMonto.value = '0'

    if (resultadoVenta) {
      try {
        await impresorasApi.imprimirBoleta({
          emisor: emisor.value,
          facturacionElectronica: false,
          meta: {
            cajero: authStore.user?.nombre ?? undefined,
          },
          cliente: incluirCustomer
            ? { nombre: customer.value.nombre || undefined, rut: customer.value.rut || undefined, direccion: customer.value.direccion || undefined }
            : undefined,
          items: resultadoVenta.lineas.map((l, i) => {
            const ln = lineasVenta[i]
            return {
              nombre: ln?.item.nombre ?? '',
              cantidad: formatCantidadLinea(
                l.cantidad,
                ln?.cantidadPresentacion,
                ln?.unidadCodigoPresentacion,
                unidadesStore.esFraccionaria(
                  ln?.unidadCodigoPresentacion ?? (ln ? unidadBaseItem(ln.item) : null),
                ),
                ln ? unidadBaseItem(ln.item) : null,
              ),
              precioUnitario: l.precioUnitario,
              totalLinea: l.totalLinea,
              ...(ln?.personalizacionDetalle
                ? { personalizacionDetalle: ln.personalizacionDetalle, comentario: ln.personalizacion?.comentario }
                : ln?.personalizacionResumen ? { nota: ln.personalizacionResumen } : {}),
            }
          }),
          totales: resultadoVenta.totales,
          impuestos: agregarImpuestosVenta(resultadoVenta.lineas),
          promociones: agregarPromocionesVenta(resultadoVenta.lineas),
          pagos: pagos.map((p) => ({
            nombre: metodos.value.find((m) => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          vuelto,
          formatMonto: (v: string) => formatMonto(v),
        })
      } catch (e: unknown) {
        toast.add({ title: apiErrorMsg(e, 'Venta registrada, pero falló la impresión de la boleta'), color: 'warning' })
      }
    }
    else {
      // Un fallo de impresora avisa; quedarse sin el cálculo del que sale el
      // ticket también tiene que avisar, si no la venta queda sin comprobante
      // y sin que nadie se entere.
      toast.add({ title: 'Venta registrada, pero no se pudo generar la boleta', color: 'warning' })
    }

    // Persiste la venta en el catálogo base; el carrito se limpia después.
    items.value = descontarStockCatalogo(items.value, lineasVenta)
    const pagosConMonto = pagos.filter(p => new Decimal(p.monto || '0').gt(0))
    const bruto = pagosConMonto.reduce(
      (acc, p) => acc.plus(p.monto || '0'),
      new Decimal(0),
    )
    cajaStore.aplicarCobroLocal(
      bruto.minus(vuelto || '0').toFixed(4),
      pagosConMonto.length,
    )
    limpiar()
    customerExpandido.value = false
    customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al registrar la venta'), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UDashboardPanel :ui="{ body: 'flex flex-col flex-1 min-h-0 overflow-hidden p-0' }">
    <template #header>
      <AppNavbar title="Punto de venta">
        <template #right>
          <div v-if="tieneCaja" class="flex items-center gap-2 mr-2">
            <UDropdownMenu :items="cajaMenuItems">
              <UButton variant="soft" color="success" size="sm" icon="i-lucide-banknote">
                Caja abierta
              </UButton>
            </UDropdownMenu>
          </div>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div v-if="cajaStore.loadingActiva" class="flex items-center justify-center h-full">
        <UIcon name="i-lucide-loader" class="w-8 h-8 text-muted animate-spin" />
      </div>

      <div v-else-if="!tieneCaja" class="max-w-md mx-auto py-12">
        <CajaAperturaForm />
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full min-h-0 flex-1 overflow-hidden p-4">
        <div class="lg:col-span-3 min-h-0 flex flex-col overflow-hidden">
          <VentasCatalogoGrid :items="itemsVisibles" :loading="loadingCatalogo" @add="onCatalogoAdd" />
        </div>
        <div class="lg:col-span-2 min-h-0 flex flex-col overflow-hidden">
          <VentasCarritoPanel
            v-model:tipo-documento-id="tipoDocumentoId"
            v-model:customer="customer"
            v-model:customer-expandido="customerExpandido"
            :lineas="lineas"
            :resultado="resultado"
            :vigente="vigente"
            :loading-calculo="loadingCalculo"
            :tipos-documento="tiposDocumento"
            :tiene-caja="tieneCaja"
            @cambiar-cantidad="onCambiarCantidadPresentacion"
            @quitar="quitar"
            @cobrar="abrirCobro"
            @limpiar-todo="limpiar"
          />
        </div>
      </div>

      <VentasItemPersonalizacionDrawer
        v-model:open="recetaDrawerOpen"
        :item-id="recetaItemId"
        @confirm="onRecetaConfirm"
      />
      <VentasCobroModal
        v-model:open="cobroOpen"
        v-model:propina-monto="propinaMonto"
        :modo-propina="propinaHabilitada"
        :total="totalFinal"
        :venta-total="totalFinal"
        :porcentaje-sugerido="propinaPorcentaje"
        :metodos="metodos"
        :submitting="submitting"
        @confirmar="confirmarCobro"
      />
      <CajaMovimientoDrawer
        v-if="cajaStore.activa"
        v-model:open="movimientoDrawerOpen"
        :caja-id="cajaStore.activa.id"
      />
      <CajaCierreDrawer
        v-if="cajaStore.activa"
        v-model:open="cierreDrawerOpen"
        :caja-id="cajaStore.activa.id"
      />
    </template>
  </UDashboardPanel>
</template>
