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
  <AppCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-palette" class="w-5 h-5" />
        <span class="font-semibold">Apariencia</span>
      </div>
    </template>

    <div class="space-y-2">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UFormField label="Tema">
          <USelect
            v-model="colorModeModel"
            :items="COLOR_MODE_OPTIONS"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Filas por página">
          <template #label>
            <span class="inline-flex items-center gap-1">
              Filas por página
              <AppInfoButton
                title="Filas por página"
                text="Cantidad de registros visibles por página en tablas con paginación, como Pagos y Ventas."
              />
            </span>
          </template>
          <USelect
            v-model="pageSizeModel"
            :items="PAGE_SIZE_OPTIONS"
            value-key="value"
            class="w-full"
          />
        </UFormField>
      </div>
    </div>
  </AppCard>
</template>
