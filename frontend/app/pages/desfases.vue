<script setup lang="ts">
import type {
  AplicarDesfaseItem,
  DesfaseItemDto,
} from '~/components/DesfasesPanel.vue'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()

interface AplicarResponse {
  aplicados: number
  omitidos: { itemId: string, nombre: string, motivo: string }[]
  afectados: DesfaseItemDto[]
}

const filas = ref<DesfaseItemDto[]>([])
const loading = ref(false)
const actionLoading = ref(false)

async function cargar() {
  loading.value = true
  try {
    filas.value = await useApiFetch<DesfaseItemDto[]>(`${apiUrl}/desfases`)
  }
  catch (e) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar costos desfasados'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

onMounted(cargar)

async function onAplicar(items: AplicarDesfaseItem[]) {
  actionLoading.value = true
  try {
    const res = await useApiFetch<AplicarResponse>(`${apiUrl}/desfases/aplicar`, {
      method: 'POST',
      body: { items },
    })
    // Un combo del lote puede volver en `omitidos` (dependía de una receta del
    // mismo lote): no se aplicó, así que su fila se conserva tal cual en vez
    // de sacarla de la bandeja.
    const omitidosIds = new Set(res.omitidos.map(o => o.itemId))
    const aplicadosIds = new Set(items.map(i => i.itemId).filter(id => !omitidosIds.has(id)))
    const afectadosIds = new Set(res.afectados.map(f => f.itemId))
    // Segunda pasada: los combos que quedaron desfasados por las recetas recién
    // aplicadas se resuelven acá mismo, en vez de recargar la lista entera.
    filas.value = [
      ...filas.value.filter(f => !aplicadosIds.has(f.itemId) && !afectadosIds.has(f.itemId)),
      ...res.afectados,
    ]
    if (res.omitidos.length) {
      toast.add({
        title: `${res.omitidos.length} combo(s) se recalcularon y vuelven a proponerse`,
        color: 'warning',
      })
    }
    if (res.afectados.length) {
      toast.add({
        title: `${res.afectados.length} combo(s) quedaron desfasados por este cambio`,
        color: 'info',
      })
    }
    else {
      toast.add({ title: 'Costos actualizados', color: 'success' })
    }
  }
  catch (e) {
    toast.add({ title: apiErrorMsg(e, 'Error al aplicar desfases'), color: 'error' })
  }
  finally {
    actionLoading.value = false
  }
}

async function onDescartar(itemIds: string[]) {
  actionLoading.value = true
  try {
    await useApiFetch(`${apiUrl}/desfases/descartar`, {
      method: 'POST',
      body: { itemIds },
    })
    const ids = new Set(itemIds)
    filas.value = filas.value.filter(f => !ids.has(f.itemId))
    toast.add({ title: 'Avisos descartados', color: 'success' })
  }
  catch (e) {
    toast.add({ title: apiErrorMsg(e, 'Error al descartar desfases'), color: 'error' })
  }
  finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Costos desfasados" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Costos desfasados"
          description="Recetas y combos cuyo costo difiere del registrado. Aplica el nuevo costo o descarta el aviso."
        />

        <DesfasesPanel
          :filas="filas"
          :loading="loading || actionLoading"
          @aplicar="onAplicar"
          @descartar="onDescartar"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
