<script setup lang="ts">
/**
 * "Marcar visto" de un cierre con diferencia grande. Actúa sobre algo que no se puede deshacer
 * (el backend rechaza con 400 un cierre ya revisado: pisar `revisado_por` borraría al primero que
 * miró), así que **pregunta antes** en vez de ofrecer un "Deshacer" que no existe (03.26).
 *
 * Lo usan la bandeja y el detalle de la caja: es el mismo gesto con el mismo texto.
 */
const props = defineProps<{
  cajaId: string
  /** Para nombrar de quién es el cierre en la pregunta; sin nombre, "este cierre". */
  cajero?: string | null
}>()

const emit = defineEmits<{ marcado: [] }>()

const cajaStore = useCajaStore()
const toast = useToast()

const confirmando = ref(false)
const marcando = ref(false)

async function marcar() {
  if (marcando.value) return
  marcando.value = true
  try {
    await cajaStore.marcarRevisado(props.cajaId)
    toast.add({ title: 'Cierre marcado como revisado', color: 'success' })
    confirmando.value = false
    emit('marcado')
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo marcar como revisado'), color: 'error' })
  }
  finally {
    marcando.value = false
  }
}
</script>

<template>
  <UButton
    size="xl"
    class="min-h-11"
    color="primary"
    icon="i-lucide-check"
    label="Marcar visto"
    :data-qa="`marcar-visto-${cajaId}`"
    @click="() => { confirmando = true }"
  />

  <UModal
    v-model:open="confirmando"
    :title="cajero ? `¿Marcar visto el cierre de ${cajero}?` : '¿Marcar visto este cierre?'"
    :ui="shellUi.modal"
  >
    <template #body>
      <p class="text-sm text-default" data-qa="marcar-visto-aviso">
        Queda registrado que lo revisaste tú, con fecha y hora, y el cierre sale de la bandeja.
        No se puede deshacer.
      </p>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" size="xl" class="min-h-11" @click="() => { confirmando = false }" />
        <UButton
          label="Marcar visto"
          color="primary"
          size="xl"
          class="min-h-11"
          :loading="marcando"
          data-qa="marcar-visto-confirmar"
          @click="marcar"
        />
      </div>
    </template>
  </UModal>
</template>
