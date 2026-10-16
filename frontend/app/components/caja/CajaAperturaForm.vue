<script setup lang="ts">
const emit = defineEmits<{ opened: [cajaId: string] }>()

const cajaStore = useCajaStore()
const toast = useToast()
const { errores, marcar, limpiar } = useErroresCampo()
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
    toast.add({ title: 'Error al cargar las cajas disponibles', color: 'error' })
  }
  finally {
    loadingCajones.value = false
  }
})

async function abrir() {
  // Las dos faltas a la vez, junto a su campo y con el foco en la primera.
  const faltan: Record<string, string> = {}
  if (!form.value.cajonId) faltan.cajonId = 'Selecciona una caja'
  if (!form.value.saldoInicial) faltan.saldoInicial = 'Ingresa el saldo inicial'
  if (marcar(faltan)) return
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
    const msg = apiErrorMsg(e, 'Error al abrir la caja')
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
      <UFormField label="Caja" required :error="errores.cajonId">
        <USelectMenu
          v-model="form.cajonId"
          @update:model-value="limpiar('cajonId')"
          :items="cajaStore.cajonesDisponibles"
          value-key="cajonId"
          label-key="nombre"
          :loading="loadingCajones"
          :disabled="sinCajones"
          placeholder="Selecciona una caja"
          class="w-full"
        />
        <p v-if="sinCajones" class="text-sm text-warning mt-1">
          No hay cajas disponibles para abrir. Pide al administrador que te habilite una.
        </p>
      </UFormField>

      <UFormField label="Saldo inicial" required :error="errores.saldoInicial">
        <MoneyInput v-model="form.saldoInicial" oficial class="w-full" @update:model-value="limpiar('saldoInicial')" />
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
