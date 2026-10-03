<script setup lang="ts">
import type { UnidadElegida } from '~/composables/useUnidadesSerie'

/**
 * Selector de las unidades con serie que salen en una venta (POS y salón): en un
 * producto con número de serie quien vende elige CUÁL —el celular nuevo o el
 * usado— y la cantidad es cuántas eligió
 * (`docs/features/inventario-serializado.md`, § «Qué se ve»).
 *
 * Ofrece lo que `GET /items/:id/unidades?vendibles=true` trae (disponible en el
 * local y sin cuenta abierta que la tenga apartada) más las `seleccionadas`, que
 * el llamador pasa completas: en el salón las de la propia línea están apartadas
 * por esa misma cuenta y el servidor no las devuelve como vendibles, pero tienen
 * que verse marcadas para poder desmarcarlas. Las `excluir` son las de otras
 * líneas de la misma pantalla y no se ofrecen. Las `fijas` se ven marcadas y no
 * se desmarcan: en el salón, las de una línea ya despachada están en la mesa y se
 * sacan con Anular (owner, 2026-10-03); el servidor rechaza el conjunto que no
 * las contenga.
 */
const props = defineProps<{
  item: { id: string, nombre: string }
  /** Las que la línea ya tiene: abren marcadas. */
  seleccionadas: UnidadElegida[]
  /** Ids de otras líneas del mismo ítem en esta pantalla: no se muestran. */
  excluir: string[]
  /** Ids de las seleccionadas que no se pueden desmarcar. */
  fijas?: string[]
}>()

const emit = defineEmits<{ confirm: [unidades: UnidadElegida[]] }>()
const open = defineModel<boolean>('open', { required: true })

interface FilaUnidad extends UnidadElegida { garantiaHasta: string | null }

const toast = useToast()
const { formatFecha } = useFormatters()
const { cargarVendibles, etiquetaCondicion, colorCondicion } = useUnidadesSerie()

const cargando = ref(false)
// Distingue "no hay unidades" de "no pude traerlas": el estado vacío afirma lo primero.
const falloLaCarga = ref(false)
const filas = ref<FilaUnidad[]>([])
const elegidas = ref<string[]>([])
const busqueda = ref('')
// Descarta la respuesta que llega tarde si el modal se cerró y se reabrió.
let turno = 0

watch(open, async (v) => {
  if (!v) return
  const mio = ++turno
  busqueda.value = ''
  elegidas.value = props.seleccionadas.map(u => u.id)
  const propias: FilaUnidad[] = props.seleccionadas.map(u => ({ ...u, garantiaHasta: null }))
  filas.value = propias
  falloLaCarga.value = false
  cargando.value = true
  try {
    const vendibles = await cargarVendibles(props.item.id)
    if (mio !== turno) return
    const yaEstan = new Set(propias.map(u => u.id))
    // Una seleccionada que también viene como vendible toma de ahí la garantía y la condición:
    // `seleccionadas` solo trae id, serie y condición, y sin esto la garantía se perdería al reabrir.
    const vendiblePorId = new Map(vendibles.map(u => [u.id, u]))
    filas.value = [
      ...propias.map((u) => {
        const v = vendiblePorId.get(u.id)
        return v ? { ...u, condicion: v.condicion, garantiaHasta: v.garantiaHasta } : u
      }),
      ...vendibles
        .filter(u => !yaEstan.has(u.id))
        .map(u => ({ id: u.id, serie: u.serie, condicion: u.condicion, garantiaHasta: u.garantiaHasta })),
    ].filter(u => !props.excluir.includes(u.id))
  }
  catch (e: unknown) {
    if (mio !== turno) return
    falloLaCarga.value = true
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las unidades'), color: 'error' })
  }
  finally {
    if (mio === turno) cargando.value = false
  }
}, { immediate: true })

const visibles = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  return q ? filas.value.filter(f => f.serie.toLowerCase().includes(q)) : filas.value
})

function estaElegida(id: string): boolean {
  return elegidas.value.includes(id)
}

function esFija(id: string): boolean {
  return props.fijas?.includes(id) ?? false
}

function alternar(id: string, marcada: boolean | 'indeterminate') {
  const sin = elegidas.value.filter(e => e !== id)
  elegidas.value = marcada === true ? [...sin, id] : sin
}

/**
 * Enter con UNA sola coincidencia la marca: es lo que deja escanear o pegar un
 * IMEI tras otro sin tocar el mouse. Marca (no alterna): escanear dos veces la
 * misma no la desmarca. El buscador se limpia para la próxima.
 */
function marcarCoincidenciaUnica() {
  if (visibles.value.length !== 1) return
  const unica = visibles.value[0]!
  if (!estaElegida(unica.id)) elegidas.value = [...elegidas.value, unica.id]
  busqueda.value = ''
}

function confirmar() {
  // En el orden de la lista (nuevo → reacondicionado → usado), no en el de los clics.
  const elegidasEnOrden = filas.value
    .filter(f => estaElegida(f.id))
    .map(({ id, serie, condicion }) => ({ id, serie, condicion }))
  if (elegidasEnOrden.length === 0) return
  emit('confirm', elegidasEnOrden)
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Elegir unidades"
    :description="item.nombre"
    :ui="shellUi.modal"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <p v-if="fijas?.length" class="text-xs text-muted" data-qa="unidades-fijas-aviso">
          Ya se despachó: las unidades que tiene la línea no se sacan por acá. Para sacar o cambiar una, anulala.
        </p>
        <UInput
          v-model="busqueda"
          icon="i-lucide-search"
          placeholder="Buscar o escanear la serie"
          autocomplete="off"
          class="w-full"
          data-qa="unidades-buscador"
          @keydown.enter.prevent="marcarCoincidenciaUnica"
        />

        <div v-if="cargando" class="flex justify-center py-6">
          <UIcon name="i-lucide-loader" class="w-6 h-6 text-muted animate-spin" />
        </div>
        <p v-else-if="falloLaCarga && !filas.length" class="text-sm text-muted text-center py-6" data-qa="unidades-error">
          No se pudieron cargar las unidades
        </p>
        <p v-else-if="!filas.length" class="text-sm text-muted text-center py-6" data-qa="unidades-vacio">
          No hay unidades de «{{ item.nombre }}» en el local
        </p>
        <p v-else-if="!visibles.length" class="text-sm text-muted text-center py-6">
          Ninguna serie coincide con «{{ busqueda.trim() }}»
        </p>
        <ul v-else class="max-h-80 overflow-y-auto divide-y divide-default">
          <li
            v-for="f in visibles"
            :key="f.id"
            class="py-2"
            data-qa="unidad-fila"
            :data-serie="f.serie"
          >
            <UCheckbox
              :model-value="estaElegida(f.id)"
              :disabled="esFija(f.id)"
              @update:model-value="(v: boolean | 'indeterminate') => alternar(f.id, v)"
            >
              <template #label>
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-sm text-default">{{ f.serie }}</span>
                  <UBadge
                    :label="etiquetaCondicion(f.condicion)"
                    :color="colorCondicion(f.condicion)"
                    variant="subtle"
                    size="sm"
                  />
                  <span v-if="f.garantiaHasta" class="text-xs text-muted">
                    Garantía hasta {{ formatFecha(f.garantiaHasta) }}
                  </span>
                </span>
              </template>
            </UCheckbox>
          </li>
        </ul>
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
          :label="`Confirmar (${elegidas.length})`"
          color="primary"
          :disabled="elegidas.length === 0"
          data-qa="unidades-confirmar"
          @click="confirmar"
        />
      </div>
    </template>
  </UModal>
</template>
