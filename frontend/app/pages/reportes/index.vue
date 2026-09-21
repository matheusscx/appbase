<script setup lang="ts">
/**
 * Índice del módulo de reportes: una tarjeta por reporte que el usuario puede
 * ver. Sin gate de permiso propio —no hay un permiso "Reportes"—: cada reporte
 * tiene el suyo, y la lista ya viene filtrada por `useReportes`.
 */
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { visibles } = useReportes()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Reportes" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Reportes"
          description="Lecturas que cruzan datos de varios módulos para contestar una pregunta del negocio."
        />

        <div v-if="visibles.length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <NuxtLink
            v-for="r in visibles"
            :key="r.to"
            :to="r.to"
            class="rounded-lg bg-muted p-4 hover:bg-elevated transition-colors"
            :data-qa="`reporte-${r.to}`"
          >
            <div class="flex items-center gap-2">
              <UIcon :name="r.icon" class="w-5 h-5 text-primary" />
              <span class="font-medium text-default">{{ r.titulo }}</span>
            </div>
            <p class="text-sm text-muted mt-2">
              {{ r.descripcion }}
            </p>
          </NuxtLink>
        </div>

        <div v-else class="rounded-lg bg-muted p-4 text-sm text-muted">
          No tenés acceso a ningún reporte.
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
