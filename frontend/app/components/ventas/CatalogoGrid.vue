<script setup lang="ts">
import Decimal from 'decimal.js'
import { stockPedible, type ItemCatalogo } from '~/composables/useVenta'

defineProps<{ items: ItemCatalogo[]; loading?: boolean; total: number; pageSize: number }>()
const emit = defineEmits<{ add: [item: ItemCatalogo] }>()

const { esMonedaExtranjera, convertirAMonedaOficial, monedaOficial } = useMonedaConversion()
const { formatStock } = useFormatters()
// El servidor busca, ordena (`orden=disponibilidad`) y pagina: la grilla solo pinta.
const busqueda = defineModel<string>('busqueda', { default: '' })
const page = defineModel<number>('page', { default: 1 })

/**
 * Mide sobre lo que todavía se puede pedir, no sobre el stock físico: desde el
 * 2026-09-01 lo que las mesas abiertas pidieron ya está apartado, y atenuar por
 * `stock` mostraba como vendible la última unidad que otra mesa ya se llevó —el
 * garzón se enteraba recién con el 400 del pedido.
 */
function tieneStock(item: ItemCatalogo): boolean {
  const pedible = stockPedible(item)
  if (pedible === null || pedible === '') return false
  try {
    return new Decimal(pedible).greaterThan(0)
  }
  catch {
    return false
  }
}

/** Recetas y combos nunca bloquean el click: la validación real vive en el backend. */
function puedeAgregar(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta' || item.tipo === 'combo') return true
  return tieneStock(item)
}

/**
 * Solo atenúa visualmente — no bloquea el click en recetas/combos.
 *
 * `<= 0` y no `=== 0`: desde el 2026-09-01 `disponible` es `stock − comprometido`
 * y **puede ser negativo** (un ingrediente no bloqueante se pasa del stock,
 * § 4.2 de
 * `docs/superpowers/specs/2026-09-01-reserva-de-stock-al-pedir-design.md`). Con
 * `=== 0`, un plato en −2 no se atenuaba y se veía mejor que el de cero, siendo
 * el peor de los tres estados (el orden ya no se decide acá: lo pone el servidor,
 * `backend/src/modules/items/catalogo-orden.ts`, con el mismo `<= 0`). El `?? 1`
 * deja intacto el `null`, que significa "no hay bloqueantes que limiten" y no es
 * falta de stock.
 */
function sinStockVisual(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta' || item.tipo === 'combo') return (item.disponible ?? 1) <= 0
  return !tieneStock(item)
}

function onAgregar(item: ItemCatalogo) {
  if (!puedeAgregar(item)) return
  emit('add', item)
}
</script>

<template>
  <div class="flex flex-col gap-4 h-full min-h-0 overflow-hidden">
    <UInput
      v-model="busqueda"
      icon="i-lucide-search"
      placeholder="Buscar ítem..."
      size="lg"
      class="shrink-0"
    />

    <div v-if="loading" class="text-center text-muted py-10 text-sm">
      Cargando catálogo...
    </div>
    <div v-else-if="!items.length" class="text-center text-muted py-10 text-sm">
      No hay ítems para mostrar.
    </div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 items-stretch p-1 pb-2">
        <!-- El orden lo pone el servidor (`orden=disponibilidad`): no reordenar acá. -->
        <UCard
          v-for="item in items"
          :key="item.id"
          class="h-full transition"
          :class="[
            puedeAgregar(item) ? 'cursor-pointer hover:ring-2 hover:ring-primary' : 'cursor-not-allowed',
            sinStockVisual(item) ? 'opacity-50' : '',
          ]"
          :ui="{ body: 'h-full p-3 sm:p-4' }"
          :aria-disabled="!puedeAgregar(item)"
          :data-qa="`item-catalogo-${item.id}`"
          @click="onAgregar(item)"
        >
          <div class="flex flex-col h-full gap-1">
            <span class="font-medium text-sm text-default truncate shrink-0">{{ item.nombre }}</span>
            <VentasPrecioItem
              :monto="item.precioBase"
              :moneda-id="item.monedaId"
              highlight
            />
            <div
              v-if="esMonedaExtranjera(item.monedaId) && monedaOficial"
              class="min-h-5 flex items-center shrink-0"
            >
              <VentasPrecioItem
                :monto="convertirAMonedaOficial(item.precioBase, item.monedaId)"
                :moneda-id="monedaOficial.monedaId"
                muted
              />
            </div>
            <!-- "Disponible" y ya no "Stock": el número dejó de ser lo que hay en
                 la bodega y pasó a ser lo que todavía se puede pedir. Con dos mesas
                 abiertas los dos difieren, y la etiqueta vieja convertía la
                 diferencia en un "el sistema está mal" — el garzón cuenta tres
                 botellas en el refrigerador y la tarjeta decía "Stock: 1". -->
            <span v-if="item.tipo === 'producto'" class="text-xs text-muted shrink-0">
              Disponible: {{ formatStock(stockPedible(item), item.unidadMedida) }}
            </span>
            <span v-else-if="item.tipo === 'combo' && item.disponibleCondicional" class="text-xs text-muted shrink-0">
              <UTooltip text="La disponibilidad final depende de la opción elegida">
                <span class="inline-flex items-center gap-1 cursor-help">
                  Disponible*
                  <UIcon name="i-lucide-info" class="size-3" />
                </span>
              </UTooltip>
            </span>
            <span v-else-if="(item.tipo === 'receta' || item.tipo === 'combo') && item.disponible !== null && item.disponible !== undefined" class="text-xs text-muted shrink-0">
              Disponibles: {{ item.disponible }}
            </span>
            <div
              v-if="!esMonedaExtranjera(item.monedaId)"
              class="min-h-5 shrink-0"
              aria-hidden="true"
            />
          </div>
        </UCard>
      </div>
    </div>

    <!-- `sibling-count` 1 y el scroll horizontal: con los 2 vecinos por defecto más los
         controles la fila no entra a 375 px, y el contenedor de arriba recorta. -->
    <div v-if="total > pageSize" class="flex justify-center shrink-0 min-w-0 overflow-x-auto">
      <UPagination
        v-model:page="page"
        :items-per-page="pageSize"
        :sibling-count="1"
        :total="total"
      />
    </div>
  </div>
</template>
