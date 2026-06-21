<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const permissionsStore = usePermissionsStore()

onMounted(() => {
  if (!permissionsStore.permisos.length && !permissionsStore.loading)
    permissionsStore.fetchPermisos()
})

const navItems = computed<NavigationMenuItem[]>(() => {
  const items: NavigationMenuItem[] = [
    {
      label: 'Perfil',
      icon: 'i-heroicons-user-circle',
      to: '/configuracion/perfil',
    },
  ]

  if (permissionsStore.esAdmin) {
    items.push(
      {
        label: 'Roles y permisos',
        icon: 'i-heroicons-shield-check',
        to: '/configuracion/roles',
      },
      {
        label: 'Usuarios',
        icon: 'i-heroicons-users',
        to: '/configuracion/usuarios',
      },
    )
  }

  return items
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Configuración" />
    </template>

    <template #body>
      <div class="flex h-full">
        <div class="w-52 border-r shrink-0 py-3">
          <UNavigationMenu
            :items="navItems"
            orientation="vertical"
          />
        </div>
        <div class="flex-1 overflow-y-auto p-6">
          <NuxtPage />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
