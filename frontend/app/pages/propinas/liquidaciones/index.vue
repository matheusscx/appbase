<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

await navigateTo({ path: '/propinas' }, { replace: true })
</script>

<template>
  <div />
</template>
