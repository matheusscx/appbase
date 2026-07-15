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
      icon: 'i-lucide-circle-user',
      to: '/configuracion/perfil',
    },
  ]

  if (permissionsStore.esAdmin) {
    items.push(
      {
        label: 'Roles y permisos',
        icon: 'i-lucide-shield-check',
        to: '/configuracion/roles',
      },
      {
        label: 'Usuarios',
        icon: 'i-lucide-users',
        to: '/configuracion/usuarios',
      },
      {
        label: 'Empresa',
        icon: 'i-lucide-building-2',
        to: '/configuracion/empresa',
      },
      {
        label: 'Razones sociales',
        icon: 'i-lucide-file-text',
        to: '/configuracion/razones-sociales',
      },
      {
        label: 'Monedas',
        icon: 'i-lucide-dollar-sign',
        to: '/configuracion/monedas',
      },
      {
        label: 'Categorías',
        icon: 'i-lucide-tag',
        to: '/configuracion/categorias',
      },
      {
        label: 'Impuestos',
        icon: 'i-lucide-badge-percent',
        to: '/configuracion/impuestos',
      },
      {
        label: 'Descuentos',
        icon: 'i-lucide-trending-down',
        to: '/configuracion/descuentos',
      },
      {
        label: 'Recargos',
        icon: 'i-lucide-trending-up',
        to: '/configuracion/recargos',
      },
      {
        label: 'Preferencias',
        icon: 'i-lucide-sliders-horizontal',
        to: '/configuracion/preferencias-financieras',
      },
      {
        label: 'Métodos de pago',
        icon: 'i-lucide-credit-card',
        to: '/configuracion/metodos-pago',
      },
      {
        label: 'Causas de merma',
        icon: 'i-lucide-tags',
        to: '/configuracion/causas-merma',
      },
    )
  }

  if (permissionsStore.esAdmin || permissionsStore.can('Salones', 'Crear')) {
    items.push({
      label: 'Salones',
      icon: 'i-lucide-utensils',
      to: '/configuracion/salones',
    })
    items.push({
      label: 'Garzones',
      icon: 'i-lucide-users',
      to: '/configuracion/garzones',
    })
  }

  if (permissionsStore.esAdmin || permissionsStore.can('Impresoras', 'Crear')) {
    items.push({
      label: 'Impresoras',
      icon: 'i-lucide-printer',
      to: '/configuracion/impresoras',
    })
  }

  if (permissionsStore.esAdmin || permissionsStore.can('Items', 'Leer')) {
    items.push({
      label: 'Items',
      icon: 'i-lucide-archive',
      to: '/configuracion/items',
    })
  }

  if (permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Leer')) {
    items.push({
      label: 'Pasarelas',
      icon: 'i-lucide-plug-zap',
      to: '/configuracion/pasarelas',
    })
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
        <div class="w-52 border-r border-default shrink-0 py-3">
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
