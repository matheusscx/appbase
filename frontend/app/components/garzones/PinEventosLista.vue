<script setup lang="ts">
import type { EventoPin, TipoEventoPin } from '~/composables/useGarzones'

const props = defineProps<{ eventos: EventoPin[] }>()

const { formatFecha } = useFormatters()

/**
 * El texto de cada tipo. Los dos de invalidación dicen cosas distintas a
 * propósito: uno es "te di una cuenta", el otro es "te corté el PIN".
 *
 * **Voz: siempre tercera persona, y siempre nombrando al actor** (revisión
 * final, 2026-08-15). Este componente lo montan **dos** pantallas con
 * lectores opuestos: la ficha (`configuracion/garzones.vue`, lee el
 * encargado sobre otra persona) y el perfil (`MiPinForm.vue`, lee el propio
 * garzón sobre sí mismo). Tutear lo dejaría mal en una de las dos.
 * (`pages/salones/index.vue` **no** lo monta: solo lo cita en comentarios
 * como precedente de redacción.) La lista es un **registro**, no un
 * mensaje: dice quién hizo qué y cuándo, y por eso las cinco líneas tienen
 * la misma forma. Los avisos SÍ tutean (`avisoPin` en el salón, "Todavía no
 * tenés PIN" en el perfil) porque son otra cosa: le hablan al lector.
 *
 * `fijado_por_garzon` era la única en tercera persona SIN actor ("Puso su
 * PIN"): rompía la forma y además escondía el dato —en la ficha, el
 * encargado no podía saber de quién era ese "su" sin inferirlo—. El actor
 * de ese evento es la cuenta del propio garzón (`garzones.service.ts` →
 * `fijarMiPin` escribe el evento con el `usuarioId` del token), así que
 * nombrarlo es correcto en las dos pantallas.
 */
const TEXTO: Record<TipoEventoPin, (quien: string) => string> = {
  emitido_en_alta: quien => `${quien} emitió el PIN al dar de alta`,
  regenerado_por_encargado: quien => `${quien} generó un PIN nuevo`,
  invalidado_por_encargado: quien => `${quien} invalidó el PIN`,
  invalidado_por_vinculo: quien => `El PIN quedó sin efecto al vincular la cuenta (${quien})`,
  fijado_por_garzon: quien => `${quien} puso su propio PIN`,
}

/**
 * El `Record` de arriba da exhaustividad en COMPILACIÓN, pero `e.tipo` viene
 * de la API en runtime: si el backend suma un tipo nuevo antes de que este
 * front lo conozca, `TEXTO[e.tipo]` da `undefined` y llamarlo revienta. Como
 * el `v-for` vive DENTRO de este componente, ese throw no tira solo la fila:
 * se cae la card entera — y este componente lo montan dos pantallas
 * (`MiPinForm.vue` en el perfil y `configuracion/garzones.vue` en la
 * ficha), así que un tipo nuevo las rompería a las dos a la vez.
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
