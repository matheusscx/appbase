<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })
// Compatibilidad: la superficie /caja se dividió en /mi-caja (operar) y /cajas
// (supervisar). Enviar a Mi caja por defecto.
onMounted(async () => {
  await navigateTo('/mi-caja', { replace: true })
})
</script>

<template>
  <div />
</template>
