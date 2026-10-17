<script setup lang="ts">
import { shellUi } from '~/utils/ui-shell'
import type { PrecuentaVista } from '~/composables/useSalones'

/**
 * La precuenta en pantalla (auditoría UX 02.7). Solo presentación: los montos llegan ya
 * calculados (ver `PrecuentaVista`). Acá no se recalcula plata.
 */
const open = defineModel<boolean>('open', { required: true })

defineProps<{
  vista: PrecuentaVista | null
  imprimiendo?: boolean
}>()

const emit = defineEmits<{ imprimir: [] }>()

const { formatMonto } = useFormatters()
</script>

<template>
  <UModal
    v-model:open="open"
    title="Precuenta"
    :description="vista ? `${vista.mesaNombre} · Cuenta ${vista.cuentaNumero}` : undefined"
    :ui="shellUi.modal"
  >
    <template #body>
      <div v-if="vista" class="space-y-4">
        <ul class="divide-y divide-default text-sm">
          <li
            v-for="(item, i) in vista.items"
            :key="i"
            class="flex items-baseline justify-between gap-4 py-2"
          >
            <span class="min-w-0 text-default">
              <span class="text-muted">{{ item.cantidad }} ×</span> {{ item.nombre }}
            </span>
            <span class="shrink-0 text-default">{{ formatMonto(item.totalLinea) }}</span>
          </li>
        </ul>

        <dl class="space-y-2 border-t border-default pt-4">
          <div class="flex items-baseline justify-between gap-4 text-base">
            <dt :class="vista.propina ? 'text-muted' : 'font-semibold text-default'">
              {{ vista.propina ? 'Total sin propina' : 'Total' }}
            </dt>
            <dd :class="vista.propina ? 'text-default' : 'text-xl font-semibold text-default'">
              {{ formatMonto(vista.total) }}
            </dd>
          </div>
          <template v-if="vista.propina">
            <div class="flex items-baseline justify-between gap-4 text-base">
              <dt class="text-muted">
                Propina sugerida {{ vista.propina.porcentaje }} %
              </dt>
              <dd class="text-default">
                {{ formatMonto(vista.propina.monto) }}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-base font-semibold text-default">
                Total con propina
              </dt>
              <dd class="text-xl font-semibold text-default">
                {{ formatMonto(vista.propina.totalConPropina) }}
              </dd>
            </div>
          </template>
        </dl>
      </div>
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton color="neutral" variant="ghost" class="min-h-11" @click="() => { open = false }">
          Cerrar
        </UButton>
        <UButton
          icon="i-lucide-receipt"
          class="min-h-11"
          :loading="imprimiendo"
          @click="emit('imprimir')"
        >
          Imprimir
        </UButton>
      </AppModalFooter>
    </template>
  </UModal>
</template>
