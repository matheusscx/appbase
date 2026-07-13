<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
  }>(),
  {
    title: 'Identifícate con tu PIN',
    description: 'Ingresa tu PIN de 6 dígitos para continuar.',
  },
)

const emit = defineEmits<{
  // Se emite con el PIN verificado y el nombre del garzón identificado.
  confirm: [pin: string, nombre: string]
}>()

const garzonesApi = useGarzones()

const pin = ref('')
const verificando = ref(false)
const error = ref('')

const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

// Reinicia el estado cada vez que se abre el modal.
watch(open, (isOpen) => {
  if (isOpen) {
    pin.value = ''
    error.value = ''
    verificando.value = false
  }
})

function pulsar(digito: string) {
  if (verificando.value || pin.value.length >= 6) return
  error.value = ''
  pin.value += digito
  if (pin.value.length === 6) void verificar()
}

function borrar() {
  if (verificando.value) return
  error.value = ''
  pin.value = pin.value.slice(0, -1)
}

async function verificar() {
  verificando.value = true
  try {
    const garzon = await garzonesApi.identificar(pin.value)
    emit('confirm', pin.value, garzon.nombre)
    open.value = false
  }
  catch (e: unknown) {
    error.value = apiErrorMsg(e, 'PIN inválido')
    pin.value = ''
  }
  finally {
    verificando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="props.title" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col items-center gap-6 py-2">
        <p class="text-center text-sm text-muted">
          {{ props.description }}
        </p>

        <!-- Indicador de dígitos ingresados -->
        <div class="flex items-center gap-3" aria-hidden="true">
          <span
            v-for="i in 6"
            :key="i"
            class="size-3 rounded-full border transition-colors"
            :class="pin.length >= i
              ? 'border-primary bg-primary'
              : 'border-accented bg-transparent'"
          />
        </div>

        <p
          v-if="error"
          class="min-h-5 text-center text-sm text-error"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-else-if="verificando"
          class="flex min-h-5 items-center gap-1.5 text-sm text-muted"
        >
          <UIcon name="i-lucide-loader" class="size-4 animate-spin" />
          Verificando…
        </p>
        <div v-else class="min-h-5" />

        <!-- Teclado numérico -->
        <div class="grid w-full max-w-xs grid-cols-3 gap-3">
          <UButton
            v-for="tecla in teclas"
            :key="tecla"
            :label="tecla"
            color="neutral"
            variant="soft"
            size="xl"
            block
            class="justify-center text-lg font-medium"
            :disabled="verificando"
            @click="pulsar(tecla)"
          />
          <div />
          <UButton
            label="0"
            color="neutral"
            variant="soft"
            size="xl"
            block
            class="justify-center text-lg font-medium"
            :disabled="verificando"
            @click="pulsar('0')"
          />
          <UButton
            icon="i-lucide-delete"
            color="neutral"
            variant="ghost"
            size="xl"
            block
            class="justify-center"
            :disabled="verificando || pin.length === 0"
            @click="borrar"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
