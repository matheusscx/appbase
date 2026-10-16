<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const authStore = useAuthStore()
const tenantStore = useTenantStore()
const permissionsStore = usePermissionsStore()
const monedasStore = useMonedasStore()
const { items, gruposAbiertos } = useMenuLateral()

const nombreLocal = computed(() => tenantStore.activeTenant?.nombre ?? 'Venka')

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

// El menú lateral es petróleo (spec 2026-10-13-identidad-venka-en-app §3.4). En vez de pisar
// cada slot y cada estado de `UNavigationMenu` (activo, hover, ícono, foco, hijas, separadores),
// se reasignan los tokens semánticos **dentro** del lateral a la escala clara de la marca: así
// los estados del componente salen solos sobre petróleo y el popover del menú colapsado, que
// Reka monta fuera del lateral, conserva los tokens del tema y se lee sobre fondo claro.
// Va en `root` (escritorio) y en `content` (panel de celular): son dos árboles distintos.
// `bg-primary-500` y no `bg-primary`: el tono fijo no cambia si algún día hay modo oscuro.
const sobrePetroleo = [
  'bg-primary-500',
  '[--ui-text-dimmed:var(--ui-color-primary-200)]',
  '[--ui-text-muted:var(--ui-color-primary-100)]',
  '[--ui-text-toned:var(--ui-color-primary-100)]',
  '[--ui-text:var(--ui-color-primary-50)]',
  '[--ui-text-highlighted:var(--ui-color-primary-50)]',
  '[--ui-primary:var(--ui-color-primary-50)]',
  '[--ui-bg-elevated:color-mix(in_oklab,var(--ui-color-primary-50)_10%,transparent)]',
  '[--ui-border:color-mix(in_oklab,var(--ui-color-primary-50)_14%,transparent)]',
].join(' ')

const ui = {
  root: sobrePetroleo,
  content: sobrePetroleo,
  header: 'h-auto min-h-(--ui-header-height) items-center px-3 sm:px-3 py-3 border-b border-default',
  body: 'gap-4 px-3 sm:px-3 py-3',
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable :ui="ui">
      <template #header="{ collapsed }">
        <div class="flex min-w-0 flex-1 flex-col gap-2.5" :class="collapsed ? 'items-center' : 'px-1'">
          <img
            v-if="collapsed"
            src="/marca/venka-sello.svg"
            alt="Venka"
            class="size-8 shrink-0"
          >
          <img
            v-else
            src="/marca/venka-negativo.svg"
            alt="Venka"
            class="h-7 w-auto shrink-0 self-start"
          >
          <ClientOnly>
            <span
              v-if="!collapsed"
              class="truncate text-sm font-medium text-white"
              :title="nombreLocal"
            >
              {{ nombreLocal }}
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
          >
            <template #item-leading="{ item, active, ui: menuUi }">
              <!-- Marca de la sección activa: 3 px menta pegada al borde del lateral. Las hijas de un
                   grupo comparten esta plantilla y no la llevan: la marca es de la sección. -->
              <span
                v-if="active"
                aria-hidden="true"
                class="absolute -start-3 inset-y-2 w-[3px] rounded-e-full bg-menta in-data-[slot=childList]:hidden"
              />
              <UIcon
                v-if="item.icon"
                :name="item.icon"
                :class="menuUi.linkLeadingIcon({ active })"
              />
            </template>
          </UNavigationMenu>
          <UNavigationMenu
            class="mt-auto border-t border-default pt-3"
            :collapsed="collapsed"
            :items="settingsItems"
            orientation="vertical"
          >
            <template #item-leading="{ item, active, ui: menuUi }">
              <span
                v-if="active"
                aria-hidden="true"
                class="absolute -start-3 inset-y-2 w-[3px] rounded-e-full bg-menta in-data-[slot=childList]:hidden"
              />
              <UIcon
                v-if="item.icon"
                :name="item.icon"
                :class="menuUi.linkLeadingIcon({ active })"
              />
            </template>
          </UNavigationMenu>
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
