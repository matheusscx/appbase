<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

type PropinaTab = 'liquidaciones' | 'reportes'

const route = useRoute()
const router = useRouter()
const permissions = usePermissionsStore()

function tabDesdeQuery(): PropinaTab {
  return route.query.tab === 'reportes' ? 'reportes' : 'liquidaciones'
}

const tab = ref<PropinaTab>(tabDesdeQuery())

const tabItems = [
  { label: 'Liquidaciones', value: 'liquidaciones', icon: 'i-lucide-hand-coins' },
  { label: 'Reportes', value: 'reportes', icon: 'i-lucide-chart-no-axes-combined' },
]

const titulo = computed(() =>
  tab.value === 'reportes' ? 'Reportes de propinas' : 'Liquidación de propinas',
)

const descripcion = computed(() =>
  tab.value === 'reportes'
    ? 'Revisa la cobranza, el estado de liquidación y la distribución por trabajador.'
    : 'Crea borradores por período, revisa el pool de propinas y confirma el reparto al personal.',
)

watch(tab, async (value) => {
  const query = { ...route.query, tab: value }
  if (value === 'liquidaciones') {
    delete query.vista
    delete query.desde
    delete query.hasta
    delete query.turnoIds
    delete query.tipoGarzon
  }
  await router.replace({ query })
})

watch(
  () => route.query.tab,
  (value) => {
    const next = value === 'reportes' ? 'reportes' : 'liquidaciones'
    if (tab.value !== next) tab.value = next
  },
)

onMounted(async () => {
  if (!permissions.permisos.length && !permissions.loading) {
    await permissions.fetchPermisos()
  }
  if (!permissions.esAdmin && !permissions.can('Propinas', 'Leer')) {
    await navigateTo('/')
  }
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar :title="titulo" />
    </template>

    <template #body>
      <div class="space-y-6">
        <CrudPageHeader
          title="Propinas"
          :description="descripcion"
        />

        <UTabs v-model="tab" :items="tabItems" :content="false" />

        <PropinaLiquidacionesPanel v-if="tab === 'liquidaciones'" />
        <PropinaReportesPanel v-else />
      </div>
    </template>
  </UDashboardPanel>
</template>
