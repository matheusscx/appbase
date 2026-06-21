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
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-heroicons-user-circle" class="w-5 h-5" />
        <span class="font-semibold">Información personal</span>
      </div>
    </template>

    <form class="space-y-4" @submit.prevent="guardar">
      <UFormField label="Correo electrónico">
        <UInput :value="authStore.user?.correo" disabled />
      </UFormField>

      <UFormField label="Nombre" required>
        <UInput v-model="form.nombre" placeholder="Tu nombre" />
      </UFormField>

      <UFormField label="Apellido">
        <UInput v-model="form.apellido" placeholder="Tu apellido" />
      </UFormField>

      <UFormField label="Teléfono">
        <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
      </UFormField>

      <UButton type="submit" :loading="loading">
        Guardar cambios
      </UButton>
    </form>
  </UCard>
</template>
