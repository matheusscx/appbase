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
/** La empresa que invitó (solo en la invitación); `null` si no llegó. */
const tenant = ref<string | null>(null)

const form = ref({ contrasena: '', confirmar: '' })
const guardando = ref(false)
const error = ref('')

const LARGO_MINIMO = 8

/**
 * El aviso de "no coinciden" no sale mientras la repetición todavía va por la
 * mitad: sale al salir del campo o cuando ya tiene el largo de la primera.
 */
const confirmarTocado = ref(false)
const mostrarNoCoinciden = computed(
  () =>
    form.value.confirmar.length > 0
    && form.value.contrasena !== form.value.confirmar
    && (confirmarTocado.value || form.value.confirmar.length >= form.value.contrasena.length),
)

const puedeGuardar = computed(
  () =>
    form.value.contrasena.length >= LARGO_MINIMO
    && form.value.contrasena === form.value.confirmar,
)

/** El título y la bajada del marco cambian con el estado del link. */
const titulo = computed(() => {
  if (cargando.value) return undefined
  if (linkInvalido.value) return 'Este link ya no sirve'
  return esInvitacion ? 'Elige tu contraseña' : 'Elige una contraseña nueva'
})
/**
 * Qué hacer con un link vencido (08.4). El motivo ya lo trae el servidor; acá va
 * la salida, que cambia según quién pueda reenviarlo: el reset se pide solo, la
 * invitación la reenvía quien invitó.
 */
const salidaLinkInvalido = esInvitacion
  ? 'Pídele a quien te invitó que te envíe uno nuevo.'
  : 'Pide otro desde el botón de abajo.'
const subtitulo = computed(() => {
  if (cargando.value) return undefined
  if (linkInvalido.value) return `${linkInvalido.value} ${salidaLinkInvalido}`
  return esInvitacion
    ? `Te sumaron a ${tenant.value ?? 'un equipo'} con ${correo.value}. Elige una contraseña para entrar.`
    : `Vas a cambiar la contraseña de ${correo.value}.`
})

/**
 * Se consulta el token ANTES de mostrar el formulario. Sin esto, la persona
 * tipea dos veces una contraseña y recién ahí se entera de que el link venció.
 * La consulta **no lo quema**.
 */
onMounted(async () => {
  try {
    const res = await $fetch<{ correo: string, tenant?: string | null }>(
      `${apiUrl}/auth/${recurso}/${token}`,
    )
    correo.value = res.correo
    tenant.value = res.tenant ?? null
  }
  catch (e: unknown) {
    linkInvalido.value = apiErrorMsg(e, 'Puede estar vencido o ya usado.')
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
    toast.add({ title: 'Contraseña guardada. Ya puedes entrar.', color: 'success' })
    // El correo ya se conoce: el login lo trae puesto y solo falta la contraseña (08.3). Va en el
    // `state` de la navegación, no en la URL: un correo en el query string queda en el historial.
    await navigateTo(correo.value ? { path: '/login', state: { email: correo.value } } : '/login')
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
  <AppMarco
    :titulo="titulo"
    :subtitulo="subtitulo"
    icono="i-lucide-key-round"
    :cargando="cargando ? 'Verificando el link…' : undefined"
  >
    <template v-if="linkInvalido">
      <UButton v-if="!esInvitacion" to="/forgot-password" block size="xl" class="min-h-11">
        Pedir otro link
      </UButton>
      <UButton v-else to="/login" block size="xl" class="min-h-11" variant="subtle">
        Ir a iniciar sesión
      </UButton>
    </template>

    <UForm
      v-else
      :state="form"
      class="space-y-4"
      @submit="guardar"
    >
      <UFormField
        label="Contraseña"
        required
        :hint="`Mínimo ${LARGO_MINIMO} caracteres`"
      >
        <AppInputContrasena
          v-model="form.contrasena"
          name="password"
          autocomplete="new-password"
          autofocus
        />
      </UFormField>
      <UFormField label="Repítela" required>
        <AppInputContrasena
          v-model="form.confirmar"
          name="password-confirmar"
          autocomplete="new-password"
          @blur="confirmarTocado = true"
        />
      </UFormField>

      <p
        v-if="mostrarNoCoinciden"
        class="text-sm text-error"
      >
        Las contraseñas no coinciden.
      </p>
      <p v-if="error" class="text-sm text-error" role="alert">
        {{ error }}
      </p>

      <!-- No dice "entrar": al guardar se vuelve al login, la sesión no se abre sola. -->
      <UButton
        type="submit"
        block
        size="xl"
        class="min-h-11"
        :loading="guardando"
        :disabled="!puedeGuardar"
      >
        Guardar contraseña
      </UButton>
    </UForm>
  </AppMarco>
</template>
