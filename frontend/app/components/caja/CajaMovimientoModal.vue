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
      <div class="space-y-4">
        <!-- Tipo selector -->
        <UFormField label="Tipo">
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors"
              :class="form.tipo === 'entrada'
                ? 'bg-green-50 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-500 dark:text-green-300'
                : 'border-border-default text-muted hover:bg-muted dark:hover:bg-muted'"
              @click="form.tipo = 'entrada'"
            >
              <UIcon name="i-heroicons-arrow-down-circle" class="w-4 h-4 inline mr-1" />
              Entrada
            </button>
            <button
              type="button"
              class="flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors"
              :class="form.tipo === 'salida'
                ? 'bg-red-50 border-red-400 text-red-700 dark:bg-red-900/30 dark:border-red-500 dark:text-red-300'
                : 'border-border-default text-muted hover:bg-muted dark:hover:bg-muted'"
              @click="form.tipo = 'salida'"
            >
              <UIcon name="i-heroicons-arrow-up-circle" class="w-4 h-4 inline mr-1" />
              Salida
            </button>
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
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="cerrar">
          Cancelar
        </UButton>
        <UButton
          :loading="saving"
          :color="form.tipo === 'entrada' ? 'success' : 'error'"
          @click="guardar"
        >
          Registrar {{ form.tipo }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
