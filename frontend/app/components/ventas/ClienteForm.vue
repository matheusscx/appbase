<script setup lang="ts">
export interface CustomerForm {
  nombre: string
  rut: string
  direccion: string
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
  activo: boolean
}

const model = defineModel<CustomerForm>({ required: true })

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
      <UFormField label="Nombre" required class="col-span-2">
        <UInput
          v-model="model.nombre"
          class="w-full"
          size="sm"
          autocomplete="name"
          readonly
          placeholder="Nombre o razón social"
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
      <UFormField label="RUT">
        <UInput
          v-model="model.rut"
          class="w-full"
          size="sm"
          autocomplete="off"
          readonly
          placeholder="12.345.678-9"
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
      <UFormField label="Dirección" class="col-span-2">
        <UInput
          v-model="model.direccion"
          class="w-full"
          size="sm"
          autocomplete="street-address"
          readonly
          placeholder="Calle, número, comuna"
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
