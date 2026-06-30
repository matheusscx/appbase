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
  <div class="flex flex-col gap-3 border-t border-default pt-3">
    <p class="text-sm font-medium text-default">Datos del cliente</p>
    <UFormField label="Nombre" required>
      <UInput
        v-model="model.nombre"
        autocomplete="name"
        readonly
        placeholder="Nombre o razón social"
        @focusin="quitarReadonly"
        @focusout="ponerReadonly"
      />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField label="RUT">
        <UInput
          v-model="model.rut"
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
          type="tel"
          autocomplete="tel"
          readonly
          placeholder="+56 9 ..."
          @focusin="quitarReadonly"
          @focusout="ponerReadonly"
        />
      </UFormField>
    </div>
    <UFormField label="Dirección">
      <UInput
        v-model="model.direccion"
        autocomplete="street-address"
        readonly
        @focusin="quitarReadonly"
        @focusout="ponerReadonly"
      />
    </UFormField>
    <UFormField label="Email">
      <UInput
        v-model="model.email"
        type="email"
        autocomplete="email"
        readonly
        @focusin="quitarReadonly"
        @focusout="ponerReadonly"
      />
    </UFormField>
  </div>
</template>
