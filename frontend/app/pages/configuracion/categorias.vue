<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Impresora } from '~/composables/useImpresoras'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface Categoria {
  id: string
  nombre: string
  aplicaA: string
  activo: boolean
  impresoraId: string | null
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const categorias = ref<Categoria[]>([])
const impresorasComanda = ref<Impresora[]>([])
const impresorasApi = useImpresoras()
const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('categorias')
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)

const impresoraOptions = computed(() => [
  { label: 'Sin ruta de comanda', value: null as string | null },
  ...impresorasComanda.value.map(i => ({ label: i.nombre, value: i.id as string | null })),
])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const aplicaAOptions = [
  { label: 'Productos', value: 'productos' },
  { label: 'Servicios', value: 'servicios' },
  { label: 'Ambos', value: 'ambos' },
]

const emptyForm = () => ({
  nombre: '',
  aplicaA: 'ambos',
  activo: true,
  impresoraId: null as string | null,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar categoría' : 'Nueva categoría',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

function aplicaALabel(value: string) {
  return aplicaAOptions.find(o => o.value === value)?.label ?? value
}

// `watch(verEliminados, cargar)` dispara `cargar()` por cada toggle del
// switch: dos clicks rápidos (prender/apagar "Ver eliminadas") disparan dos
// llamadas en paralelo, y sin serializar la respuesta que llega segunda pisa
// `categorias.value` sin importar cuál toggle la originó — el listado queda
// desincronizado del estado visible del switch.
//
// Esto NO es el patrón de a82bf72 (`items.vue` → `catalogosListos`): ese caso
// memoiza UN solo disparo (`cargarCatalogos()` corre una vez en `onMounted`)
// para que un consumidor tardío espere esa misma promesa — "no dispares dos
// veces". Acá `cargar()` se invoca N veces (una por toggle) y hace falta lo
// contrario: una cola serial donde cada invocación nueva encadena sobre la
// promesa de la anterior antes de arrancar la propia, así el orden de
// escritura en `categorias.value` queda atado al orden de los toggles —no a
// qué respuesta de red llega primero— sin que dos fetches lleguen a estar en
// vuelo a la vez.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      categorias.value = await useApiFetch<Categoria[]>(`${apiUrl}/categorias${query}`)
    }
    catch (e: unknown) {
      const msg = apiErrorMsg(e, 'Error al cargar categorías')
      toast.add({ title: msg, color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: Categoria) {
  const idx = categorias.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) {
    categorias.value[idx] = { ...categorias.value[idx], ...saved }
  }
  else {
    categorias.value.push(saved)
  }
  categorias.value = [...categorias.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  categorias.value = categorias.value.filter(c => c.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(cat: Categoria) {
  resetDrawer()
  editingId.value = cat.id
  form.value = {
    nombre: cat.nombre,
    aplicaA: cat.aplicaA,
    activo: cat.activo,
    impresoraId: cat.impresoraId,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      aplicaA: form.value.aplicaA,
      activo: form.value.activo,
      // Enviar el valor crudo: `null` (opción "Sin ruta de comanda") desasigna la
      // impresora; un id la (re)asigna. No usar `?? undefined` — impediría limpiarla.
      impresoraId: form.value.impresoraId,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Categoria>(`${apiUrl}/categorias`, { method: 'POST', body })
      : await useApiFetch<Categoria>(`${apiUrl}/categorias/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Categoría creada' : 'Categoría actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(cat: Categoria) {
  if (toggling.has(cat.id)) return
  toggling.add(cat.id)
  const prev = cat.activo
  cat.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/categorias/${cat.id}`, {
      method: 'PATCH',
      body: { activo: cat.activo },
    })
    toast.add({ title: cat.activo ? 'Categoría activada' : 'Categoría desactivada', color: 'success' })
  }
  catch (e: unknown) {
    cat.activo = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(cat.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/categorias/${id}`, {
      method: 'DELETE',
    })
    // Con la papelera abierta la fila no desaparece: pasa a "eliminada" con su
    // autor y fecha. El DELETE no devuelve esos datos (solo el backend los
    // sabe), así que acá sí hace falta recargar en vez del patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      removeLocal(id)
    }
    toast.add({ title: 'Categoría eliminada', color: 'success' })
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al eliminar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

async function restaurarCategoria(id: string) {
  try {
    await restaurar(id)
    const cat = categorias.value.find(c => c.id === id)
    if (cat) {
      cat.eliminadoEl = null
      cat.eliminadoPorNombre = null
    }
    toast.add({ title: 'Categoría restaurada', color: 'success' })
  }
  catch (e: unknown) {
    // El 400 de colisión de nombre trae el detalle de qué renombrar: se
    // muestra tal cual, sin reemplazarlo por el fallback genérico.
    const msg = apiErrorMsg(e, 'Error al restaurar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    confirmRestaurarId.value = null
    confirmRestaurarModalOpen.value = false
  }
}

async function cargarImpresoras() {
  try {
    impresorasComanda.value = await impresorasApi.listar('comanda')
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar impresoras'), color: 'error' })
  }
}

onMounted(() => {
  cargar()
  cargarImpresoras()
})

const columns: TableColumn<Categoria>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Categorías"
      description="Clasifica productos y servicios del catálogo."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminadas" />
            <span class="text-sm text-muted">Ver eliminadas</span>
          </div>
          <UButton
            icon="i-lucide-plus"
            @click="abrirCrear"
          >
            Nueva categoría
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="categorias" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <CrudListItem
              :title="row.original.nombre"
              :subtitle="`Aplica a: ${aplicaALabel(row.original.aplicaA)}${row.original.impresoraId ? ' · ' + (impresorasComanda.find(i => i.id === row.original.impresoraId)?.nombre ?? '') : ''}`"
            />
            <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
              Eliminada
            </UBadge>
          </div>
          <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
            {{ formatearBorradoPor(row.original) }}
          </p>
        </div>
      </template>

        <template #activo-cell="{ row }">
          <div class="flex justify-end">
            <USwitch
              :model-value="row.original.activo"
              :disabled="toggling.has(row.original.id) || !!row.original.eliminadoEl"
              @update:model-value="toggleActivo(row.original)"
            />
          </div>
        </template>

        <template #acciones-cell="{ row }">
          <div v-if="row.original.eliminadoEl" class="flex justify-end">
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="ghost"
              @click="() => { confirmRestaurarId = row.original.id; confirmRestaurarModalOpen = true }"
            >
              Restaurar
            </UButton>
          </div>
          <div v-else class="flex justify-end gap-2">
            <UButton
              icon="i-lucide-square-pen"
              color="neutral"
              variant="ghost"
              title="Editar"
              @click="abrirEditar(row.original)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              title="Eliminar"
              @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
            />
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay categorías registradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="categoria-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField label="Nombre" required>
            <UInput
              v-model="form.nombre"
              placeholder="Bebidas"
              autofocus
            />
          </UFormField>
          <UFormField label="Aplica a">
            <USelectMenu
              v-model="form.aplicaA"
              :items="aplicaAOptions"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Activa">
            <USwitch v-model="form.activo" />
          </UFormField>
          <UFormField
            label="Impresora de comanda"
            description="Rutea los ítems de esta categoría a una estación al enviar comanda."
          >
            <USelectMenu
              v-model="form.impresoraId"
              :items="impresoraOptions"
              value-key="value"
            />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          @click="() => { drawerOpen = false }"
        >
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="categoria-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar categoría"
      message="¿Estás seguro de que quieres eliminar esta categoría? Esta acción no se puede deshacer."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar categoría"
      message="¿Restaurar esta categoría? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      @cancel="confirmRestaurarId = null"
      @confirm="confirmRestaurarId && restaurarCategoria(confirmRestaurarId)"
    />
  </div>
</template>
