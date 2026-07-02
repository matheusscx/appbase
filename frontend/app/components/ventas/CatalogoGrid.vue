<script setup lang="ts">
import type { ItemCatalogo } from '~/composables/useVenta'

const props = defineProps<{ items: ItemCatalogo[]; loading?: boolean }>()
const emit = defineEmits<{ add: [item: ItemCatalogo] }>()

const { formatMonto } = useFormatters()
const busqueda = ref('')

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter((i) => i.nombre.toLowerCase().includes(q))
})
</script>

<template>
  <div class="flex flex-col gap-4 h-full">
    <UInput
      v-model="busqueda"
      icon="i-lucide-search"
      placeholder="Buscar ítem..."
      size="lg"
    />

    <div v-if="loading" class="text-center text-muted py-10 text-sm">
      Cargando catálogo...
    </div>
    <div v-else-if="!filtrados.length" class="text-center text-muted py-10 text-sm">
      No hay ítems para mostrar.
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto p-1">
      <UCard
        v-for="item in filtrados"
        :key="item.id"
        class="cursor-pointer hover:ring-2 hover:ring-primary transition"
        @click="emit('add', item)"
      >
        <div class="flex flex-col gap-1">
          <span class="font-medium text-sm text-default truncate">{{ item.nombre }}</span>
          <span class="text-highlighted font-semibold text-sm font-mono">
            {{ formatMonto(item.precioBase, item.monedaId) }}
          </span>
          <span v-if="item.tipo === 'producto'" class="text-xs text-muted">
            Stock: {{ item.stock ?? '0' }}
          </span>
        </div>
      </UCard>
    </div>
  </div>
</template>
