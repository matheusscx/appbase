<script setup lang="ts">
import type { Caja } from '~/stores/caja'

/**
 * Lo que explica un descuadre, en el detalle de la caja (03.18): lo que dijo el cajero, qué tan
 * grande fue y, si hace falta, "Marcar visto". Antes la bandeja mandaba a "Ver cierre" y esa
 * pantalla no traía nada de esto, así que revisar era ir y volver.
 *
 * El nivel viene congelado del cierre (`nivelDescuadre`): acá no se recalcula contra los umbrales.
 */
const props = defineProps<{ caja: Caja }>()
const emit = defineEmits<{ marcado: [] }>()

const permisos = usePermissionsStore()
const { formatFecha } = useFormatters()

const NIVEL_LABEL: Record<string, string> = {
  aviso: 'Diferencia grande',
  alto: 'Diferencia muy grande',
}

const explicacion = computed(
  () => props.caja.explicacionDescuadre || props.caja.comentarioCierre || null,
)
const revisado = computed(() => !!props.caja.revisadoEl)
// Solo el nivel alto entra a la bandeja, y es el único que el backend deja marcar.
const puedeMarcar = computed(
  () => props.caja.nivelDescuadre === 'alto' && !revisado.value && permisos.can('Cajas', 'Actualizar'),
)
</script>

<template>
  <UCard data-qa="revision-descuadre">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-default">
          Revisión del descuadre
        </h3>
        <UBadge
          :color="caja.nivelDescuadre === 'alto' ? 'error' : 'warning'"
          variant="subtle"
          size="sm"
          :label="NIVEL_LABEL[caja.nivelDescuadre ?? ''] ?? 'Con diferencia'"
        />
      </div>
    </template>

    <div class="space-y-3">
      <div>
        <p class="text-xs text-muted">
          Qué dijo el cajero
        </p>
        <p v-if="explicacion" class="text-sm text-default whitespace-pre-line">
          {{ explicacion }}
        </p>
        <p v-else class="text-sm text-muted italic">
          No dejó explicación
        </p>
      </div>

      <p v-if="revisado" class="text-sm text-muted" data-qa="revision-hecha">
        Revisado el {{ formatFecha(caja.revisadoEl) }}
      </p>
      <div v-else-if="puedeMarcar">
        <CajaMarcarVisto :caja-id="caja.id" :cajero="caja.usuarioNombre" @marcado="emit('marcado')" />
      </div>
    </div>
  </UCard>
</template>
