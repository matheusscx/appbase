<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ItemCatalogo } from '~/composables/useVenta'

const props = defineProps<{ items: ItemCatalogo[]; loading?: boolean }>()
const emit = defineEmits<{ add: [item: ItemCatalogo] }>()

const { esMonedaExtranjera, convertirAMonedaOficial, monedaOficial } = useMonedaConversion()
const { formatStock } = useFormatters()
const busqueda = ref('')

function tieneStock(item: ItemCatalogo): boolean {
  if (item.stock === null || item.stock === '') return false
  try {
    return new Decimal(item.stock).greaterThan(0)
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

/** Solo atenúa visualmente — no bloquea el click en recetas/combos. */
function sinStockVisual(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta' || item.tipo === 'combo') return item.disponible === 0
  return !tieneStock(item)
}

function compararCatalogo(a: ItemCatalogo, b: ItemCatalogo): number {
  const aConStock = sinStockVisual(a) ? 1 : 0
  const bConStock = sinStockVisual(b) ? 1 : 0
  if (aConStock !== bConStock) return aConStock - bConStock
  return a.nombre.localeCompare(b.nombre, 'es')
}

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  const list = q
    ? props.items.filter((i) => i.nombre.toLowerCase().includes(q))
    : props.items
  return [...list].sort(compararCatalogo)
})

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
    <div v-else-if="!filtrados.length" class="text-center text-muted py-10 text-sm">
      No hay ítems para mostrar.
    </div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 items-stretch p-1 pb-2">
        <UCard
          v-for="item in filtrados"
          :key="item.id"
          class="h-full transition"
          :class="[
            puedeAgregar(item) ? 'cursor-pointer hover:ring-2 hover:ring-primary' : 'cursor-not-allowed',
            sinStockVisual(item) ? 'opacity-50' : '',
          ]"
          :ui="{ body: 'h-full p-3 sm:p-4' }"
          :aria-disabled="!puedeAgregar(item)"
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
            <span v-if="item.tipo === 'producto'" class="text-xs text-muted shrink-0">
              Stock: {{ formatStock(item.stock, item.unidadMedida) }}
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
  </div>
</template>
