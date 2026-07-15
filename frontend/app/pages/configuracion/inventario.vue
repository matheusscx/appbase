<script setup lang="ts">
/** Compatibilidad: módulo movido a /inventario */
definePageMeta({
  middleware: () => navigateTo('/inventario', { replace: true }),
})
</script>
