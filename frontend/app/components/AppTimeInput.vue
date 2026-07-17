<script setup lang="ts">
import type { Time } from '@internationalized/date'
import { fromTime, toTime } from '~/utils/date-value'

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    disabled?: boolean
    class?: string
    /** data-qa para E2E */
    qa?: string
  }>(),
  {
    modelValue: null,
    disabled: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const rootEl = ref<HTMLElement | null>(null)
const internal = shallowRef<Time | null>(toTime(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    const next = toTime(v)
    const cur = internal.value
    if (!next && !cur) return
    if (next && cur && next.hour === cur.hour && next.minute === cur.minute) return
    internal.value = next
  },
)

watch(internal, (v) => {
  emit('update:modelValue', fromTime(v))
})

function onQaSet(e: Event) {
  const detail = (e as CustomEvent<string>).detail
  internal.value = toTime(detail)
}

onMounted(() => {
  rootEl.value?.addEventListener('qa-set-value', onQaSet)
})

onBeforeUnmount(() => {
  rootEl.value?.removeEventListener('qa-set-value', onQaSet)
})
</script>

<template>
  <div ref="rootEl" :data-qa="qa" class="w-full min-w-0">
    <UInputTime
      v-model="internal"
      granularity="minute"
      :hour-cycle="24"
      icon="i-lucide-clock"
      :disabled="disabled"
      :class="props.class"
      class="w-full"
    />
  </div>
</template>
