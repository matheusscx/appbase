<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  layout: 'dashboard',
})

const store = useAuthStore()
const tenantStore = useTenantStore()
const permissionsStore = usePermissionsStore()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Inicio" />
    </template>

    <template #body>
      <div class="w-full space-y-8">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950 flex items-center justify-center shrink-0">
            <UIcon name="i-lucide-circle-check" class="w-5 h-5 text-highlighted" />
          </div>
          <div>
            <h2 class="text-lg font-semibold text-default">
              Bienvenido, {{ store.user?.nombre }}
            </h2>
            <ClientOnly>
              <p class="text-muted text-xs">
                Trabajando en <strong>{{ tenantStore.activeTenant?.nombre ?? '—' }}</strong>
              </p>
            </ClientOnly>
          </div>
        </div>

        <!-- Zona "Ahora": el turno en vivo, con refresco periódico (spec
             `2026-09-18-dashboard-inicio-design.md` § 3.1 y § 6). Un bloque
             que el tenant no contrató se muestra igual acá —el admin no
             tiene cómo saberlo desde el frontend— y se esconde solo cuando
             su propio `useRefrescoPeriodico` recibe el 403. -->
        <section class="space-y-3">
          <h3 class="text-sm font-medium text-muted">
            Ahora
          </h3>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InicioSalon v-if="permissionsStore.esAdmin || permissionsStore.can('Salones', 'Ver todas')" />
            <InicioCajas v-if="permissionsStore.esAdmin || permissionsStore.can('Cajas', 'Leer')" />
            <InicioCierres v-if="permissionsStore.esAdmin || permissionsStore.can('Cajas', 'Leer')" />
          </div>
        </section>

        <!-- Zona "Hoy": el día del dueño (spec `2026-09-18-dashboard-inicio-design.md`
             § 3.2 y § 6). Un solo componente —a diferencia de "Ahora"— porque
             sus cuatro bloques comparten UNA llamada a `/resumen-negocio/hoy`;
             `InicioHoy.vue` hace esa carga y esconde la zona entera si recibe
             un 403 (mismo motivo que "Ahora": el frontend no sabe qué módulos
             contrató el tenant). -->
        <InicioHoy v-if="permissionsStore.esAdmin || permissionsStore.can('Resumen del negocio', 'Leer')" />
      </div>
    </template>
  </UDashboardPanel>
</template>
