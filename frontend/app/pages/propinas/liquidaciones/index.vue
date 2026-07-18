<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

await navigateTo({ path: '/propinas', query: { tab: 'liquidaciones' } }, { replace: true })
</script>

<template>
  <div />
</template>
