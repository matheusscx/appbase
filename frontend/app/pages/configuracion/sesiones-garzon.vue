<script setup lang="ts">
/** Compatibilidad: bookmarks y links antiguos → módulo operativo */
definePageMeta({
  middleware: () => navigateTo('/sesiones-garzon', { replace: true }),
})
</script>
