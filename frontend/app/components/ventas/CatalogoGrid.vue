<script setup lang="ts">
import type { ItemCatalogo } from '~/composables/useVenta'

const props = defineProps<{ items: ItemCatalogo[]; loading?: boolean }>()
const emit = defineEmits<{ add: [item: ItemCatalogo] }>()

const { esMonedaExtranjera, convertirAMonedaOficial, monedaOficial } = useMonedaConversion()
const { formatStock } = useFormatters()
const busqueda = ref('')

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter((i) => i.nombre.toLowerCase().includes(q))
})
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
          class="cursor-pointer hover:ring-2 hover:ring-primary transition h-full"
          :ui="{ body: 'h-full p-3 sm:p-4' }"
          @click="emit('add', item)"
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
