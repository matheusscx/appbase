<script setup lang="ts">
const authStore = useAuthStore()
const toast = useToast()
const config = useRuntimeConfig()

const loading = ref(false)
const form = reactive({
  nombre: authStore.user?.nombre ?? '',
  apellido: authStore.user?.apellido ?? '',
  telefono: authStore.user?.telefono ?? '',
})

async function guardar() {
  loading.value = true
  try {
    const updated = await useApiFetch<{ nombre: string; apellido: string | null; telefono: string | null }>(
      `${config.public.apiUrl}/me/perfil`,
      { method: 'PATCH', body: { nombre: form.nombre, apellido: form.apellido || null, telefono: form.telefono || null } },
    )
    authStore.updateUser({ nombre: updated.nombre, apellido: updated.apellido, telefono: updated.telefono })
    toast.add({ title: 'Perfil actualizado', color: 'success' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al guardar'
    toast.add({ title: msg, color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AppCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-circle-user" class="w-5 h-5" />
        <span class="font-semibold">Información personal</span>
      </div>
    </template>

    <UForm :state="form" class="space-y-4" @submit="guardar">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UFormField label="Nombre" required>
          <UInput v-model="form.nombre" placeholder="Tu nombre" />
        </UFormField>

        <UFormField label="Apellido">
          <UInput v-model="form.apellido" placeholder="Tu apellido" />
        </UFormField>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UFormField label="Teléfono">
          <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
        </UFormField>

        <UFormField label="Correo electrónico">
          <UInput :model-value="authStore.user?.correo" disabled />
        </UFormField>
      </div>

      <UButton type="submit" :loading="loading">
        Guardar cambios
      </UButton>
    </UForm>
  </AppCard>
</template>
