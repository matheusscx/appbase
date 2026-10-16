<script setup lang="ts">
import { descontarStockCatalogo } from '~/composables/useVenta'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const unidadesStore = useUnidadesMedidaStore()

const { lineas, resultado, loadingCalculo, vigente, errorCalculo, asegurarVigente, recalcular, add, quitar, restaurar, cambiarCantidadPresentacion, pagar } = useTiendaCarrito()
const { formatMonto } = useFormatters()
// Sin `Tienda Online:Crear` el backend contesta 403 al pagar: se avisa antes de armar el carrito entero (09.14).
const { puedeCrear } = usePermisosCrud('Tienda Online')

const catalogo = useCatalogoVenta({
  tipos: ['producto'],
  filtros: { vendibleOnline: 'true' },
  // El 403 y el fallo ya los dice el panel del catálogo; el toast no repite la URL ni la jerga de red.
  onError: (e) => {
    if (!esSinPermiso(e)) toast.add({ title: apiErrorMsg(e, 'No se pudo cargar el catálogo', { detalleLocal: false }), color: 'error' })
  },
})
const items = catalogo.items
const loadingCatalogo = catalogo.loading
const pagando = ref(false)

/** Catálogo restando lo ya en el carrito (stock), reactivo al agregar/quitar. */
const itemsVisibles = computed(() => descontarStockCatalogo(items.value, lineas.value))

/** A menos de 1024 px el carrito completo vive en un panel que sube desde la barra inferior (09.16). */
const carritoAbierto = ref(false)

onMounted(async () => {
  // Un carrito recuperado del storage (volver de Webpay) llega sin su cálculo: se rehace sin esperar un toque.
  if (lineas.value.length && !vigente.value) void recalcular()
  await Promise.all([catalogo.cargar(), unidadesStore.ensureLoaded()])
})

/** Quitar es un toque y el basurero queda cerca de la cantidad: se puede deshacer (09.10). */
function onQuitar(index: number) {
  const linea = lineas.value[index]
  if (!linea) return
  quitar(index)
  toast.add({
    title: `Quitamos ${linea.item.nombre} del carrito`,
    actions: [{ label: 'Deshacer', color: 'neutral', variant: 'outline', onClick: () => restaurar(linea, index) }],
  })
}

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
  if (!puedeCrear.value) return
  carritoAbierto.value = false
  pagando.value = true
  try {
    // El comprador aprieta Pagar sobre el total que está viendo: se espera a que
    // ese total sea el de su carrito. El monto lo recalcula el backend igual,
    // pero mostrar uno y cobrar otro no es una diferencia que le toque descubrir.
    if (!await asegurarVigente()) {
      toast.add({ ...avisoCalculoFallido(errorCalculo.value), color: 'error' })
      pagando.value = false
      return
    }
    const res = await pagar()
    if (res.modo === 'webpay') {
      // Redirect real fuera de la SPA al formulario hosted de Webpay.
      window.location.href = res.urlWebpay
      return
    }
    await navigateTo(res.checkoutUrl)
  } catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al iniciar el pago')
    toast.add({ title: msg, color: 'error' })
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
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start p-4 pb-24 lg:pb-4">
        <div class="lg:col-span-3">
          <VentasCatalogoGrid
            v-model:busqueda="catalogo.busqueda.value"
            v-model:page="catalogo.page.value"
            :items="itemsVisibles"
            :total="catalogo.total.value"
            :page-size="catalogo.pageSize"
            :loading="loadingCatalogo"
            :error="catalogo.error.value"
            :sin-permiso="catalogo.sinPermiso.value"
            vacio="Aún no hay ítems a la venta online. Márcalos en Configuración › Items."
            @reintentar="catalogo.refrescar"
            @add="add"
          />
        </div>
        <div class="hidden lg:block lg:col-span-2 lg:sticky lg:top-4">
          <TiendaCarritoOnline
            :lineas="lineas"
            :resultado="resultado"
            :vigente="vigente"
            :loading-calculo="loadingCalculo"
            :pagando="pagando"
            :sin-permiso="!puedeCrear"
            @cambiar-cantidad="onCambiarCantidadPresentacion"
            @quitar="onQuitar"
            @pagar="irAPagar"
          />
        </div>
      </div>

      <!-- Bajo el punto `lg` el carrito iba debajo de 48 ítems: el total y "Pagar" quedaban lejos de
           lo que se agrega. Acá quedan siempre a la vista; el detalle abre en un panel. -->
      <div
        v-if="lineas.length"
        data-qa="barra-pagar"
        class="lg:hidden fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-default bg-default p-3"
      >
        <UButton
          :label="`Ver carrito (${lineas.length})`"
          icon="i-lucide-shopping-cart"
          color="neutral"
          variant="outline"
          size="xl"
          class="min-h-11"
          @click="() => { carritoAbierto = true }"
        />
        <span class="ms-auto text-lg font-semibold text-default tabular-nums" :class="{ 'opacity-50': loadingCalculo || !vigente }">
          {{ resultado ? formatMonto(resultado.totales.totalFinal) : '' }}
        </span>
        <UButton
          label="Pagar"
          icon="i-lucide-credit-card"
          size="xl"
          class="min-h-11"
          :loading="pagando"
          :disabled="loadingCalculo || !puedeCrear"
          @click="irAPagar"
        />
      </div>

      <USlideover v-model:open="carritoAbierto" side="bottom" title="Tu carrito" description="Revisa las cantidades antes de pagar.">
        <template #body>
          <TiendaCarritoOnline
            :lineas="lineas"
            :resultado="resultado"
            :vigente="vigente"
            :loading-calculo="loadingCalculo"
            :pagando="pagando"
            :sin-permiso="!puedeCrear"
            @cambiar-cantidad="onCambiarCantidadPresentacion"
            @quitar="onQuitar"
            @pagar="irAPagar"
          />
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
