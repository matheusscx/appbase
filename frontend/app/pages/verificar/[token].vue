<script setup lang="ts">
/**
 * Verificar el correo del auto-registro.
 *
 * `layout: false` y **sin middleware**, igual que `invitacion/[token]` y
 * `confirmacion/[token]`: quien llega acá todavía no puede entrar —la cuenta
 * existe pero sin la dirección probada—, así que la prueba de identidad es el
 * token de la URL.
 *
 * A diferencia de la invitación **no se elige contraseña**: la persona ya la
 * puso al registrarse. Lo único que falta es probar que el correo es suyo.
 *
 * ⚠️ **Pide un clic y no verifica al montar.** Verificar en `onMounted` parecía
 * lo natural —no hay ningún dato que la persona tenga que aportar— pero deja que
 * el token lo consuma cualquier cosa que *renderice* el link: los escáneres de
 * seguridad de los proveedores de correo abren las URLs de los mails entrantes.
 * El daño sería acotado (el escáner vive en la casilla del dueño), pero
 * convierte "la persona hizo clic" en "algo abrió el link", que es justamente la
 * afirmación que este token existe para sostener.
 */
definePageMeta({ layout: false })

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const token = route.params.token as string

/** Motivo por el que el link no sirve. `null` mientras sirva. */
const linkInvalido = ref<string | null>(null)
const verificando = ref(false)
const mensaje = ref('')

async function verificar() {
  if (verificando.value) return
  verificando.value = true
  try {
    const res = await $fetch<{ message: string }>(
      `${apiUrl}/auth/verificar/${token}`,
      { method: 'POST' },
    )
    mensaje.value = res.message
  }
  catch (e: unknown) {
    linkInvalido.value = apiErrorMsg(e, 'Ese link ya no sirve')
  }
  finally {
    verificando.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm text-center">
      <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-6">
        <UIcon name="i-lucide-mail-check" class="text-white w-5 h-5" />
      </div>

      <template v-if="linkInvalido">
        <h1 class="text-xl font-semibold mb-2">
          Este link ya no sirve
        </h1>
        <p class="text-sm text-muted mb-6">
          {{ linkInvalido }}
        </p>
        <!-- A registrarse y no a entrar: sin el correo verificado el login
             corta igual, así que mandarla al login sería un callejón. Volver a
             registrarse con la misma dirección reenvía el link. -->
        <UButton to="/register" block variant="subtle">
          Pedir un link nuevo
        </UButton>
      </template>

      <template v-else-if="mensaje">
        <h1 class="text-xl font-semibold mb-2">
          Correo verificado
        </h1>
        <p class="text-sm text-muted mb-6">
          {{ mensaje }}
        </p>
        <UButton to="/login" block>
          Iniciar sesión
        </UButton>
      </template>

      <template v-else>
        <h1 class="text-xl font-semibold mb-2">
          Confirmá que este correo es tuyo
        </h1>
        <p class="text-sm text-muted mb-6">
          Es el último paso: hasta que lo hagas, tu cuenta no se puede usar.
        </p>
        <UButton block :loading="verificando" @click="verificar">
          Verificar mi correo
        </UButton>
      </template>
    </div>
  </div>
</template>
