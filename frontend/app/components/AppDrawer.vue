<script setup lang="ts">
import { resolveDrawerWidth, type DrawerWidth } from '~/utils/drawer-width'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  direction?: 'left' | 'right' | 'top' | 'bottom'
  /** Preset (`xs`–`full`) o valor CSS (`50%`, `75%`, `28rem`). Solo aplica a `left`/`right`. */
  width?: DrawerWidth
  handle?: boolean
  inset?: boolean
  ui?: Record<string, unknown>
}>(), {
  direction: 'right',
  width: 'md',
  handle: false,
})

const open = defineModel<boolean>('open', { default: false })

const isHorizontal = computed(
  () => props.direction === 'left' || props.direction === 'right',
)

const drawerContent = computed(() => {
  if (!isHorizontal.value) return undefined
  const size = resolveDrawerWidth(props.width)
  return {
    style: {
      width: size,
      maxWidth: size,
    },
  }
})

const drawerUi = computed(() => {
  const defaults = {
    content: 'h-full min-h-0',
    container: 'w-full h-full min-h-0 flex flex-col overflow-hidden divide-y divide-accented',
    header: 'shrink-0 px-6 py-4',
    body: 'flex-1 min-h-0 overflow-y-auto px-6 py-4',
    footer: 'shrink-0 mt-auto px-6 py-4 flex flex-row items-center justify-between gap-2 bg-default w-full',
  }
  const custom = props.ui ?? {}
  return {
    ...defaults,
    ...custom,
    content: [defaults.content, custom.content].filter(Boolean).join(' '),
    container: [defaults.container, custom.container].filter(Boolean).join(' '),
    header: [defaults.header, custom.header].filter(Boolean).join(' '),
    body: [defaults.body, custom.body].filter(Boolean).join(' '),
    footer: [defaults.footer, custom.footer].filter(Boolean).join(' '),
  }
})
</script>

<template>
  <UDrawer
    v-model:open="open"
    v-bind="$attrs"
    :title="title"
    :description="description"
    :direction="direction"
    :handle="handle"
    :inset="inset"
    :content="drawerContent"
    :ui="drawerUi"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    <template v-if="$slots.body" #body>
      <slot name="body" />
    </template>
    <template v-if="$slots.actions || $slots.footer" #footer>
      <div class="flex w-full flex-row items-center justify-between gap-2">
        <slot name="actions" />
        <slot name="footer" />
      </div>
    </template>
    <template v-if="$slots.default" #default>
      <slot />
    </template>
  </UDrawer>
</template>
