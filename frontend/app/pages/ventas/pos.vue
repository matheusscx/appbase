<script setup lang="ts">
import { useVenta, descontarStockCatalogo, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
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

const items = ref<ItemCatalogo[]>([])
const metodos = ref<MetodoPago[]>([])
const tiposDocumento = ref<TipoDoc[]>([])
const loadingCatalogo = ref(false)

const tipoDocumentoId = ref<string | undefined>(undefined)
const customer = ref<CustomerForm>({ nombre: '', rut: '', direccion: '', telefono: '', email: '' })
const customerExpandido = ref(false)

const cobroOpen = ref(false)
const submitting = ref(false)
const movimientoDrawerOpen = ref(false)
const cierreDrawerOpen = ref(false)

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
  customerExpandido.value = false
  customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
})

async function cargar() {
  loadingCatalogo.value = true
  try {
    const [itemsRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(
        `${apiUrl}/items?tipo=producto&pageSize=100`,
      ),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = itemsRes.data
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
      lineas: lineas.value.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad })),
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
      }
    }
    const venta = await useApiFetch<{ estado: string }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body,
    })
    toast.add({ title: `Venta ${venta.estado}`, color: 'success' })
    cobroOpen.value = false
    items.value = descontarStockCatalogo(items.value, lineas.value)
    limpiar()
    customerExpandido.value = false
    customer.value = { nombre: '', rut: '', direccion: '', telefono: '', email: '' }
    await cajaStore.cargarActiva()
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
          <VentasCatalogoGrid :items="items" :loading="loadingCatalogo" @add="add" />
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
          />
        </div>
      </div>

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
        @saved="cajaStore.cargarResumenTurno(cajaStore.activa!.id)"
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
