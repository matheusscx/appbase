<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const authStore = useAuthStore()
const tenantStore = useTenantStore()
const permissionsStore = usePermissionsStore()
const monedasStore = useMonedasStore()

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

const items = computed<NavigationMenuItem[]>(() => {
  const base: NavigationMenuItem[] = [
    {
      label: 'Inicio',
      icon: 'i-lucide-house',
      to: '/',
    },
  ]
  if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'Leer')) {
    base.push({
      label: 'Caja',
      icon: 'i-lucide-banknote',
      to: '/caja',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Ventas', 'Leer')) {
    base.push({
      label: 'Ventas',
      icon: 'i-lucide-file-text',
      to: '/ventas',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Pagos', 'Leer')) {
    base.push({
      label: 'Pagos',
      icon: 'i-lucide-credit-card',
      to: '/pagos',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Propinas', 'Leer')) {
    base.push({
      label: 'Propinas',
      icon: 'i-lucide-hand-coins',
      to: '/propinas/liquidaciones',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Ventas', 'Crear')) {
    base.push({
      label: 'Punto de venta',
      icon: 'i-lucide-shopping-cart',
      to: '/ventas/pos',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Salones', 'Operar')) {
    base.push({
      label: 'Salones',
      icon: 'i-lucide-utensils',
      to: '/salones',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Salones', 'Leer')) {
    base.push({
      label: 'Sesiones',
      icon: 'i-lucide-timer',
      to: '/sesiones-garzon',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Tienda Online', 'Leer')) {
    base.push({
      label: 'Tienda Online',
      icon: 'i-lucide-store',
      to: '/tienda',
    })
    base.push({
      label: 'Mis suscripciones',
      icon: 'i-lucide-repeat',
      to: '/tienda/suscripciones',
    })
    base.push({
      label: 'Medios de pago',
      icon: 'i-lucide-wallet',
      to: '/tienda/medios-pago',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Suscripciones', 'Leer')) {
    base.push({
      label: 'Suscripciones',
      icon: 'i-lucide-repeat-2',
      to: '/suscripciones',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Terceros', 'Leer')) {
    base.push({
      label: 'Terceros',
      icon: 'i-lucide-contact',
      to: '/terceros',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Inventario', 'Leer')) {
    base.push({
      label: 'Inventario',
      icon: 'i-lucide-clipboard-list',
      to: '/inventario',
    })
    base.push({
      label: 'Mermas',
      icon: 'i-lucide-trash-2',
      to: '/mermas',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Items', 'Leer')) {
    base.push({
      label: 'Recetas desfasadas',
      icon: 'i-lucide-scale',
      to: '/recetas-desfases',
    })
  }
  if (permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Leer')) {
    base.push({
      label: 'Órdenes',
      icon: 'i-lucide-receipt',
      to: '/ordenes',
    })
  }
  if (authStore.isSuperadmin) {
    base.push({
      label: 'Administración',
      icon: 'i-lucide-shield-check',
      to: '/admin',
    })
  }
  return base
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
            :collapsed="collapsed"
            :items="items"
            orientation="vertical"
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
