<script setup lang="ts">
/**
 * Pedir el link de reset. Era un placeholder que decía "próximamente"; el login
 * ya enlazaba acá.
 *
 * ⚠️ **Confirma siempre lo mismo, exista o no la cuenta**, porque el backend
 * responde igual a propósito: distinguir convertiría el endpoint en un
 * enumerador público de correos registrados. La pantalla no puede "mejorar" ese
 * mensaje sin devolver la fuga.
 */
definePageMeta({ layout: false })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const correo = ref('')
const enviando = ref(false)
const enviado = ref(false)
const error = ref('')

async function pedir() {
  if (!correo.value || enviando.value) return
  enviando.value = true
  error.value = ''
  try {
    await $fetch(`${apiUrl}/auth/recuperar`, {
      method: 'POST',
      body: { correo: correo.value },
    })
    enviado.value = true
  }
  catch (e: unknown) {
    // Solo llega acá si el correo es inválido o el backend está caído: un
    // correo que no existe responde 200 igual.
    error.value = apiErrorMsg(e, 'No se pudo enviar el link')
  }
  finally {
    enviando.value = false
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
          Recuperar contraseña
        </h1>
      </div>

      <template v-if="enviado">
        <p class="text-sm text-muted mb-6 text-center">
          Si ese correo tiene una cuenta, te llega un link para elegir una
          contraseña nueva. Vence en una hora.
        </p>
        <UButton to="/login" block variant="subtle">
          Volver al inicio de sesión
        </UButton>
      </template>

      <template v-else>
        <p class="text-sm text-muted mb-6 text-center">
          Ponés tu correo y te mandamos un link para elegir una contraseña nueva.
        </p>
        <UForm :state="{ correo }" class="space-y-4" @submit="pedir">
          <UFormField label="Correo" required>
            <UInput
              v-model="correo"
              type="email"
              autofocus
              :maxlength="100"
              class="w-full"
            />
          </UFormField>
          <p v-if="error" class="text-sm text-error" role="alert">
            {{ error }}
          </p>
          <UButton type="submit" block :loading="enviando" :disabled="!correo">
            Mandame el link
          </UButton>
          <UButton to="/login" block variant="ghost">
            Volver
          </UButton>
        </UForm>
      </template>
    </div>
  </div>
</template>
