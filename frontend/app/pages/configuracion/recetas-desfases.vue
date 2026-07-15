<script setup lang="ts">
import type {
  AplicarDesfaseItem,
  DesfaseRecetaDto,
} from '~/components/RecetasDesfasesPanel.vue'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()

const filas = ref<DesfaseRecetaDto[]>([])
const loading = ref(false)
const actionLoading = ref(false)

async function cargar() {
  loading.value = true
  try {
    filas.value = await useApiFetch<DesfaseRecetaDto[]>(`${apiUrl}/recetas/desfases`)
  }
  catch (e) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar recetas desfasadas'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

onMounted(cargar)

async function onAplicar(items: AplicarDesfaseItem[]) {
  actionLoading.value = true
  try {
    await useApiFetch(`${apiUrl}/recetas/desfases/aplicar`, {
      method: 'POST',
      body: { items },
    })
    toast.add({ title: 'Costos de recetas actualizados', color: 'success' })
    await cargar()
  }
  catch (e) {
    toast.add({ title: apiErrorMsg(e, 'Error al aplicar desfases'), color: 'error' })
  }
  finally {
    actionLoading.value = false
  }
}

async function onDescartar(recetaItemIds: string[]) {
  actionLoading.value = true
  try {
    await useApiFetch(`${apiUrl}/recetas/desfases/descartar`, {
      method: 'POST',
      body: { recetaItemIds },
    })
    toast.add({ title: 'Avisos descartados', color: 'success' })
    await cargar()
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
  <div class="space-y-6">
    <CrudPageHeader
      title="Recetas desfasadas"
      description="Recetas cuyo costo de insumos difiere del registrado. Aplica el nuevo costo o descarta el aviso."
    />

    <RecetasDesfasesPanel
      :filas="filas"
      :loading="loading || actionLoading"
      @aplicar="onAplicar"
      @descartar="onDescartar"
    />
  </div>
</template>
