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

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
]
function avatarColor(name: string): string {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase()
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
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4 py-12">
    <div class="w-full max-w-lg">
      <div class="mb-8 text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-4">
          <UIcon name="i-heroicons-bolt" class="text-white w-5 h-5" />
        </div>
        <h1 class="text-xl font-semibold text-default">
          ¿En qué empresa vas a trabajar?
        </h1>
        <p class="mt-1 text-sm text-muted">
          Selecciona el espacio de trabajo para esta sesión.
        </p>
      </div>

      <div v-if="tenantStore.error" class="mb-4">
        <UAlert
          color="error"
          variant="subtle"
          :description="tenantStore.error"
          icon="i-heroicons-exclamation-circle"
        />
        <UButton class="mt-3" size="sm" variant="ghost" @click="tenantStore.fetchMyTenants()">
          Reintentar
        </UButton>
      </div>

      <div v-else-if="tenantStore.loading && tenantStore.tenants.length === 0" class="py-12 text-center">
        <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-primary-600 animate-spin mx-auto" />
      </div>

      <div v-else :class="gridClass">
        <button
          v-for="tenant in tenantStore.tenants"
          :key="tenant.tenantId"
          :disabled="!!switching"
          class="group relative flex items-center gap-4 rounded-xl bg-default ring-1 ring-border-default px-5 py-4 text-left transition-all hover:ring-primary-500 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
          @click="select(tenant.tenantId)"
        >
          <div
            :class="[avatarColor(tenant.nombre), 'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white font-bold text-base']"
          >
            <UIcon
              v-if="switching === tenant.tenantId"
              name="i-heroicons-arrow-path"
              class="w-5 h-5 animate-spin"
            />
            <span v-else>{{ avatarInitial(tenant.nombre) }}</span>
          </div>
          <span class="font-medium text-default text-sm flex-1 truncate">
            {{ tenant.nombre }}
          </span>
          <UIcon
            name="i-heroicons-chevron-right"
            class="w-4 h-4 text-gray-400 shrink-0 transition-transform group-hover:translate-x-0.5"
          />
        </button>
      </div>

      <div class="mt-8 text-center">
        <UButton variant="ghost" color="neutral" size="sm" @click="authStore.logout()">
          Cerrar sesión
        </UButton>
      </div>
    </div>
  </div>
</template>
