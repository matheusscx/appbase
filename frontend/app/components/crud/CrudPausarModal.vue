<script setup lang="ts">
import type { NivelRegla } from '~/composables/useNivelRegla'
// Confirmación de pausa, compartida por las tres pantallas de reglas
// (descuentos, recargos, impuestos). El copy vive acá y no triplicado: es la
// parte que se desincroniza sola cuando alguien afina el mensaje en una sola.
//
// Solo aparece cuando hay algo que perder de vista: si ningún ítem usa la
// regla, `usePausaRegla` pausa sin abrir esto. La excepción es una regla de
// nivel venta, que no se asocia a ítems y aun así deja de estar disponible.
const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(defineProps<{
  nombre: string
  /** Cuántos ítems dejan de recibir la regla. */
  items: number
  /** Impuestos no tienen nivel: se comportan como `'linea'`. */
  nivel?: NivelRegla
}>(), { nivel: 'linea' })

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

/**
 * Lo que la pausa saca de circulación, dicho por el nivel de la regla.
 *
 * Una regla de venta decía "afecta 0 ítems" y era verdad y era inútil: no tiene
 * tabla puente con ítems, así que su conteo es 0 siempre. Lo que pierde el local
 * es la posibilidad de aplicarla al cobrar, y eso es lo que hay que decir.
 *
 * El caso mixto —nivel venta con ítems asociados— no se puede crear hoy (las dos
 * puertas del backend lo impiden), pero si una fila vieja lo tuviera el mensaje
 * lo nombra en vez de esconderlo.
 */
const mensaje = computed(() => {
  if (props.nivel !== 'venta') {
    return `Deja de aplicarse en ${props.items} ítem${props.items === 1 ? '' : 's'}.`
  }
  const enVentas = 'Deja de ofrecerse al cobrar: ninguna venta nueva va a poder aplicarlo al total.'
  return props.items === 0
    ? enVentas
    : `${enVentas} Además figura en ${props.items} ítem${props.items === 1 ? '' : 's'}.`
})
</script>

<template>
  <CrudModal
    v-model:open="open"
    :title="`Pausar «${nombre}»`"
    :message="mensaje"
    confirm-label="Pausar"
    confirm-color="neutral"
    @cancel="emit('cancel')"
    @confirm="emit('confirm')"
  >
    <template #detalle>
      <p class="mt-2 text-sm">
        Las asociaciones se conservan: al reactivarlo vuelve como estaba.
      </p>
    </template>
  </CrudModal>
</template>
