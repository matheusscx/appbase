<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    /**
     * Cuál de las dos listas complementarias se ofrece.
     * `false` → los que NO están en turno, para *entrar a turno*: quien ya
     * tiene sesión abierta no puede abrir otra, así que ofrecerlo sería
     * ofrecer un error. `true` → los que sí, para todo lo demás.
     */
    enTurno?: boolean
  }>(),
  {
    title: 'Identifícate con tu PIN',
    description: 'Ingresa tu PIN de 6 dígitos para continuar.',
    enTurno: true,
  },
)

const emit = defineEmits<{
  confirm: [garzonId: string, pin: string, nombre: string]
}>()

const garzonesApi = useGarzones()

const garzones = ref<GarzonParaSelector[]>([])
const cargando = ref(false)
const elegido = ref<GarzonParaSelector | null>(null)
const pin = ref('')
const verificando = ref(false)
const error = ref('')

const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

// Se elige primero a quién comparar y después se prueba: con el garzón ya
// elegido, la verificación es UN bcrypt en vez de uno por garzón del local.
watch(open, async (isOpen) => {
  elegido.value = null
  pin.value = ''
  error.value = ''
  verificando.value = false
  if (!isOpen) return

  cargando.value = true
  try {
    garzones.value = await garzonesApi.paraSelector(props.enTurno)
  }
  catch (e: unknown) {
    error.value = apiErrorMsg(e, 'No se pudo cargar la lista de garzones')
    garzones.value = []
  }
  finally {
    cargando.value = false
  }
})

function elegir(garzon: GarzonParaSelector) {
  elegido.value = garzon
  pin.value = ''
  error.value = ''
}

/** Volver atrás cambia de garzón sin cerrar el modal ni perder la acción. */
function volver() {
  if (verificando.value) return
  elegido.value = null
  pin.value = ''
  error.value = ''
}

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

// Se verifica ANTES de emitir: así el PIN equivocado se corrige acá, sin
// cerrar el modal ni descartar la acción que lo abrió.
async function verificar() {
  const garzon = elegido.value
  if (!garzon) return
  verificando.value = true
  try {
    await garzonesApi.verificarPin(garzon.garzonId, pin.value)
    emit('confirm', garzon.garzonId, pin.value, garzon.nombre)
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
  <UModal
    v-model:open="open"
    :title="elegido ? `PIN de ${elegido.nombre}` : props.title"
    :ui="shellUi.modal"
  >
    <template #body>
      <!-- Paso 1: elegir garzón -->
      <div v-if="!elegido" class="flex flex-col gap-4 py-2">
        <p class="text-center text-sm text-muted">
          Elegí quién sos para continuar.
        </p>

        <div v-if="cargando" class="flex justify-center py-6 text-muted">
          <UIcon name="i-lucide-loader" class="size-5 animate-spin" />
        </div>

        <!-- Lista vacía: sin esto el usuario ve un selector en blanco y no
             tiene forma de saber que lo que falta es entrar a turno. -->
        <UAlert
          v-else-if="garzones.length === 0"
          color="neutral"
          variant="subtle"
          icon="i-lucide-user-x"
          :description="props.enTurno
            ? 'No hay nadie en turno. Primero alguien tiene que entrar a turno.'
            : 'No hay garzones disponibles: o ya están todos en turno, o no hay ninguno activo.'"
        />

        <div v-else class="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto">
          <UButton
            v-for="garzon in garzones"
            :key="garzon.garzonId"
            :label="garzon.nombre"
            color="neutral"
            variant="soft"
            size="xl"
            block
            class="justify-start"
            @click="elegir(garzon)"
          />
        </div>

        <p v-if="error" class="text-center text-sm text-error" role="alert">
          {{ error }}
        </p>
      </div>

      <!-- Paso 2: teclado -->
      <div v-else class="flex flex-col items-center gap-6 py-2">
        <p class="text-center text-sm text-muted">
          {{ props.description }}
        </p>

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

        <UButton
          label="Cambiar de garzón"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :disabled="verificando"
          @click="volver"
        />
      </div>
    </template>
  </UModal>
</template>
