<script setup lang="ts">
import { puedeAgregarItem, stockPedible, tieneStockPedible, type ItemCatalogo } from '~/composables/useVenta'

const props = defineProps<{
  items: ItemCatalogo[]
  loading?: boolean
  total: number
  pageSize: number
  /** La carga falló: si no quedan ítems de antes, el panel dice que no pudo cargar y ofrece Reintentar. */
  error?: boolean
  /** El fallo fue un 403. */
  sinPermiso?: boolean
  /** Qué decir cuando no hay ítems y nadie buscó nada (la tienda online dice otra cosa que el POS). */
  vacio?: string
  /**
   * El mostrador lo prende: el buscador toma el foco al abrir, para que un lector de códigos
   * escriba directo. Solo con puntero fino (escritorio): en una tablet abriría el teclado en pantalla.
   */
  autofocus?: boolean
  /** Chips de categoría arriba de la búsqueda (hoy solo el salón). Sin ellas no se dibujan. */
  categorias?: { id: string, nombre: string }[]
  /** Ofrece el chip «Favoritos» junto a las categorías (hoy solo el salón). */
  favoritos?: boolean
}>()
const emit = defineEmits<{
  add: [item: ItemCatalogo]
  reintentar: []
  /** Enter en el buscador: lo que manda un lector de códigos al terminar de leer. */
  'buscar-enter': []
}>()

const buscador = useTemplateRef('buscador')
onMounted(() => {
  if (!props.autofocus) return
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return
  buscador.value?.inputRef?.focus()
})

const { esMonedaExtranjera, convertirAMonedaOficial, monedaOficial } = useMonedaConversion()
const { formatStock } = useFormatters()
// El servidor busca, ordena (`orden=disponibilidad`) y pagina: la grilla solo pinta.
const busqueda = defineModel<string>('busqueda', { default: '' })
const page = defineModel<number>('page', { default: 1 })
/** La categoría elegida (`id`), o `null` para todas. */
const categoria = defineModel<string | null>('categoria', { default: null })

/** Solo los productos que el admin marcó como favoritos; excluyente con la categoría. */
const soloFavoritos = defineModel<boolean>('soloFavoritos', { default: false })

const nombreCategoria = computed(() => props.categorias?.find(c => c.id === categoria.value)?.nombre ?? '')

/** Qué decir cuando una búsqueda, una categoría o las dos dejan la grilla vacía. */
const textoFiltrado = computed(() => {
  const q = busqueda.value.trim()
  if (soloFavoritos.value && q) return `No encontramos «${q}» entre los favoritos. Prueba con otra palabra.`
  if (soloFavoritos.value) return 'Aún no hay favoritos. El administrador los marca en Configuración → Productos.'
  if (q && nombreCategoria.value) return `No encontramos «${q}» en «${nombreCategoria.value}». Prueba con otra palabra.`
  if (q) return `No encontramos «${q}». Prueba con otra palabra.`
  return `No hay productos en «${nombreCategoria.value}».`
})

function elegirCategoria(id: string | null) {
  soloFavoritos.value = false
  categoria.value = id
}

function elegirFavoritos() {
  categoria.value = null
  soloFavoritos.value = true
}

function quitarFiltros() {
  busqueda.value = ''
  categoria.value = null
  soloFavoritos.value = false
}

/**
 * Solo atenúa visualmente — no bloquea el click en recetas/combos.
 *
 * `<= 0` y no `=== 0`: desde el 2026-09-01 `disponible` es `stock − comprometido`
 * y **puede ser negativo** (un ingrediente no bloqueante se pasa del stock,
 * § 4.2 de
 * `docs/superpowers/specs/2026-09-01-reserva-de-stock-al-pedir-design.md`). Con
 * `=== 0`, un plato en −2 no se atenuaba y se veía mejor que el de cero, siendo
 * el peor de los tres estados (el orden ya no se decide acá: lo pone el servidor,
 * `backend/src/modules/items/catalogo-orden.ts`, con el mismo `<= 0`). El `?? 1`
 * deja intacto el `null`, que significa "no hay bloqueantes que limiten" y no es
 * falta de stock.
 */
function sinStockVisual(item: ItemCatalogo): boolean {
  if (item.tipo === 'receta' || item.tipo === 'combo') return (item.disponible ?? 1) <= 0
  return !tieneStockPedible(item)
}

function onAgregar(item: ItemCatalogo) {
  if (!puedeAgregarItem(item)) return
  emit('add', item)
}
</script>

<template>
  <div class="flex flex-col gap-4 h-full min-h-0 overflow-hidden">
    <UInput
      ref="buscador"
      v-model="busqueda"
      icon="i-lucide-search"
      placeholder="Buscar ítem…"
      size="lg"
      class="shrink-0"
      @keydown.enter.prevent="emit('buscar-enter')"
    >
      <template v-if="busqueda" #trailing>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="link"
          size="sm"
          aria-label="Borrar búsqueda"
          @click="() => { busqueda = '' }"
        />
      </template>
    </UInput>

    <div
      v-if="categorias?.length || favoritos"
      class="-mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 pb-1"
      role="group"
      aria-label="Categorías"
    >
      <template v-for="chip in [{ id: null, nombre: 'Todas' }, ...(categorias ?? [])]" :key="chip.id ?? 'todas'">
        <UButton
          :label="chip.nombre"
          size="lg"
          class="min-h-11 shrink-0"
          :variant="categoria === chip.id && !soloFavoritos ? 'solid' : 'outline'"
          :color="categoria === chip.id && !soloFavoritos ? 'primary' : 'neutral'"
          :aria-pressed="categoria === chip.id && !soloFavoritos"
          data-qa="categoria-chip"
          @click="elegirCategoria(chip.id)"
        />
        <UButton
          v-if="favoritos && chip.id === null"
          label="Favoritos"
          icon="i-lucide-star"
          size="lg"
          class="min-h-11 shrink-0"
          :variant="soloFavoritos ? 'solid' : 'outline'"
          :color="soloFavoritos ? 'primary' : 'neutral'"
          :aria-pressed="soloFavoritos"
          data-qa="favoritos-chip"
          @click="elegirFavoritos"
        />
      </template>
    </div>

    <div v-if="loading" class="text-center text-muted py-10 text-sm">
      Cargando catálogo…
    </div>
    <AppEstadoLista
      v-else-if="!items.length"
      recurso="el catálogo"
      :vacio="vacio ?? 'Aún no hay ítems para vender. Avisa al encargado.'"
      :error="error"
      :sin-permiso="sinPermiso"
      :filtrado="!!busqueda.trim() || !!categoria || soloFavoritos"
      :filtrado-texto="textoFiltrado"
      :quitar-texto="categoria || soloFavoritos ? 'Ver todas' : 'Borrar búsqueda'"
      @reintentar="emit('reintentar')"
      @quitar-filtros="quitarFiltros"
    />

    <div v-else class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 items-stretch p-1 pb-2">
        <!-- El orden lo pone el servidor (`orden=disponibilidad`): no reordenar acá. -->
        <UCard
          v-for="item in items"
          :key="item.id"
          class="h-full transition"
          :class="[
            puedeAgregarItem(item) ? 'cursor-pointer hover:ring-2 hover:ring-primary' : 'cursor-not-allowed',
            'outline-none focus-visible:ring-2 focus-visible:ring-primary',
            sinStockVisual(item) ? 'opacity-50' : '',
          ]"
          :ui="{ body: 'h-full p-3 sm:p-4' }"
          role="button"
          tabindex="0"
          :aria-disabled="!puedeAgregarItem(item)"
          :data-qa="`item-catalogo-${item.id}`"
          @click="onAgregar(item)"
          @keydown.enter.self.prevent="!$event.repeat && onAgregar(item)"
          @keydown.space.self.prevent="!$event.repeat && onAgregar(item)"
        >
          <div class="flex flex-col h-full gap-1">
            <span class="font-medium text-sm text-default truncate shrink-0">{{ item.nombre }}</span>
            <VentasPrecioItem
              :monto="item.precioBase"
              :moneda-id="item.monedaId"
              highlight
            />
            <div
              v-if="esMonedaExtranjera(item.monedaId) && monedaOficial"
              class="min-h-5 flex items-center shrink-0"
            >
              <VentasPrecioItem
                :monto="convertirAMonedaOficial(item.precioBase, item.monedaId)"
                :moneda-id="monedaOficial.monedaId"
                muted
              />
            </div>
            <!-- "Disponible" y ya no "Stock": el número dejó de ser lo que hay en
                 la bodega y pasó a ser lo que todavía se puede pedir. Con dos mesas
                 abiertas los dos difieren, y la etiqueta vieja convertía la
                 diferencia en un "el sistema está mal" — el garzón cuenta tres
                 botellas en el refrigerador y la tarjeta decía "Stock: 1". -->
            <span v-if="item.tipo === 'combo' && item.disponibleCondicional" class="text-xs text-muted shrink-0">
              Disponible según la opción
            </span>
            <!-- Una sola palabra para lo que queda, y la tarjeta atenuada dice por qué (01.26). -->
            <span v-else-if="sinStockVisual(item)" class="text-xs font-medium text-error shrink-0">
              Sin stock
            </span>
            <span v-else-if="item.tipo === 'producto'" class="text-xs text-muted shrink-0">
              Disponible: {{ formatStock(stockPedible(item), item.unidadMedida) }}
            </span>
            <span v-else-if="(item.tipo === 'receta' || item.tipo === 'combo') && item.disponible !== null && item.disponible !== undefined" class="text-xs text-muted shrink-0">
              Disponible: {{ item.disponible }}
            </span>
            <div
              v-if="!esMonedaExtranjera(item.monedaId)"
              class="min-h-5 shrink-0"
              aria-hidden="true"
            />
          </div>
        </UCard>
      </div>
    </div>

    <!-- `sibling-count` 1 y el scroll horizontal: con los 2 vecinos por defecto más los
         controles la fila no entra a 375 px, y el contenedor de arriba recorta. -->
    <div v-if="total > pageSize" class="flex justify-center shrink-0 min-w-0 overflow-x-auto">
      <UPagination
        v-model:page="page"
        :items-per-page="pageSize"
        :sibling-count="1"
        :total="total"
      />
    </div>
  </div>
</template>
