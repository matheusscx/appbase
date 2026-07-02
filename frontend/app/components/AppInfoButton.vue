<script setup lang="ts">
const open = ref(false)

defineProps<{
  title: string
  text?: string
  ariaLabel?: string
}>()
</script>

<template>
  <span class="inline-flex items-center">
    <UButton
      type="button"
      icon="i-lucide-info"
      color="neutral"
      variant="ghost"
      size="xs"
      square
      class="-my-1 text-muted hover:text-default"
      :aria-label="ariaLabel ?? `Más información: ${title}`"
      @click.stop="open = true"
    />

    <UModal
      v-model:open="open"
      :title="title"
      :description="$slots.default ? undefined : text"
      :ui="shellUi.modal"
    >
      <template v-if="$slots.default" #body>
        <div :class="[shellInsetDividerClass, 'text-sm text-muted']">
          <slot />
        </div>
      </template>

      <template #footer>
        <AppModalFooter>
          <UButton color="neutral" variant="outline" @click="open = false">
            Entendido
          </UButton>
        </AppModalFooter>
      </template>
    </UModal>
  </span>
</template>
