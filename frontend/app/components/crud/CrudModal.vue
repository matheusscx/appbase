<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    confirmColor?: 'error' | 'primary' | 'neutral'
    loading?: boolean
  }>(),
  {
    confirmLabel: 'Eliminar',
    confirmColor: 'error',
    loading: false,
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
  <UModal v-model:open="open" :title="title">
    <template #body>
      <p class="text-sm">
        {{ message }}
      </p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="cancelar">
          Cancelar
        </UButton>
        <UButton
          :color="confirmColor"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
