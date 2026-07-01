<script setup lang="ts">
const emit = defineEmits<{ opened: [] }>()

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
    emit('opened')
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
        <h2 class="text-base font-semibold text-default">
          Abrir caja
        </h2>
        <p class="text-sm text-muted mt-0.5">
          No hay caja abierta. Ingresa el saldo inicial para comenzar el turno.
        </p>
      </div>
    </template>

    <UForm id="caja-apertura-form" :state="form" class="space-y-4" @submit="abrir">
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
    </UForm>

    <template #footer>
      <div class="flex justify-end">
        <UButton
          type="submit"
          form="caja-apertura-form"
          icon="i-heroicons-lock-open"
          :loading="saving"
        >
          Abrir caja
        </UButton>
      </div>
    </template>
  </UCard>
</template>
