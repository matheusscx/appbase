<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const authStore = useAuthStore()
const tenantStore = useTenantStore()

const items = computed<NavigationMenuItem[]>(() => {
  const base: NavigationMenuItem[] = [
    {
      label: 'Inicio',
      icon: 'i-heroicons-home',
      to: '/',
    },
    {
      label: 'Test',
      icon: 'i-heroicons-beaker',
      to: '/test',
    },
  ]
  if (authStore.isSuperadmin) {
    base.push({
      label: 'Administración',
      icon: 'i-heroicons-shield-check',
      to: '/admin',
    })
  }
  return base
})

const settingsItems = computed<NavigationMenuItem[]>(() => [
  {
    label: 'Configuración',
    icon: 'i-heroicons-cog-6-tooth',
    to: '/configuracion',
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
          <span v-if="!collapsed" class="font-semibold text-sm truncate">
            {{ tenantStore.activeTenant?.nombre ?? 'Prueba Técnica' }}
          </span>
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
          <UNavigationMenu
            :collapsed="collapsed"
            :items="settingsItems"
            orientation="vertical"
          />
          <!-- Tenant activo (cuando sidebar expandido) -->
          <div v-if="!collapsed && tenantStore.activeTenant" class="px-2 text-xs text-muted truncate flex items-center gap-1">
            <UIcon name="i-heroicons-building-office" class="w-3 h-3 shrink-0" />
            {{ tenantStore.activeTenant.nombre }}
          </div>
          <div v-if="!collapsed" class="px-2 text-xs text-muted truncate">
            {{ authStore.user?.nombre }}
          </div>
          <UButton
            :icon="collapsed ? 'i-heroicons-arrow-right-on-rectangle' : undefined"
            :label="collapsed ? undefined : 'Cerrar sesión'"
            color="neutral"
            variant="ghost"
            block
            @click="authStore.logout()"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
