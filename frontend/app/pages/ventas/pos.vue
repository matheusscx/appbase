<script setup lang="ts">
import { useVenta, descontarStockCatalogo, tieneCustomerData, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import type { PersonalizacionPayload } from '~/composables/useRecetaPersonalizacion'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { CustomerForm } from '~/components/ventas/ClienteForm.vue'
import Decimal from 'decimal.js'
import type { DropdownMenuItem } from '@nuxt/ui'

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

const { lineas, resultado, loadingCalculo, add, quitar, cambiarCantidad, limpiar } = useVenta()
const impresorasApi = useImpresoras()
const tenantStore = useTenantStore()
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
const movimientoDrawerOpen = ref(false)
const cierreDrawerOpen = ref(false)
const recetaDrawerOpen = ref(false)
const recetaItemId = ref<string | null>(null)

function onCatalogoAdd(item: ItemCatalogo) {
  if (item.tipo === 'receta') {
    recetaItemId.value = item.id
    recetaDrawerOpen.value = true
    return
  }
  add(item)
}

function personalizacionVacia(p: PersonalizacionPayload): boolean {
  return p.omitidos.length === 0 && p.extras.length === 0 && !p.comentario?.trim()
}

function onRecetaConfirm(payload: PersonalizacionPayload, resumen: string, precioPreview: string) {
  const item = items.value.find((i) => i.id === recetaItemId.value)
  if (!item) return
  if (personalizacionVacia(payload)) {
    add(item)
  }
  else {
    add(item, payload, resumen || undefined, precioPreview)
  }
  recetaDrawerOpen.value = false
  recetaItemId.value = null
}

function abrirMovimientoDrawer() { movimientoDrawerOpen.value = true }
function abrirCierreDrawer() { cierreDrawerOpen.value = true }

const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')

const saldoEsperado = computed(() => {
  if (!cajaStore.activa) return new Decimal(0)
  if (cajaStore.resumenTurno) {
    return new Decimal(cajaStore.resumenTurno.saldoEsperado)
  }
  return new Decimal(cajaStore.activa.saldoInicial)
})

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
    const [productosRes, recetasRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=producto&pageSize=100`,
      ),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=receta&pageSize=100`,
      ),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = [...productosRes.data, ...recetasRes.data]
    metodos.value = metodosRes
    tiposDocumento.value = tiposRes
    tipoDocumentoId.value = tiposRes[0]?.id
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar el POS', color: 'error' })
  } finally {
    loadingCatalogo.value = false
  }
}

onMounted(async () => {
  await Promise.all([cajaStore.cargarActiva(), cargar()])
})

const estadoToastTitle: Record<string, string> = {
  pagada: 'Venta pagada',
  pagada_parcial: 'Venta con pago parcial',
  pendiente: 'Venta registrada — pendiente de pago',
}

async function confirmarCobro(pagos: PagoInput[], _vuelto: string) {
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
      lineas: lineas.value.map((l) => ({
        itemId: l.item.id,
        cantidad: l.cantidad,
        ...(l.personalizacion
          ? {
              personalizacion: {
                omitidos: l.personalizacion.omitidos,
                extras: l.personalizacion.extras.map((e) => ({
                  ingredienteItemId: e.ingredienteItemId,
                })),
                ...(l.personalizacion.comentario
                  ? { comentario: l.personalizacion.comentario }
                  : {}),
              },
            }
          : {}),
      })),
      pagos,
      tipoDocumentoId: tipoDocumentoId.value,
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
    const resultadoVenta = resultado.value
    const lineasVenta = [...lineas.value]

    const venta = await useApiFetch<{ estado: string; advertenciasReceta?: string[] }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body,
    })
    toast.add({ title: estadoToastTitle[venta.estado] ?? 'Venta registrada', color: 'success' })
    for (const advertencia of venta.advertenciasReceta ?? []) {
      toast.add({ title: advertencia, color: 'warning' })
    }
    cobroOpen.value = false

    if (resultadoVenta) {
      try {
        await impresorasApi.imprimirBoleta({
          tenantNombre: tenantStore.activeTenant?.nombre ?? '',
          items: resultadoVenta.lineas.map((l, i) => {
            const ln = lineasVenta[i]
            return {
              nombre: ln?.item.nombre ?? '',
              cantidad: l.cantidad,
              totalLinea: l.totalLinea,
              ...(ln?.personalizacionResumen ? { nota: ln.personalizacionResumen } : {}),
            }
          }),
          totales: resultadoVenta.totales,
          pagos: pagos.map((p) => ({
            nombre: metodos.value.find((m) => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          formatMonto: (v: string) => formatMonto(v),
        })
      } catch (e: unknown) {
        toast.add({ title: apiErrorMsg(e, 'Venta registrada, pero falló la impresión de la boleta'), color: 'warning' })
      }
    }

    // Persiste la venta en el catálogo base; el carrito se limpia después.
    items.value = descontarStockCatalogo(items.value, lineasVenta)
    const pagosConMonto = pagos.filter(p => new Decimal(p.monto || '0').gt(0))
    const bruto = pagosConMonto.reduce(
      (acc, p) => acc.plus(p.monto || '0'),
      new Decimal(0),
    )
    cajaStore.aplicarCobroLocal(
      bruto.minus(_vuelto || '0').toFixed(4),
      pagosConMonto.length,
    )
    limpiar()
    customerExpandido.value = false
    customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '', terceroId: null }
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al registrar la venta', color: 'error' })
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
            :loading-calculo="loadingCalculo"
            :tipos-documento="tiposDocumento"
            :tiene-caja="tieneCaja"
            @cambiar-cantidad="cambiarCantidad"
            @quitar="quitar"
            @cobrar="cobroOpen = true"
            @limpiar-todo="limpiar"
          />
        </div>
      </div>

      <VentasRecetaPersonalizacionDrawer
        v-model:open="recetaDrawerOpen"
        :item-id="recetaItemId"
        @confirm="onRecetaConfirm"
      />
      <VentasCobroModal
        v-model:open="cobroOpen"
        :total="totalFinal"
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
        :saldo-esperado="saldoEsperado"
      />
    </template>
  </UDashboardPanel>
</template>
