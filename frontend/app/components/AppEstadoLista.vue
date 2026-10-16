<script setup lang="ts">
/**
 * Lo que una lista dice cuando no tiene filas. Cuatro razones distintas, un solo lugar:
 *
 * - **sin permiso** (`error` + `sinPermiso`): "Sin acceso a X. Pídele al administrador…";
 * - **error** (`error`): "No pudimos cargar X" y un botón "Reintentar" que toca la persona —
 *   la app no reintenta sola (regla del proyecto);
 * - **filtrado** (`filtrado`): el filtro o la búsqueda no encontró nada, con salida para quitarlo;
 * - **vacío** de verdad: el texto de `vacio`.
 *
 * Existe porque un 500 y un 403 se veían igual que "no hay nada" (auditoría UX 2026-10-16, lote 7):
 * el dueño que mira su catálogo caído podía creer que se borró y volver a crearlo.
 * El orden de precedencia es ese: error > filtrado > vacío.
 */
const props = defineProps<{
  /** Lo que la lista contiene, con su artículo si lo lleva: "traslados", "el stock mínimo". */
  recurso: string
  /** Texto del vacío de verdad: "No hay traslados registrados." */
  vacio: string
  error?: boolean
  sinPermiso?: boolean
  filtrado?: boolean
  /** Si el filtro dice algo más específico que el genérico (la búsqueda nombra lo buscado). */
  filtradoTexto?: string
  /** Rótulo del botón que quita el filtro, si "Quitar filtros" no es lo que es (una búsqueda: "Borrar búsqueda"). */
  quitarTexto?: string
  /** El llamador no tiene cómo quitar el filtro: no se ofrece el botón. */
  sinQuitarFiltros?: boolean
}>()

const emit = defineEmits<{ reintentar: [], quitarFiltros: [] }>()

/** "a" + "el" se contraen: "Sin acceso al stock mínimo", no "a el stock mínimo". */
const aRecurso = computed(() =>
  props.recurso.startsWith('el ') ? `al ${props.recurso.slice(3)}` : `a ${props.recurso}`,
)

const estado = computed<'sin-permiso' | 'error' | 'filtrado' | 'vacio'>(() => {
  if (props.error) return props.sinPermiso ? 'sin-permiso' : 'error'
  if (props.filtrado) return 'filtrado'
  return 'vacio'
})
</script>

<template>
  <div
    class="flex flex-col items-center gap-3 py-8 text-center text-sm"
    :data-qa="`estado-lista-${estado}`"
    :role="estado === 'error' ? 'alert' : undefined"
  >
    <template v-if="estado === 'sin-permiso'">
      <UIcon name="i-lucide-lock" class="size-6 text-muted" />
      <p class="max-w-sm text-default">
        Sin acceso {{ aRecurso }}. Pídele al administrador que te lo habilite.
      </p>
    </template>

    <template v-else-if="estado === 'error'">
      <UIcon name="i-lucide-triangle-alert" class="size-6 text-error" />
      <p class="max-w-sm text-default">
        No pudimos cargar {{ recurso }}. Revisa tu conexión y reintenta.
      </p>
      <UButton
        label="Reintentar"
        icon="i-lucide-rotate-cw"
        color="neutral"
        variant="outline"
        size="sm"
        data-qa="estado-reintentar"
        @click="emit('reintentar')"
      />
    </template>

    <template v-else-if="estado === 'filtrado'">
      <p class="text-muted">
        {{ filtradoTexto ?? 'Ningún resultado con esos filtros.' }}
      </p>
      <UButton
        v-if="!sinQuitarFiltros"
        :label="quitarTexto ?? 'Quitar filtros'"
        color="neutral"
        variant="outline"
        size="sm"
        data-qa="estado-quitar-filtros"
        @click="emit('quitarFiltros')"
      />
    </template>

    <p v-else class="text-muted">
      {{ vacio }}
    </p>
  </div>
</template>
