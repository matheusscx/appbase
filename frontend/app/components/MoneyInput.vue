<script setup lang="ts">
import { vMaska, type MaskaDetail } from 'maska/vue'
import { formatMontoDisplay } from '~/utils/currency-format'

const props = withDefaults(
  defineProps<{
    modelValue: string
    monedaId?: string
    oficial?: boolean
    placeholder?: string
    disabled?: boolean
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    class?: string
  }>(),
  {
    placeholder: '0',
    oficial: false,
    size: 'md',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const store = useMonedasStore()

const cfg = computed(() => {
  if (props.oficial) return store.monedaOficial ?? undefined
  if (props.monedaId) return store.getById(props.monedaId)
  return undefined
})

function buildMask(c: NonNullable<typeof cfg.value>): string {
  if (c.decimals === 0) return `${c.prefix}#`
  const frac = '0'.repeat(c.decimals)
  return `${c.prefix}0${c.thousands}0${c.decimal}${frac}`
}

/** Texto enmascarado mostrado en el input. */
const display = ref('')

function syncFromMaska(detail: MaskaDetail) {
  display.value = detail.masked
  emit('update:modelValue', detail.unmasked || '')
}

const maskaOptions = computed(() => {
  const c = cfg.value
  if (!c) return undefined
  return {
    mask: buildMask(c),
    number: {
      locale: c.locale,
      fraction: c.decimals,
      unsigned: true,
    },
    onMaska: syncFromMaska,
  }
})

watch(
  [() => props.modelValue, cfg],
  () => {
    const c = cfg.value
    if (!c) {
      display.value = ''
      return
    }
    if (props.modelValue === '' || props.modelValue === undefined) {
      display.value = ''
      return
    }
    display.value = formatMontoDisplay(props.modelValue, c)
  },
  { immediate: true },
)
</script>

<template>
  <UInput
    v-maska="maskaOptions"
    :model-value="display"
    :placeholder="placeholder"
    :disabled="disabled || !cfg"
    :size="size"
    :class="props.class"
    inputmode="decimal"
    autocomplete="off"
  />
</template>
