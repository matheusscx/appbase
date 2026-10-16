<script setup lang="ts">
/**
 * Elegir contraseña desde un link. **Una sola pantalla** para invitación y
 * reset: cambian los textos y el endpoint, no el flujo. Tenerlas separadas
 * duplicaría la validación y el manejo de link vencido, que es justo donde un
 * bug no se nota hasta que alguien no puede entrar.
 *
 * `layout: false` y **sin middleware**: quien llega acá no puede autenticarse
 * todavía (invitación) o no puede más (reset). La prueba de identidad es el
 * token de la URL.
 */
definePageMeta({ layout: false })

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()

const token = route.params.token as string
/** La ruta define el flujo: `/invitacion/:token` o `/recuperar/:token`. */
const esInvitacion = route.path.startsWith('/invitacion')
const recurso = esInvitacion ? 'invitacion' : 'recuperar'

const cargando = ref(true)
/** Motivo por el que el link no sirve. `null` mientras sirva. */
const linkInvalido = ref<string | null>(null)
const correo = ref('')

const form = ref({ contrasena: '', confirmar: '' })
const guardando = ref(false)
const error = ref('')

const LARGO_MINIMO = 8

const puedeGuardar = computed(
  () =>
    form.value.contrasena.length >= LARGO_MINIMO
    && form.value.contrasena === form.value.confirmar,
)

/** El título y la bajada del marco cambian con el estado del link. */
const titulo = computed(() => {
  if (cargando.value) return undefined
  if (linkInvalido.value) return 'Este link ya no sirve'
  return esInvitacion ? 'Elegí tu contraseña' : 'Elegí una contraseña nueva'
})
const subtitulo = computed(() => {
  if (cargando.value) return 'Verificando el link…'
  if (linkInvalido.value) return linkInvalido.value
  return esInvitacion
    ? `Te sumaron a un equipo con ${correo.value}. Elegí una contraseña para entrar.`
    : `Vas a cambiar la contraseña de ${correo.value}.`
})

/**
 * Se consulta el token ANTES de mostrar el formulario. Sin esto, la persona
 * tipea dos veces una contraseña y recién ahí se entera de que el link venció.
 * La consulta **no lo quema**.
 */
onMounted(async () => {
  try {
    const res = await $fetch<{ correo: string }>(
      `${apiUrl}/auth/${recurso}/${token}`,
    )
    correo.value = res.correo
  }
  catch (e: unknown) {
    linkInvalido.value = apiErrorMsg(e, 'Ese link ya no sirve')
  }
  finally {
    cargando.value = false
  }
})

async function guardar() {
  if (!puedeGuardar.value || guardando.value) return
  guardando.value = true
  error.value = ''
  try {
    await $fetch(`${apiUrl}/auth/${recurso}/${token}`, {
      method: 'POST',
      body: { contrasena: form.value.contrasena },
    })
    toast.add({ title: 'Listo, ya podés entrar', color: 'success' })
    await navigateTo('/login')
  }
  catch (e: unknown) {
    error.value = apiErrorMsg(e, 'No se pudo guardar la contraseña')
  }
  finally {
    guardando.value = false
  }
}
</script>

<template>
  <AppMarco :titulo="titulo" :subtitulo="subtitulo" icono="i-lucide-key-round">
    <UButton v-if="linkInvalido" to="/login" block variant="subtle">
      Ir a iniciar sesión
    </UButton>

    <UForm
      v-else-if="!cargando"
      :state="form"
      class="space-y-4"
      @submit="guardar"
    >
      <UFormField
        label="Contraseña"
        required
        :hint="`Mínimo ${LARGO_MINIMO} caracteres`"
      >
        <UInput
          v-model="form.contrasena"
          type="password"
          autofocus
          class="w-full"
        />
      </UFormField>
      <UFormField label="Repetila" required>
        <UInput v-model="form.confirmar" type="password" class="w-full" />
      </UFormField>

      <p
        v-if="form.confirmar.length > 0 && form.contrasena !== form.confirmar"
        class="text-sm text-error"
      >
        Las contraseñas no coinciden.
      </p>
      <p v-if="error" class="text-sm text-error" role="alert">
        {{ error }}
      </p>

      <UButton type="submit" block :loading="guardando" :disabled="!puedeGuardar">
        Guardar y entrar
      </UButton>
    </UForm>
  </AppMarco>
</template>
