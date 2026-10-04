<script setup lang="ts">
import type { DestinoStock, FilaDevolucion } from '~/composables/useDevolucionInventario'

defineProps<{
  filas: FilaDevolucion[]
  /** filasValidas del composable useDevolucionInventario */
  valida: boolean
  /** faltaDestino del composable: alguna fila a devolver sin contestar la pregunta */
  faltaDestino?: boolean
  cargando?: boolean
}>()
const emit = defineEmits<{
  setCantidad: [itemId: string, valor: string]
  setStock: [itemId: string, valor: DestinoStock]
}>()

/**
 * "¿Vuelve al stock o se perdió?" (owner, 2026-08-23): siempre que la línea
 * sacó algo del inventario —el producto suelto, la receta, el combo—, sin
 * opción elegida de antemano. En serie/lote solo se puede perder acá.
 */
function opcionesStock(fila: FilaDevolucion) {
  return [
    { label: 'Vuelve al stock', value: 'recupera', disabled: fila.devolucionStock === 'solo_perdida' },
    { label: 'Se perdió', value: 'pierde' },
  ]
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-sm text-muted">Acreditar ítems de la venta (opcional)</span>
    <div v-if="cargando" class="text-sm text-muted">
      Cargando líneas de la venta…
    </div>
    <div v-else-if="!filas.length" class="text-sm text-muted">
      La venta no tiene líneas para devolver.
    </div>
    <div v-else class="flex flex-col divide-y divide-default">
      <div
        v-for="fila in filas"
        :key="fila.itemId"
        class="flex flex-col gap-2 py-2"
        :data-testid="`devolucion-fila-${fila.itemId}`"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{{ fila.descripcion }}</p>
            <p class="text-xs text-muted">
              Disponible: {{ fila.disponible }}
            </p>
          </div>

          <UInput
            :model-value="fila.cantidad"
            inputmode="decimal"
            placeholder="0"
            class="w-24"
            :disabled="!filaAcreditable(fila)"
            @update:model-value="emit('setCantidad', fila.itemId, String($event ?? ''))"
          />
        </div>

        <div v-if="fila.devolucionStock !== 'sin_stock'" class="flex flex-col gap-1">
          <URadioGroup
            :model-value="fila.stock ?? undefined"
            :items="opcionesStock(fila)"
            orientation="horizontal"
            size="xs"
            :aria-label="`¿${fila.descripcion} vuelve al stock o se perdió?`"
            @update:model-value="emit('setStock', fila.itemId, $event as DestinoStock)"
          />
          <p v-if="notaDevolucion(fila)" class="text-xs text-muted">
            {{ notaDevolucion(fila) }}
          </p>
          <p v-if="fila.stock === 'pierde'" class="text-xs text-muted">
            Sale como merma «Devolución».
          </p>
        </div>
        <p v-else class="text-xs text-muted">
          {{ notaDevolucion(fila) }}
        </p>
      </div>
    </div>
    <p v-if="!valida" class="text-xs text-error">
      Las cantidades deben ser numéricas y no superar lo disponible por ítem.
    </p>
    <p v-if="faltaDestino" class="text-xs text-warning">
      Falta decir, en cada ítem que se devuelve, si vuelve al stock o se perdió.
    </p>
  </div>
</template>
