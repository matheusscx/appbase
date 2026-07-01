<script setup lang="ts">
import type { ColorModePreference, PageSizePreference } from '~/types/usuario-preferencias'
import { PAGE_SIZE_OPTIONS } from '~/types/usuario-preferencias'

const authStore = useAuthStore()
const { pageSize, colorModePreference, setPageSize, setColorMode } = useUserPreferences()
const colorMode = useColorMode()

const pageSizeModel = computed({
  get: () => pageSize.value,
  set: (value: PageSizePreference) => setPageSize(value),
})

watch(
  () => colorMode.preference,
  (pref) => {
    if (!authStore.user) return
    if (pref !== 'system' && pref !== 'light' && pref !== 'dark') return
    if (pref === colorModePreference.value) return
    setColorMode(pref as ColorModePreference)
  },
)
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
        <ClientOnly>
          <UColorModeSelect class="w-48" />
          <template #fallback>
            <USkeleton class="h-10 w-48" />
          </template>
        </ClientOnly>
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
