<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea, Caja } from '~/stores/caja'

const props = defineProps<{
  arqueo: ArqueoLinea[]
  caja: Caja
}>()

const { formatMonto, formatFecha } = useFormatters()

const diferenciaTotal = computed(() =>
  props.arqueo.reduce(
    (acc, l) => (l.diferencia != null ? acc.plus(l.diferencia) : acc),
    new Decimal(0),
  ),
)

const cuadro = computed(() => diferenciaTotal.value.isZero())
</script>

<template>
  <div class="rounded-lg border border-default p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
    <div class="flex items-center gap-2">
      <UIcon
        :name="cuadro ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
        class="w-5 h-5"
        :class="cuadro ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
      />
      <span
        class="font-semibold"
        :class="cuadro ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'"
      >
        <template v-if="cuadro">
          Cuadró
        </template>
        <template v-else>
          Diferencia {{ formatMonto(diferenciaTotal) }}
        </template>
      </span>
    </div>
    <span v-if="caja.cajonNombre" class="text-sm text-muted">
      Cajón {{ caja.cajonNombre }}
    </span>
    <span v-if="caja.fechaCierre" class="text-sm text-muted">
      Cerrada {{ formatFecha(caja.fechaCierre) }}
    </span>
  </div>
</template>
