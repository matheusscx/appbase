<script setup lang="ts">
// Bloque "Pagos sin venta" de la zona "Ahora" (pendientes.md § 3, D). Es el
// aviso al admin de que la tienda online cobró y no pudo registrar la venta:
// la plata hay que devolverla, o registrar la venta a mano. Solo un número; la
// lista con el motivo de cada una vive en `/ordenes?sinVenta=true`.
//
// No tiene endpoint propio: lee el `meta.total` del listado del admin con el
// filtro `sinVenta`, así que el guard es el de esa ruta (`Pasarelas:Leer`). El
// permiso para montarlo lo decide `index.vue`; un tenant sin el módulo responde
// 403 y el bloque se oculta.

interface ListadoOrdenes {
  meta: { total: number }
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const { formatHora } = useFormatters()

const DESTINO = '/ordenes?sinVenta=true'

const { datos, actualizadoEl, sinConexion, oculto } = useRefrescoPeriodico(
  () => useApiFetch<ListadoOrdenes>(`${apiUrl}/pasarela/admin/ordenes?sinVenta=true&pageSize=1`),
)
</script>

<template>
  <UCard
    v-if="!oculto"
    as="a"
    :href="DESTINO"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
    @click.prevent="navigateTo(DESTINO)"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Pagos sin venta</span>
        <UIcon name="i-lucide-receipt-text" class="text-muted" />
      </div>
    </template>

    <div v-if="datos" data-qa="pagos-sin-venta-resumen">
      <p v-if="datos.meta.total === 0" class="text-sm text-muted">
        Ningún pago online sin venta.
      </p>
      <template v-else>
        <p class="text-2xl font-semibold text-warning" data-qa="pagos-sin-venta-total">
          {{ datos.meta.total }}
          <span class="text-sm font-normal text-muted">cobrados sin registrar</span>
        </p>
        <p class="mt-2 text-sm text-muted">
          Devolvé el cargo o registrá la venta a mano.
        </p>
      </template>
    </div>
    <p v-else class="text-sm text-muted">
      Cargando…
    </p>

    <UAlert
      v-if="sinConexion"
      color="warning"
      variant="subtle"
      icon="i-lucide-wifi-off"
      title="Sin conexión — se reintenta en el próximo ciclo"
      class="mt-3"
    />

    <template #footer>
      <p class="text-xs text-muted">
        Actualizado {{ formatHora(actualizadoEl) }}
      </p>
    </template>
  </UCard>
</template>
