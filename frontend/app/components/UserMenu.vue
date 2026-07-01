<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const authStore = useAuthStore()
const tenantStore = useTenantStore()
const permissionsStore = usePermissionsStore()

const fullName = computed(() =>
  [authStore.user?.nombre, authStore.user?.apellido].filter(Boolean).join(' '),
)

const rolLabel = computed(() => {
  if (authStore.isSuperadmin) return 'Super Administrador'
  if (permissionsStore.esAdmin) return 'Administrador'
  return null
})

const items = computed<DropdownMenuItem[][]>(() => {
  const main: DropdownMenuItem[] = [
    {
      label: 'Mi Cuenta',
      icon: 'i-lucide-circle-user',
      onSelect: () => navigateTo('/configuracion/perfil'),
    },
  ]

  if (tenantStore.tenants.length > 1) {
    main.push({
      label: 'Cambiar Institución',
      icon: 'i-lucide-building-2',
      onSelect: () => navigateTo('/select-tenant'),
    })
  }

  return [
    main,
    [{
      label: 'Cerrar Sesión',
      icon: 'i-lucide-log-out',
      color: 'error',
      onSelect: () => authStore.logout(),
    }],
  ]
})
</script>

<template>
  <UDropdownMenu :items="items">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg px-2 py-1 -my-1 hover:bg-elevated/50 transition-colors cursor-pointer"
    >
      <UAvatar
        :alt="fullName"
        size="xl"
      />
      <div class="flex flex-col leading-tight text-left">
        <span class="text-sm text-muted">{{ fullName }}</span>
        <span v-if="rolLabel" class="text-xs text-muted opacity-60">{{ rolLabel }}</span>
      </div>
    </button>

    <template #content-top>
      <div class="px-3 py-3 flex items-center gap-3 border-b border-default">
        <UAvatar :alt="fullName" size="lg" />
        <div class="flex flex-col min-w-0">
          <span class="font-medium text-highlighted text-sm truncate">{{ fullName }}</span>
          <span
            v-if="tenantStore.activeTenant?.nombre"
            class="text-xs text-muted truncate"
          >
            {{ tenantStore.activeTenant.nombre }}
          </span>
          <span v-if="rolLabel" class="text-xs text-muted opacity-60">{{ rolLabel }}</span>
        </div>
      </div>
    </template>
  </UDropdownMenu>
</template>
