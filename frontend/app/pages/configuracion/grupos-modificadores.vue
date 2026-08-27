<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

type Familia = 'ingrediente' | 'vendible'

interface OpcionRow {
  itemId: string
  /** Opcional: sin cantidad, la opción se configura por receta (override en item_grupo_modificador_opciones). */
  cantidad?: string
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
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

interface ItemCatalogo {
  id: string
  nombre: string
  tipo: string
  unidadMedida: string | null
}

/** Estado efectivo (override o default del grupo) de una opción para una receta que usa el grupo. */
interface RecetaUsandoOpcion {
  grupoOpcionId: string
  itemNombre: string
  cantidad: string | null
  cantidadDefault: string | null
  unidadCodigo: string | null
  precioExtra: string
  esPendiente: boolean
}

interface RecetaUsando {
  itemId: string
  itemNombre: string
  tipo: string
  itemGrupoId: string
  /** Moneda del ítem: la opción HEREDA la moneda de la receta a la que se aplica. */
  monedaId: string
  opciones: RecetaUsandoOpcion[]
}

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl
const unidadesMedidaStore = useUnidadesMedidaStore()

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('grupos-modificadores')

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
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)
// Segundo paso del restaurar, solo cuando el backend contesta 400 de colisión:
// el mensaje que explica cuál nombre está tomado y el nombre libre —editable—
// con el que se reintenta. Molde: configuracion/descuentos.vue.
const colisionModalOpen = ref(false)
const colisionMensaje = ref('')
const nombrePropuesto = ref('')

// ── Drawer "usado en recetas" ────────────────────────────────────────────
const recetasDrawerOpen = ref(false)
const recetasGrupoId = ref<string | null>(null)
const recetasUsando = ref<RecetaUsando[]>([])
const recetasLoading = ref(false)
/** TanStack row-selection state (`v-model:row-selection` de `UTable`), keyed por `itemGrupoId` vía `get-row-id`. */
const rowSelection = ref<Record<string, boolean>>({})
const loteCantidad = ref('')
const loteUnidad = ref<string | undefined>(undefined)
const lotePrecio = ref('')
const loteOpcionId = ref<string | undefined>(undefined)
const aplicandoLote = ref(false)

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

// ── Drawer "usado en recetas" — helpers ──────────────────────────────────

/** itemGrupoId de las filas seleccionadas en la UTable del drawer. */
const seleccionIg = computed<Set<string>>(() =>
  new Set(Object.entries(rowSelection.value).filter(([, v]) => v).map(([k]) => k)),
)

const recetasGrupoActual = computed(() =>
  grupos.value.find(g => g.grupoModificadorId === recetasGrupoId.value) ?? null,
)

const loteOpcionesItems = computed(() =>
  (recetasGrupoActual.value?.opciones ?? []).map(o => ({ label: o.itemNombre, value: o.grupoOpcionId })),
)

const loteEsIngrediente = computed(() => recetasGrupoActual.value?.familia === 'ingrediente')

/** Unidades de la misma magnitud que la unidad base del item de la opción elegida en el lote. */
function loteUnidadesFiltradas() {
  const opcion = recetasGrupoActual.value?.opciones.find(o => o.grupoOpcionId === loteOpcionId.value)
  const item = itemsCatalogo.value.find(i => i.id === opcion?.itemId)
  const magnitud = unidadesMedidaStore.magnitudDe(item?.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: u.codigo, value: u.codigo }))
}

/** Estado efectivo de la opción activa (`loteOpcionId`) para una fila (receta) del drawer. */
function opcionDeFila(fila: RecetaUsando): RecetaUsandoOpcion | undefined {
  return fila.opciones.find(o => o.grupoOpcionId === loteOpcionId.value)
}

async function cargarRecetasUsando() {
  if (!recetasGrupoId.value) return
  recetasUsando.value = await useApiFetch<RecetaUsando[]>(
    `${apiUrl}/grupos-modificadores/${recetasGrupoId.value}/items`,
  )
}

async function abrirRecetas(grupo: Grupo) {
  recetasGrupoId.value = grupo.grupoModificadorId
  rowSelection.value = {}
  loteOpcionId.value = grupo.opciones[0]?.grupoOpcionId ?? undefined
  loteCantidad.value = ''
  loteUnidad.value = undefined
  lotePrecio.value = ''
  recetasLoading.value = true
  try {
    await cargarRecetasUsando()
    recetasDrawerOpen.value = true
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las recetas que usan el grupo'), color: 'error' })
  }
  finally {
    recetasLoading.value = false
  }
}

async function aplicarLote() {
  if (!recetasGrupoId.value || !loteOpcionId.value || !seleccionIg.value.size) return
  aplicandoLote.value = true
  try {
    const { actualizados } = await useApiFetch<{ actualizados: number }>(
      `${apiUrl}/grupos-modificadores/${recetasGrupoId.value}/overrides`,
      {
        method: 'PATCH',
        body: {
          itemGrupoIds: [...seleccionIg.value],
          grupoOpcionId: loteOpcionId.value,
          cantidad: loteCantidad.value || undefined,
          unidadCodigo: loteUnidad.value || undefined,
          precioExtra: lotePrecio.value || undefined,
        },
      },
    )
    // Excepción a "mutar y actualizar el ref local en vez de recargar": el PATCH
    // /overrides devuelve solo `{ actualizados }`, no el estado por opción
    // recalculado (cantidad efectiva, esPendiente) — re-pedir la lista del
    // drawer es la forma más simple de reflejar los efectivos.
    await cargarRecetasUsando()
    rowSelection.value = {}
    toast.add({ title: `Aplicado a ${actualizados} recetas`, color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al aplicar en lote'), color: 'error' })
  }
  finally {
    aplicandoLote.value = false
  }
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

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `grupos.value` sin
// importar cuál toggle la originó. Esta pantalla NO usa `usePaginatedList`,
// así que no hereda ninguna cola que viva ahí: va local. Encierra las TRES
// cargas del `Promise.all` (grupos, catálogo de items, unidades de medida) y
// no solo la de grupos: comparten el mismo `loading`, y encadenar solo la de
// grupos dejaría `loading` desincronizado si un toggle rápido reordena las
// respuestas de las otras dos.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      const [gruposData] = await Promise.all([
        useApiFetch<Grupo[]>(`${apiUrl}/grupos-modificadores${query}`),
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
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

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
  if (grupo.eliminadoEl) return
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
    if (o.cantidad) {
      let cantidad: Decimal
      try {
        cantidad = new Decimal(o.cantidad)
      }
      catch {
        return 'La cantidad debe ser un número válido'
      }
      if (cantidad.isNaN() || cantidad.lessThanOrEqualTo(0)) return 'La cantidad debe ser mayor a 0'
    }
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
        const payload: { itemId: string, precioExtra: string, orden: number, unidadCodigo?: string, cantidad?: string } = {
          itemId: o.itemId,
          precioExtra: o.precioExtra,
          orden: i,
        }
        if (o.unidadCodigo) payload.unidadCodigo = o.unidadCodigo
        if (o.cantidad) payload.cantidad = o.cantidad
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

function pedirEliminar(grupo: Grupo) {
  if (grupo.eliminadoEl) return
  confirmDeleteId.value = grupo.grupoModificadorId
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/grupos-modificadores/${id}`, { method: 'DELETE' })
    // Con la papelera abierta la fila no desaparece: pasa a "eliminada" con su
    // autor y fecha. El DELETE no devuelve esos datos —solo llegan en el
    // próximo GET con el flag—, así que acá hace falta recargar en vez del
    // patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      grupos.value = grupos.value.filter(g => g.grupoModificadorId !== id)
    }
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

function cerrarRestaurar() {
  confirmRestaurarId.value = null
  confirmRestaurarModalOpen.value = false
  colisionModalOpen.value = false
  colisionMensaje.value = ''
  nombrePropuesto.value = ''
}

/**
 * Restaura un grupo de la papelera. `nombreNuevo` solo llega en el reintento
 * desde el modal de colisión. Molde: `descuentos.vue` → `restaurarDescuento()`.
 *
 * El catch NO cierra todo y tira un toast rojo: un 400 de colisión no es un
 * error terminal sino una pregunta —qué nombre querés usar—, así que abre el
 * segundo modal con la sugerencia del backend. Solo los errores de verdad
 * (404 "no está en la papelera", red) terminan en toast.
 */
async function restaurarGrupo(id: string, nombreNuevo?: string) {
  // El modal no se cierra solo al confirmar (lo cierran las funciones de acá),
  // así que mientras el POST viaja el segundo click manda un segundo
  // `POST .../restaurar` sobre una fila que el primero ya revivió: el backend
  // contesta 404 "no está en la papelera" y el usuario ve un toast de ERROR
  // inmediatamente después de un restore exitoso.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const g = grupos.value.find(x => x.grupoModificadorId === id)
    if (g) {
      g.eliminadoEl = null
      g.eliminadoPorNombre = null
      if (nombreNuevo) {
        // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
        // local no adivina. Reordenar hace falta porque el listado viene
        // ordenado por nombre y el renombre lo puede mover de lugar.
        g.nombre = nombreNuevo
        grupos.value = [...grupos.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      }
    }
    toast.add({ title: 'Grupo restaurado', color: 'success' })
    cerrarRestaurar()
  }
  catch (e: unknown) {
    const sugerido = nombreSugeridoDe(e)
    if (sugerido) {
      // Se reabre con la sugerencia NUEVA: si el usuario editó a un nombre que
      // también estaba tomado, el backend ya calculó el siguiente libre.
      colisionMensaje.value = apiErrorMsg(e, 'Ese nombre ya está en uso.')
      nombrePropuesto.value = sugerido
      confirmRestaurarModalOpen.value = false
      colisionModalOpen.value = true
    }
    else {
      toast.add({ title: apiErrorMsg(e, 'Error al restaurar'), color: 'error' })
      cerrarRestaurar()
    }
  }
  finally {
    restaurando.value = false
  }
}

function confirmarColision() {
  const id = confirmRestaurarId.value
  const nombre = nombrePropuesto.value.trim()
  if (!id || !nombre) return
  restaurarGrupo(id, nombre)
}

onMounted(cargar)

const columns: TableColumn<Grupo>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'familia', header: 'Familia' },
  { id: 'opciones', header: 'Opciones', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'uso', header: 'Items que lo usan', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const recetasColumns: TableColumn<RecetaUsando>[] = [
  { id: 'select', meta: { class: { th: 'w-10', td: 'w-10' } } },
  { accessorKey: 'itemNombre', header: 'Receta' },
  { id: 'tipo', header: 'Tipo' },
  { id: 'efectivo', header: 'Cantidad / unidad / precio' },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Grupos de modificadores"
      description="Grupos reutilizables de opciones (ingredientes o vendibles) para armar combos."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton
            icon="i-lucide-plus"
            @click="abrirCrear"
          >
            Nuevo grupo
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="grupos" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
            <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
              Eliminado
            </UBadge>
          </div>
          <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
            {{ formatearBorradoPor(row.original) }}
          </p>
        </div>
      </template>

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
        <UButton
          v-if="row.original.itemsUsandoCount > 0"
          variant="link"
          color="neutral"
          class="p-0 text-sm"
          @click="abrirRecetas(row.original)"
        >
          {{ row.original.itemsUsandoCount }}
        </UButton>
        <span v-else class="text-sm text-muted">0</span>
      </template>

      <template #acciones-cell="{ row }">
        <div v-if="row.original.eliminadoEl" class="flex justify-end">
          <UButton
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            @click="() => { confirmRestaurarId = row.original.grupoModificadorId; confirmRestaurarModalOpen = true }"
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
            @click="pedirEliminar(row.original)"
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

              <UFormField
                label="Cantidad (opcional)"
                description="Vacío = se configura por receta"
              >
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
                  <!-- Sin `MoneyInput` a propósito: acá el grupo todavía no cuelga de
                       ningún ítem, y la opción hereda la moneda del ítem al que se
                       aplica (owner, 2026-08-25). No hay moneda que resolver, y
                       `MoneyInput` sin una se renderiza deshabilitado. La ayuda visual
                       aparece donde el ítem existe: el precio extra por receta en
                       `configuracion/items.vue`. La escala la valida el backend con
                       `@EsCosto()` (4). -->
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
          @click="() => { drawerOpen = false }"
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

    <AppDrawer v-model:open="recetasDrawerOpen" width="xl">
      <template #header>
        <span class="font-semibold text-default">
          Usado en {{ recetasUsando.length }} {{ recetasUsando.length === 1 ? 'receta' : 'recetas' }}
        </span>
      </template>

      <template #body>
        <div class="space-y-4">
          <div class="grid grid-cols-12 items-end gap-2 rounded-lg border border-default p-3">
            <UFormField label="Opción" class="col-span-4">
              <USelectMenu
                v-model="loteOpcionId"
                :items="loteOpcionesItems"
                value-key="value"
                placeholder="Elegí una opción"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Cantidad" class="col-span-2">
              <UInput v-model="loteCantidad" inputmode="decimal" placeholder="150" class="w-full" />
            </UFormField>

            <UFormField v-if="loteEsIngrediente" label="Unidad" class="col-span-2">
              <USelectMenu
                v-model="loteUnidad"
                :items="loteUnidadesFiltradas()"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Precio extra" :class="loteEsIngrediente ? 'col-span-2' : 'col-span-4'">
              <!-- Sin `MoneyInput` a propósito, y acá la razón NO es la moneda (las
                   recetas seleccionadas suelen compartirla): es que este campo aplica
                   el mismo número a N recetas de una y `MoneyInput` en una moneda de
                   separador de miles `.` —el peso, la oficial de todos los tenants del
                   seed— lee ese punto como agrupador. Medido: teclear `800.5` emite
                   `8005`, y el backend NO lo rechaza, porque `@EsCosto()` valida escala
                   4 y `8005` es válido. O sea, ×10 guardado en silencio en N filas.
                   Con `,` anda bien, pero el input pelado manda `800.5` tal cual.
                   El detalle está en `docs/agent/pendientes.md` ("el 400 no es red para
                   los campos de escala fija"); mientras eso siga así, acá no va máscara. -->
              <UInput v-model="lotePrecio" inputmode="decimal" placeholder="0" class="w-full" />
            </UFormField>

            <div class="col-span-2 flex justify-end">
              <UButton
                :disabled="!loteOpcionId || !seleccionIg.size"
                :loading="aplicandoLote"
                @click="aplicarLote"
              >
                Aplicar a seleccionadas ({{ seleccionIg.size }})
              </UButton>
            </div>
          </div>

          <UTable
            v-model:row-selection="rowSelection"
            :get-row-id="(row: RecetaUsando) => row.itemGrupoId"
            :data="recetasUsando"
            :columns="recetasColumns"
            :loading="recetasLoading"
          >
            <template #select-header="{ table }">
              <UCheckbox
                :model-value="table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()"
                aria-label="Seleccionar todas"
                @update:model-value="(v: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!v)"
              />
            </template>
            <template #select-cell="{ row }">
              <UCheckbox
                :model-value="row.getIsSelected()"
                aria-label="Seleccionar fila"
                @update:model-value="(v: boolean | 'indeterminate') => row.toggleSelected(!!v)"
              />
            </template>

            <template #tipo-cell="{ row }">
              <span class="text-sm text-muted">{{ tipoLabels[row.original.tipo] ?? row.original.tipo }}</span>
            </template>

            <template #efectivo-cell="{ row }">
              <span v-if="!loteOpcionId" class="text-sm text-muted">Elegí una opción arriba</span>
              <template v-else-if="opcionDeFila(row.original)">
                <div class="flex items-center gap-2">
                  <UBadge
                    v-if="opcionDeFila(row.original)!.esPendiente"
                    label="Pendiente"
                    color="warning"
                    variant="subtle"
                    size="sm"
                  />
                  <span v-else class="text-sm text-default">
                    {{ opcionDeFila(row.original)!.cantidad }} {{ opcionDeFila(row.original)!.unidadCodigo }}
                    · {{ formatMonto(opcionDeFila(row.original)!.precioExtra, row.original.monedaId) }}
                  </span>
                </div>
              </template>
              <span v-else class="text-sm text-muted">—</span>
            </template>

            <template #empty>
              <div class="py-8 text-center text-sm text-muted">
                Ninguna receta usa este grupo todavía.
              </div>
            </template>
          </UTable>
        </div>
      </template>

      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          @click="() => { recetasDrawerOpen = false }"
        >
          Cerrar
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar grupo de modificadores"
      message="¿Eliminar este grupo? Podés recuperarlo desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar grupo de modificadores"
      message="¿Restaurar este grupo? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarGrupo(confirmRestaurarId)"
    />

    <!-- Segundo paso, solo si el backend rechazó por nombre tomado. El campo
         viene precargado con la sugerencia pero es editable: el usuario
         confirma o escribe el suyo (decisión del owner). -->
    <CrudModal
      v-model:open="colisionModalOpen"
      title="No se puede restaurar con ese nombre"
      :message="colisionMensaje"
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      :confirm-disabled="!nombrePropuesto.trim()"
      @cancel="cerrarRestaurar"
      @confirm="confirmarColision"
    >
      <template #detalle>
        <UFormField label="Restaurar como" class="mt-4">
          <UInput
            v-model="nombrePropuesto"
            aria-label="Restaurar como"
            autofocus
          />
        </UFormField>
      </template>
    </CrudModal>
  </div>
</template>
