<script setup lang="ts">
// `auth.ts` (línea 27-31) trae su propio branch para `/admin`: exige
// `isSuperadmin` y redirige a `/` si no lo es. `middleware: 'admin'` NO sirve
// acá — chequea `esAdmin` (admin del tenant activo), un eje distinto al
// superadmin, y contra el store equivocado.
definePageMeta({ middleware: 'auth', layout: 'dashboard' })
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Administración" />
    </template>

    <template #body>
      <div class="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
        <UIcon name="i-lucide-shield-check" class="w-12 h-12 text-muted" />
        <p class="text-sm text-muted">
          Panel de administración — próximamente disponible.
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
