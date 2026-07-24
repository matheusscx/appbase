<script setup lang="ts">
const emit = defineEmits<{ opened: [cajaId: string] }>()

const cajaStore = useCajaStore()
const toast = useToast()
const saving = ref(false)
const loadingCajones = ref(false)

const form = ref({
  saldoInicial: '',
  comentario: '',
  cajonId: '',
})

const sinCajones = computed(
  () => !loadingCajones.value && cajaStore.cajonesDisponibles.length === 0,
)

onMounted(async () => {
  loadingCajones.value = true
  try {
    await cajaStore.cargarCajonesDisponibles()
  }
  catch {
    toast.add({ title: 'Error al cargar los cajones disponibles', color: 'error' })
  }
  finally {
    loadingCajones.value = false
  }
})

async function abrir() {
  if (!form.value.saldoInicial) {
    toast.add({ title: 'Ingresa el saldo inicial', color: 'warning' })
    return
  }
  if (!form.value.cajonId) {
    toast.add({ title: 'Selecciona un cajón', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const caja = await cajaStore.abrir({
      saldoInicial: form.value.saldoInicial,
      comentario: form.value.comentario || undefined,
      cajonId: form.value.cajonId,
    })
    toast.add({ title: 'Caja abierta correctamente', color: 'success' })
    form.value = { saldoInicial: '', comentario: '', cajonId: '' }
    emit('opened', caja.id)
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
  <UCard class="w-full">
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
      <UFormField label="Cajón" required>
        <USelectMenu
          v-model="form.cajonId"
          :items="cajaStore.cajonesDisponibles"
          value-key="cajonId"
          label-key="nombre"
          :loading="loadingCajones"
          :disabled="sinCajones"
          placeholder="Selecciona un cajón"
          class="w-full"
        />
        <p v-if="sinCajones" class="text-sm text-warning mt-1">
          No hay cajas disponibles para abrir. Pedí al administrador que te habilite una.
        </p>
      </UFormField>

      <UFormField label="Saldo inicial" required>
        <MoneyInput v-model="form.saldoInicial" oficial class="w-full" />
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
          icon="i-lucide-lock-open"
          :loading="saving"
          :disabled="sinCajones"
        >
          Abrir caja
        </UButton>
      </div>
    </template>
  </UCard>
</template>
