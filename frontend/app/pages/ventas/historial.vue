<script setup lang="ts">
/** Compatibilidad: bookmarks y links antiguos → historial unificado en /ventas */
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()

await navigateTo({
  path: '/ventas',
  query: route.query,
})
</script>

<template>
  <div />
</template>
