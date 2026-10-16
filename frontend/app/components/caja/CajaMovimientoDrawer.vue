<script setup lang="ts">
import type { MovimientoCaja } from '~/stores/caja'

const props = defineProps<{
  cajaId: string
}>()

const emit = defineEmits<{
  saved: [MovimientoCaja]
}>()

const open = defineModel<boolean>('open', { required: true })

const cajaStore = useCajaStore()
const toast = useToast()
const { errores, marcar, limpiar } = useErroresCampo()
const saving = ref(false)

const emptyForm = () => ({
  tipo: 'entrada' as 'entrada' | 'salida',
  concepto: '',
  monto: '',
  referencia: '',
})

const form = ref(emptyForm())

watch(open, (isOpen) => {
  if (!isOpen) {
    form.value = emptyForm()
    limpiar()
  }
})

async function guardar() {
  const faltan: Record<string, string> = {}
  if (!form.value.concepto) faltan.concepto = 'Ingresa el concepto del movimiento'
  if (!form.value.monto) faltan.monto = 'Ingresa el monto'
  if (marcar(faltan)) return
  saving.value = true
  try {
    const mov = await cajaStore.registrarMovimiento(props.cajaId, {
      tipo: form.value.tipo,
      concepto: form.value.concepto,
      monto: form.value.monto,
      referencia: form.value.referencia || undefined,
    })
    toast.add({ title: 'Movimiento registrado', color: 'success' })
    emit('saved', mov)
    open.value = false
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al registrar movimiento')
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
              @click="() => { form.tipo = 'entrada' }"
            />
            <UButton
              type="button"
              block
              class="flex-1"
              :variant="form.tipo === 'salida' ? 'soft' : 'outline'"
              color="error"
              icon="i-lucide-circle-arrow-up"
              label="Salida"
              @click="() => { form.tipo = 'salida' }"
            />
          </div>
        </UFormField>

        <UFormField label="Concepto" required :error="errores.concepto">
          <UInput
            v-model="form.concepto"
            placeholder="Descripción del movimiento"
            class="w-full"
            autofocus
            @update:model-value="limpiar('concepto')"
          />
        </UFormField>

        <UFormField label="Monto" required :error="errores.monto">
          <MoneyInput v-model="form.monto" oficial class="w-full" @update:model-value="limpiar('monto')" />
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
      <UButton color="neutral" variant="ghost" @click="() => { open = false }">
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
