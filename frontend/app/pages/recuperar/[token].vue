<script setup lang="ts">
/**
 * El reset reusa **la misma pantalla** que la invitación: el componente decide
 * los textos y el endpoint mirando la ruta. Este archivo existe solo porque el
 * router de Nuxt es por archivos y las dos URLs son distintas.
 */
import Elegir from '../invitacion/[token].vue'
</script>

<template>
  <Elegir />
</template>
