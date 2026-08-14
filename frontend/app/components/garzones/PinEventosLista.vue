<script setup lang="ts">
import type { EventoPin, TipoEventoPin } from '~/composables/useGarzones'

const props = defineProps<{ eventos: EventoPin[] }>()

const { formatFecha } = useFormatters()

/**
 * El texto de cada tipo. Los dos de invalidación dicen cosas distintas a
 * propósito: uno es "te di una cuenta", el otro es "te corté el PIN".
 */
const TEXTO: Record<TipoEventoPin, (quien: string) => string> = {
  emitido_en_alta: quien => `${quien} emitió el PIN al dar de alta`,
  regenerado_por_encargado: quien => `${quien} generó un PIN nuevo`,
  invalidado_por_encargado: quien => `${quien} invalidó el PIN`,
  invalidado_por_vinculo: quien => `El PIN quedó sin efecto al vincular la cuenta (${quien})`,
  fijado_por_garzon: () => 'Puso su PIN',
}

/**
 * El `Record` de arriba da exhaustividad en COMPILACIÓN, pero `e.tipo` viene
 * de la API en runtime: si el backend suma un tipo nuevo antes de que este
 * front lo conozca, `TEXTO[e.tipo]` da `undefined` y llamarlo revienta. Como
 * el `v-for` vive DENTRO de este componente, ese throw no tira solo la fila:
 * se cae la card entera — y este componente lo montan tres pantallas
 * (perfil, ficha del garzón, salón), así que un tipo nuevo las rompería a
 * las tres a la vez.
 */
function texto(e: EventoPin): string {
  const fn = TEXTO[e.tipo]
  if (!fn) return 'Hubo un cambio en el PIN'
  return fn(e.usuarioNombre ?? 'Una cuenta dada de baja')
}
</script>

<template>
  <p v-if="props.eventos.length === 0" class="text-sm text-muted">
    Todavía no hubo cambios de PIN.
  </p>
  <ul v-else class="divide-y divide-default">
    <li
      v-for="e in props.eventos"
      :key="e.id"
      class="flex items-center justify-between gap-3 py-2 text-sm"
    >
      <span class="text-default">{{ texto(e) }}</span>
      <span class="shrink-0 text-xs text-muted">{{ formatFecha(e.creadoEl) }}</span>
    </li>
  </ul>
</template>
