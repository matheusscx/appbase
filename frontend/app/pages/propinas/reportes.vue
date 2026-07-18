<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()

const query: Record<string, string> = { tab: 'reportes' }
if (typeof route.query.tab === 'string' && route.query.tab === 'trabajadores') {
  query.vista = 'trabajadores'
}
else if (typeof route.query.vista === 'string') {
  query.vista = route.query.vista
}
else {
  query.vista = 'resumen'
}
for (const key of ['desde', 'hasta', 'turnoIds', 'tipoGarzon'] as const) {
  const value = route.query[key]
  if (typeof value === 'string' && value) query[key] = value
}

await navigateTo({ path: '/propinas', query }, { replace: true })
</script>

<template>
  <div />
</template>
