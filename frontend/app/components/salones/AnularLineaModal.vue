<script setup lang="ts">
import Decimal from 'decimal.js'
import {
  aCantidadCanonica,
  desdeCantidadCanonica,
  esConteo,
  type UnidadCat,
} from '~/utils/cantidad-presentacion'
import {
  tipoMotivoBajaLabel,
  type CuentaLineaDetalle,
  type TipoMotivoBaja,
} from '~/composables/useSalones'

interface MotivoBajaOpt {
  id: string
  nombre: string
  tipo: TipoMotivoBaja
}

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  /** La línea a anular, o `null` mientras el modal está cerrado. */
  linea: CuentaLineaDetalle | null
  /** Unidad canónica del ítem — la misma que `linea.cantidadEnviada`. */
  unidadBase: string
  submitting?: boolean
}>()

const emit = defineEmits<{
  confirm: [{ cantidad: string, motivoBajaId: string }]
}>()

const salonesApi = useSalones()
const unidadesStore = useUnidadesMedidaStore()

const motivos = ref<MotivoBajaOpt[]>([])
const cargandoMotivos = ref(false)
const cantidad = ref<number | undefined>(undefined)
const motivoBajaId = ref<string | undefined>(undefined)

const catalogo = computed<UnidadCat[]>(() =>
  unidadesStore.unidades.map(u => ({
    codigo: u.codigo,
    magnitud: u.magnitud,
    factorBase: u.factorBase,
  })),
)

/** La misma presentación que ya muestra la línea en la lista de la cuenta. */
const unidadPresentacion = computed(() =>
  props.linea?.unidadCodigoPresentacion ?? props.unidadBase,
)

const esConteoLocal = computed(() => esConteo(unidadPresentacion.value, catalogo.value))

/**
 * El tope, convertido a la presentación de la línea (spec § 4.1: "la pantalla
 * muestra la presentación, 500 g, no 0,5 kg"). Reusa la misma conversión que
 * `AppCantidadInput`/`patchLineaCantidad` — no una nueva.
 */
const maximoPresentacion = computed(() => {
  if (!props.linea) return '0'
  try {
    return desdeCantidadCanonica(
      props.linea.cantidadEnviada,
      props.unidadBase,
      unidadPresentacion.value,
      catalogo.value,
    )
  }
  catch {
    return props.linea.cantidadEnviada
  }
})

const motivoItems = computed(() =>
  motivos.value.map(m => ({
    label: `${m.nombre} (${tipoMotivoBajaLabel(m.tipo)})`,
    value: m.id,
  })),
)

// Arranca vacío en cada apertura (spec: "arrancando destildado o vacío") y
// carga el catálogo de motivos — activos del tenant, los tres tipos.
watch(open, async (isOpen) => {
  cantidad.value = undefined
  motivoBajaId.value = undefined
  if (!isOpen) return
  await unidadesStore.ensureLoaded()
  cargandoMotivos.value = true
  try {
    motivos.value = await salonesApi.listarMotivosBajaActivos()
  }
  catch (e: unknown) {
    motivos.value = []
    useToast().add({ title: apiErrorMsg(e, 'No se pudieron cargar los motivos'), color: 'error' })
  }
  finally {
    cargandoMotivos.value = false
  }
})

const cantidadValida = computed(() => {
  if (cantidad.value === undefined || !Number.isFinite(cantidad.value)) return false
  if (cantidad.value <= 0) return false
  return new Decimal(cantidad.value).lte(maximoPresentacion.value || '0')
})

const puedeConfirmar = computed(() =>
  !!props.linea && cantidadValida.value && !!motivoBajaId.value && !props.submitting,
)

function confirmar() {
  if (!puedeConfirmar.value || !props.linea || !motivoBajaId.value || cantidad.value === undefined) return
  const cantidadCanonica = aCantidadCanonica(
    String(cantidad.value),
    unidadPresentacion.value,
    props.unidadBase,
    catalogo.value,
  )
  emit('confirm', { cantidad: cantidadCanonica, motivoBajaId: motivoBajaId.value })
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Anular plato"
    :description="linea ? `${linea.nombre}: se anula lo ya despachado a cocina.` : undefined"
    :ui="shellUi.modal"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField
          label="Cantidad a anular"
          required
          :description="`Máximo ${maximoPresentacion} ${unidadPresentacion} (lo despachado)`"
        >
          <UInputNumber
            v-model="cantidad"
            :min="esConteoLocal ? 1 : undefined"
            :max="Number(maximoPresentacion)"
            :step="1"
            :step-snapping="esConteoLocal"
            :disabled="submitting"
            placeholder="0"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Motivo" required>
          <USelectMenu
            v-model="motivoBajaId"
            :items="motivoItems"
            value-key="value"
            :loading="cargandoMotivos"
            :disabled="submitting"
            placeholder="Elegir motivo…"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton color="neutral" variant="ghost" :disabled="submitting" @click="() => { open = false }">
          Cancelar
        </UButton>
        <UButton color="error" :disabled="!puedeConfirmar" :loading="submitting" @click="confirmar">
          Anular
        </UButton>
      </AppModalFooter>
    </template>
  </UModal>
</template>
