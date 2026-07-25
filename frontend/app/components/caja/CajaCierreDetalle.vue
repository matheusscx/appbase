<script setup lang="ts">
import type { ArqueoLinea, Caja } from '~/stores/caja'

const props = defineProps<{
  caja: Caja
  arqueo: ArqueoLinea[]
  readonly?: boolean
  historialUrl?: string
}>()

const perms = usePermissionsStore()
const cierreDrawerOpen = ref(false)

const enConciliacion = computed(() => props.caja.estado === 'en_conciliacion')
const puedeFinalizar = computed(() => enConciliacion.value && !props.readonly)
</script>

<template>
  <div class="w-full space-y-6">
    <UCard class="w-full">
      <template #header>
        <CajaTurnoHeader
          :caja="caja"
          :readonly="readonly"
          :historial-url="historialUrl"
        />
      </template>

      <div class="space-y-4">
        <UAlert
          v-if="puedeFinalizar"
          color="warning"
          variant="soft"
          icon="i-lucide-scale"
          title="En conciliación — falta finalizar el cierre"
        >
          <template #actions>
            <UButton
              color="warning"
              variant="solid"
              size="sm"
              @click="() => { cierreDrawerOpen = true }"
            >
              Continuar conciliación
            </UButton>
          </template>
        </UAlert>

        <CajaCierreResumen :arqueo="arqueo" :caja="caja" />
      </div>
    </UCard>

    <UCard class="w-full">
      <template #header>
        <h3 class="text-sm font-semibold text-default">
          Arqueo del cierre
        </h3>
      </template>
      <CajaArqueoTable
        :lineas="arqueo"
        :puede-justificar="perms.esAdmin && caja.estado === 'cerrada'"
        :caja-id="caja.id"
      />
    </UCard>

    <CajaMovimientosTable :caja-id="caja.id" colapsable />

    <CajaCierreDrawer
      v-if="puedeFinalizar"
      v-model:open="cierreDrawerOpen"
      :caja-id="caja.id"
      resumir
    />
  </div>
</template>
