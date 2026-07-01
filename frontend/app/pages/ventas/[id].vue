<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()

await navigateTo({
  path: '/ventas',
  query: { venta: route.params.id as string },
})
</script>

<template>
  <div />
</template>
