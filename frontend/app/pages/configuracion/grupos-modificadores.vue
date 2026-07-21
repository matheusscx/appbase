<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

type Familia = 'ingrediente' | 'vendible'

interface OpcionRow {
  itemId: string
  cantidad: string
  unidadCodigo?: string
  precioExtra: string
}

interface OpcionResuelta {
  grupoOpcionId: string
  itemId: string
  itemNombre: string
  tipo: string
  cantidad: string
  unidadCodigo: string | null
  precioExtra: string
  orden: number
  stock: string | null
}

interface Grupo {
  grupoModificadorId: string
  nombre: string
  familia: Familia | null
  opciones: OpcionResuelta[]
  itemsUsandoCount: number
}

interface ItemCatalogo {
  id: string
  nombre: string
  tipo: string
  unidadMedida: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl
const unidadesMedidaStore = useUnidadesMedidaStore()

const tipoLabels: Record<string, string> = {
  ingrediente: 'Ingrediente',
  producto: 'Producto',
  receta: 'Receta',
  servicio: 'Servicio',
}

const grupos = ref<Grupo[]>([])
const itemsCatalogo = ref<ItemCatalogo[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)

const emptyForm = () => ({
  nombre: '',
  opciones: [] as OpcionRow[],
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar grupo de modificadores' : 'Nuevo grupo de modificadores',
)
const submitLabel = computed(() => (editingId.value ? 'Guardar' : 'Crear'))

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

function familiaDeTipo(tipo: string): Familia {
  return tipo === 'ingrediente' ? 'ingrediente' : 'vendible'
}

function familiaDeItem(itemId: string): Familia | null {
  const item = itemsCatalogo.value.find(i => i.id === itemId)
  return item ? familiaDeTipo(item.tipo) : null
}

/** Familia derivada de las demás filas ya completadas, ignorando la fila `idx`. */
function familiaGrupoExcluyendo(idx: number): Familia | null {
  for (let i = 0; i < form.value.opciones.length; i++) {
    if (i === idx) continue
    const f = familiaDeItem(form.value.opciones[i]!.itemId)
    if (f) return f
  }
  return null
}

function itemsUsadosExcluyendo(idx: number): Set<string> {
  return new Set(
    form.value.opciones
      .filter((_, i) => i !== idx)
      .map(o => o.itemId)
      .filter(Boolean),
  )
}

/** Items candidatos para la fila `idx`: excluye ya usados y filtra por familia del grupo. */
function opcionesDisponibles(idx: number) {
  const familiaReq = familiaGrupoExcluyendo(idx)
  const usados = itemsUsadosExcluyendo(idx)
  return itemsCatalogo.value
    .filter(it => !usados.has(it.id))
    .filter(it => !familiaReq || familiaDeTipo(it.tipo) === familiaReq)
    .map(it => ({ label: `${it.nombre} (${tipoLabels[it.tipo] ?? it.tipo})`, value: it.id }))
}

/** Unidades de la misma magnitud que la unidad base del ingrediente seleccionado. */
function unidadesFiltradas(idx: number) {
  const op = form.value.opciones[idx]
  const item = itemsCatalogo.value.find(i => i.id === op?.itemId)
  const magnitud = unidadesMedidaStore.magnitudDe(item?.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: u.codigo, value: u.codigo }))
}

function onSelectItemOpcion(idx: number, itemId: string | undefined) {
  if (!itemId) return
  const familiaExistente = familiaGrupoExcluyendo(idx)
  const familiaNueva = familiaDeItem(itemId)
  if (familiaExistente && familiaNueva && familiaExistente !== familiaNueva) {
    toast.add({
      title: 'Todas las opciones del grupo deben ser de la misma familia (ingrediente o vendible)',
      color: 'warning',
    })
    return
  }
  const opciones = [...form.value.opciones]
  const actual = opciones[idx]!
  opciones[idx] = {
    ...actual,
    itemId,
    cantidad: familiaNueva === 'vendible' ? (actual.cantidad || '1') : actual.cantidad,
    unidadCodigo: familiaNueva === 'ingrediente' ? actual.unidadCodigo : undefined,
  }
  form.value.opciones = opciones
}

function agregarOpcion() {
  form.value.opciones = [...form.value.opciones, { itemId: '', cantidad: '', unidadCodigo: undefined, precioExtra: '' }]
}

function eliminarOpcion(idx: number) {
  form.value.opciones = form.value.opciones.filter((_, i) => i !== idx)
}

async function cargarItemsCatalogo() {
  const tipos = ['ingrediente', 'producto', 'receta', 'servicio']
  const respuestas = await Promise.all(
    tipos.map(tipo =>
      useApiFetch<PaginatedResponse<{ id: string, nombre: string, tipo: string, unidadMedida: string | null }>>(
        `${apiUrl}/items?tipo=${tipo}&pageSize=100`,
      ),
    ),
  )
  itemsCatalogo.value = respuestas.flatMap(r =>
    r.data.map(it => ({ id: it.id, nombre: it.nombre, tipo: it.tipo, unidadMedida: it.unidadMedida })),
  )
}

async function cargar() {
  loading.value = true
  try {
    const [gruposData] = await Promise.all([
      useApiFetch<Grupo[]>(`${apiUrl}/grupos-modificadores`),
      cargarItemsCatalogo(),
      unidadesMedidaStore.ensureLoaded(),
    ])
    grupos.value = gruposData
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar grupos de modificadores'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: Grupo) {
  // El create() del backend no incluye itemsUsandoCount (un grupo recién creado
  // siempre parte en 0, todavía no hay items que lo referencien).
  const normalizado: Grupo = { ...saved, itemsUsandoCount: saved.itemsUsandoCount ?? 0 }
  const idx = grupos.value.findIndex(g => g.grupoModificadorId === normalizado.grupoModificadorId)
  if (idx >= 0) {
    grupos.value[idx] = normalizado
  }
  else {
    grupos.value.push(normalizado)
  }
  grupos.value = [...grupos.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(grupo: Grupo) {
  resetDrawer()
  editingId.value = grupo.grupoModificadorId
  form.value = {
    nombre: grupo.nombre,
    opciones: grupo.opciones.map(o => ({
      itemId: o.itemId,
      cantidad: o.cantidad,
      unidadCodigo: o.unidadCodigo ?? undefined,
      precioExtra: o.precioExtra,
    })),
  }
  drawerOpen.value = true
}

function validarForm(): string | null {
  if (!form.value.nombre.trim()) return 'El nombre es obligatorio'
  if (!form.value.opciones.length) return 'Agregá al menos una opción'
  for (const o of form.value.opciones) {
    if (!o.itemId) return 'Seleccioná un item para cada opción'
    if (!o.cantidad) return 'Completá la cantidad de cada opción'
    if (!o.precioExtra) return 'Completá el precio extra de cada opción (puede ser 0)'
    if (familiaDeItem(o.itemId) === 'ingrediente' && !o.unidadCodigo) {
      return 'Las opciones ingrediente requieren unidad de medida'
    }
  }
  return null
}

async function guardar() {
  const error = validarForm()
  if (error) {
    toast.add({ title: error, color: 'warning' })
    return
  }
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      opciones: form.value.opciones.map((o, i) => {
        const payload: { itemId: string, cantidad: string, precioExtra: string, orden: number, unidadCodigo?: string } = {
          itemId: o.itemId,
          cantidad: o.cantidad,
          precioExtra: o.precioExtra,
          orden: i,
        }
        if (o.unidadCodigo) payload.unidadCodigo = o.unidadCodigo
        return payload
      }),
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Grupo>(`${apiUrl}/grupos-modificadores`, { method: 'POST', body })
      : await useApiFetch<Grupo>(`${apiUrl}/grupos-modificadores/${editingId.value}`, { method: 'PATCH', body })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Grupo creado' : 'Grupo actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/grupos-modificadores/${id}`, { method: 'DELETE' })
    grupos.value = grupos.value.filter(g => g.grupoModificadorId !== id)
    toast.add({ title: 'Grupo eliminado', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<Grupo>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'familia', header: 'Familia' },
  { id: 'opciones', header: 'Opciones', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'uso', header: 'Items que lo usan', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Grupos de modificadores"
      description="Grupos reutilizables de opciones (ingredientes o vendibles) para armar combos."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          @click="abrirCrear"
        >
          Nuevo grupo
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="grupos" :columns="columns" :loading="loading">
      <template #familia-cell="{ row }">
        <UBadge
          v-if="row.original.familia"
          :label="row.original.familia === 'ingrediente' ? 'Ingrediente' : 'Vendible'"
          :color="row.original.familia === 'ingrediente' ? 'warning' : 'primary'"
          variant="subtle"
          size="sm"
        />
        <span v-else class="text-sm text-muted">—</span>
      </template>

      <template #opciones-cell="{ row }">
        <span class="text-sm">{{ row.original.opciones.length }}</span>
      </template>

      <template #uso-cell="{ row }">
        <span class="text-sm">{{ row.original.itemsUsandoCount }}</span>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            @click="abrirEditar(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="() => { confirmDeleteId = row.original.grupoModificadorId; confirmModalOpen = true }"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay grupos de modificadores registrados.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="grupo-modificador-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField label="Nombre" required>
            <UInput
              v-model="form.nombre"
              placeholder="Salsas"
              autofocus
              class="w-full"
            />
          </UFormField>

          <USeparator />

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-muted">
                Opciones ({{ form.opciones.length }})
              </p>
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-plus"
                @click="agregarOpcion"
              >
                Agregar opción
              </UButton>
            </div>

            <div
              v-for="(op, idx) in form.opciones"
              :key="idx"
              class="grid grid-cols-5 gap-2 items-end"
            >
              <UFormField label="Item" class="col-span-2">
                <USelectMenu
                  :model-value="op.itemId"
                  :items="opcionesDisponibles(idx)"
                  value-key="value"
                  class="w-full"
                  @update:model-value="(v: string) => onSelectItemOpcion(idx, v)"
                />
              </UFormField>

              <UFormField label="Cantidad">
                <UInput v-model="op.cantidad" inputmode="decimal" placeholder="1" class="w-full" />
              </UFormField>

              <UFormField v-if="familiaDeItem(op.itemId) === 'ingrediente'" label="Unidad">
                <USelectMenu
                  v-model="op.unidadCodigo"
                  :items="unidadesFiltradas(idx)"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>

              <div
                class="flex items-end gap-2"
                :class="{ 'col-span-2': familiaDeItem(op.itemId) !== 'ingrediente' }"
              >
                <UFormField label="Precio extra" class="flex-1">
                  <UInput v-model="op.precioExtra" inputmode="decimal" placeholder="0" class="w-full" />
                </UFormField>
                <UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  size="sm"
                  @click="eliminarOpcion(idx)"
                />
              </div>
            </div>

            <p v-if="!form.opciones.length" class="text-sm text-muted">
              Agregá al menos una opción. Todas deben ser de la misma familia (ingrediente o vendible).
            </p>
          </div>
        </UForm>
      </template>

      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          @click="drawerOpen = false"
        >
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="grupo-modificador-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar grupo de modificadores"
      message="¿Estás seguro de que quieres eliminar este grupo? Esta acción no se puede deshacer."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
