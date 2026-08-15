<script setup lang="ts">
const toast = useToast()
const config = useRuntimeConfig()
const authStore = useAuthStore()

const loading = ref(false)
const form = reactive({
  contrasenaActual: '',
  contrasenaNueva: '',
  confirmarContrasena: '',
})

async function guardar() {
  if (form.contrasenaNueva !== form.confirmarContrasena) {
    toast.add({ title: 'Las contraseñas nuevas no coinciden', color: 'error' })
    return
  }
  loading.value = true
  try {
    await useApiFetch<{ message: string }>(
      `${config.public.apiUrl}/me/contrasena`,
      { method: 'PATCH', body: { ...form } },
    )
    form.contrasenaActual = ''
    form.contrasenaNueva = ''
    form.confirmarContrasena = ''
    // El backend borra TODOS los refresh tokens de la cuenta, incluido el de
    // esta pestaña: cambiar la contraseña tiene que echar a un intruso, y no
    // hay forma de distinguir su sesión de la propia. Así que se desloguea acá,
    // avisando — si no, `useApiFetch` expulsa sin explicación en cuanto vence
    // el access token, hasta 15 minutos después y en cualquier pantalla.
    toast.add({
      title: 'Contraseña actualizada',
      description: 'Se cerraron todas las sesiones. Entrá de nuevo con tu contraseña nueva.',
      color: 'success',
    })
    await authStore.logout()
  } catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cambiar contraseña')
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
        <UIcon name="i-lucide-lock" class="w-5 h-5" />
        <span class="font-semibold">Cambiar contraseña</span>
      </div>
    </template>

    <UForm :state="form" class="space-y-4" @submit="guardar">
      <UFormField label="Contraseña actual" required>
        <UInput v-model="form.contrasenaActual" type="password" placeholder="Tu contraseña actual" />
      </UFormField>

      <UFormField label="Nueva contraseña" required>
        <UInput v-model="form.contrasenaNueva" type="password" placeholder="Mínimo 8 caracteres" />
      </UFormField>

      <UFormField label="Confirmar nueva contraseña" required>
        <UInput v-model="form.confirmarContrasena" type="password" placeholder="Repetí la nueva contraseña" />
      </UFormField>

      <UButton type="submit" :loading="loading">
        Actualizar contraseña
      </UButton>
    </UForm>
  </AppCard>
</template>
