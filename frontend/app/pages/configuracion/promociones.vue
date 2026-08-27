<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type {
  CanalPromocion,
  Promocion,
  PromocionPayload,
  ScopePromocion,
  ScopePromocionPayload,
  TipoPromocion,
  TipoScope,
} from '~/composables/usePromociones'
import {
  CANAL_OPTIONS,
  CANAL_SENTINEL_AMBOS,
  DIA_SEMANA_OPTIONS,
  PROMOCION_CONFIG,
  TIPO_PROMOCION_OPTIONS,
  TIPO_SCOPE_OPTIONS,
} from '~/utils/promociones-form-config'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend — mismo molde que `descuentos`/`recargos`. El menú ya la esconde a
// los no-admin, pero sin guard de ruta la URL escrita a mano la abría igual
// (la lectura es abierta, así que la tabla cargaba) y el 403 llegaba recién
// al guardar.
definePageMeta({ middleware: 'admin' })

interface ItemCatalogo { id: string, nombre: string, categoriaNombre: string | null }
interface CategoriaCatalogo { id: string, nombre: string }

const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const apiUrl = runtimeConfig.public.apiUrl
const { formatFecha, formatMonto } = useFormatters()
const { listar, crear, actualizar, eliminar } = usePromociones()

const promociones = ref<Promocion[]>([])
const itemsCatalogo = ref<ItemCatalogo[]>([])
const categoriasCatalogo = ref<CategoriaCatalogo[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const eliminando = ref(false)

const itemsOpts = computed(() =>
  itemsCatalogo.value.map(i => ({
    label: i.categoriaNombre ? `${i.nombre} (${i.categoriaNombre})` : i.nombre,
    value: i.id,
  })),
)
const categoriasOpts = computed(() =>
  categoriasCatalogo.value.map(c => ({ label: c.nombre, value: c.id })),
)

// ── Pausar: toggle simple, sin modal de uso ─────────────────────────────────
// A diferencia de `descuentos`/`recargos`, una promo no tiene tabla puente
// con ítems vendidos (no existe `GET .../uso`): pausarla no le esconde nada a
// nadie más, así que el toggle es directo — molde optimista+revert de
// `docs/patterns/frontend.md` §3, sin el modal de `usePausaRegla`.
const toggling = reactive(new Set<string>())

async function toggleActivo(promo: Promocion) {
  if (toggling.has(promo.id)) return
  toggling.add(promo.id)
  const prev = promo.activo
  promo.activo = !prev
  try {
    const saved = await actualizar(promo.id, { activo: promo.activo })
    upsertLocal(saved)
    toast.add({
      title: promo.activo ? 'Promoción activada' : 'Promoción pausada',
      color: 'success',
    })
  }
  catch (e: unknown) {
    promo.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(promo.id)
  }
}

// ── Formulario ───────────────────────────────────────────────────────────

interface ScopeForm {
  tipoScope: TipoScope
  categoriaId: string
  itemIds: string[]
  /** Solo significa algo en `precio_fijo`; en los demás tipos viaja pero no
   *  se muestra ni se envía (ver `guardar`). */
  cantidad: number | null
}

function scopeVacio(): ScopeForm {
  return { tipoScope: 'items', categoriaId: '', itemIds: [], cantidad: 1 }
}

const emptyForm = () => ({
  nombre: '',
  descripcion: '',
  tipo: 'porcentaje' as TipoPromocion,
  valorPorcentaje: '',
  cadaN: null as number | null,
  valorMonto: '',
  fechaInicio: null as string | null,
  fechaFin: null as string | null,
  horaInicio: null as string | null,
  horaFin: null as string | null,
  diasSemana: [] as number[],
  canal: CANAL_SENTINEL_AMBOS,
  activo: true,
  scopes: [scopeVacio()] as ScopeForm[],
})
const form = ref(emptyForm())

const cfg = computed(() => PROMOCION_CONFIG[form.value.tipo])

const drawerTitle = computed(() => (editingId.value ? 'Editar promoción' : 'Nueva promoción'))
const submitLabel = computed(() => (editingId.value ? 'Guardar' : 'Crear'))

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

/**
 * Cambiar de tipo puede dejar campos que el nuevo no usa. A diferencia de
 * `descuentos` (que bloquea con un modal de confirmación antes de guardar),
 * acá alcanza con un toast: el campo requerido del tipo nuevo siempre queda
 * vacío tras el cambio, así que el submit ya lo frena con un 400 legible
 * antes de que se pierda algo guardado de verdad. Lo único que este aviso
 * evita es la sorpresa de "¿por qué desapareció el combo?" a mitad de la
 * edición.
 */
function onTipoChange(value: TipoPromocion) {
  if (value === form.value.tipo) return
  form.value.tipo = value
  form.value.valorPorcentaje = ''
  form.value.cadaN = null
  form.value.valorMonto = ''
  const nuevaCfg = PROMOCION_CONFIG[value]
  if (!nuevaCfg.scopesMultiples && form.value.scopes.length > 1) {
    form.value.scopes = [form.value.scopes[0]!]
    toast.add({
      title: 'Se conserva solo el primer componente',
      description: 'Este tipo aplica a un único ítem, categoría o toda la venta.',
      color: 'warning',
    })
  }
}

function agregarSlot() {
  form.value.scopes = [...form.value.scopes, scopeVacio()]
}

function eliminarSlot(i: number) {
  form.value.scopes = form.value.scopes.filter((_, idx) => idx !== i)
}

// ── Carga ────────────────────────────────────────────────────────────────

async function cargar() {
  loading.value = true
  try {
    promociones.value = await listar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar promociones'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

/**
 * Catálogos para el armado de slots (ítems/categoría). Mismo techo de 100 que
 * el resto de los selectores del repo (`pageSize` tope del backend) — filtrado
 * client-side por `USelectMenu`, sin buscador contra la API (ningún selector
 * del proyecto lo tiene, ver `docs/patterns/frontend.md`).
 */
async function cargarCatalogos() {
  try {
    const [categorias, itemsResp] = await Promise.all([
      useApiFetch<{ id: string, nombre: string, activo: boolean }[]>(`${apiUrl}/categorias`),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?pageSize=100`),
    ])
    categoriasCatalogo.value = categorias
      .filter(c => c.activo)
      .map(c => ({ id: c.id, nombre: c.nombre }))
    itemsCatalogo.value = itemsResp.data.map(i => ({
      id: i.id,
      nombre: i.nombre,
      categoriaNombre: i.categoriaNombre,
    }))
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar catálogos'), color: 'error' })
  }
}

function upsertLocal(saved: Promocion) {
  const idx = promociones.value.findIndex(p => p.id === saved.id)
  if (idx >= 0) promociones.value[idx] = saved
  else promociones.value.push(saved)
  promociones.value = [...promociones.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function removeLocal(id: string) {
  promociones.value = promociones.value.filter(p => p.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function scopeAForm(s: ScopePromocion): ScopeForm {
  return {
    tipoScope: s.tipoScope,
    categoriaId: s.categoriaId ?? '',
    itemIds: s.itemIds ?? [],
    cantidad: s.cantidad ?? 1,
  }
}

function abrirEditar(p: Promocion) {
  resetDrawer()
  editingId.value = p.id
  form.value = {
    nombre: p.nombre,
    descripcion: p.descripcion ?? '',
    tipo: p.tipo,
    valorPorcentaje: p.valorPorcentaje ?? '',
    cadaN: p.cadaN ?? null,
    valorMonto: p.valorMonto ?? '',
    fechaInicio: p.fechaInicio,
    fechaFin: p.fechaFin,
    horaInicio: p.horaInicio,
    horaFin: p.horaFin,
    diasSemana: p.diasSemana ?? [],
    canal: p.canal ?? CANAL_SENTINEL_AMBOS,
    activo: p.activo,
    scopes: p.scopes.length ? p.scopes.map(scopeAForm) : [scopeVacio()],
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body: PromocionPayload = {
      nombre: form.value.nombre,
      descripcion: form.value.descripcion || null,
      activo: form.value.activo,
      tipo: form.value.tipo,
      fechaInicio: form.value.fechaInicio ?? '',
      fechaFin: form.value.fechaFin ?? '',
      horaInicio: form.value.horaInicio || null,
      horaFin: form.value.horaFin || null,
      diasSemana: form.value.diasSemana.length ? form.value.diasSemana : null,
      canal:
        form.value.canal === CANAL_SENTINEL_AMBOS
          ? null
          : (form.value.canal as CanalPromocion),
      valorPorcentaje: cfg.value.campoPorcentaje ? form.value.valorPorcentaje : null,
      cadaN: cfg.value.campoCadaN ? form.value.cadaN : null,
      valorMonto: cfg.value.campoMonto ? form.value.valorMonto : null,
      scopes: form.value.scopes.map((s): ScopePromocionPayload => ({
        tipoScope: s.tipoScope,
        categoriaId: s.tipoScope === 'categoria' ? s.categoriaId || null : null,
        itemIds: s.tipoScope === 'items' ? s.itemIds : undefined,
        cantidad: cfg.value.scopesMultiples ? s.cantidad ?? 1 : undefined,
      })),
    }

    const isNew = !editingId.value
    const saved = isNew
      ? await crear(body)
      : await actualizar(editingId.value!, body)
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Promoción creada' : 'Promoción actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

function pedirEliminar(p: Promocion) {
  confirmDeleteId.value = p.id
  confirmModalOpen.value = true
}

async function confirmarEliminar() {
  if (!confirmDeleteId.value) return
  eliminando.value = true
  try {
    await eliminar(confirmDeleteId.value)
    removeLocal(confirmDeleteId.value)
    toast.add({ title: 'Promoción eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    eliminando.value = false
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

// ── Presentación de la fila ──────────────────────────────────────────────

function labelTipo(tipo: TipoPromocion): string {
  return TIPO_PROMOCION_OPTIONS.find(o => o.value === tipo)?.label ?? tipo
}

function resumenValor(p: Promocion): string {
  if (p.tipo === 'porcentaje') {
    return p.valorPorcentaje ? `${(Number(p.valorPorcentaje) * 100).toFixed(0)}% de descuento` : '—'
  }
  if (p.tipo === 'nxm') {
    return p.valorPorcentaje && p.cadaN
      ? `Cada ${p.cadaN}: ${(Number(p.valorPorcentaje) * 100).toFixed(0)}% en la más barata`
      : '—'
  }
  return p.valorMonto ? formatMonto(p.valorMonto) : '—'
}

onMounted(() => {
  cargar()
  cargarCatalogos()
})

const columns: TableColumn<Promocion>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Promociones"
      description="Campañas de descuento (2x1, happy hour, combos) que el motor aplica solo, sin activación manual."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">
          Nueva promoción
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="promociones" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
            <UBadge
              v-if="estadoPromocionBadge(row.original)"
              :color="estadoPromocionBadge(row.original)!.color"
              variant="subtle"
            >
              {{ estadoPromocionBadge(row.original)!.label }}
            </UBadge>
            <UBadge color="neutral" variant="outline">
              {{ labelTipo(row.original.tipo) }}
            </UBadge>
          </div>
          <p class="text-sm text-muted">
            {{ resumenValor(row.original) }}
          </p>
          <p class="text-xs text-muted">
            {{ formatFecha(row.original.fechaInicio) }} – {{ formatFecha(row.original.fechaFin) }}
          </p>
        </div>
      </template>

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <USwitch
            :model-value="row.original.activo"
            :disabled="toggling.has(row.original.id)"
            @update:model-value="toggleActivo(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
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
          No hay promociones registradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="promocion-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="2x1 martes" autofocus />
          </UFormField>

          <UFormField label="Descripción">
            <UTextarea v-model="form.descripcion" placeholder="Opcional, uso interno" :rows="2" class="w-full" />
          </UFormField>

          <UFormField label="Tipo" required>
            <USelectMenu
              :model-value="form.tipo"
              :items="TIPO_PROMOCION_OPTIONS"
              value-key="value"
              @update:model-value="onTipoChange"
            />
          </UFormField>

          <!-- Valor del beneficio — por tipo (espejo de `chk_promociones_valor_segun_tipo`) -->
          <UFormField v-if="cfg.campoPorcentaje" :label="cfg.labelPorcentaje ?? 'Porcentaje'" required>
            <UInput v-model="form.valorPorcentaje" inputmode="decimal" placeholder="0.10 (= 10%)" />
            <template #hint>
              Expresar en decimal: 1.00 = 100% (gratis)
            </template>
          </UFormField>

          <UFormField v-if="cfg.campoCadaN" label="Cada cuántas unidades" required>
            <UInput v-model.number="form.cadaN" type="number" :min="2" placeholder="2 (= 2x1)" />
          </UFormField>

          <UFormField v-if="cfg.campoMonto" label="Precio del combo" required>
            <MoneyInput v-model="form.valorMonto" oficial />
          </UFormField>

          <!-- A qué aplica: un único scope (porcentaje/nxm) o slots del combo (precio_fijo) -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">
                {{ cfg.scopesMultiples ? 'Componentes del combo' : 'Aplica a' }}
              </span>
              <UButton
                v-if="cfg.scopesMultiples"
                size="xs"
                icon="i-lucide-plus"
                variant="ghost"
                @click="agregarSlot"
              >
                Agregar componente
              </UButton>
            </div>

            <div
              v-for="(scope, i) in form.scopes"
              :key="i"
              class="space-y-2 rounded-lg border border-default p-4"
            >
              <div v-if="cfg.scopesMultiples" class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted">Componente {{ i + 1 }}</span>
                <UButton
                  v-if="form.scopes.length > 1"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="eliminarSlot(i)"
                />
              </div>

              <UFormField label="Condición" required>
                <USelectMenu
                  v-model="scope.tipoScope"
                  :items="TIPO_SCOPE_OPTIONS"
                  value-key="value"
                />
              </UFormField>

              <UFormField v-if="scope.tipoScope === 'categoria'" label="Categoría" required>
                <USelectMenu
                  v-model="scope.categoriaId"
                  :items="categoriasOpts"
                  value-key="value"
                  placeholder="Selecciona una categoría"
                />
              </UFormField>

              <UFormField v-if="scope.tipoScope === 'items'" label="Ítems" required>
                <USelectMenu
                  v-model="scope.itemIds"
                  :items="itemsOpts"
                  value-key="value"
                  multiple
                  placeholder="Selecciona uno o más ítems"
                />
              </UFormField>

              <UFormField v-if="cfg.scopesMultiples" label="Cantidad" required>
                <UInput v-model.number="scope.cantidad" type="number" :min="1" placeholder="1" />
              </UFormField>
            </div>

            <p v-if="!form.scopes.length" class="text-xs text-muted">
              Agrega al menos un componente.
            </p>
          </div>

          <!-- Fechas — las dos obligatorias en los tres tipos (guardarraíl heredado) -->
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Fecha inicio" required>
              <AppDateInput
                :model-value="form.fechaInicio"
                qa="promocion-fecha-inicio"
                @update:model-value="form.fechaInicio = $event || null"
              />
            </UFormField>
            <UFormField label="Fecha fin" required>
              <AppDateInput
                :model-value="form.fechaFin"
                qa="promocion-fecha-fin"
                @update:model-value="form.fechaFin = $event || null"
              />
            </UFormField>
          </div>

          <!-- Franja horaria — opcional, las dos juntas o ninguna -->
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Hora inicio">
              <AppTimeInput
                :model-value="form.horaInicio"
                qa="promocion-hora-inicio"
                @update:model-value="form.horaInicio = $event || null"
              />
            </UFormField>
            <UFormField label="Hora fin">
              <AppTimeInput
                :model-value="form.horaFin"
                qa="promocion-hora-fin"
                @update:model-value="form.horaFin = $event || null"
              />
              <template #hint>
                Las dos juntas, o ninguna. Inicio &gt; fin cruza medianoche.
              </template>
            </UFormField>
          </div>

          <UFormField label="Días de la semana">
            <USelectMenu
              v-model="form.diasSemana"
              :items="DIA_SEMANA_OPTIONS"
              value-key="value"
              multiple
              placeholder="Todos los días"
            />
          </UFormField>

          <UFormField label="Canal">
            <USelectMenu
              v-model="form.canal"
              :items="CANAL_OPTIONS"
              value-key="value"
            />
          </UFormField>

          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton type="submit" form="promocion-form" :loading="saving">
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar promoción"
      message="¿Eliminar esta promoción? Dejará de aplicarse en las ventas."
      :loading="eliminando"
      @cancel="confirmDeleteId = null"
      @confirm="confirmarEliminar"
    />
  </div>
</template>
