<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const authStore = useAuthStore()
const tenantStore = useTenantStore()
const permissionsStore = usePermissionsStore()

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
  if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'Leer')) {
    base.push({
      label: 'Caja',
      icon: 'i-heroicons-banknotes',
      to: '/caja',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Ventas', 'Leer')) {
    base.push({
      label: 'Ventas',
      icon: 'i-heroicons-document-text',
      to: '/ventas',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Ventas', 'Leer')) {
    base.push({
      label: 'Pagos',
      icon: 'i-heroicons-credit-card',
      to: '/pagos',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Ventas', 'Crear')) {
    base.push({
      label: 'Punto de venta',
      icon: 'i-heroicons-shopping-cart',
      to: '/ventas/pos',
    })
  }
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
          <ClientOnly>
            <span v-if="!collapsed" class="font-semibold text-sm truncate">
              {{ tenantStore.activeTenant?.nombre ?? 'Prueba Técnica' }}
            </span>
          </ClientOnly>
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
