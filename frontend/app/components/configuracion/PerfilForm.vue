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

const { errores, marcar, limpiar } = useErroresCampo()

async function guardar() {
  if (marcar(form.nombre.trim() ? {} : { nombre: 'Escribe tu nombre' })) return
  loading.value = true
  try {
    const updated = await useApiFetch<{ nombre: string; apellido: string | null; telefono: string | null }>(
      `${config.public.apiUrl}/me/perfil`,
      { method: 'PATCH', body: { nombre: form.nombre, apellido: form.apellido || null, telefono: form.telefono || null } },
    )
    authStore.updateUser({ nombre: updated.nombre, apellido: updated.apellido, telefono: updated.telefono })
    toast.add({ title: 'Perfil actualizado', color: 'success' })
  } catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
    marcar(apiFieldErrors(e))
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
        <UFormField label="Nombre" required :error="errores.nombre">
          <UInput v-model="form.nombre" size="xl" class="w-full" name="nombre" autocomplete="given-name" placeholder="Tu nombre" @update:model-value="limpiar('nombre')" />
        </UFormField>

        <UFormField label="Apellido">
          <UInput v-model="form.apellido" size="xl" class="w-full" name="apellido" autocomplete="family-name" placeholder="Tu apellido" />
        </UFormField>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UFormField label="Teléfono">
          <UInput v-model="form.telefono" size="xl" class="w-full" type="tel" inputmode="tel" name="telefono" autocomplete="tel" placeholder="+56 9 1234 5678" />
        </UFormField>

        <UFormField label="Correo electrónico">
          <UInput :model-value="authStore.user?.correo" size="xl" class="w-full" disabled />
        </UFormField>
      </div>

      <UButton type="submit" size="xl" :loading="loading">
        Guardar cambios
      </UButton>
    </UForm>
  </AppCard>
</template>
