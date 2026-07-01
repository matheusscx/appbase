<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { RECARGO_CONFIG, type TipoConfig } from '~/utils/reglas-form-config'

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

const recargos = ref<Regla[]>([])
const tipos = ref<{ label: string; value: string; codigo: string; descripcion: string | null }[]>([])
const metodos = ref<{ label: string; value: string }[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())
const nombreError = ref<string | null>(null)

const modoOptions = [
  { label: 'Porcentaje', value: 'porcentaje' },
  { label: 'Monto fijo', value: 'monto_fijo' },
]

const CONFIG_MAP = RECARGO_CONFIG

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
    recargos.value = await useApiFetch<Regla[]>(`${apiUrl}/recargos`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar recargos')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function cargarTipos() {
  try {
    const data = await useApiFetch<TipoRegla[]>(`${apiUrl}/tipos-regla?clase=recargo`)
    tipos.value = data.map(t => ({ label: t.nombre, value: t.id, codigo: t.codigo, descripcion: t.descripcion ?? null }))
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar tipos de recargo')
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
  editingId.value = null
  form.value = emptyForm()
  nombreError.value = null
  modalOpen.value = true
}

function abrirEditar(r: Regla) {
  editingId.value = r.id
  form.value = {
    nombre: r.nombre,
    tipoReglaId: r.tipoReglaId,
    modo: r.modo,
    valor: r.valor,
    metodoPagoIds: r.metodoPagoIds ?? [],
    tramos: r.tramos?.map(t => ({ minimo: t.minimo ?? '', valor: t.valor ?? '' })) ?? [],
    diasVencimiento: r.diasVencimiento ?? null,
    fechaInicio: r.fechaInicio ?? null,
    fechaFin: r.fechaFin ?? null,
    activo: r.activo,
  }
  nombreError.value = null
  modalOpen.value = true
}

async function checkNombre() {
  if (!form.value.nombre) { nombreError.value = null; return }
  try {
    const params = new URLSearchParams({ nombre: form.value.nombre })
    if (editingId.value) params.append('excludeId', editingId.value)
    const res = await useApiFetch<{ disponible: boolean }>(
      `${apiUrl}/recargos/nombre-disponible?${params}`,
    )
    nombreError.value = res.disponible ? null : 'Ya existe un recargo con este nombre'
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

    if (editingId.value) {
      await useApiFetch(`${apiUrl}/recargos/${editingId.value}`, { method: 'PATCH', body })
      toast.add({ title: 'Recargo actualizado', color: 'success' })
    }
    else {
      await useApiFetch(`${apiUrl}/recargos`, { method: 'POST', body })
      toast.add({ title: 'Recargo creado', color: 'success' })
    }
    modalOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(r: Regla) {
  if (toggling.has(r.id)) return
  toggling.add(r.id)
  const prev = r.activo
  r.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/recargos/${r.id}`, {
      method: 'PATCH',
      body: { activo: r.activo },
    })
    toast.add({ title: r.activo ? 'Recargo activado' : 'Recargo desactivado', color: 'success' })
  }
  catch (e: unknown) {
    r.activo = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(r.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/recargos/${id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Recargo eliminado', color: 'success' })
    await cargar()
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
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Recargos
        </h2>
        <p class="text-sm text-muted">
          Reglas de recargo aplicables en el cálculo de precios.
        </p>
      </div>
      <UButton
        icon="i-heroicons-plus"
        @click="abrirCrear"
      >
        Nuevo recargo
      </UButton>
    </div>

    <UCard>
      <UTable :data="recargos" :columns="columns" :loading="loading">
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
              icon="i-heroicons-pencil-square"
              color="neutral"
              variant="ghost"
              @click="abrirEditar(row.original)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="error"
              variant="ghost"
              @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
            />
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            No hay recargos registrados.
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Modal crear/editar -->
    <UModal
      v-model:open="modalOpen"
      :title="editingId ? 'Editar recargo' : 'Nuevo recargo'"
    >
      <template #body>
        <div class="space-y-4">
          <!-- Nombre (always visible) -->
          <UFormField label="Nombre" required :error="nombreError">
            <UInput v-model="form.nombre" placeholder="Mi recargo" @blur="checkNombre" />
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
                <UButton size="xs" icon="i-heroicons-plus" variant="ghost" @click="agregarTramo">
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
                  <tr v-for="(tramo, i) in form.tramos" :key="i" class="border-t border-border-default">
                    <td class="py-1 pr-2">
                      <UInput v-model="tramo.minimo" inputmode="decimal" placeholder="0" class="w-full" />
                    </td>
                    <td class="py-1 pr-2">
                      <UInput v-model="tramo.valor" inputmode="decimal" :placeholder="form.modo === 'porcentaje' ? '0.10 (= 10%)' : '0'" class="w-full" />
                    </td>
                    <td class="py-1">
                      <UButton
                        icon="i-heroicons-trash"
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
                <UInput :model-value="form.fechaInicio ?? undefined" type="date" class="w-full" @update:model-value="form.fechaInicio = $event || null" />
              </UFormField>
              <UFormField v-if="config.campoFechaFin" label="Fecha fin" :required="config.fechasRequeridas">
                <UInput :model-value="form.fechaFin ?? undefined" type="date" class="w-full" @update:model-value="form.fechaFin = $event || null" />
              </UFormField>
            </div>
          </template>

          <!-- Activo -->
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="modalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="saving" @click="guardar">
            Guardar
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal confirmación eliminar -->
    <UModal
      v-model:open="confirmModalOpen"
      title="Eliminar recargo"
    >
      <template #body>
        <p class="text-sm">
          ¿Estás seguro de que quieres eliminar este recargo? Esta acción no se puede deshacer.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="confirmModalOpen = false; confirmDeleteId = null">
            Cancelar
          </UButton>
          <UButton
            color="error"
            @click="confirmDeleteId && eliminar(confirmDeleteId)"
          >
            Eliminar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
