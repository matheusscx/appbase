<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  layout: 'dashboard',
})

const store = useAuthStore()
const tenantStore = useTenantStore()
const permissionsStore = usePermissionsStore()

// Qué bloques le corresponden a este rol. Sin ninguno, la pantalla era un "Bienvenido" con el título
// "Ahora" y nada debajo (auditoría UX 04.8): ahora dice qué hacer y esconde los títulos vacíos.
const verAhora = computed(() =>
  permissionsStore.can('Salones', 'Ver todas')
  || permissionsStore.can('Cajas', 'Leer')
  || permissionsStore.can('Inventario', 'Leer')
  || permissionsStore.can('Pasarelas', 'Leer'),
)
const verHoy = computed(() => permissionsStore.can('Resumen del negocio', 'Leer'))
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
             `2026-09-18-dashboard-inicio-design.md` § 3.1 y § 6). Sin atajo
             para el admin: `mis-permisos` le trae solo los módulos que su
             tenant contrató (owner, 2026-10-15). Si igual llega un 403, el
             `useRefrescoPeriodico` del bloque lo esconde. -->
        <section v-if="verAhora" class="space-y-3">
          <h3 class="text-sm font-medium text-muted">
            Ahora
          </h3>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InicioSalon v-if="permissionsStore.can('Salones', 'Ver todas')" />
            <InicioCajas v-if="permissionsStore.can('Cajas', 'Leer')" />
            <InicioCierres v-if="permissionsStore.can('Cajas', 'Leer')" />
            <!-- En "Ahora" y no en "Hoy": el stock cambia todo el turno con cada
                 venta, igual que salón y cajas. -->
            <InicioStockBajo v-if="permissionsStore.can('Inventario', 'Leer')" />
            <!-- Lo que la tienda cobró y no pudo registrar: plata del cliente
                 que espera una acción del local. -->
            <InicioPagosSinVenta v-if="permissionsStore.can('Pasarelas', 'Leer')" />
          </div>
        </section>

        <!-- Zona "Hoy": el día del dueño (spec `2026-09-18-dashboard-inicio-design.md`
             § 3.2 y § 6). Un solo componente —a diferencia de "Ahora"— porque
             sus cuatro bloques comparten UNA llamada a `/resumen-negocio/hoy`;
             `InicioHoy.vue` hace esa carga y esconde la zona entera si recibe
             un 403. -->
        <InicioHoy v-if="verHoy" />

        <p
          v-if="!verAhora && !verHoy"
          class="text-sm text-muted"
          data-qa="inicio-sin-resumen"
        >
          Tu rol no tiene resumen del día. Elige una sección en el menú.
        </p>
      </div>
    </template>
  </UDashboardPanel>
</template>
