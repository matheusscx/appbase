<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { RECARGO_CONFIG, type TipoConfig } from '~/utils/reglas-form-config'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

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
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const apiUrl = runtimeConfig.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('recargos')

const recargos = ref<Regla[]>([])
const tipos = ref<{ label: string; value: string; codigo: string; descripcion: string | null }[]>([])
const metodos = ref<{ label: string; value: string }[]>([])
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
// con el que se reintenta.
const colisionModalOpen = ref(false)
const colisionMensaje = ref('')
const nombrePropuesto = ref('')
const nombreError = ref<string | null>(null)

// ── Pausar: confirmación con el alcance ─────────────────────────────────────
const {
  toggling,
  confirmPausarNombre,
  confirmPausarItems,
  confirmPausarModalOpen,
  toggleActivo,
  cerrarPausar,
  confirmarPausar,
} = usePausaRegla('recargos', 'Recargo', recargos)

const modoOptions = [
  { label: 'Porcentaje', value: 'porcentaje' },
  { label: 'Monto fijo', value: 'monto_fijo' },
]

const CONFIG_MAP = RECARGO_CONFIG

const emptyForm = () => ({
  nombre: '',
  tipoReglaId: '',
  modo: 'porcentaje' as string,
  valor: '' as string,
  metodoPagoIds: [] as string[],
  tramos: [] as { minimo: string; valor: string }[],
  diasVencimiento: null as number | null,
  fechaInicio: null as string | null,
  fechaFin: null as string | null,
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar recargo' : 'Nuevo recargo',
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

// Mismo criterio que `onTipoChange`: solo en un cambio REAL del usuario (bindeado al
// evento del radio, no un watch), para no pisar la población programática de
// `abrirEditar`.
//
// `valor` es un campo compartido por las dos ramas del `v-if` de abajo —monto fijo
// (MoneyInput, plata) y porcentaje (UInput, decimal 0.10 = 10%)— y los dos modos NO
// comparten escala ni significado. Sin este reset, escribir `0.10` como porcentaje y
// pasar a monto fijo dejaba el input mostrando `0` (MoneyInput trunca a los decimales
// de la moneda para MOSTRAR) mientras `form.valor` seguía valiendo `0.10`: el usuario
// veía un número y guardaba otro. Vaciar es la salida honesta — no hay conversión
// sensata de "10%" a un monto.
function onModoChange(value: string) {
  if (value === form.value.modo) return
  form.value.modo = value
  form.value.valor = ''
  for (const tramo of form.value.tramos) tramo.valor = ''
}

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `recargos.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del
// switch. Esta pantalla NO usa `usePaginatedList`, así que no hereda la cola
// que vive ahí: va local.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      recargos.value = await useApiFetch<Regla[]>(`${apiUrl}/recargos${query}`)
    }
    catch (e: unknown) {
      const msg = apiErrorMsg(e, 'Error al cargar recargos')
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

function upsertLocal(saved: Regla) {
  const idx = recargos.value.findIndex(r => r.id === saved.id)
  const prev = idx >= 0 ? recargos.value[idx] : null
  const merged: Regla = {
    ...(prev ?? { tramos: [], metodoPagoIds: [] }),
    ...saved,
    tramos: saved.tramos ?? prev?.tramos ?? [],
    metodoPagoIds: saved.metodoPagoIds ?? prev?.metodoPagoIds ?? [],
    tipoRegla: saved.tipoRegla ?? prev?.tipoRegla,
  }
  if (idx >= 0) {
    recargos.value[idx] = merged
  }
  else {
    recargos.value.push(merged)
  }
  recargos.value = [...recargos.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  recargos.value = recargos.value.filter(r => r.id !== id)
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
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(r: Regla) {
  if (r.eliminadoEl) return
  resetDrawer()
  editingId.value = r.id
  form.value = {
    nombre: r.nombre,
    tipoReglaId: r.tipoReglaId,
    modo: r.modo ?? '',
    valor: r.valor ?? '',
    metodoPagoIds: r.metodoPagoIds ?? [],
    tramos: r.tramos?.map(t => ({ minimo: t.minimo ?? '', valor: t.valor ?? '' })) ?? [],
    diasVencimiento: r.diasVencimiento ?? null,
    fechaInicio: r.fechaInicio ?? null,
    fechaFin: r.fechaFin ?? null,
    activo: r.activo,
  }
  drawerOpen.value = true
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

    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Regla>(`${apiUrl}/recargos`, { method: 'POST', body })
      : await useApiFetch<Regla>(`${apiUrl}/recargos/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Recargo creado' : 'Recargo actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

function pedirEliminar(r: Regla) {
  if (r.eliminadoEl) return
  confirmDeleteId.value = r.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/recargos/${id}`, {
      method: 'DELETE',
    })
    // Con la papelera abierta la fila no desaparece: pasa a "eliminada" con su
    // autor y fecha. El DELETE no devuelve esos datos —solo llegan en el
    // próximo GET con el flag—, así que acá hace falta recargar en vez del
    // patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      removeLocal(id)
    }
    toast.add({ title: 'Recargo eliminado', color: 'success' })
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

function cerrarRestaurar() {
  confirmRestaurarId.value = null
  confirmRestaurarModalOpen.value = false
  colisionModalOpen.value = false
  colisionMensaje.value = ''
  nombrePropuesto.value = ''
}

/**
 * Restaura una fila de la papelera. `nombreNuevo` solo llega en el reintento
 * desde el modal de colisión.
 *
 * El catch NO cierra todo y tira un toast rojo: un 400 de colisión no es un
 * error terminal sino una pregunta —qué nombre querés usar—, así que abre el
 * segundo modal con la sugerencia del backend. Solo los errores de verdad
 * (404 "no está en la papelera", red) terminan en toast.
 * Molde: `configuracion/descuentos.vue`.
 */
async function restaurarRecargo(id: string, nombreNuevo?: string) {
  // El modal no se cierra solo al confirmar (lo cierran las funciones de acá),
  // así que mientras el POST viaja el segundo click manda un segundo
  // `POST .../restaurar` sobre una fila que el primero ya revivió: el backend
  // contesta 404 "no está en la papelera" y el usuario ve un toast de ERROR
  // inmediatamente después de un restore exitoso. Este guard y el
  // `:loading="restaurando"` de los modales se tapan mutuamente (medido con
  // mutantes en `descuentos`): el test fija la conducta —un solo POST—, no
  // cuál de las dos capas la sostiene.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const r = recargos.value.find(x => x.id === id)
    if (r) {
      r.eliminadoEl = null
      r.eliminadoPorNombre = null
      if (nombreNuevo) {
        // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
        // local no adivina. Reordenar hace falta porque el listado viene
        // ordenado por nombre y el renombre lo puede mover de lugar.
        r.nombre = nombreNuevo
        recargos.value = [...recargos.value].sort((a, b) =>
          a.nombre.localeCompare(b.nombre, 'es'),
        )
      }
    }
    toast.add({ title: 'Recargo restaurado', color: 'success' })
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
  restaurarRecargo(id, nombre)
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
      title="Recargos"
      description="Reglas de recargo aplicables en el cálculo de precios."
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
            Nuevo recargo
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="recargos" :columns="columns" :loading="loading">
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
              @click="pedirEliminar(row.original)"
            />
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay recargos registrados.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="recargo-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <!-- Nombre (always visible) -->
          <UFormField label="Nombre" required :error="nombreError ?? undefined">
            <UInput
              v-model="form.nombre"
              placeholder="Mi recargo"
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
              <URadioGroup
                :model-value="form.modo"
                :items="modoOptions"
                orientation="horizontal"
                @update:model-value="onModoChange"
              />
            </UFormField>

            <!-- Valor — when campoValor. El campo es monto fijo O porcentaje según
                 `form.modo`: el backend no puede validar la escala (decorador/pipe no
                 leen el campo hermano `modo`), así que acá es la única capa que puede
                 distinguirlos. Porcentaje sigue sin máscara de moneda: no es plata. -->
            <UFormField v-if="config.campoValor" :label="config.labelValor ?? 'Valor'" required>
              <MoneyInput
                v-if="form.modo === 'monto_fijo'"
                v-model="form.valor"
                oficial
              />
              <UInput
                v-else
                v-model="form.valor"
                inputmode="decimal"
                placeholder="0.10 (= 10%)"
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
                      <!-- Gemelo de descuentos.vue: "Mínimo" es plata solo cuando el
                           tipo es `por_monto_venta` (hoy ningún recargo seedeado usa
                           `campoTramos`, pero el criterio queda igual por si se agrega
                           uno). -->
                      <MoneyInput v-if="tipoSeleccionado?.codigo === 'por_monto_venta'" v-model="tramo.minimo" oficial class="w-full" />
                      <UInput v-else v-model="tramo.minimo" inputmode="decimal" placeholder="0" class="w-full" />
                    </td>
                    <td class="py-1 pr-2">
                      <MoneyInput v-if="form.modo === 'monto_fijo'" v-model="tramo.valor" oficial class="w-full" />
                      <UInput v-else v-model="tramo.valor" inputmode="decimal" placeholder="0.10 (= 10%)" class="w-full" />
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
                  @update:model-value="form.fechaInicio = $event || null"
                />
              </UFormField>
              <UFormField v-if="config.campoFechaFin" label="Fecha fin" :required="config.fechasRequeridas">
                <AppDateInput
                  :model-value="form.fechaFin"
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
          @click="() => { drawerOpen = false }"
        >
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="recargo-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudPausarModal
      v-model:open="confirmPausarModalOpen"
      :nombre="confirmPausarNombre"
      :items="confirmPausarItems"
      @cancel="cerrarPausar"
      @confirm="confirmarPausar"
    />

    <!-- Modal confirmación eliminar -->
    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar recargo"
      message="¿Eliminar este recargo? Podés recuperarlo desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar recargo"
      message="¿Restaurar este recargo? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarRecargo(confirmRestaurarId)"
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
