<script setup lang="ts">
import type {
  AplicarDesfaseItem,
  DescartarDesfaseItem,
  DesfaseItemDto,
} from '~/components/DesfasesPanel.vue'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()

/**
 * `cambiados` son las filas cuyo costo se movió entre que la bandeja se cargó y
 * el clic en Descartar: NO se descartaron, y vuelven con su número nuevo.
 */
interface DescartarResponse {
  descartados: number
  cambiados: { itemId: string, nombre: string, costoPropuestoActual: string }[]
}

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

async function onDescartar(items: DescartarDesfaseItem[]) {
  actionLoading.value = true
  try {
    const res = await useApiFetch<DescartarResponse>(`${apiUrl}/desfases/descartar`, {
      method: 'POST',
      body: { items },
    })
    if (res.cambiados.length) {
      // Se recarga entera en vez de filtrar a mano: las filas que cambiaron
      // tienen que mostrar el número NUEVO, y sacarlas de la lista sería
      // repetir el bug que este cambio cierra (la fila desaparecía con el
      // desfase adentro).
      await cargar()
      const uno = res.cambiados[0]!
      toast.add({
        title: res.cambiados.length === 1
          ? `El costo de «${uno.nombre}» cambió mientras mirabas`
          : `${res.cambiados.length} costos cambiaron mientras mirabas`,
        description: 'Esos avisos no se descartaron. Mirá el número nuevo y decidí otra vez.',
        color: 'warning',
      })
    }
    else {
      const ids = new Set(items.map(i => i.itemId))
      filas.value = filas.value.filter(f => !ids.has(f.itemId))
    }
    if (res.descartados) {
      toast.add({ title: 'Avisos descartados', color: 'success' })
    }
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
