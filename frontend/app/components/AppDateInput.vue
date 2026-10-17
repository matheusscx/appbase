<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import { CalendarDate } from '@internationalized/date'
import { fromCalendarDate, toCalendarDate } from '~/utils/date-value'

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    disabled?: boolean
    class?: string
    /** data-qa para E2E */
    qa?: string
    /**
     * Rótulo visible ("Desde", "Hasta"). Sin él, dos campos de fecha juntos son
     * idénticos para el lector de pantalla y sus botones del calendario se llaman
     * igual. Los que ya viven dentro de un `UFormField` no lo pasan.
     */
    label?: string
  }>(),
  {
    modelValue: null,
    disabled: false,
    label: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// El ícono mide 20 px: el área de toque llega a 44 sin mover nada del campo (04.16).
const AREA_TACTIL = 'relative after:absolute after:-inset-3 after:content-[\'\']'

const UFormField = resolveComponent('UFormField')
// Con `label` la raíz es un componente: el listener de QA va al elemento real.
const rootEl = ref<HTMLElement | { $el: HTMLElement } | null>(null)
const rootNode = () => (rootEl.value && '$el' in rootEl.value ? rootEl.value.$el : rootEl.value) as HTMLElement | null
const internal = shallowRef(toCalendarDate(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    const next = toCalendarDate(v)
    const cur = internal.value
    if (!next && !cur) return
    if (
      next
      && cur
      && next.year === cur.year
      && next.month === cur.month
      && next.day === cur.day
    ) {
      return
    }
    internal.value = next
  },
)

watch(internal, (v) => {
  emit('update:modelValue', fromCalendarDate(v))
})

function onCalendar(v: DateValue | DateValue[] | null | undefined | { start: DateValue | undefined, end: DateValue | undefined }) {
  if (!v || Array.isArray(v) || ('start' in v)) return
  internal.value = new CalendarDate(v.year, v.month, v.day)
}

function onQaSet(e: Event) {
  const detail = (e as CustomEvent<string>).detail
  internal.value = toCalendarDate(detail)
}

onMounted(() => {
  rootNode()?.addEventListener('qa-set-value', onQaSet)
})

onBeforeUnmount(() => {
  rootNode()?.removeEventListener('qa-set-value', onQaSet)
})
</script>

<template>
  <component
    :is="label ? UFormField : 'div'"
    ref="rootEl"
    :label="label"
    :data-qa="qa"
    class="min-w-0"
    :class="props.class"
  >
    <UInputDate
      v-model="internal"
      :disabled="disabled"
      class="w-full"
    >
      <template #trailing="{ ui }">
        <UPopover>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-calendar"
            :aria-label="label ? `Seleccionar la fecha ${label}` : 'Seleccionar fecha'"
            tabindex="-1"
            :disabled="disabled"
            :class="[ui.trailingIcon(), AREA_TACTIL]"
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
  </component>
</template>
