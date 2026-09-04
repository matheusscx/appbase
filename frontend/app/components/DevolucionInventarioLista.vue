<script setup lang="ts">
import type { FilaDevolucion } from '~/composables/useDevolucionInventario'

withDefaults(
  defineProps<{
    filas: FilaDevolucion[]
    /** filasValidas del composable useDevolucionInventario */
    valida: boolean
    cargando?: boolean
    /**
     * Qué hace el camino que va a recibir estas líneas, que NO es lo mismo en
     * los dos modales que usan esta lista:
     *
     * - `'acredita'` — hay nota de crédito de por medio: **cualquier ítem
     *   vendido** entra, y volver al stock es una elección por línea.
     * - `'solo-stock'` — no hay documento (reembolso sin nota): ahí una línea
     *   que no repone no tiene nada que hacer y el backend la rechaza, así que
     *   no se ofrece.
     *
     * ⚠️ En el modal de reembolso el modo NO es fijo: depende del checkbox
     * "generar nota de crédito", así que cambia mientras el modal está abierto.
     */
    modo?: 'acredita' | 'solo-stock'
  }>(),
  { modo: 'solo-stock' },
)
const emit = defineEmits<{
  setCantidad: [itemId: string, valor: string]
  setReponer: [itemId: string, valor: boolean]
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-sm text-muted">{{
      modo === 'acredita' ? 'Acreditar ítems de la venta (opcional)' : 'Devolver a inventario (opcional)'
    }}</span>
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
            <template v-if="modo === 'solo-stock' && notaDevolucion(fila)">
              {{ notaDevolucion(fila) }}
            </template>
            <template v-else>Disponible: {{ fila.disponible }}</template>
          </p>
        </div>

        <!-- Solo con nota de crédito: sin documento no hay nada que elegir,
             porque la línea que no repone directamente no va. -->
        <USwitch
          v-if="modo === 'acredita'"
          :model-value="fila.reponerStock"
          :disabled="!fila.puedeReponer"
          :label="fila.puedeReponer ? 'Vuelve al stock' : notaDevolucion(fila) ?? 'No vuelve al stock'"
          :ui="{ label: 'text-xs text-muted' }"
          @update:model-value="emit('setReponer', fila.itemId, $event)"
        />

        <UInput
          :model-value="fila.cantidad"
          inputmode="decimal"
          placeholder="0"
          class="w-24"
          :disabled="!filaEditable(fila, modo)"
          @update:model-value="emit('setCantidad', fila.itemId, String($event ?? ''))"
        />
      </div>
    </div>
    <p v-if="!valida" class="text-xs text-error">
      Las cantidades deben ser numéricas y no superar lo disponible por ítem.
    </p>
  </div>
</template>
