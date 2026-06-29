<script setup lang="ts">
export interface CustomerForm {
  nombre: string
  rut: string
  direccion: string
  telefono: string
  email: string
}

const model = defineModel<CustomerForm>({ required: true })
</script>

<template>
  <div class="flex flex-col gap-3 border-t border-default pt-3">
    <p class="text-sm font-medium text-default">Datos del cliente</p>
    <UFormField label="Nombre" required>
      <UInput v-model="model.nombre" placeholder="Nombre o razón social" />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField label="RUT">
        <UInput v-model="model.rut" placeholder="12.345.678-9" />
      </UFormField>
      <UFormField label="Teléfono">
        <UInput v-model="model.telefono" placeholder="+56 9 ..." />
      </UFormField>
    </div>
    <UFormField label="Dirección">
      <UInput v-model="model.direccion" />
    </UFormField>
    <UFormField label="Email">
      <UInput v-model="model.email" type="email" />
    </UFormField>
  </div>
</template>
