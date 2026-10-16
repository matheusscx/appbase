<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    /** Para un modal que destruye: el que sale dice "Volver" y no repite la palabra del que confirma. */
    cancelLabel?: string
    confirmColor?: 'error' | 'primary' | 'neutral'
    loading?: boolean
    soloCerrar?: boolean
    /** Para los modales cuyo `#detalle` pide un dato: sin él, confirmar sería
     * un click que no hace nada (ver el modal de colisión de `descuentos`). */
    confirmDisabled?: boolean
  }>(),
  {
    confirmLabel: 'Eliminar',
    cancelLabel: 'Cancelar',
    confirmColor: 'error',
    loading: false,
    soloCerrar: false,
    confirmDisabled: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function cancelar() {
  open.value = false
  emit('cancel')
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="shellUi.modal">
    <template #body>
      <p class="text-sm">
        {{ message }}
      </p>
      <slot name="detalle" />
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton
          v-if="soloCerrar"
          color="neutral"
          @click="cancelar"
        >
          Entendido
        </UButton>
        <template v-else>
          <UButton color="neutral" variant="ghost" @click="cancelar">
            {{ cancelLabel }}
          </UButton>
          <UButton
            :color="confirmColor"
            :loading="loading"
            :disabled="confirmDisabled"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </UButton>
        </template>
      </AppModalFooter>
    </template>
  </UModal>
</template>
