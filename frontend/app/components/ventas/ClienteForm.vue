<script setup lang="ts">
import { LARGO_RECEPTOR, rutValido, type ReglaReceptor } from '~/composables/useReceptor'

export interface CustomerForm {
  nombre: string
  rut: string
  giro: string
  direccion: string
  comuna: string
  telefono: string
  email: string
  terceroId: string | null
}

interface Tercero {
  id: string
  tipo: string
  nombre: string
  rut: string | null
  nombreLegal: string | null
  rutFiscal: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  giro: string | null
  comuna: string | null
  activo: boolean
}

const model = defineModel<CustomerForm>({ required: true })
/**
 * Qué exige el tipo de documento elegido (`GET /tipos-documento`). Sin regla
 * (otra pantalla), nada es obligatorio y el RUT no se mira.
 */
const props = withDefaults(defineProps<{ regla?: ReglaReceptor }>(), {
  regla: () => ({ receptorCompleto: false, rutChileno: false }),
})

const errorRut = computed(() =>
  props.regla.rutChileno && model.value.rut.trim() && !rutValido(model.value.rut)
    ? 'RUT inválido: revisá el dígito verificador'
    : undefined,
)
function contador(campo: keyof typeof LARGO_RECEPTOR) {
  return `${model.value[campo].length}/${LARGO_RECEPTOR[campo]}`
}
function errorLargo(campo: keyof typeof LARGO_RECEPTOR) {
  return model.value[campo].length > LARGO_RECEPTOR[campo]
    ? `Abreviá: el SII acepta hasta ${LARGO_RECEPTOR[campo]} caracteres`
    : undefined
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const terceros = ref<Tercero[]>([])
const terceroSeleccionado = ref<string | undefined>(undefined)

const terceroOptions = computed(() =>
  terceros.value
    .filter(t => t.activo)
    .map(t => ({ label: t.nombreLegal || t.nombre, value: t.id })),
)

async function cargarTerceros() {
  try {
    terceros.value = await useApiFetch<Tercero[]>(`${apiUrl}/terceros`)
  }
  catch {
    // el picker es un atajo opcional; si falla, se completa el formulario a mano
  }
}
onMounted(cargarTerceros)

watch(terceroSeleccionado, (id) => {
  if (!id) {
    model.value.terceroId = null
    return
  }
  const tercero = terceros.value.find(t => t.id === id)
  if (!tercero) return
  model.value.terceroId = tercero.id
  model.value.nombre = tercero.nombreLegal || tercero.nombre
  model.value.rut = tercero.rutFiscal || tercero.rut || ''
  model.value.direccion = tercero.direccion || ''
  model.value.giro = tercero.giro || ''
  model.value.comuna = tercero.comuna || ''
  model.value.telefono = tercero.telefono || ''
  model.value.email = tercero.correo || ''
})

function quitarReadonly(e: Event) {
  ;(e.target as HTMLInputElement).removeAttribute('readonly')
}
function ponerReadonly(e: Event) {
  ;(e.target as HTMLInputElement).setAttribute('readonly', 'readonly')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm font-medium text-default">Datos del cliente</p>
    <UFormField label="Tercero registrado">
      <USelectMenu
        v-model="terceroSeleccionado"
        :items="terceroOptions"
        value-key="value"
        placeholder="Buscar proveedor, empresa o persona..."
        class="w-full"
      />
    </UFormField>
    <div class="grid grid-cols-2 gap-4">
      <UFormField
        label="Nombre o razón social"
        required
        class="col-span-2"
        :hint="contador('nombre')"
        :error="errorLargo('nombre')"
      >
        <UInput
          v-model="model.nombre"
          class="w-full"
          size="sm"
          autocomplete="name"
          :maxlength="LARGO_RECEPTOR.nombre"
          readonly
          placeholder="Nombre o razón social"
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
      <UFormField label="RUT" :required="regla.receptorCompleto || regla.identidadPagador" :error="errorRut">
        <UInput
          v-model="model.rut"
          class="w-full"
          size="sm"
          autocomplete="off"
          readonly
          placeholder="12.345.678-5"
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
      <UFormField label="Teléfono">
        <UInput
          v-model="model.telefono"
          class="w-full"
          size="sm"
          type="tel"
          autocomplete="tel"
          readonly
          placeholder="+56 9 ..."
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
      <UFormField
        label="Giro"
        :required="regla.receptorCompleto"
        class="col-span-2"
        :hint="contador('giro')"
        :error="errorLargo('giro')"
      >
        <UInput
          v-model="model.giro"
          class="w-full"
          size="sm"
          autocomplete="off"
          :maxlength="LARGO_RECEPTOR.giro"
          readonly
          placeholder="Actividad del cliente, abreviada"
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
      <UFormField
        label="Dirección"
        :required="regla.receptorCompleto"
        :hint="contador('direccion')"
        :error="errorLargo('direccion')"
      >
        <UInput
          v-model="model.direccion"
          class="w-full"
          size="sm"
          autocomplete="street-address"
          :maxlength="LARGO_RECEPTOR.direccion"
          readonly
          placeholder="Calle y número"
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
      <UFormField
        label="Comuna"
        :required="regla.receptorCompleto"
        :hint="contador('comuna')"
        :error="errorLargo('comuna')"
      >
        <UInput
          v-model="model.comuna"
          class="w-full"
          size="sm"
          autocomplete="off"
          :maxlength="LARGO_RECEPTOR.comuna"
          readonly
          placeholder="Comuna"
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
      <UFormField label="Email" class="col-span-2">
        <UInput
          v-model="model.email"
          class="w-full"
          size="sm"
          type="email"
          autocomplete="email"
          readonly
          placeholder="correo@ejemplo.com"
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
    </div>
  </div>
</template>
