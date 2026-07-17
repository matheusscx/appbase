<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { DESCUENTO_CONFIG, type TipoConfig } from '~/utils/reglas-form-config'

interface TipoRegla { id: string; nombre: string; codigo: string; descripcion: string | null }

interface Regla {
  id: string
  nombre: string
  tipoReglaId: string
  tipoRegla?: { id: string; codigo: string; nombre: string }
  modo: string | null
  valor: string | null
  metodoPagoIds: string[]
  tramos: { minimo: string; valor: string }[]
  diasVencimiento: number | null
  fechaInicio: string | null
  fechaFin: string | null
  activo: boolean
}

const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const apiUrl = runtimeConfig.public.apiUrl

const descuentos = ref<Regla[]>([])
const tipos = ref<{ label: string; value: string; codigo: string; descripcion: string | null }[]>([])
const metodos = ref<{ label: string; value: string }[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())
const nombreError = ref<string | null>(null)

const modoOptions = [
  { label: 'Porcentaje', value: 'porcentaje' },
  { label: 'Monto fijo', value: 'monto_fijo' },
]

const CONFIG_MAP = DESCUENTO_CONFIG

const emptyForm = () => ({
  nombre: '',
  tipoReglaId: '',
  modo: 'porcentaje' as string | null,
  valor: '' as string | null,
  metodoPagoIds: [] as string[],
  tramos: [] as { minimo: string; valor: string }[],
  diasVencimiento: null as number | null,
  fechaInicio: null as string | null,
  fechaFin: null as string | null,
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar descuento' : 'Nuevo descuento',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
  nombreError.value = null
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

const tipoSeleccionado = computed(() =>
  tipos.value.find(t => t.value === form.value.tipoReglaId),
)
const config = computed<TipoConfig | null>(() =>
  tipoSeleccionado.value ? CONFIG_MAP[tipoSeleccionado.value.codigo] ?? null : null,
)

// Reset dependent fields only on a real user change of tipo (not on programmatic
// form population in abrirEditar). Bound to the select's change event below.
function onTipoChange(value: string) {
  form.value.tipoReglaId = value
  form.value.metodoPagoIds = []
  form.value.tramos = []
  form.value.diasVencimiento = null
  form.value.modo = config.value?.modo === 'porcentaje' ? 'porcentaje' : 'monto_fijo'
}

async function cargar() {
  loading.value = true
  try {
    descuentos.value = await useApiFetch<Regla[]>(`${apiUrl}/descuentos`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar descuentos')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: Regla) {
  const idx = descuentos.value.findIndex(d => d.id === saved.id)
  const prev = idx >= 0 ? descuentos.value[idx] : null
  const merged: Regla = {
    ...(prev ?? { tramos: [], metodoPagoIds: [] }),
    ...saved,
    tramos: saved.tramos ?? prev?.tramos ?? [],
    metodoPagoIds: saved.metodoPagoIds ?? prev?.metodoPagoIds ?? [],
    tipoRegla: saved.tipoRegla ?? prev?.tipoRegla,
  }
  if (idx >= 0) {
    descuentos.value[idx] = merged
  }
  else {
    descuentos.value.push(merged)
  }
  descuentos.value = [...descuentos.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  descuentos.value = descuentos.value.filter(d => d.id !== id)
}

async function cargarTipos() {
  try {
    const data = await useApiFetch<TipoRegla[]>(`${apiUrl}/tipos-regla?clase=descuento`)
    tipos.value = data.map(t => ({ label: t.nombre, value: t.id, codigo: t.codigo, descripcion: t.descripcion ?? null }))
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar tipos de descuento')
    toast.add({ title: msg, color: 'error' })
  }
}

async function cargarMetodos() {
  try {
    const data = await useApiFetch<{ metodoPagoId: string; nombre: string; habilitada: boolean }[]>(
      `${apiUrl}/metodos-pago`,
    )
    metodos.value = data
      .filter(m => m.habilitada)
      .map(m => ({ label: m.nombre, value: m.metodoPagoId }))
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar métodos de pago')
    toast.add({ title: msg, color: 'error' })
  }
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(d: Regla) {
  resetDrawer()
  editingId.value = d.id
  form.value = {
    nombre: d.nombre,
    tipoReglaId: d.tipoReglaId,
    modo: d.modo,
    valor: d.valor,
    metodoPagoIds: d.metodoPagoIds ?? [],
    tramos: d.tramos?.map(t => ({ minimo: t.minimo ?? '', valor: t.valor ?? '' })) ?? [],
    diasVencimiento: d.diasVencimiento ?? null,
    fechaInicio: d.fechaInicio ?? null,
    fechaFin: d.fechaFin ?? null,
    activo: d.activo,
  }
  drawerOpen.value = true
}

async function checkNombre() {
  if (!form.value.nombre) { nombreError.value = null; return }
  try {
    const params = new URLSearchParams({ nombre: form.value.nombre })
    if (editingId.value) params.append('excludeId', editingId.value)
    const res = await useApiFetch<{ disponible: boolean }>(
      `${apiUrl}/descuentos/nombre-disponible?${params}`,
    )
    nombreError.value = res.disponible ? null : 'Ya existe un descuento con este nombre'
  }
  catch {
    // don't block the form on a check failure
  }
}

async function guardar() {
  await checkNombre()
  if (nombreError.value) return

  saving.value = true
  try {
    const cfg = config.value
    const body: Record<string, unknown> = {
      nombre: form.value.nombre,
      tipoReglaId: form.value.tipoReglaId,
      activo: form.value.activo,
    }

    if (cfg) {
      if (cfg.modo === 'libre') body.modo = form.value.modo
      if (cfg.campoValor) body.valor = form.value.valor
      if (cfg.campoMetodos) body.metodoPagoIds = form.value.metodoPagoIds
      if (cfg.campoTramos) body.tramos = form.value.tramos
      if (cfg.campoDias) body.diasVencimiento = form.value.diasVencimiento
      if (cfg.campoFechaInicio) body.fechaInicio = form.value.fechaInicio || null
      if (cfg.campoFechaFin) body.fechaFin = form.value.fechaFin || null
    }

    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Regla>(`${apiUrl}/descuentos`, { method: 'POST', body })
      : await useApiFetch<Regla>(`${apiUrl}/descuentos/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Descuento creado' : 'Descuento actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(d: Regla) {
  if (toggling.has(d.id)) return
  toggling.add(d.id)
  const prev = d.activo
  d.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/descuentos/${d.id}`, {
      method: 'PATCH',
      body: { activo: d.activo },
    })
    toast.add({ title: d.activo ? 'Descuento activado' : 'Descuento desactivado', color: 'success' })
  }
  catch (e: unknown) {
    d.activo = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(d.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/descuentos/${id}`, {
      method: 'DELETE',
    })
    removeLocal(id)
    toast.add({ title: 'Descuento eliminado', color: 'success' })
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

function agregarTramo() {
  form.value.tramos = [...form.value.tramos, { minimo: '', valor: '' }]
}

function eliminarTramo(i: number) {
  form.value.tramos = form.value.tramos.filter((_, idx) => idx !== i)
}

onMounted(() => {
  cargar()
  cargarTipos()
  cargarMetodos()
})

const columns: TableColumn<Regla>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Descuentos"
      description="Reglas de descuento aplicables en el cálculo de precios."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          @click="abrirCrear"
        >
          Nuevo descuento
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="descuentos" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
            <p class="text-sm text-muted">
              <template v-if="row.original.tramos?.length">
                {{ row.original.tramos.length }} tramo{{ row.original.tramos.length !== 1 ? 's' : '' }}
              </template>
              <template v-else-if="row.original.valor">
                {{ row.original.modo === 'porcentaje' ? `${(Number(row.original.valor) * 100).toFixed(0)}%` : row.original.valor }}
                ({{ row.original.modo === 'porcentaje' ? 'porcentaje' : 'monto fijo' }})
              </template>
              <template v-else>
                {{ row.original.metodoPagoIds?.length ? `${row.original.metodoPagoIds.length} método(s) de pago` : '—' }}
              </template>
            </p>
            <p class="text-xs text-muted">
              {{ tipos.find(t => t.value === row.original.tipoReglaId)?.label ?? '' }}
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
              @click="abrirEditar(row.original)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
            />
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay descuentos registrados.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="descuento-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <!-- Nombre (always visible) -->
          <UFormField label="Nombre" required :error="nombreError">
            <UInput
              v-model="form.nombre"
              placeholder="Mi descuento"
              autofocus
              @blur="checkNombre"
            />
          </UFormField>

          <!-- Tipo (always visible) -->
          <UFormField label="Tipo" required>
            <USelectMenu
              :model-value="form.tipoReglaId"
              :items="tipos"
              label-key="label"
              value-key="value"
              placeholder="Selecciona un tipo"
              @update:model-value="onTipoChange"
            />
            <p
              v-if="tipoSeleccionado?.descripcion"
              class="mt-1.5 text-xs text-muted leading-snug"
            >
              {{ tipoSeleccionado.descripcion }}
            </p>
          </UFormField>

          <!-- Only show the rest if a tipo is selected and config is resolved -->
          <template v-if="config">
            <!-- Modo — only when libre -->
            <UFormField v-if="config.modo === 'libre'" label="Modo" required>
              <URadioGroup v-model="form.modo" :items="modoOptions" orientation="horizontal" />
            </UFormField>

            <!-- Valor — when campoValor -->
            <UFormField v-if="config.campoValor" :label="config.labelValor ?? 'Valor'" required>
              <UInput
                v-model="form.valor"
                inputmode="decimal"
                :placeholder="form.modo === 'porcentaje' ? '0.10 (= 10%)' : 'monto fijo'"
              />
              <template v-if="form.modo === 'porcentaje'" #hint>
                Expresar en decimal: 0.10 = 10%
              </template>
            </UFormField>

            <!-- Métodos de pago — when campoMetodos -->
            <UFormField v-if="config.campoMetodos" label="Métodos de pago" required>
              <USelectMenu
                v-model="form.metodoPagoIds"
                :items="metodos"
                label-key="label"
                value-key="value"
                multiple
                placeholder="Selecciona uno o más métodos"
              />
            </UFormField>

            <!-- Días de vencimiento — when campoDias -->
            <UFormField v-if="config.campoDias" :label="config.labelDias ?? 'Días de vencimiento'" required>
              <UInput
                v-model.number="form.diasVencimiento"
                type="number"
                :min="config.diasMin"
                :max="config.diasMax"
                placeholder="30"
              />
            </UFormField>

            <!-- Tramos table — when campoTramos -->
            <div v-if="config.campoTramos" class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Tramos</span>
                <UButton size="xs" icon="i-lucide-plus" variant="ghost" @click="agregarTramo">
                  Agregar tramo
                </UButton>
              </div>
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-muted">
                    <th class="pb-1">{{ config.labelTramos ?? 'Mínimo' }}</th>
                    <th class="pb-1">{{ form.modo === 'porcentaje' ? 'Porcentaje' : 'Monto' }}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(tramo, i) in form.tramos" :key="i" class="border-t border-default">
                    <td class="py-1 pr-2">
                      <UInput v-model="tramo.minimo" inputmode="decimal" placeholder="0" class="w-full" />
                    </td>
                    <td class="py-1 pr-2">
                      <UInput v-model="tramo.valor" inputmode="decimal" :placeholder="form.modo === 'porcentaje' ? '0.10 (= 10%)' : '0'" class="w-full" />
                    </td>
                    <td class="py-1">
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        @click="eliminarTramo(i)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!form.tramos.length" class="text-xs text-muted">
                Sin tramos. Agrega al menos uno.
              </p>
            </div>

            <!-- Fechas -->
            <div v-if="config.campoFechaInicio || config.campoFechaFin" class="grid grid-cols-2 gap-4">
              <UFormField v-if="config.campoFechaInicio" label="Fecha inicio" :required="config.fechasRequeridas">
                <AppDateInput
                  :model-value="form.fechaInicio"
                  qa="descuento-fecha-inicio"
                  @update:model-value="form.fechaInicio = $event || null"
                />
              </UFormField>
              <UFormField v-if="config.campoFechaFin" label="Fecha fin" :required="config.fechasRequeridas">
                <AppDateInput
                  :model-value="form.fechaFin"
                  qa="descuento-fecha-fin"
                  @update:model-value="form.fechaFin = $event || null"
                />
              </UFormField>
            </div>
          </template>

          <!-- Activo -->
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
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
          form="descuento-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar descuento"
      message="¿Estás seguro de que quieres eliminar este descuento? Esta acción no se puede deshacer."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
