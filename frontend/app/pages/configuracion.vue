<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const permissionsStore = usePermissionsStore()

onMounted(() => {
  if (!permissionsStore.permisos.length && !permissionsStore.loading)
    permissionsStore.fetchPermisos()
})

// Agrupado por lo que configura, en el orden en que se arma un local (owner,
// 2026-10-02). Cada entrada lleva su propio gate —el de la ruta, exacto—, y un
// grupo sin entradas visibles se saca entero: el menú dibuja el separador y el
// encabezado aunque la lista venga vacía.
const navItems = computed<NavigationMenuItem[][]>(() => {
  const admin = permissionsStore.esAdmin
  // `Leer`, no `Crear`: lo que la pantalla pide para abrirse es el permiso de
  // lectura. Con `Crear` el link quedaba escondido para quien solo tiene
  // `Actualizar` o `Eliminar` —que sí puede trabajar ahí—, el mismo colapso de
  // permisos que los gates por control vienen a evitar.
  const lee = (modulo: string) => admin || permissionsStore.can(modulo, 'Leer')

  const grupos: { label: string, items: (NavigationMenuItem | false)[] }[] = [
    {
      label: 'Mi cuenta',
      items: [
        { label: 'Perfil', icon: 'i-lucide-circle-user', to: '/configuracion/perfil' },
      ],
    },
    {
      label: 'Organización',
      items: [
        admin && { label: 'Empresa', icon: 'i-lucide-building-2', to: '/configuracion/empresa' },
        admin && { label: 'Razones sociales', icon: 'i-lucide-file-text', to: '/configuracion/razones-sociales' },
        admin && { label: 'Usuarios', icon: 'i-lucide-users', to: '/configuracion/usuarios' },
        admin && { label: 'Roles y permisos', icon: 'i-lucide-shield-check', to: '/configuracion/roles' },
      ],
    },
    {
      label: 'Catálogo',
      items: [
        lee('Items') && { label: 'Items', icon: 'i-lucide-archive', to: '/configuracion/items' },
        admin && { label: 'Categorías', icon: 'i-lucide-tag', to: '/configuracion/categorias' },
        admin && { label: 'Grupos de modificadores', icon: 'i-lucide-list-plus', to: '/configuracion/grupos-modificadores' },
      ],
    },
    {
      label: 'Precios',
      items: [
        admin && { label: 'Preferencias', icon: 'i-lucide-sliders-horizontal', to: '/configuracion/preferencias-financieras' },
        admin && { label: 'Impuestos', icon: 'i-lucide-badge-percent', to: '/configuracion/impuestos' },
        admin && { label: 'Descuentos', icon: 'i-lucide-trending-down', to: '/configuracion/descuentos' },
        admin && { label: 'Recargos', icon: 'i-lucide-trending-up', to: '/configuracion/recargos' },
        admin && { label: 'Promociones', icon: 'i-lucide-megaphone', to: '/configuracion/promociones' },
        admin && { label: 'Monedas', icon: 'i-lucide-dollar-sign', to: '/configuracion/monedas' },
      ],
    },
    {
      label: 'Cobros',
      items: [
        admin && { label: 'Métodos de pago', icon: 'i-lucide-credit-card', to: '/configuracion/metodos-pago' },
        lee('Pasarelas') && { label: 'Pasarelas', icon: 'i-lucide-plug-zap', to: '/configuracion/pasarelas' },
      ],
    },
    {
      label: 'Caja',
      items: [
        lee('Cajas') && { label: 'Cajas', icon: 'i-lucide-inbox', to: '/configuracion/cajas' },
        admin && { label: 'Motivos de diferencia', icon: 'i-lucide-scale', to: '/configuracion/motivos-diferencia' },
      ],
    },
    {
      label: 'Inventario',
      items: [
        admin && { label: 'Ubicaciones', icon: 'i-lucide-warehouse', to: '/configuracion/ubicaciones' },
        admin && { label: 'Motivos de baja', icon: 'i-lucide-tags', to: '/configuracion/motivos-baja' },
        admin && { label: 'Motivos de diferencia', icon: 'i-lucide-clipboard-check', to: '/configuracion/motivos-diferencia-inventario' },
        admin && { label: 'Motivos de traslado', icon: 'i-lucide-truck', to: '/configuracion/motivos-traslado' },
      ],
    },
    {
      label: 'Restaurante',
      items: [
        lee('Salones') && { label: 'Salones', icon: 'i-lucide-utensils', to: '/configuracion/salones' },
        lee('Salones') && { label: 'Garzones', icon: 'i-lucide-users', to: '/configuracion/garzones' },
        lee('Salones') && { label: 'Turnos', icon: 'i-lucide-clock-3', to: '/configuracion/turnos' },
        (lee('Propinas') || permissionsStore.can('Propinas', 'Configurar'))
        && { label: 'Propinas', icon: 'i-lucide-hand-coins', to: '/configuracion/propinas-distribucion' },
        lee('Impresoras') && { label: 'Impresoras', icon: 'i-lucide-printer', to: '/configuracion/impresoras' },
      ],
    },
  ]

  return grupos
    .map(g => ({ label: g.label, items: g.items.filter(i => i !== false) }))
    .filter(g => g.items.length > 0)
    .map(g => [{ label: g.label, type: 'label' as const }, ...g.items])
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Configuración" />
    </template>

    <template #body>
      <div class="flex h-full">
        <div class="w-60 border-r border-default shrink-0 py-3 overflow-y-auto">
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
