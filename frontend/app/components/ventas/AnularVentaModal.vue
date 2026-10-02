<script setup lang="ts">
import { documentoPreguntado } from '~/composables/useDocumentosVenta'

const props = defineProps<{
  ventaId: string
  /**
   * La venta vino de una cuenta de salón con al menos una línea ya enviada a
   * cocina (lo calcula el backend en `GET /ventas/:id`). Es lo que decide el
   * DEFAULT del checkbox de reposición, no un bloqueo: el cajero lo tilda igual
   * si la mercadería sigue vendible.
   */
  tieneLineasDespachadas: boolean
  /**
   * Del backend (`anularPreguntaExterno`): la venta tiene un documento hecho por
   * fuera sin número, y antes de anular hay que saber si ya existe en el otro
   * facturador. Sin esta bandera el modal no pregunta: **y no manda
   * `externoHecho`**, porque "ausente" es "no se preguntó" y `null` es un 400.
   */
  preguntaExterno?: boolean
  /** `tipoDocumento.esBoleta` del detalle: "esta factura" o "este documento" en la pregunta. */
  esBoleta?: boolean
}>()

export interface AnularVentaSuccessPayload {
  id: string
  estado: string
  stockRepuesto: boolean
  motivo: string
}

const emit = defineEmits<{ success: [AnularVentaSuccessPayload] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const motivo = ref('')
/**
 * Nace DESTILDADO si alguna línea ya se despachó (decisión del owner
 * 2026-08-15, caso mixto resuelto el 2026-08-23): reponer comida que la cocina
 * ya hizo mete al stock ingredientes que físicamente no existen, y eso es peor
 * que no reponer. Uno solo para toda la venta: basta con que ALGUNA línea haya
 * salido.
 */
const reponerStock = ref(!props.tieneLineasDespachadas)
const submitting = ref(false)
/** `null` hasta que el cajero contesta: sin respuesta no se puede anular. */
const respuestaExterno = ref<'si' | 'no' | null>(null)

const MOTIVO_MIN = 10

watch(open, (v) => {
  if (!v) return
  motivo.value = ''
  reponerStock.value = !props.tieneLineasDespachadas
  respuestaExterno.value = null
})

const motivoValido = computed(() => motivo.value.trim().length >= MOTIVO_MIN)

/**
 * Con la pregunta abierta, solo el "No" deja anular. El "Sí" no anula: si el
 * documento ya está hecho en el otro facturador, se revierte con una nota de
 * crédito (el servidor también lo rechaza con 400, pero no hace falta mandarlo).
 */
const puedeConfirmar = computed(() =>
  motivoValido.value && (!props.preguntaExterno || respuestaExterno.value === 'no'),
)

const ayudaReposicion = computed(() =>
  props.tieneLineasDespachadas
    ? 'Hay platos ya enviados a cocina: eso no vuelve al inventario. Tildalo solo si la mercadería sigue vendible.'
    : 'Desmarcalo solo si la mercadería ya no está vendible: el descuento queda como pérdida.',
)

async function confirmar() {
  if (!puedeConfirmar.value) return
  submitting.value = true
  try {
    const res = await useApiFetch<AnularVentaSuccessPayload>(
      `${apiUrl}/ventas/${props.ventaId}/anular`,
      {
        method: 'POST',
        body: {
          motivo: motivo.value.trim(),
          reponerStock: reponerStock.value,
          // Solo si se preguntó, y solo puede ser `false` acá (con "Sí" no se llega).
          ...(props.preguntaExterno ? { externoHecho: false } : {}),
        },
      },
    )
    toast.add({
      title: res.stockRepuesto
        ? 'Venta anulada y stock repuesto'
        : 'Venta anulada sin reponer stock',
      color: 'success',
    })
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al anular la venta'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Anular venta" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          La anulación deshace la venta por completo. Solo se anulan las ventas
          pendientes sin pagos: una venta cobrada se revierte con una nota de
          crédito.
        </p>

        <div v-if="preguntaExterno" class="flex flex-col gap-2" data-qa="pregunta-externo">
          <p class="text-sm font-medium text-default">
            ¿Ya hiciste {{ documentoPreguntado(esBoleta) }} en tu facturador?
          </p>
          <div class="flex gap-2">
            <UButton
              label="Sí"
              :variant="respuestaExterno === 'si' ? 'solid' : 'outline'"
              color="neutral"
              :aria-pressed="respuestaExterno === 'si'"
              data-qa="externo-si"
              @click="() => { respuestaExterno = 'si' }"
            />
            <UButton
              label="No"
              :variant="respuestaExterno === 'no' ? 'solid' : 'outline'"
              color="neutral"
              :aria-pressed="respuestaExterno === 'no'"
              data-qa="externo-no"
              @click="() => { respuestaExterno = 'no' }"
            />
          </div>
          <UAlert
            v-if="respuestaExterno === 'si'"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            data-qa="externo-si-explica"
            description="Si ya está hecho, la venta no se anula: se revierte con una nota de crédito, hecha por fuera en tu facturador y anotada acá con su número."
          />
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Motivo</span>
          <UTextarea
            v-model="motivo"
            :rows="3"
            placeholder="Por qué se anula esta venta"
          />
          <p v-if="motivo && !motivoValido" class="text-xs text-error">
            Contá el motivo con al menos {{ MOTIVO_MIN }} caracteres: queda como
            registro de auditoría.
          </p>
        </div>

        <UCheckbox
          v-model="reponerStock"
          label="Reponer el stock que la venta descontó"
          :description="ayudaReposicion"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="() => { open = false }"
        />
        <UButton
          label="Anular venta"
          color="error"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </div>
    </template>
  </UModal>
</template>
