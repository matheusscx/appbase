<script setup lang="ts" generic="T">
import type { TableColumn } from '@nuxt/ui'

defineProps<{
  data: T[]
  columns: TableColumn<T>[]
  loading?: boolean
}>()

const tableSlots = computed(() => {
  const slots = useSlots()
  return Object.keys(slots).filter(name => name !== 'footer')
})
</script>

<template>
  <UCard class="w-full">
    <UTable
      :data="data"
      :columns="columns"
      :loading="loading"
      v-bind="$attrs"
    >
      <template
        v-for="slotName in tableSlots"
        #[slotName]="slotProps"
      >
        <slot
          :name="slotName"
          v-bind="slotProps ?? {}"
        />
      </template>
      <template v-if="!$slots.empty" #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay registros.
        </div>
      </template>
    </UTable>

    <div
      v-if="$slots.footer"
      class="flex justify-end border-t border-default pt-4"
    >
      <slot name="footer" />
    </div>
  </UCard>
</template>
