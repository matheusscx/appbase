<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const permissionsStore = usePermissionsStore()
const toast = useToast()
const config = useRuntimeConfig()

// Cargar permisos al montar
onMounted(async () => {
  await permissionsStore.fetchPermisos()
})

// ---- Sección A: validación frontend (no llaman al backend) ----
function accionFrontend(label: string) {
  toast.add({ title: label, color: 'success' })
}

// ---- Sección B: validación backend (siempre habilitados) ----
async function accionBackend(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string) {
  try {
    const result = await useApiFetch<{ message: string }>(
      `${config.public.apiUrl}/${path}`,
      { method }
    )
    toast.add({ title: result.message, color: 'success' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error 403'
    toast.add({ title: msg, color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Test" />
    </template>

    <template #body>
      <div class="p-6 space-y-8">

        <!-- Sección A: Validación Frontend -->
        <div>
          <h2 class="text-lg font-semibold mb-1">Sección A — Validación Frontend</h2>
          <p class="text-sm text-muted mb-4">
            Los botones se deshabilitan según los permisos del store. No llaman al backend.
          </p>
          <div class="flex flex-wrap gap-3">
            <UButton
              :disabled="!permissionsStore.can('Test', 'Leer')"
              @click="accionFrontend('Leyendo')"
            >
              Leer
            </UButton>
            <UButton
              :disabled="!permissionsStore.can('Test', 'Crear')"
              @click="accionFrontend('Creando')"
            >
              Crear
            </UButton>
            <UButton
              :disabled="!permissionsStore.can('Test', 'Actualizar')"
              @click="accionFrontend('Actualizando')"
            >
              Actualizar
            </UButton>
            <UButton
              :disabled="!permissionsStore.can('Test', 'Eliminar')"
              @click="accionFrontend('Eliminando')"
            >
              Eliminar
            </UButton>
          </div>
        </div>

        <!-- Sección B: Validación Backend -->
        <div>
          <h2 class="text-lg font-semibold mb-1">Sección B — Validación Backend</h2>
          <p class="text-sm text-muted mb-4">
            Los botones siempre están habilitados. El backend acepta o rechaza con 403.
          </p>
          <div class="flex flex-wrap gap-3">
            <UButton @click="accionBackend('GET', 'test/leer')">
              GET /test/leer
            </UButton>
            <UButton @click="accionBackend('POST', 'test/crear')">
              POST /test/crear
            </UButton>
            <UButton @click="accionBackend('PATCH', 'test/actualizar')">
              PATCH /test/actualizar
            </UButton>
            <UButton @click="accionBackend('DELETE', 'test/eliminar')">
              DELETE /test/eliminar
            </UButton>
          </div>
        </div>

      </div>
    </template>
  </UDashboardPanel>
</template>
