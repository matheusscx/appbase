<script setup lang="ts">
// Bloque "Stock bajo" de la zona "Ahora" (`docs/features/aviso-stock-bajo.md`).
// Contesta "¿tengo que hacer algo antes de abrir?", así que NO es una lista:
// un número y hasta 4 ubicaciones, las más afectadas. La propiedad a sostener
// es que no crezca — si hay 40 productos abajo, el bloque ocupa lo mismo; la
// lista completa vive en `/inventario/stock-minimo`. El permiso
// (`Inventario:Leer`) lo decide `index.vue`, que solo monta este componente si
// corresponde. Lo que ya tiene una compra en borrador no cuenta: el backend lo
// saca del número.

interface StockBajoResumen {
  total: number
  porUbicacion: { ubicacionId: string, ubicacionNombre: string, cantidad: number }[]
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const { formatHora } = useFormatters()

const { datos, actualizadoEl, sinConexion, oculto } = useRefrescoPeriodico(
  () => useApiFetch<StockBajoResumen>(`${apiUrl}/inventario/stock-bajo/resumen`),
)
</script>

<template>
  <UCard
    v-if="!oculto"
    as="a"
    href="/inventario/stock-minimo?soloBajoMinimo=true"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
    @click.prevent="navigateTo('/inventario/stock-minimo?soloBajoMinimo=true')"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Stock bajo</span>
        <UIcon name="i-lucide-package-minus" class="text-muted" />
      </div>
    </template>

    <div v-if="datos" data-qa="stock-bajo-resumen">
      <p v-if="datos.total === 0" class="text-sm text-muted">
        Nada bajo el mínimo.
      </p>
      <template v-else>
        <p class="text-2xl font-semibold text-warning" data-qa="stock-bajo-total">
          {{ datos.total }}
          <span class="text-sm font-normal text-muted">bajo el mínimo</span>
        </p>
        <ul class="mt-2 space-y-1">
          <li
            v-for="u in datos.porUbicacion"
            :key="u.ubicacionId"
            class="flex items-center justify-between gap-2 text-sm"
            data-qa="stock-bajo-ubicacion"
          >
            <span class="text-default truncate">{{ u.ubicacionNombre }}</span>
            <span class="text-muted">{{ u.cantidad }}</span>
          </li>
        </ul>
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
