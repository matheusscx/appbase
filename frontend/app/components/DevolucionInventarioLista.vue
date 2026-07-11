<script setup lang="ts">
import type { FilaDevolucion } from '~/composables/useDevolucionInventario'

defineProps<{
  filas: FilaDevolucion[]
  /** filasValidas del composable useDevolucionInventario */
  valida: boolean
  cargando?: boolean
}>()
const emit = defineEmits<{ setCantidad: [itemId: string, valor: string] }>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-sm text-muted">Devolver a inventario (opcional)</span>
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
        class="flex items-center justify-between gap-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm">{{ fila.descripcion }}</p>
          <p class="text-xs text-muted">
            <template v-if="notaDevolucion(fila)">{{ notaDevolucion(fila) }}</template>
            <template v-else>Disponible: {{ fila.disponible }}</template>
          </p>
        </div>
        <UInput
          :model-value="fila.cantidad"
          inputmode="decimal"
          placeholder="0"
          class="w-24"
          :disabled="!filaDevolvible(fila)"
          @update:model-value="emit('setCantidad', fila.itemId, String($event ?? ''))"
        />
      </div>
    </div>
    <p v-if="!valida" class="text-xs text-error">
      Las cantidades deben ser numéricas y no superar lo disponible por ítem.
    </p>
  </div>
</template>
