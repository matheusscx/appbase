<script setup lang="ts">
const cajaStore = useCajaStore()
const toast = useToast()
const saving = ref(false)

const form = ref({
  saldoInicial: '',
  comentario: '',
})

async function abrir() {
  if (!form.value.saldoInicial) {
    toast.add({ title: 'Ingresa el saldo inicial', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await cajaStore.abrir({
      saldoInicial: form.value.saldoInicial,
      comentario: form.value.comentario || undefined,
    })
    toast.add({ title: 'Caja abierta correctamente', color: 'success' })
    form.value = { saldoInicial: '', comentario: '' }
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al abrir la caja'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="text-base font-semibold">
          Abrir caja
        </h2>
        <p class="text-sm text-gray-500 mt-0.5">
          No hay caja abierta. Ingresa el saldo inicial para comenzar el turno.
        </p>
      </div>
    </template>

    <div class="space-y-4">
      <UFormField label="Saldo inicial" required>
        <UInput
          v-model="form.saldoInicial"
          inputmode="decimal"
          placeholder="0.00"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Comentario">
        <UInput
          v-model="form.comentario"
          placeholder="Observaciones del turno (opcional)"
          class="w-full"
        />
      </UFormField>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <UButton
          icon="i-heroicons-lock-open"
          :loading="saving"
          @click="abrir"
        >
          Abrir caja
        </UButton>
      </div>
    </template>
  </UCard>
</template>
