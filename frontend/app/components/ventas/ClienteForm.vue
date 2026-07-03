<script setup lang="ts">
export interface CustomerForm {
  nombre: string
  rut: string
  direccion: string
  telefono: string
  email: string
}

const model = defineModel<CustomerForm>({ required: true })

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
