<script setup lang="ts">
import { es } from '@nuxt/ui/locale'

/** Formato de fechas/horas alineado a Chile (es-CL). */
const locale = extendLocale(es, { code: 'es-CL' })
</script>

<template>
  <UApp :locale="locale" :toaster="{ position: 'top-right' }">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
