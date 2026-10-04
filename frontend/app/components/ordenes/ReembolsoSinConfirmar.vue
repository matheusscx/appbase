<script setup lang="ts">
/**
 * Un reembolso que quedó sin confirmar (Transbank no contestó): primero se
 * vuelve a consultar el saldo; si la consulta no lo aclara, el admin revisa el
 * portal de Transbank y marca "Salió" (con el código de autorización) o "No
 * salió" (ADR-029, decisión del owner del 2026-10-04).
 */
const props = defineProps<{
  ordenId: string
  transaccionId: string
  monto: string | null
}>()

const emit = defineEmits<{ resuelto: [] }>()

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const consultando = ref(false)
const marcando = ref(false)
// La consulta no lo aclaró: recién ahí se ofrece marcarlo a mano.
const aMano = ref(false)
const codigoAutorizacion = ref('')

const montoTexto = computed(() => (props.monto ? formatMonto(props.monto) : ''))

async function volverAConsultar() {
  consultando.value = true
  try {
    const res = await useApiFetch<{ aclarado: 'salio' | 'no_salio' | 'ya_resuelto' | null, warning?: string }>(
      `${apiUrl}/pasarela/admin/ordenes/${props.ordenId}/reembolsos/aclarar`,
      { method: 'POST' },
    )
    if (res.aclarado === 'salio')
      toast.add({ title: `El reembolso de ${montoTexto.value} salió: quedó registrado`, description: res.warning, color: 'success' })
    else if (res.aclarado === 'no_salio')
      toast.add({ title: `El reembolso de ${montoTexto.value} no salió: podés reembolsar de nuevo`, color: 'warning' })
    emit('resuelto')
  }
  catch (e: unknown) {
    if ((e as { status?: number })?.status === 409) aMano.value = true
    toast.add({ title: apiErrorMsg(e, 'No se pudo consultar a Transbank'), color: 'error' })
  }
  finally {
    consultando.value = false
  }
}

async function marcar(salio: boolean) {
  marcando.value = true
  try {
    const res = await useApiFetch<{ warning?: string }>(
      `${apiUrl}/pasarela/admin/ordenes/${props.ordenId}/reembolsos/${props.transaccionId}/resolucion`,
      {
        method: 'POST',
        body: salio ? { salio, codigoAutorizacion: codigoAutorizacion.value.trim() } : { salio },
      },
    )
    toast.add(salio
      ? { title: 'Reembolso marcado como hecho', description: res.warning, color: res.warning ? 'warning' : 'success' }
      : { title: 'Reembolso marcado como no hecho: la orden queda libre', color: 'success' })
    emit('resuelto')
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo marcar el reembolso'), color: 'error' })
    // Si otro lo resolvió en el medio, lo que hay que ver es la orden actual.
    if ((e as { status?: number })?.status === 409) emit('resuelto')
  }
  finally {
    marcando.value = false
  }
}
</script>

<template>
  <UAlert
    color="warning"
    variant="subtle"
    icon="i-lucide-circle-help"
    :title="`Hay un reembolso de ${montoTexto} sin confirmar`"
    description="Transbank no confirmó si la plata salió. El sistema no lo vuelve a intentar solo."
  >
    <template #actions>
      <div class="flex w-full flex-col gap-3">
        <div>
          <UButton
            label="Volver a consultar"
            icon="i-lucide-refresh-cw"
            color="warning"
            variant="outline"
            size="sm"
            :loading="consultando"
            :disabled="marcando"
            @click="volverAConsultar"
          />
        </div>
        <div v-if="aMano" class="flex flex-col gap-2">
          <p class="text-sm text-default">
            Revisalo en el portal de Transbank y marcá lo que dice.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <UInput
              v-model="codigoAutorizacion"
              placeholder="Código de autorización"
              size="sm"
              aria-label="Código de autorización del portal"
            />
            <UButton
              label="Salió"
              color="success"
              size="sm"
              :loading="marcando"
              :disabled="!codigoAutorizacion.trim() || consultando"
              @click="marcar(true)"
            />
            <UButton
              label="No salió"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="marcando"
              :disabled="consultando"
              @click="marcar(false)"
            />
          </div>
        </div>
      </div>
    </template>
  </UAlert>
</template>
