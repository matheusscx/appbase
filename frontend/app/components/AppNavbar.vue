<script setup lang="ts">
defineProps<{
  title: string
}>()

const authStore = useAuthStore()
const permissionsStore = usePermissionsStore()

const rolLabel = computed(() => {
  if (authStore.isSuperadmin) return 'Super Administrador'
  if (permissionsStore.esAdmin) return 'Administrador'
  return null
})
</script>

<template>
  <UDashboardNavbar :title="title">
    <template #leading>
      <UDashboardSidebarCollapse />
    </template>
    <template #right>
      <slot name="right">
        <div class="flex items-center gap-2">
          <UAvatar
            :alt="[authStore.user?.nombre, authStore.user?.apellido].filter(Boolean).join(' ')"
            size="xl"
          />
          <div class="flex flex-col leading-tight">
            <span class="text-sm text-muted">
              {{ [authStore.user?.nombre, authStore.user?.apellido].filter(Boolean).join(' ') }}
            </span>
            <span v-if="rolLabel" class="text-xs text-muted opacity-60">
              {{ rolLabel }}
            </span>
          </div>
        </div>
      </slot>
    </template>
  </UDashboardNavbar>
</template>
