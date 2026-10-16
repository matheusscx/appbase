<script setup lang="ts">
definePageMeta({ layout: false })

const tenantStore = useTenantStore()
const authStore = useAuthStore()
const switching = ref<string | null>(null)

onMounted(async () => {
  if (tenantStore.tenants.length === 0) {
    await tenantStore.fetchMyTenants()
  }
})

const AVATAR_COLORS = ['primary', 'secondary', 'success', 'warning', 'error', 'info'] as const
function avatarColor(name: string): typeof AVATAR_COLORS[number] {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]!
}

async function select(tenantId: string) {
  switching.value = tenantId
  await tenantStore.switchTenant(tenantId)
  switching.value = null
}

const gridClass = computed(() =>
  tenantStore.tenants.length <= 4
    ? 'grid grid-cols-1 sm:grid-cols-2 gap-3'
    : 'flex flex-col gap-2'
)
</script>

<template>
  <AppMarco
    titulo="¿En qué empresa vas a trabajar?"
    subtitulo="Selecciona el espacio de trabajo para esta sesión."
    ancho="lg"
  >
    <div v-if="tenantStore.error" class="mb-4">
      <UAlert
        color="error"
        variant="subtle"
        :description="tenantStore.error"
        icon="i-lucide-circle-alert"
      />
      <UButton class="mt-3" size="sm" variant="ghost" @click="tenantStore.fetchMyTenants()">
        Reintentar
      </UButton>
    </div>

    <div v-else-if="tenantStore.loading && tenantStore.tenants.length === 0" class="py-12 text-center">
      <UIcon name="i-lucide-loader" class="w-6 h-6 text-highlighted animate-spin mx-auto" />
    </div>

    <div v-else :class="gridClass">
      <button
        v-for="tenant in tenantStore.tenants"
        :key="tenant.tenantId"
        :disabled="!!switching"
        class="group relative flex items-center gap-4 rounded-xl bg-default border border-default px-5 py-4 text-left transition-all hover:border-primary-500 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
        @click="select(tenant.tenantId)"
      >
        <div class="relative shrink-0">
          <UAvatar
            :alt="tenant.nombre"
            :color="avatarColor(tenant.nombre)"
            size="md"
            :class="switching === tenant.tenantId ? 'opacity-50' : ''"
          />
          <UIcon
            v-if="switching === tenant.tenantId"
            name="i-lucide-loader"
            class="absolute inset-0 m-auto w-5 h-5 animate-spin text-highlighted"
          />
        </div>
        <span class="min-w-0 font-medium text-default text-sm flex-1 truncate">
          {{ tenant.nombre }}
        </span>
        <UIcon
          name="i-lucide-chevron-right"
          class="w-4 h-4 text-muted shrink-0 transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </div>

    <div class="mt-8 text-center">
      <UButton variant="ghost" color="neutral" size="sm" @click="authStore.logout()">
        Cerrar sesión
      </UButton>
    </div>
  </AppMarco>
</template>
