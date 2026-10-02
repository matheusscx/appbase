<script setup lang="ts">
import {
  CLASES_MAQUINA_ITEMS,
  NUMERO_DOCUMENTO_MAX,
  type ClaseDocumentoMaquina,
} from '~/composables/useDocumentosVenta'

/**
 * El número del comprobante y, si lo emitió la máquina, de qué clase es. Lo usan
 * el cobro, el abono y "Completar número" del detalle: los tres piden lo mismo y
 * ninguno lo exige (en el cobro se completa después).
 *
 * El cajero dice qué tiene en la mano. **No elige quién emitió**: eso lo decide
 * el servidor con la regla del medio de pago.
 */
withDefaults(defineProps<{
  /** Un documento hecho por fuera no tiene clase: solo el número. */
  sinClase?: boolean
  size?: 'xs' | 'sm' | 'md'
}>(), { sinClase: false, size: 'sm' })

const numero = defineModel<string>('numero', { default: '' })
const clase = defineModel<ClaseDocumentoMaquina | undefined>('clase', { default: undefined })

// `USelectMenu` con `clear` vuelve a `undefined`/`null` al limpiar; el cobro
// entiende "ausente", no `null`.
function onClase(v: ClaseDocumentoMaquina | null | undefined) {
  clase.value = v ?? undefined
}
</script>

<template>
  <div class="flex flex-col gap-2 sm:flex-row" data-qa="comprobante-campos">
    <UInput
      v-model="numero"
      :size="size"
      :maxlength="NUMERO_DOCUMENTO_MAX"
      placeholder="N° del comprobante"
      aria-label="N° del comprobante"
      data-qa="comprobante-numero"
      class="flex-1"
    />
    <USelectMenu
      v-if="!sinClase"
      :model-value="clase"
      :items="CLASES_MAQUINA_ITEMS"
      value-key="value"
      label-key="label"
      :size="size"
      clear
      :search-input="false"
      placeholder="¿Voucher o boleta?"
      aria-label="Clase del comprobante de la máquina"
      data-qa="comprobante-clase"
      class="sm:w-56"
      @update:model-value="onClase"
    />
  </div>
</template>
