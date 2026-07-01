<script setup lang="ts">
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
