<script setup lang="ts">
const props = defineProps<{
  open: boolean
  cajaId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

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

function cerrar() {
  emit('update:open', false)
}

function onAfterLeave() {
  form.value = emptyForm()
}

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
    cerrar()
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
  <UModal
    :open="open"
    title="Registrar movimiento"
    @update:open="emit('update:open', $event)"
    @after-leave="onAfterLeave"
  >
    <template #body>
      <UForm id="caja-movimiento-form" :state="form" class="space-y-4" @submit="guardar">
        <!-- Tipo selector -->
        <UFormField label="Tipo">
          <div class="flex gap-2">
            <UButton
              type="button"
              block
              class="flex-1"
              :variant="form.tipo === 'entrada' ? 'soft' : 'outline'"
              :color="form.tipo === 'entrada' ? 'success' : 'neutral'"
              icon="i-lucide-circle-arrow-down"
              label="Entrada"
              @click="form.tipo = 'entrada'"
            />
            <UButton
              type="button"
              block
              class="flex-1"
              :variant="form.tipo === 'salida' ? 'soft' : 'outline'"
              :color="form.tipo === 'salida' ? 'error' : 'neutral'"
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
          />
        </UFormField>

        <UFormField label="Monto" required>
          <UInput
            v-model="form.monto"
            inputmode="decimal"
            placeholder="0.00"
            class="w-full"
          />
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

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="cerrar">
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
      </div>
    </template>
  </UModal>
</template>
