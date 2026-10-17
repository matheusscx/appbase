<script setup lang="ts">
import Decimal from 'decimal.js'
import type { BoletaVenta } from '~/types/boleta'

/**
 * Lo que la cajera necesita después de cobrar y que el toast de 5 s no le deja:
 * el total, el vuelto que tiene que devolver y el folio de la boleta (01.5 y
 * 02.26). Sale de la respuesta del servidor —lo que quedó registrado—, no de lo
 * que se tipeó, y aparece sin esperar la impresión.
 */
const props = defineProps<{
  titulo: string
  /** La respuesta del cobro; `null` si el servidor no devolvió boleta. */
  boleta: BoletaVenta | null | undefined
  /** El vuelto que calculó el modal, para cuando la boleta no lo trae. */
  vueltoDelModal?: string
}>()
const emit = defineEmits<{ cerrar: [] }>()

const { formatMonto } = useFormatters()

const total = computed(() =>
  props.boleta
    ? new Decimal(props.boleta.totales.totalFinal).plus(props.boleta.propina?.monto || '0').toString()
    : null,
)
const vuelto = computed(() => new Decimal(props.boleta?.vuelto ?? props.vueltoDelModal ?? '0'))
const folio = computed(() => props.boleta?.boletaElectronica?.folio ?? null)
</script>

<template>
  <div
    role="status"
    data-qa="cobro-resultado"
    class="flex flex-col gap-2 rounded-lg border border-default bg-elevated p-4 tabular-nums"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="flex items-center gap-2 font-semibold text-default">
        <UIcon name="i-lucide-circle-check" class="size-5 text-success" />
        {{ titulo }}
      </p>
      <UButton
        label="Listo"
        color="neutral"
        variant="outline"
        size="xl"
        class="min-h-11"
        data-qa="cobro-resultado-cerrar"
        @click="emit('cerrar')"
      />
    </div>
    <div v-if="total !== null" class="flex items-baseline justify-between gap-3">
      <span class="text-muted">Total</span>
      <span class="text-xl font-semibold text-default" data-qa="resultado-total">{{ formatMonto(total) }}</span>
    </div>
    <div v-if="vuelto.gt(0)" class="flex items-baseline justify-between gap-3">
      <span class="text-muted">Vuelto</span>
      <span class="text-3xl font-semibold text-default" data-qa="resultado-vuelto">{{ formatMonto(vuelto.toString()) }}</span>
    </div>
    <p v-if="folio !== null" class="text-sm text-muted" data-qa="resultado-folio">Boleta N° {{ folio }}</p>
  </div>
</template>
