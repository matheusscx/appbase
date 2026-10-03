<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const authStore = useAuthStore()
const tenantStore = useTenantStore()
const permissionsStore = usePermissionsStore()
const monedasStore = useMonedasStore()
const { items, gruposAbiertos } = useMenuLateral()

// Tras F5 o reapertura del navegador, Pinia pierde permisos en memoria.
// Cargarlos al montar el layout (solo cliente) para poblar el menú lateral.
onMounted(async () => {
  const tasks: Promise<void>[] = []
  if (!permissionsStore.permisos.length && !permissionsStore.loading) {
    tasks.push(permissionsStore.fetchPermisos())
  }
  if (!monedasStore.isLoaded && !monedasStore.loading) {
    tasks.push(monedasStore.ensureLoaded())
  }
  await Promise.all(tasks)
})

const settingsItems = computed<NavigationMenuItem[]>(() => [
  {
    label: 'Configuración',
    icon: 'i-lucide-settings',
    to: '/configuracion/perfil',
    active: route.path.startsWith('/configuracion'),
  },
  {
    label: 'Cerrar sesión',
    icon: 'i-lucide-log-out',
    onSelect: () => authStore.logout(),
  },
])
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable>
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 px-1">
          <div class="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-zap" class="text-white w-4 h-4" />
          </div>
          <ClientOnly>
            <span v-if="!collapsed" class="font-semibold text-sm truncate">
              {{ tenantStore.activeTenant?.nombre ?? 'Prueba Técnica' }}
            </span>
          </ClientOnly>
        </div>
      </template>

      <template #default="{ collapsed }">
        <div class="flex flex-1 flex-col min-h-full gap-4">
          <UNavigationMenu
            v-model="gruposAbiertos"
            :collapsed="collapsed"
            :items="items"
            orientation="vertical"
            type="multiple"
            popover
            data-qa="menu-lateral"
          />
          <UNavigationMenu
            class="mt-auto"
            :collapsed="collapsed"
            :items="settingsItems"
            orientation="vertical"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
