<script setup lang="ts" generic="T">
import type { TableColumn } from '@nuxt/ui'

const props = defineProps<{
  data: T[]
  columns: TableColumn<T>[]
  loading?: boolean
  /**
   * La lectura falló: la tarjeta no muestra filas ni el vacío de la pantalla, dice que no pudo
   * cargar y ofrece "Reintentar" (`@reintentar`; lo toca la persona, nunca es automático).
   */
  error?: boolean
  /** El fallo fue un 403: en vez de "no pudimos cargar", "Sin acceso a …". */
  sinPermiso?: boolean
  /** Qué contiene la tabla, para los textos de error: "las categorías". */
  recurso?: string
  /** Texto del vacío de verdad. Una pantalla con algo más rico que texto usa el slot `#empty`. */
  vacio?: string
  /** Hay filtro o búsqueda activos: sin filas dice que el filtro no encontró nada, no que no hay datos. */
  filtrado?: boolean
  /** Texto propio para el caso filtrado (p. ej. el que nombra lo buscado). */
  filtradoTexto?: string
  /** Deja la primera columna fija a la izquierda: en una tabla ancha el nombre no se pierde al deslizar. */
  fijarPrimera?: boolean
  /**
   * Rótulo del botón del vacío de verdad ("Nueva categoría"): el vacío dice por dónde empezar
   * (auditoría UX 07.35). La pantalla solo lo pasa si la persona puede crear.
   */
  vacioAccion?: string
}>()

const emit = defineEmits<{ reintentar: [], quitarFiltros: [], vacioAccion: [] }>()
// El botón "Quitar filtros" solo se ofrece si la pantalla escucha el evento.
const escuchaQuitarFiltros = !!getCurrentInstance()?.vnode.props?.onQuitarFiltros

// La columna de acciones queda pegada al borde derecho de la tarjeta: en una pantalla angosta el
// lápiz y el basurero no se esconden detrás de un scroll sin pista (auditoría UX 07.1).
// Las celdas fijas de Nuxt UI traen `bg-default/75`; la clase de la tarjeta las vuelve opacas.
const COLUMNAS_DE_ACCIONES = ['acciones', 'accion']
const idDeColumna = (c: TableColumn<T>) => (c as { id?: string, accessorKey?: string }).id ?? (c as { accessorKey?: string }).accessorKey
const fijas = computed(() => {
  const ids = props.columns.map(idDeColumna)
  const right = ids.filter((id): id is string => !!id && COLUMNAS_DE_ACCIONES.includes(id))
  const left = props.fijarPrimera && ids[0] ? [ids[0]] : []
  return { left, right }
})

// Se lee en cada render, no en un `computed`: `useSlots()` no es reactivo, y una columna cuyo slot
// aparece tarde (cuando cargan los permisos) quedaba sin celda (auditoría UX 00.9 / 06.26).
const slots = useSlots()
function nombresDeSlots() {
  return Object.keys(slots).filter(name => name !== 'footer' && name !== 'empty')
}
</script>

<template>
  <UCard class="w-full [&_[data-pinned=left]]:bg-default [&_[data-pinned=right]]:bg-default [&_[data-pinned=right]]:text-right">
    <UTable
      :data="error ? [] : data"
      :columns="columns"
      :loading="loading"
      :column-pinning="fijas"
      v-bind="$attrs"
    >
      <template
        v-for="slotName in nombresDeSlots()"
        #[slotName]="slotProps"
      >
        <slot
          :name="slotName"
          v-bind="slotProps ?? {}"
        />
      </template>
      <!-- Cuatro estados distintos para una tabla sin filas: error o sin permiso (la lectura falló),
           cargando (todavía no se sabe) y vacío de verdad. El vacío de la pantalla solo se muestra con
           la carga terminada y sin error: antes un 500 y la demora decían "No hay …" (auditoría UX 07.3). -->
      <template #empty>
        <AppEstadoLista
          v-if="error"
          :recurso="recurso ?? 'los datos'"
          vacio=""
          error
          :sin-permiso="sinPermiso"
          @reintentar="emit('reintentar')"
        />
        <div
          v-else-if="loading"
          class="py-8 text-center text-sm text-muted"
          data-qa="crud-cargando"
        >
          Cargando…
        </div>
        <slot v-else-if="$slots.empty && !filtrado" name="empty" />
        <AppEstadoLista
          v-else
          :recurso="recurso ?? 'los datos'"
          :vacio="vacio ?? 'No hay registros.'"
          :filtrado="filtrado"
          :filtrado-texto="filtradoTexto"
          :sin-quitar-filtros="!escuchaQuitarFiltros"
          :vacio-accion="vacioAccion"
          @quitar-filtros="emit('quitarFiltros')"
          @vacio-accion="emit('vacioAccion')"
        />
      </template>
    </UTable>

    <div
      v-if="$slots.footer"
      class="flex justify-end border-t border-default pt-4"
    >
      <slot name="footer" />
    </div>
  </UCard>
</template>
