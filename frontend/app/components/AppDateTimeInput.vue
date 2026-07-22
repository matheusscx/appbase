<script setup lang="ts">
import type { CalendarDateTime, DateValue } from '@internationalized/date'
import {
  fromCalendarDateTime,
  mergeDateKeepingTime,
  toCalendarDateTime,
} from '~/utils/date-value'

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
const internal = shallowRef<CalendarDateTime | null>(
  toCalendarDateTime(props.modelValue),
)

watch(
  () => props.modelValue,
  (v) => {
    const next = toCalendarDateTime(v)
    const cur = internal.value
    if (!next && !cur) return
    if (
      next
      && cur
      && next.year === cur.year
      && next.month === cur.month
      && next.day === cur.day
      && next.hour === cur.hour
      && next.minute === cur.minute
    ) {
      return
    }
    internal.value = next
  },
)

watch(internal, (v) => {
  emit('update:modelValue', fromCalendarDateTime(v))
})

function onCalendar(v: DateValue | DateValue[] | null | undefined | { start: DateValue | undefined, end: DateValue | undefined }) {
  if (!v || Array.isArray(v) || ('start' in v)) return
  internal.value = mergeDateKeepingTime(v, internal.value)
}

function onQaSet(e: Event) {
  const detail = (e as CustomEvent<string>).detail
  internal.value = toCalendarDateTime(detail)
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
    <UInputDate
      v-model="internal"
      granularity="minute"
      :hour-cycle="24"
      hide-time-zone
      :disabled="disabled"
      :class="props.class"
      class="w-full"
    >
      <template #trailing="{ ui }">
        <UPopover>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-calendar"
            aria-label="Seleccionar fecha y hora"
            tabindex="-1"
            :disabled="disabled"
            :class="ui.trailingIcon()"
          />
          <template #content>
            <UCalendar
              :model-value="internal ?? undefined"
              class="p-2"
              @update:model-value="onCalendar"
            />
          </template>
        </UPopover>
      </template>
    </UInputDate>
  </div>
</template>
