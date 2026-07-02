<script setup lang="ts">
const props = defineProps<{
  cajaId: string
}>()

const emit = defineEmits<{
  saved: []
}>()

const open = defineModel<boolean>('open', { required: true })

const cajaStore = useCajaStore()
const toast = useToast()
const saving = ref(false)

const emptyForm = () => ({
  tipo: 'entrada' as 'entrada' | 'salida',
  concepto: '',
  monto: '',
  referencia: '',
})

const form = ref(emptyForm())

watch(open, (isOpen) => {
  if (!isOpen) form.value = emptyForm()
})

async function guardar() {
  if (!form.value.concepto) {
    toast.add({ title: 'Ingresa el concepto del movimiento', color: 'warning' })
    return
  }
  if (!form.value.monto) {
    toast.add({ title: 'Ingresa el monto', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await cajaStore.registrarMovimiento(props.cajaId, {
      tipo: form.value.tipo,
      concepto: form.value.concepto,
      monto: form.value.monto,
      referencia: form.value.referencia || undefined,
    })
    toast.add({ title: 'Movimiento registrado', color: 'success' })
    emit('saved')
    open.value = false
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al registrar movimiento'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">Registrar movimiento</span>
    </template>

    <template #body>
      <UForm id="caja-movimiento-form" :state="form" class="space-y-4" @submit="guardar">
        <UFormField label="Tipo">
          <div class="flex gap-2">
            <UButton
              type="button"
              block
              class="flex-1"
              :variant="form.tipo === 'entrada' ? 'soft' : 'outline'"
              color="success"
              icon="i-lucide-circle-arrow-down"
              label="Entrada"
              @click="form.tipo = 'entrada'"
            />
            <UButton
              type="button"
              block
              class="flex-1"
              :variant="form.tipo === 'salida' ? 'soft' : 'outline'"
              color="error"
              icon="i-lucide-circle-arrow-up"
              label="Salida"
              @click="form.tipo = 'salida'"
            />
          </div>
        </UFormField>

        <UFormField label="Concepto" required>
          <UInput
            v-model="form.concepto"
            placeholder="Descripción del movimiento"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField label="Monto" required>
          <MoneyInput v-model="form.monto" oficial class="w-full" />
        </UFormField>

        <UFormField label="Referencia">
          <UInput
            v-model="form.referencia"
            placeholder="Número de documento u otra referencia (opcional)"
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>

    <template #actions>
      <UButton color="neutral" variant="ghost" @click="open = false">
        Cancelar
      </UButton>
      <UButton
        type="submit"
        form="caja-movimiento-form"
        :loading="saving"
        :color="form.tipo === 'entrada' ? 'success' : 'error'"
      >
        Registrar {{ form.tipo }}
      </UButton>
    </template>
  </AppDrawer>
</template>
