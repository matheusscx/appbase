<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
    large?: boolean
  }>(),
  { large: false },
)
</script>

<template>
  <!-- `flex-wrap`: con una descripción larga o una zona angosta las acciones bajan bajo el título
       y no se aprietan ("Nueva / impresora"). Auditoría UX 07.5. -->
  <div data-qa="cabecera" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div class="min-w-0 flex-1 basis-64">
      <h1 v-if="large" class="text-2xl font-semibold text-default">
        {{ title }}
      </h1>
      <h2 v-else class="text-lg font-semibold text-default">
        {{ title }}
      </h2>
      <p v-if="description" class="text-sm text-muted">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" data-qa="cabecera-acciones" class="flex shrink-0 flex-wrap items-center gap-2 whitespace-nowrap">
      <slot name="actions" />
    </div>
  </div>
</template>
