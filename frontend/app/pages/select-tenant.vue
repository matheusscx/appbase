<script setup lang="ts">
definePageMeta({ layout: false })

const tenantStore = useTenantStore()
const authStore = useAuthStore()
const switching = ref<string | null>(null)
/** La empresa cuya elección falló, para que "Reintentar" repita esa y no la lista. */
const eleccionFallida = ref<string | null>(null)

onMounted(async () => {
  if (tenantStore.tenants.length === 0) {
    await tenantStore.fetchMyTenants()
  }
  // Sin locales no hay nada que elegir: la pantalla "sin empresa" explica qué hacer.
  if (tenantStore.tenants.length === 0 && !tenantStore.error) {
    await navigateTo('/no-tenant')
  }
})

// Tonos de la marca (petróleo y menta); los de estado (rojo, ámbar) se leen como alerta.
const AVATAR_TONOS = [
  { root: 'bg-primary/10', fallback: 'text-primary' },
  { root: 'bg-menta/40', fallback: 'text-primary' },
  { root: 'bg-primary', fallback: 'text-inverted' },
] as const
function avatarUi(name: string) {
  return AVATAR_TONOS[name.charCodeAt(0) % AVATAR_TONOS.length]!
}

async function select(tenantId: string) {
  switching.value = tenantId
  await tenantStore.switchTenant(tenantId)
  eleccionFallida.value = tenantStore.error ? tenantId : null
  switching.value = null
}

function reintentar() {
  if (eleccionFallida.value) return select(eleccionFallida.value)
  return tenantStore.fetchMyTenants()
}
</script>

<template>
  <AppMarco
    titulo="¿En qué empresa vas a trabajar?"
    subtitulo="Elige la empresa para esta sesión."
    ancho="lg"
    :cargando="tenantStore.loading && !tenantStore.tenants.length && !tenantStore.error ? 'Cargando tus empresas…' : undefined"
  >
    <!-- El aviso va encima y la lista se queda: si falla entrar a un local, la
         persona ve cuál eligió y reintenta con un toque. -->
    <div v-if="tenantStore.error" class="mb-4">
      <UAlert
        color="error"
        variant="subtle"
        :description="tenantStore.error"
        icon="i-lucide-circle-alert"
        role="alert"
      />
      <UButton class="mt-3 min-h-11" size="xl" variant="ghost" :disabled="!!switching" @click="reintentar">
        Reintentar
      </UButton>
    </div>

    <div v-if="tenantStore.tenants.length" class="flex flex-col gap-2">
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
            :ui="avatarUi(tenant.nombre)"
            size="md"
            :class="switching === tenant.tenantId ? 'opacity-50' : ''"
          />
          <UIcon
            v-if="switching === tenant.tenantId"
            name="i-lucide-loader"
            class="absolute inset-0 m-auto w-5 h-5 animate-spin text-highlighted"
          />
        </div>
        <span class="min-w-0 flex-1 text-sm font-medium text-default line-clamp-2" :title="tenant.nombre">
          {{ tenant.nombre }}
        </span>
        <UIcon
          name="i-lucide-chevron-right"
          class="w-4 h-4 text-muted shrink-0 transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </div>

    <div class="mt-8 text-center">
      <UButton variant="ghost" color="neutral" size="xl" class="min-h-11" @click="authStore.logout()">
        Cerrar sesión
      </UButton>
    </div>
  </AppMarco>
</template>
