<script setup lang="ts">
import Decimal from 'decimal.js'

export interface DesfaseInsumoDto {
  itemId: string
  nombre: string
  costoActual: string | null
}

export interface DesfaseItemDto {
  itemId: string
  tipo: 'receta' | 'combo'
  nombre: string
  costoActual: string
  costoPropuesto: string
  deltaCosto: string
  precioBase: string
  margenPctActual: string | null
  margenPctPropuesto: string | null
  precioSugerido: string | null
  afectados: DesfaseInsumoDto[]
}

export interface AplicarDesfaseItem {
  itemId: string
  actualizarPrecio?: boolean
  precioBase?: string
}

/**
 * Lo que se manda al descartar. El `costoPropuestoVisto` es **el número que
 * esta tabla tenía en pantalla**, y viaja porque el backend archiva ESE en vez
 * de recalcularlo: recalculando, un cambio de costo entre abrir la bandeja y
 * hacer clic dejaba archivado un número que el usuario nunca vio y la fila
 * desaparecía con el desfase adentro (medido 2026-08-24).
 */
export interface DescartarDesfaseItem {
  itemId: string
  costoPropuestoVisto: string
}

const props = withDefaults(
  defineProps<{
    filas: DesfaseItemDto[]
    highlightIngredienteId?: string | null
    loading?: boolean
  }>(),
  {
    highlightIngredienteId: null,
    loading: false,
  },
)

const emit = defineEmits<{
  aplicar: [items: AplicarDesfaseItem[]]
  descartar: [items: DescartarDesfaseItem[]]
  cerrar: []
}>()

// Aplicar y descartar pegan a `POST /desfases/*`, que exige
// `Items:Actualizar`. El gate vive acá y no en cada página porque el panel lo
// usan tres (`desfases`, `configuracion/items`, `inventario`) y las
// tres necesitan el mismo permiso: repetirlo en cada una es una copia que se
// desincroniza. "Después" no escribe, así que no se gatea.
const { puedeActualizar: puedeAplicar } = usePermisosCrud('Items')

const { formatMonto, formatPorcentaje } = useFormatters()
const monedasStore = useMonedasStore()

interface RowState {
  actualizarPrecio: boolean
  precioEditado: string
}

const selected = ref<Set<string>>(new Set())
const rowState = ref<Record<string, RowState>>({})

/**
 * El precio con el que se prefillea la fila, **cuantizado a la moneda oficial**.
 *
 * `precioSugerido` es una tasa de 4 decimales: lo calcula el motor y el backend lo
 * deja así a propósito —su docblock dice que cuantizarlo *"sería UX del prefill"*—.
 * Acá es donde esa UX vive: el campo no puede mostrar más decimales que la moneda,
 * así que aplicar el crudo dejaría la pantalla diciendo `4.447` y el POST llevando
 * `4447.0588`.
 *
 * 📌 Hasta el 2026-09-08 esto pasaba solo, y por un bug: `MoneyInput` re-emitía
 * cuantizado todo valor que le entraba por `props`. Ese re-emit se cerró —le
 * reescribía el modelo al padre sin que nadie tocara el campo— y con él se fue el
 * redondeo que esta pantalla estaba usando sin saberlo. Ahora es explícito.
 *
 * ⚠️ **Cuantiza con la misma llamada que formatea la pantalla**, no con el
 * `modo_redondeo` del tenant: `formatMontoManual` hace `abs.toFixed(cfg.decimals)`, y acá
 * es `new Decimal(crudo).toFixed(decimales)`. Es a propósito — lo que este número tiene
 * que igualar es **lo que el campo muestra**, y usar otro modo de redondeo reabriría la
 * misma divergencia por el otro lado. Y va contra la **oficial** porque el `MoneyInput` de
 * la fila es `oficial`; el día que el panel muestre la moneda del ítem, esto la sigue.
 */
function precioPrefill(f: DesfaseItemDto): string {
  const crudo = f.precioSugerido ?? f.precioBase
  const decimales = monedasStore.monedaOficial?.decimals
  if (decimales === undefined) return crudo
  try {
    return new Decimal(crudo).toFixed(decimales)
  }
  catch {
    return crudo
  }
}

function initFromFilas(filas: DesfaseItemDto[]) {
  const nextSelected = new Set<string>()
  const nextState: Record<string, RowState> = {}
  for (const f of filas) {
    nextSelected.add(f.itemId)
    nextState[f.itemId] = {
      actualizarPrecio: false,
      precioEditado: precioPrefill(f),
    }
  }
  selected.value = nextSelected
  rowState.value = nextState
}

watch(
  () => props.filas,
  (filas) => initFromFilas(filas),
  { immediate: true },
)

/**
 * La carrera que este panel puede perder: `desfases.vue` pide sus filas en su propio
 * `onMounted`, y quien dispara `monedasStore.ensureLoaded()` es el layout. Con una carga
 * dura de `/desfases`, las filas pueden llegar **antes** que la moneda oficial — y ahí
 * `precioPrefill` no tiene escala con la que cuantizar y devuelve el crudo, que es
 * justamente el número que no se puede mostrar.
 *
 * Se rehace en cualquier transición `null → moneda`, no solo en la primera. Lo que hace que
 * pisar `precioEditado` sea seguro es un invariante **del componente**, no de una pantalla:
 * mientras `monedaOficial` es `null`, el `MoneyInput` de la fila se renderiza **deshabilitado**
 * (`!cfg`), así que en la ventana que este `watch` sobreescribe nadie pudo tipear.
 * ⚠️ Eso no cubriría una **segunda** transición `null → moneda` con el panel montado y algo ya
 * tipeado. Hoy no existe por dos hechos, y ninguno de los dos es "nadie repuebla monedas"
 * —`ensureLoaded()` tiene cuatro llamadores y uno es `configuracion/items`, host de este
 * panel—: **(a)** el store solo se vacía en `clearAuth` y en `switchTenant`, y a `switchTenant`
 * se entra desde `select-tenant` o desde `handlePostLogin` —que además del login lo llama el
 * middleware de ruta, o sea con la página anterior todavía montada; da igual, porque ese
 * camino produce `moneda → null`, que el guard descarta—; **(b)**
 * repoblarlo exige un `ensureLoaded()`, que en los cuatro llamadores cuelga de un `onMounted`.
 * ⚠️ Lo que NO alcanza como argumento es el `navigateTo('/')` de `switchTenant`: está dentro
 * del `try`, después del `reset()`, así que un switch fallido deja el store vacío sin navegar.
 * Y tampoco alcanza mirar esos cuatro `ensureLoaded()`: `hydrate()` está exportado, así que un
 * llamador nuevo fuera de un `onMounted` rompe (b) sin tocar ninguno de los cuatro.
 * Si mañana una pantalla repuebla el store con el panel abierto, ésta es la línea a revisar.
 *
 * Y reescribe
 * **solo `precioEditado`**, no `initFromFilas`: las casillas —seleccionar la fila y
 * "Actualizar precio"— no dependen de la moneda, se dibujan apenas llegan las filas, y en
 * esta misma ventana alguien puede haberlas tocado. Reiniciarlas le revertiría su elección
 * en silencio, y con "Descartar" eso archiva la bandeja entera en vez de las filas que
 * eligió. El precio sí se puede pisar: sin moneda resuelta el `MoneyInput` se renderiza
 * deshabilitado, así que ahí nadie tipeó nada.
 *
 * Lo levantó la revisión independiente del 2026-09-08 —las dos mitades: la carrera y esta—;
 * hasta entonces la carrera la tapaba el re-emit de `MoneyInput`, que se cerró en ese mismo
 * commit.
 */
watch(
  () => monedasStore.monedaOficial,
  (nueva, anterior) => {
    if (anterior || !nueva) return
    for (const f of props.filas) {
      const st = rowState.value[f.itemId]
      if (st) st.precioEditado = precioPrefill(f)
    }
  },
)

const allSelected = computed(
  () => props.filas.length > 0 && props.filas.every((f) => selected.value.has(f.itemId)),
)

const someSelected = computed(() =>
  props.filas.some((f) => selected.value.has(f.itemId)),
)

function toggleAll(value: boolean | 'indeterminate') {
  if (value === true) {
    selected.value = new Set(props.filas.map((f) => f.itemId))
  } else {
    selected.value = new Set()
  }
}

function toggleOne(id: string, value: boolean | 'indeterminate') {
  const next = new Set(selected.value)
  if (value === true) next.add(id)
  else next.delete(id)
  selected.value = next
}

function isHighlighted(fila: DesfaseItemDto): boolean {
  const hid = props.highlightIngredienteId
  if (!hid) return false
  return fila.afectados.some((i) => i.itemId === hid)
}

function deltaClass(delta: string): string {
  try {
    const d = new Decimal(delta)
    if (d.isZero()) return 'text-muted'
    return d.isPositive() ? 'text-error' : 'text-success'
  } catch {
    return 'text-muted'
  }
}

function onAplicar() {
  const items: AplicarDesfaseItem[] = props.filas
    .filter((f) => selected.value.has(f.itemId))
    .map((f) => {
      const st = rowState.value[f.itemId]
      const item: AplicarDesfaseItem = { itemId: f.itemId }
      if (st?.actualizarPrecio) {
        item.actualizarPrecio = true
        item.precioBase = st.precioEditado
      }
      return item
    })
  if (!items.length) return
  emit('aplicar', items)
}

function onDescartar() {
  // Se manda el `costoPropuesto` de la fila TAL COMO SE ESTÁ MOSTRANDO: es el
  // número que el usuario tiene delante y sobre el que decidió.
  const items = props.filas
    .filter((f) => selected.value.has(f.itemId))
    .map((f) => ({ itemId: f.itemId, costoPropuestoVisto: f.costoPropuesto }))
  if (!items.length) return
  emit('descartar', items)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-muted">
      Estos items tienen un costo distinto al registrado. Puedes aplicar el nuevo costo,
      descartar el aviso o revisar más tarde.
    </p>

    <div class="overflow-x-auto rounded-lg border border-default">
      <table class="w-full min-w-[44rem] text-sm">
        <thead class="bg-elevated text-left text-muted">
          <tr class="border-b border-default">
            <th class="w-10 px-3 py-2">
              <UCheckbox
                :model-value="allSelected ? true : someSelected ? 'indeterminate' : false"
                aria-label="Seleccionar todas"
                @update:model-value="toggleAll"
              />
            </th>
            <th class="px-3 py-2 font-medium">Tipo</th>
            <th class="px-3 py-2 font-medium">Item</th>
            <th class="px-3 py-2 font-medium text-right">Costo</th>
            <th class="px-3 py-2 font-medium text-right">Margen</th>
            <th class="px-3 py-2 font-medium">Precio</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-if="loading">
            <td colspan="6" class="px-3 py-8 text-center text-muted">Cargando…</td>
          </tr>
          <tr v-else-if="!filas.length">
            <td colspan="6" class="px-3 py-8 text-center text-muted">Sin costos desfasados.</td>
          </tr>
          <tr
            v-for="fila in filas"
            v-else
            :key="fila.itemId"
            :class="isHighlighted(fila) ? 'bg-elevated' : 'bg-default'"
          >
            <td class="px-3 py-3 align-top">
              <UCheckbox
                :model-value="selected.has(fila.itemId)"
                :aria-label="`Seleccionar ${fila.nombre}`"
                @update:model-value="(v) => toggleOne(fila.itemId, v)"
              />
            </td>
            <td class="px-3 py-3 align-top">
              <UBadge
                :color="fila.tipo === 'combo' ? 'primary' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ fila.tipo === 'combo' ? 'Combo' : 'Receta' }}
              </UBadge>
            </td>
            <td class="px-3 py-3 align-top">
              <div class="font-medium text-default">{{ fila.nombre }}</div>
              <div
                v-if="fila.afectados.length"
                class="mt-1 text-xs text-muted"
              >
                {{ fila.afectados.map((i) => i.nombre).join(', ') }}
              </div>
            </td>
            <td class="px-3 py-3 align-top text-right font-mono tabular-nums">
              <div class="text-default">
                {{ formatMonto(fila.costoActual) }}
                <span class="text-muted">→</span>
                {{ formatMonto(fila.costoPropuesto) }}
              </div>
              <div class="text-xs" :class="deltaClass(fila.deltaCosto)">
                Δ {{ formatMonto(fila.deltaCosto) }}
              </div>
            </td>
            <td class="px-3 py-3 align-top text-right tabular-nums">
              <span class="text-default">{{ formatPorcentaje(fila.margenPctActual) }}</span>
              <span class="text-muted"> → </span>
              <span class="text-default">{{ formatPorcentaje(fila.margenPctPropuesto) }}</span>
            </td>
            <td class="px-3 py-3 align-top">
              <div class="flex min-w-40 flex-col gap-2">
                <MoneyInput
                  v-if="rowState[fila.itemId]"
                  v-model="rowState[fila.itemId]!.precioEditado"
                  oficial
                  size="sm"
                  class="w-full"
                  :disabled="!rowState[fila.itemId]?.actualizarPrecio"
                />
                <UCheckbox
                  v-if="rowState[fila.itemId]"
                  v-model="rowState[fila.itemId]!.actualizarPrecio"
                  label="Actualizar precio"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <UButton color="neutral" variant="ghost" @click="emit('cerrar')">
        Después
      </UButton>
      <UButton
        v-if="puedeAplicar"
        color="neutral"
        variant="outline"
        :disabled="!someSelected || loading"
        @click="onDescartar"
      >
        Descartar seleccionadas
      </UButton>
      <UButton
        v-if="puedeAplicar"
        color="primary"
        :disabled="!someSelected || loading"
        @click="onAplicar"
      >
        Aplicar seleccionadas
      </UButton>
    </div>
  </div>
</template>
