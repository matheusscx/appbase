<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TrazaPromo } from '~/composables/useCalculoPrecios'

const props = defineProps<{ promociones: TrazaPromo[] }>()

const { formatMonto } = useFormatters()

/**
 * Una promo sin plata no se dibuja — misma regla que el ticket impreso
 * (`ticket-builder.ts`, `lineasTotalesConImpuestos`), que ya la tenía.
 *
 * Llega con `monto: '0'` la promo que el **piso en cero** recortó hasta la
 * nada: el catálogo ya se había llevado la línea entera y no quedaba
 * `disponible`. El motor igual la deja en la traza —con su advertencia al
 * lado— para poder explicarla. No es la promo que perdió el interruptor
 * promo-vs-catálogo: esa se descarta entera y sin traza.
 *
 * Sin el filtro el carrito muestra `-$0` bajo una línea, y el ticket de esa
 * misma venta no la nombra: dos superficies contando distinto la misma promo.
 * El aviso que ya se dibuja al lado (`AdvertenciasPrecio`) dice mucho más que
 * la fila en cero.
 */
const conMonto = computed(() =>
  props.promociones.filter(p => new Decimal(p.monto).gt(0)),
)
</script>

<template>
  <div v-if="conMonto.length">
    <p
      v-for="(promo, i) in conMonto"
      :key="i"
      class="flex items-center gap-1 text-xs text-success"
    >
      <UIcon name="i-lucide-tag" class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ promo.nombre }}</span>
      <span class="shrink-0 font-mono">-{{ formatMonto(promo.monto) }}</span>
    </p>
  </div>
</template>
