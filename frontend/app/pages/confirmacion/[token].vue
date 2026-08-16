<script setup lang="ts">
/**
 * "Te están sumando a X" — el otro extremo del alta que ya no adopta cuentas.
 * Quien llega acá **ya tiene cuenta**: no elige contraseña, decide si acepta
 * quedar asociada a esa empresa. Hasta que apriete, no es miembro.
 *
 * Misma forma que `invitacion/[token].vue`, y por los mismos motivos:
 * `layout: false` y **sin middleware** —la prueba de identidad es el token de
 * la URL, no una sesión: la persona puede tener sesión abierta en otro tenant
 * o ninguna—, y el token se consulta ANTES de mostrar el botón para que un
 * link vencido se avise de entrada. La consulta **no lo quema**.
 *
 * No se reusa aquella pantalla porque no comparten el flujo: allá el cuerpo es
 * un formulario de contraseña con su validación, acá es una decisión de un
 * click. Lo que sí comparten —los estados del link— es justo lo que se copia.
 */
definePageMeta({ layout: false })

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()

const token = route.params.token as string

const cargando = ref(true)
/** Motivo por el que el link no sirve. `null` mientras sirva. */
const linkInvalido = ref<string | null>(null)
const correo = ref('')
const tenant = ref('')

/**
 * Dijo "ahora no". No hay endpoint que rechazar —no aceptar **es** no hacer
 * nada—, así que el estado es local: sirve para que la pantalla no la deje
 * encerrada entre aceptar y cerrar la pestaña.
 */
const declinado = ref(false)
const confirmando = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const res = await $fetch<{ correo: string, tenant: string }>(
      `${apiUrl}/tenants/confirmacion/${token}`,
    )
    correo.value = res.correo
    tenant.value = res.tenant
  }
  catch (e: unknown) {
    linkInvalido.value = apiErrorMsg(e, 'Ese link ya no sirve')
  }
  finally {
    cargando.value = false
  }
})

async function confirmar() {
  if (confirmando.value) return
  confirmando.value = true
  error.value = ''
  try {
    const res = await $fetch<{ message: string }>(
      `${apiUrl}/tenants/confirmacion/${token}`,
      { method: 'POST' },
    )
    toast.add({
      title: res?.message || `Listo, ya sos parte de ${tenant.value}`,
      color: 'success',
    })
    await navigateTo('/login')
  }
  catch (e: unknown) {
    error.value = apiErrorMsg(e, 'No se pudo confirmar')
  }
  finally {
    confirmando.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm">
      <div class="text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-6">
          <UIcon name="i-lucide-building-2" class="text-white w-5 h-5" />
        </div>

        <template v-if="cargando">
          <p class="text-sm text-muted">
            Verificando el link…
          </p>
        </template>

        <template v-else-if="linkInvalido">
          <h1 class="text-xl font-semibold mb-2">
            Este link ya no sirve
          </h1>
          <p class="text-sm text-muted mb-6">
            {{ linkInvalido }}
          </p>
          <UButton to="/login" block variant="subtle">
            Ir a iniciar sesión
          </UButton>
        </template>

        <template v-else-if="declinado">
          <h1 class="text-xl font-semibold mb-2">
            No hicimos nada
          </h1>
          <p class="text-sm text-muted mb-6">
            No te sumamos a {{ tenant }} y tu cuenta quedó igual que antes. Si
            cambiás de idea, volvé a abrir el link del mail antes de que venza.
          </p>
          <UButton to="/login" block variant="subtle">
            Ir a iniciar sesión
          </UButton>
        </template>

        <template v-else>
          <h1 class="text-xl font-semibold mb-2">
            Te están sumando a {{ tenant }}
          </h1>
          <p class="text-sm text-muted mb-6">
            Con tu cuenta {{ correo }}. Si aceptás, vas a poder entrar a
            {{ tenant }} con la contraseña que ya usás — no tenés que crear
            nada nuevo.
          </p>

          <div class="space-y-2">
            <UButton
              block
              :loading="confirmando"
              @click="confirmar"
            >
              Sí, quiero sumarme
            </UButton>
            <UButton
              block
              color="neutral"
              variant="ghost"
              :disabled="confirmando"
              @click="() => { declinado = true }"
            >
              Ahora no
            </UButton>
          </div>

          <p v-if="error" class="text-sm text-error mt-4" role="alert">
            {{ error }}
          </p>

          <p class="text-xs text-muted mt-6">
            Si no esperabas esto, no aceptes: sin tu confirmación no quedás
            asociado a ninguna empresa.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
