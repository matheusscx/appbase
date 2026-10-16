<script setup lang="ts">
/** Compatibilidad: la pantalla pasó a llamarse «Stock» (`/inventario/stock`). El bloque del inicio y los enlaces viejos llegan con `?soloBajoMinimo=true`. */
definePageMeta({
  middleware: (to) => navigateTo({ path: '/inventario/stock', query: to.query }, { replace: true }),
})
</script>
