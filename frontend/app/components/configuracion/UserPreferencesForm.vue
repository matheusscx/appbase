<script setup lang="ts">
import type { ColorModePreference, PageSizePreference } from '~/types/usuario-preferencias'
import { COLOR_MODE_OPTIONS, PAGE_SIZE_OPTIONS } from '~/types/usuario-preferencias'

const { pageSize, colorModePreference, setPageSize, setColorMode } = useUserPreferences()

const pageSizeModel = computed({
  get: () => pageSize.value,
  set: (value: PageSizePreference) => setPageSize(value),
})

const colorModeModel = computed({
  get: () => colorModePreference.value,
  set: (value: ColorModePreference) => setColorMode(value),
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-palette" class="w-5 h-5" />
        <span class="font-semibold">Apariencia</span>
      </div>
    </template>

    <div class="space-y-4">
      <UFormField label="Tema">
        <USelect
          v-model="colorModeModel"
          :items="COLOR_MODE_OPTIONS"
          value-key="value"
          class="w-48"
        />
      </UFormField>

      <UFormField
        label="Filas por página"
        description="Aplica en tablas con paginación (Pagos, Ventas, etc.)"
      >
        <USelect
          v-model="pageSizeModel"
          :items="PAGE_SIZE_OPTIONS"
          value-key="value"
          class="w-48"
        />
      </UFormField>
    </div>
  </UCard>
</template>
