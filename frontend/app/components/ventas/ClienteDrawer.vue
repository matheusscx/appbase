<script setup lang="ts">
import type { CustomerForm } from './ClienteForm.vue'

const open = defineModel<boolean>('open', { required: true })
const customer = defineModel<CustomerForm>('customer', { required: true })
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">Datos del cliente</span>
    </template>

    <template #body>
      <VentasClienteForm v-model="customer" />
    </template>

    <template #actions>
      <UButton label="Listo" color="primary" block @click="() => { open = false }" />
    </template>
  </AppDrawer>
</template>
