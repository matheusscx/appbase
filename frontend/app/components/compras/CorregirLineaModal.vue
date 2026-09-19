<script setup lang="ts">
import type { CompraDetalle, LineaCompra } from '~/composables/useCompras'

/**
 * Completar o corregir una línea de una compra confirmada (spec § 4.4 y § 6):
 * el precio, la cantidad o los dos. Muestra el valor actual al lado del
 * nuevo, porque corregir cambia el costo de mercadería que ya entró.
 *
 * En serie, subir la cantidad pide las series que entran y bajarla pide
 * cuáles salen, de las que trajo esta línea (owner, 2026-09-19).
 */
const props = defineProps<{
  compraId: string
  linea: LineaCompra
}>()

const emit = defineEmits<{ success: [CompraDetalle] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const { diferenciaCantidad, cuerpoCorreccion, cantidadConUnidad, cantidadParaEditar } = useCompras()

const precio = ref('')
const cantidad = ref('')
const seriesTexto = ref('')
const unidadesQueSalen = ref<string[]>([])
const unidadesDeLaLinea = ref<{ id: string, serie: string }[]>([])
const enviando = ref(false)

const completar = computed(() => props.linea.precioUnitario == null)
const esSerie = computed(() => props.linea.modoInventario === 'serie')
const diferencia = computed(() => diferenciaCantidad(props.linea.cantidad, cantidad.value))

// `immediate`: el padre lo monta la primera vez YA abierto (con `v-if` sobre
// la línea elegida), y sin esto el modal abriría con los campos vacíos.
watch(open, async (v) => {
  if (!v) return
  precio.value = props.linea.precioUnitario ?? ''
  cantidad.value = cantidadParaEditar(props.linea.cantidad)
  seriesTexto.value = ''
  unidadesQueSalen.value = []
  unidadesDeLaLinea.value = []
  if (esSerie.value) await cargarUnidades()
}, { immediate: true })

/**
 * Las unidades que trajo esta línea y siguen disponibles en la ubicación de
 * la compra: son las únicas que pueden salir al bajar la cantidad. El filtro lo
 * hace el backend, en una ruta de Compras: con `/items/:id/unidades` corregir
 * exigía `Items:Leer` (owner, 2026-09-19).
 */
async function cargarUnidades() {
  try {
    unidadesDeLaLinea.value = await useApiFetch<{ id: string, serie: string }[]>(
      `${apiUrl}/compras/${props.compraId}/lineas/${props.linea.id}/unidades`,
    )
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las unidades'), color: 'error' })
  }
}

const seriesNuevas = computed(() =>
  seriesTexto.value.split('\n').map(s => s.trim()).filter(Boolean),
)

/** En serie, las series o unidades tienen que ser tantas como la diferencia. */
const serieCompleta = computed(() => {
  if (!esSerie.value || !diferencia.value) return true
  const pedidas = Number(diferencia.value.cuanto)
  return diferencia.value.sube
    ? seriesNuevas.value.length === pedidas
    : unidadesQueSalen.value.length === pedidas
})

const body = computed(() =>
  cuerpoCorreccion(
    { cantidad: props.linea.cantidad, precioUnitario: props.linea.precioUnitario },
    { cantidad: cantidad.value, precioUnitario: precio.value },
    esSerie.value && diferencia.value
      ? diferencia.value.sube
        ? { series: seriesNuevas.value }
        : { unidadIds: unidadesQueSalen.value }
      : {},
  ),
)

const puedeEnviar = computed(() => body.value != null && serieCompleta.value)

function alternarUnidad(id: string, marcada: boolean | 'indeterminate') {
  unidadesQueSalen.value = marcada === true
    ? [...unidadesQueSalen.value, id]
    : unidadesQueSalen.value.filter(u => u !== id)
}

async function enviar() {
  if (!puedeEnviar.value || enviando.value) return
  enviando.value = true
  try {
    const res = await useApiFetch<CompraDetalle>(
      `${apiUrl}/compras/${props.compraId}/lineas/${props.linea.id}`,
      { method: 'PATCH', body: body.value! },
    )
    toast.add({
      title: completar.value ? 'Precio completado: el costo se recalculó' : 'Línea corregida: el costo se recalculó',
      color: 'success',
    })
    open.value = false
    emit('success', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al corregir la línea'), color: 'error' })
  }
  finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="completar ? 'Completar el precio' : 'Corregir la línea'"
    :description="linea.itemNombre ?? undefined"
    :ui="shellUi.modal"
  >
    <template #body>
      <div class="flex flex-col gap-4" data-qa="corregir-linea">
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Precio unitario" :help="`Actual: ${linea.precioUnitario != null ? formatMonto(linea.precioUnitario) : 'sin precio'}`">
            <MoneyInput v-model="precio" oficial class="w-full" data-qa="corregir-precio" />
          </UFormField>
          <UFormField :label="`Cantidad (${linea.unidadCodigo})`" :help="`Actual: ${cantidadConUnidad(linea.cantidad, linea.unidadCodigo)}`">
            <UInput v-model="cantidad" inputmode="decimal" class="w-full" data-qa="corregir-cantidad" />
          </UFormField>
        </div>

        <UFormField
          v-if="esSerie && diferencia?.sube"
          :label="`Series que entran (${diferencia.cuanto})`"
          help="Una por renglón."
        >
          <UTextarea v-model="seriesTexto" :rows="3" class="w-full" data-qa="corregir-series" />
        </UFormField>

        <div v-if="esSerie && diferencia && !diferencia.sube" class="flex flex-col gap-2">
          <span class="text-sm text-muted">
            Cuáles salen ({{ diferencia.cuanto }}), de las que trajo esta compra:
          </span>
          <UCheckbox
            v-for="u in unidadesDeLaLinea"
            :key="u.id"
            :label="u.serie"
            :model-value="unidadesQueSalen.includes(u.id)"
            @update:model-value="(v: boolean | 'indeterminate') => alternarUnidad(u.id, v)"
          />
          <p v-if="!unidadesDeLaLinea.length" class="text-xs text-muted">
            No queda ninguna disponible en la ubicación de la compra.
          </p>
        </div>

        <p class="text-xs text-muted">
          El costo del producto se recalcula desde esta compra. Lo que ya se vendió queda con el costo de su momento.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          :label="completar ? 'Completar' : 'Corregir'"
          :loading="enviando"
          :disabled="!puedeEnviar"
          data-qa="corregir-enviar"
          @click="enviar"
        />
      </div>
    </template>
  </UModal>
</template>
