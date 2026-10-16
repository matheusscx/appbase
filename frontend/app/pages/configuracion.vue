<script setup lang="ts">
import type { NavigationMenuItem, SelectMenuItem } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const permissionsStore = usePermissionsStore()
const route = useRoute()

onMounted(() => {
  if (!permissionsStore.permisos.length && !permissionsStore.loading)
    permissionsStore.fetchPermisos()
})

// Los grupos y el gate de cada entrada viven en `useMenuConfiguracion`: los comparte el índice.
const grupos = useMenuConfiguracion()

const navItems = computed<NavigationMenuItem[][]>(() =>
  grupos.value.map(g => [
    { label: g.label, type: 'label' as const },
    ...g.items.map(({ label, icon, to }) => ({ label, icon, to })),
  ]),
)

// En una pantalla angosta (tablet) el menú de 240 px se come la mitad del ancho: pasa a un selector
// arriba y el contenido ocupa todo (auditoría UX 07.1 / 07.5).
const itemsSelector = computed<SelectMenuItem[][]>(() =>
  grupos.value.map(g => [
    { type: 'label' as const, label: g.label },
    ...g.items.map(({ label, icon, to }) => ({ label, icon, value: to })),
  ]),
)

// El menú mide más que la pantalla y se desliza solo: la entrada activa tiene que quedar a la vista,
// si no el dueño no ve en qué parte del menú está (auditoría UX 07.4).
const menu = ref<HTMLElement | null>(null)
const contenido = ref<HTMLElement | null>(null)
async function mostrarEntradaActiva() {
  await nextTick()
  menu.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
}
onMounted(mostrarEntradaActiva)
watch(() => [route.path, grupos.value.length], mostrarEntradaActiva)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar :title="route.path === '/configuracion/perfil' ? 'Mi cuenta' : 'Configuración'" />
    </template>

    <template #body>
      <!-- El menú y el de la barra lateral van antes del contenido: sin este salto eran 31 Tab hasta
           el primer botón (auditoría UX 07.26). -->
      <a
        href="#configuracion-contenido"
        class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-default focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-primary"
        data-qa="saltar-al-contenido"
        @click.prevent="contenido?.focus()"
      >
        Saltar al contenido
      </a>
      <div class="flex h-full flex-col lg:flex-row">
        <div class="shrink-0 pb-4 lg:hidden" data-qa="configuracion-selector">
          <USelectMenu
            :model-value="route.path"
            :items="itemsSelector"
            value-key="value"
            placeholder="Ir a…"
            class="w-full"
            size="lg"
            @update:model-value="(destino: unknown) => navigateTo(String(destino))"
          />
        </div>
        <div
          ref="menu"
          class="hidden w-60 shrink-0 overflow-y-auto border-r border-default py-3 lg:block"
          data-qa="configuracion-menu"
        >
          <UNavigationMenu
            :items="navItems"
            orientation="vertical"
            :ui="{ linkLabel: 'whitespace-normal text-clip', link: 'min-h-11' }"
          />
        </div>
        <div
          id="configuracion-contenido"
          ref="contenido"
          tabindex="-1"
          class="min-w-0 flex-1 overflow-y-auto p-6 focus:outline-none"
        >
          <NuxtPage />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
