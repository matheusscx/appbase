<script setup lang="ts">
import { useVenta, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import type { CustomerForm } from '~/components/ventas/ClienteForm.vue'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface TipoDoc { id: string; nombre: string; requiereCustomer: boolean }
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

const cobroOpen = ref(false)
const submitting = ref(false)

const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')

async function cargar() {
  loadingCatalogo.value = true
  try {
    const [itemsRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<ItemCatalogo[]>(`${apiUrl}/items?tipo=producto`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = itemsRes
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
  submitting.value = true
  try {
    const docSel = tiposDocumento.value.find((t) => t.id === tipoDocumentoId.value)
    const body: Record<string, unknown> = {
      lineas: lineas.value.map((l) => ({ itemId: l.item.id, cantidad: l.cantidad })),
      pagos,
      tipoDocumentoId: tipoDocumentoId.value,
    }
    if (docSel?.requiereCustomer) {
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
    limpiar()
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
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Punto de venta" />
    </template>

    <template #body>
      <div v-if="!cajaStore.loadingActiva && !tieneCaja" class="max-w-md mx-auto text-center py-16">
        <UIcon name="i-heroicons-lock-closed" class="w-12 h-12 text-muted mx-auto mb-4" />
        <h2 class="text-lg font-semibold text-default mb-1">Necesitás una caja abierta</h2>
        <p class="text-sm text-muted mb-4">Abrí una caja para registrar ventas del canal físico.</p>
        <UButton label="Ir a caja" icon="i-heroicons-banknotes" to="/caja" />
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full p-4">
        <div class="lg:col-span-3 min-h-0">
          <CatalogoGrid :items="items" :loading="loadingCatalogo" @add="add" />
        </div>
        <div class="lg:col-span-2 min-h-0">
          <CarritoPanel
            v-model:tipo-documento-id="tipoDocumentoId"
            v-model:customer="customer"
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

      <CobroModal
        v-model:open="cobroOpen"
        :total="totalFinal"
        :metodos="metodos"
        :submitting="submitting"
        @confirmar="confirmarCobro"
      />
    </template>
  </UDashboardPanel>
</template>
