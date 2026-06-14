<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const store = useAuthStore()

const items = computed<NavigationMenuItem[]>(() => [
  {
    label: 'Inicio',
    icon: 'i-heroicons-home',
    to: '/',
  },
])
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable>
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 px-1">
          <div class="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
            <UIcon name="i-heroicons-bolt" class="text-white w-4 h-4" />
          </div>
          <span v-if="!collapsed" class="font-semibold text-sm truncate">Prueba Técnica</span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="items"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex flex-col gap-2">
          <div v-if="!collapsed" class="px-2 text-xs text-muted truncate">
            {{ store.user?.email }}
          </div>
          <UButton
            :icon="collapsed ? 'i-heroicons-arrow-right-on-rectangle' : undefined"
            :label="collapsed ? undefined : 'Cerrar sesión'"
            color="neutral"
            variant="ghost"
            block
            @click="store.logout()"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
