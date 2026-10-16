<script setup lang="ts">
// Entrar a Configuración abre el índice, no Perfil (owner, 2026-10-16, auditoría UX 07.34): una
// tarjeta por grupo, con una frase por pantalla. Solo se ven las pantallas a las que la persona
// llega: el mismo gate que el menú lateral.
const grupos = useMenuConfiguracion()
</script>

<template>
  <div class="space-y-6" data-qa="configuracion-indice">
    <CrudPageHeader
      title="Configuración"
      description="Elige qué quieres dejar listo en tu local."
    />

    <UCard v-for="grupo in grupos" :key="grupo.label" :ui="shellUi.card">
      <template #header>
        <h2 class="text-base font-semibold text-default">
          {{ grupo.label }}
        </h2>
      </template>
      <ul class="grid gap-x-6 gap-y-1 md:grid-cols-2">
        <li v-for="entrada in grupo.items" :key="entrada.to">
          <NuxtLink
            :to="entrada.to"
            class="flex min-h-11 items-start gap-3 rounded-md px-2 py-2 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
          >
            <UIcon :name="entrada.icon" class="mt-0.5 size-5 shrink-0 text-primary" />
            <span class="min-w-0">
              <span class="block text-sm font-medium text-default">{{ entrada.label }}</span>
              <span class="block text-sm text-muted">{{ entrada.descripcion }}</span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </UCard>
  </div>
</template>
