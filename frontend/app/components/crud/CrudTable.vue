<script setup lang="ts" generic="T">
import type { TableColumn } from '@nuxt/ui'

defineProps<{
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
}>()

const emit = defineEmits<{ reintentar: [], quitarFiltros: [] }>()
// El botón "Quitar filtros" solo se ofrece si la pantalla escucha el evento.
const escuchaQuitarFiltros = !!getCurrentInstance()?.vnode.props?.onQuitarFiltros

const tableSlots = computed(() => {
  const slots = useSlots()
  return Object.keys(slots).filter(name => name !== 'footer' && name !== 'empty')
})
</script>

<template>
  <UCard class="w-full">
    <UTable
      :data="error ? [] : data"
      :columns="columns"
      :loading="loading"
      v-bind="$attrs"
    >
      <template
        v-for="slotName in tableSlots"
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
          @quitar-filtros="emit('quitarFiltros')"
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
