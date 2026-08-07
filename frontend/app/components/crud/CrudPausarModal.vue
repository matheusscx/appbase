<script setup lang="ts">
// Confirmación de pausa, compartida por las tres pantallas de reglas
// (descuentos, recargos, impuestos). El copy vive acá y no triplicado: es la
// parte que se desincroniza sola cuando alguien afina el mensaje en una sola.
//
// Solo aparece cuando hay algo que perder de vista: si ningún ítem usa la
// regla, `usePausaRegla` pausa sin abrir esto.
const open = defineModel<boolean>('open', { required: true })

defineProps<{
  nombre: string
  /** Cuántos ítems dejan de recibir la regla. */
  items: number
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <CrudModal
    v-model:open="open"
    :title="`Pausar «${nombre}»`"
    :message="`Deja de aplicarse en ${items} ítem${items === 1 ? '' : 's'}.`"
    confirm-label="Pausar"
    confirm-color="neutral"
    @cancel="emit('cancel')"
    @confirm="emit('confirm')"
  >
    <template #detalle>
      <p class="mt-2 text-sm">
        Las asociaciones se conservan: al reactivarlo vuelve como estaba.
      </p>
    </template>
  </CrudModal>
</template>
