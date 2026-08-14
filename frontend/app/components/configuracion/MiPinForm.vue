<script setup lang="ts">
import type { MiPinEstado } from '~/composables/useGarzones'

const garzonesApi = useGarzones()
const toast = useToast()

/**
 * `null` = esta cuenta no es garzón en el local activo (el backend responde
 * 404). En ese caso el bloque entero no se renderiza: "Mi PIN" no significa
 * nada para quien no atiende. `cargandoInicial` solo tapa el bloque en la
 * PRIMERA carga: la recarga que sigue a `guardar()` reusa `cargarEstado()`
 * sin tocarlo, así que un guardado exitoso no desmonta y remonta la card
 * entera (aviso, formulario, historial) — el resto del perfil tampoco lo
 * hace, usa `loading` en el botón nomás.
 */
const estado = ref<MiPinEstado | null>(null)
const cargandoInicial = ref(true)
const guardando = ref(false)
const form = reactive({ pin: '', confirmarPin: '' })

/**
 * El 404 es el caso normal (esta cuenta no es garzón acá) y se traga en
 * silencio. Cualquier OTRO error —500, timeout, red caída— tiene que ser
 * visible: sin esto, un garzón real se queda sin ver "Mi PIN" y sin ninguna
 * pista de por qué, indistinguible del 404 esperado.
 */
async function cargarEstado(): Promise<void> {
  try {
    estado.value = await garzonesApi.miPin()
  }
  catch (e: unknown) {
    estado.value = null
    const err = e as { status?: number, statusCode?: number, response?: { status?: number } }
    const status = err?.status ?? err?.statusCode ?? err?.response?.status
    if (status !== 404) {
      toast.add({ title: apiErrorMsg(e, 'No se pudo cargar tu PIN'), color: 'error' })
    }
  }
}

async function guardar() {
  guardando.value = true
  try {
    await garzonesApi.fijarMiPin(form.pin, form.confirmarPin)
    toast.add({ title: 'PIN actualizado', color: 'success' })
    form.pin = ''
    form.confirmarPin = ''
    await cargarEstado()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo guardar el PIN'), color: 'error' })
  }
  finally {
    guardando.value = false
  }
}

onMounted(async () => {
  cargandoInicial.value = true
  await cargarEstado()
  cargandoInicial.value = false
})
</script>

<template>
  <AppCard v-if="!cargandoInicial && estado">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-key-round" class="w-5 h-5" />
        <span class="font-semibold">Mi PIN</span>
      </div>
    </template>

    <UAlert
      v-if="!estado.fijado"
      color="warning"
      variant="subtle"
      icon="i-lucide-info"
      title="Todavía no tenés PIN"
      description="Sin PIN no podés operar desde un dispositivo compartido. Desde el tuyo trabajás normal."
      class="mb-4"
    />

    <UForm :state="form" class="space-y-4" @submit="guardar">
      <UFormField label="PIN nuevo" required>
        <UInput v-model="form.pin" type="password" inputmode="numeric" maxlength="6" placeholder="6 dígitos" />
      </UFormField>

      <UFormField label="Repetir PIN" required>
        <UInput v-model="form.confirmarPin" type="password" inputmode="numeric" maxlength="6" placeholder="Repetilo" />
      </UFormField>

      <UButton type="submit" :loading="guardando">
        Guardar PIN
      </UButton>
    </UForm>

    <div class="mt-6">
      <p class="mb-2 text-sm font-medium text-default">
        Historial
      </p>
      <GarzonesPinEventosLista :eventos="estado.eventos" />
    </div>
  </AppCard>
</template>
