<script setup lang="ts">
/** Compatibilidad: /configuracion → perfil (nav principal ya apunta a /configuracion/perfil) */
definePageMeta({
  middleware: () => navigateTo('/configuracion/perfil', { replace: true }),
})
</script>
