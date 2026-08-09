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
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm">
      <div class="text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-6">
          <UIcon name="i-lucide-key-round" class="text-white w-5 h-5" />
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

        <template v-else>
          <h1 class="text-xl font-semibold mb-2">
            {{ esInvitacion ? 'Elegí tu contraseña' : 'Elegí una contraseña nueva' }}
          </h1>
          <p class="text-sm text-muted mb-6">
            {{ esInvitacion
              ? `Te sumaron a un equipo con ${correo}. Elegí una contraseña para entrar.`
              : `Vas a cambiar la contraseña de ${correo}.` }}
          </p>
        </template>
      </div>

      <UForm
        v-if="!cargando && !linkInvalido"
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
    </div>
  </div>
</template>
