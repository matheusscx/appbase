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

/** El título y la bajada del marco cambian con el estado del link. */
const titulo = computed(() => {
  if (linkInvalido.value) return 'Este link ya no sirve'
  if (mensaje.value) return 'Correo verificado'
  return 'Confirma que este correo es tuyo'
})
const subtitulo = computed(() => {
  if (linkInvalido.value) return linkInvalido.value
  if (mensaje.value) return mensaje.value
  return 'Es el último paso: hasta que lo hagas, tu cuenta no se puede usar.'
})

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
  <AppMarco :titulo="titulo" :subtitulo="subtitulo" icono="i-lucide-mail-check">
    <!-- A registrarse y no a entrar: sin el correo verificado el login
         corta igual, así que mandarla al login sería un callejón. Volver a
         registrarse con la misma dirección reenvía el link. -->
    <UButton v-if="linkInvalido" to="/register" block variant="subtle">
      Pedir un link nuevo
    </UButton>

    <UButton v-else-if="mensaje" to="/login" block>
      Iniciar sesión
    </UButton>

    <UButton v-else block :loading="verificando" @click="verificar">
      Verificar mi correo
    </UButton>
  </AppMarco>
</template>
