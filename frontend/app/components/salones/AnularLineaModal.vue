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
  confirm: [{ cantidad: string, unidadIds?: string[], motivoBajaId: string }]
}>()

const salonesApi = useSalones()
const unidadesStore = useUnidadesMedidaStore()
const { etiquetaCondicion, colorCondicion } = useUnidadesSerie()

const motivos = ref<MotivoBajaOpt[]>([])
const cargandoMotivos = ref(false)
const cantidad = ref<number | undefined>(undefined)
const motivoBajaId = ref<string | undefined>(undefined)
/** Solo en una línea con serie: los ids de las unidades que se anulan. */
const unidadesElegidas = ref<string[]>([])

/** Con serie la línea trae sus unidades y se anula por casillas; el resto, por cantidad. */
const unidadesLinea = computed(() => props.linea?.unidades ?? [])
const esSerie = computed(() => unidadesLinea.value.length > 0)

/** Lo despachado, en unidades enteras: es lo máximo que se puede marcar. */
const topeUnidades = computed(() => Math.floor(Number(props.linea?.cantidadEnviada ?? 0)))

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
  unidadesElegidas.value = []
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

function estaMarcada(id: string): boolean {
  return unidadesElegidas.value.includes(id)
}

/** Sumar se bloquea al llegar al tope; desmarcar nunca. */
function bloqueada(id: string): boolean {
  return !estaMarcada(id) && unidadesElegidas.value.length >= topeUnidades.value
}

function alternar(id: string, marcada: boolean | 'indeterminate') {
  const sin = unidadesElegidas.value.filter(e => e !== id)
  unidadesElegidas.value = marcada === true ? [...sin, id] : sin
}

const puedeConfirmar = computed(() =>
  !!props.linea
  && (esSerie.value ? unidadesElegidas.value.length > 0 : cantidadValida.value)
  && !!motivoBajaId.value
  && !props.submitting,
)

function confirmar() {
  if (!puedeConfirmar.value || !props.linea || !motivoBajaId.value) return
  if (esSerie.value) {
    // En el orden de la línea, no en el de los clics.
    const unidadIds = unidadesLinea.value.map(u => u.id).filter(estaMarcada)
    emit('confirm', { cantidad: String(unidadIds.length), unidadIds, motivoBajaId: motivoBajaId.value })
    return
  }
  if (cantidad.value === undefined) return
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
          v-if="esSerie"
          label="Unidades a anular"
          required
          :description="`Máximo ${topeUnidades} (lo despachado)`"
        >
          <ul class="divide-y divide-default">
            <li v-for="u in unidadesLinea" :key="u.id" class="py-2" data-qa="unidad-anular">
              <UCheckbox
                :model-value="estaMarcada(u.id)"
                :disabled="submitting || bloqueada(u.id)"
                @update:model-value="(v: boolean | 'indeterminate') => alternar(u.id, v)"
              >
                <template #label>
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-sm text-default">{{ u.serie }}</span>
                    <UBadge
                      :label="etiquetaCondicion(u.condicion)"
                      :color="colorCondicion(u.condicion)"
                      variant="subtle"
                      size="sm"
                    />
                  </span>
                </template>
              </UCheckbox>
            </li>
          </ul>
        </UFormField>
        <UFormField
          v-else
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
