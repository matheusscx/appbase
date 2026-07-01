<script setup lang="ts" generic="T">
import type { TableColumn } from '@nuxt/ui'

defineProps<{
  data: T[]
  columns: TableColumn<T>[]
  loading?: boolean
}>()
</script>

<template>
  <UCard>
    <UTable
      :data="data"
      :columns="columns"
      :loading="loading"
      v-bind="$attrs"
    >
      <template
        v-for="(_, slotName) in $slots"
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
  </UCard>
</template>
