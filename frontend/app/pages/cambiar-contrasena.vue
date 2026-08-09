<script setup lang="ts">
/**
 * Cambio **obligatorio** de la contraseña temporal que generó el sistema al dar
 * de alta la cuenta.
 *
 * `layout: false` y sin link de escape a propósito: mientras el flag esté
 * puesto, `switch-tenant` responde 403, así que no hay ningún tenant al que
 * volver. La única salida real es cambiarla.
 *
 * No se puede confundir con el cambio voluntario del perfil: aquel vive dentro
 * de la app, con el resto de la navegación disponible.
 */
definePageMeta({ layout: false, middleware: 'auth' })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const auth = useAuthStore()

const form = ref({ actual: '', nueva: '', confirmar: '' })
const guardando = ref(false)
const error = ref('')

/** 8, no 6: es el mínimo que exige `UpdateContrasenaDto` en el backend. Con 6
 * el botón se habilitaba y la respuesta era un 400 crudo. */
const LARGO_MINIMO = 8

const puedeGuardar = computed(
  () =>
    form.value.actual.length > 0
    && form.value.nueva.length >= LARGO_MINIMO
    && form.value.nueva === form.value.confirmar,
)

async function guardar() {
  if (!puedeGuardar.value || guardando.value) return
  guardando.value = true
  error.value = ''
  try {
    await useApiFetch(`${apiUrl}/me/contrasena`, {
      method: 'PATCH',
      body: {
        contrasenaActual: form.value.actual,
        contrasenaNueva: form.value.nueva,
        confirmarContrasena: form.value.confirmar,
      },
    })
    toast.add({ title: 'Contraseña actualizada', color: 'success' })
    // El backend bajó el flag en la misma escritura, así que el camino normal
    // de post-login ya funciona: vuelve a resolver a qué tenant entrar.
    await auth.handlePostLogin()
  }
  catch (e: unknown) {
    error.value = apiErrorMsg(e, 'No se pudo cambiar la contraseña')
  }
  finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm">
      <div class="text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-6">
          <UIcon name="i-lucide-key-round" class="text-white w-5 h-5" />
        </div>
        <h1 class="text-xl font-semibold mb-2">
          Cambiá tu contraseña
        </h1>
        <p class="text-sm text-muted mb-6">
          Tu cuenta se creó con una contraseña temporal. Elegí una propia para
          poder entrar.
        </p>
      </div>

      <UForm :state="form" class="space-y-4" @submit="guardar">
        <UFormField label="Contraseña temporal" required>
          <UInput
            v-model="form.actual"
            type="password"
            autofocus
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Contraseña nueva"
          required
          :hint="`Mínimo ${LARGO_MINIMO} caracteres`"
        >
          <UInput v-model="form.nueva" type="password" class="w-full" />
        </UFormField>
        <UFormField label="Repetila" required>
          <UInput v-model="form.confirmar" type="password" class="w-full" />
        </UFormField>

        <p
          v-if="form.confirmar.length > 0 && form.nueva !== form.confirmar"
          class="text-sm text-error"
        >
          Las contraseñas no coinciden.
        </p>
        <p v-if="error" class="text-sm text-error" role="alert">
          {{ error }}
        </p>

        <UButton
          type="submit"
          block
          :loading="guardando"
          :disabled="!puedeGuardar"
        >
          Cambiar y entrar
        </UButton>
      </UForm>
    </div>
  </div>
</template>
