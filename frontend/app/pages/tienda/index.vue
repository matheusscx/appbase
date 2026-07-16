<script setup lang="ts">
import { descontarStockCatalogo, type ItemCatalogo } from '~/composables/useVenta'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const unidadesStore = useUnidadesMedidaStore()

const { lineas, resultado, loadingCalculo, add, quitar, cambiarCantidadPresentacion, pagar } = useTiendaCarrito()

const items = ref<ItemCatalogo[]>([])
const loadingCatalogo = ref(false)
const pagando = ref(false)

/** Catálogo restando lo ya en el carrito (stock), reactivo al agregar/quitar. */
const itemsVisibles = computed(() => descontarStockCatalogo(items.value, lineas.value))

async function cargar() {
  loadingCatalogo.value = true
  try {
    const res = await useApiFetch<PaginatedResponse<ItemCatalogo>>(
      `${apiUrl}/items?tipo=producto&pageSize=100`,
    )
    items.value = res.data
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar el catálogo', color: 'error' })
  } finally {
    loadingCatalogo.value = false
  }
}

onMounted(async () => {
  await Promise.all([cargar(), unidadesStore.ensureLoaded()])
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

async function irAPagar() {
  pagando.value = true
  try {
    const res = await pagar()
    if (res.modo === 'webpay') {
      // Redirect real fuera de la SPA al formulario hosted de Webpay.
      window.location.href = res.urlWebpay
      return
    }
    await navigateTo(res.checkoutUrl)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al iniciar el pago', color: 'error' })
    pagando.value = false
  }
}
</script>

<template>
  <UDashboardPanel :ui="{ body: 'flex flex-col flex-1 min-h-0 overflow-hidden p-0' }">
    <template #header>
      <AppNavbar title="Tienda Online">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start p-4">
        <div class="lg:col-span-3">
          <VentasCatalogoGrid :items="itemsVisibles" :loading="loadingCatalogo" @add="add" />
        </div>
        <div class="lg:col-span-2 lg:sticky lg:top-4">
          <TiendaCarritoOnline
            :lineas="lineas"
            :resultado="resultado"
            :loading-calculo="loadingCalculo"
            :pagando="pagando"
            @cambiar-cantidad="onCambiarCantidadPresentacion"
            @quitar="quitar"
            @pagar="irAPagar"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
