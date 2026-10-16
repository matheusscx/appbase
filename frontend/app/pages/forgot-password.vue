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

const subtitulo = computed(() =>
  enviado.value
    ? 'Si ese correo tiene una cuenta, te llega un link para elegir una contraseña nueva. Vence en una hora.'
    : 'Pones tu correo y te mandamos un link para elegir una contraseña nueva.',
)

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
  <AppMarco
    titulo="Recuperar contraseña"
    :subtitulo="subtitulo"
    icono="i-lucide-key-round"
  >
    <UButton v-if="enviado" to="/login" block size="xl" class="min-h-11" variant="subtle">
      Volver al inicio de sesión
    </UButton>

    <UForm v-else :state="{ correo }" class="space-y-4" @submit="pedir">
      <UFormField label="Correo" required>
        <UInput
          v-model="correo"
          type="email"
          autofocus
          :maxlength="100"
          size="xl"
          :ui="{ base: 'min-h-11' }"
          class="w-full"
        />
      </UFormField>
      <p v-if="error" class="text-sm text-error" role="alert">
        {{ error }}
      </p>
      <UButton type="submit" block size="xl" class="min-h-11" :loading="enviando" :disabled="!correo">
        Mándame el link
      </UButton>
      <UButton to="/login" block size="xl" class="min-h-11" variant="ghost">
        Volver
      </UButton>
    </UForm>
  </AppMarco>
</template>
