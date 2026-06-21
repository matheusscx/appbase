<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const navItems: NavigationMenuItem[] = [
  {
    label: 'Perfil',
    icon: 'i-heroicons-user-circle',
    to: '/configuracion/perfil',
  },
]
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
