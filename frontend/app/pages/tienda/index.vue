<script setup lang="ts">
import { descontarStockCatalogo, type ItemCatalogo } from '~/composables/useVenta'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()

const { lineas, resultado, loadingCalculo, add, quitar, cambiarCantidad, pagar } = useTiendaCarrito()

const items = ref<ItemCatalogo[]>([])
const loadingCatalogo = ref(false)
const pagando = ref(false)

async function cargar() {
  loadingCatalogo.value = true
  try {
    const res = await useApiFetch<PaginatedResponse<ItemCatalogo>>(
      `${apiUrl}/items?tipo=producto&pageSize=100`,
    )
    items.value = descontarStockCatalogo(res.data, lineas.value)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar el catálogo', color: 'error' })
  } finally {
    loadingCatalogo.value = false
  }
}

onMounted(cargar)

async function irAPagar() {
  pagando.value = true
  try {
    const { checkoutUrl } = await pagar()
    await navigateTo(checkoutUrl)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al iniciar el pago', color: 'error' })
  } finally {
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
          <VentasCatalogoGrid :items="items" :loading="loadingCatalogo" @add="add" />
        </div>
        <div class="lg:col-span-2 lg:sticky lg:top-4">
          <TiendaCarritoOnline
            :lineas="lineas"
            :resultado="resultado"
            :loading-calculo="loadingCalculo"
            :pagando="pagando"
            @cambiar-cantidad="cambiarCantidad"
            @quitar="quitar"
            @pagar="irAPagar"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
