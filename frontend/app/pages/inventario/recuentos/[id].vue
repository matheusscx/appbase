<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface MotivoOpt {
  id: string
  nombre: string
  activo: boolean
  esFijo: boolean
}

interface RecuentoLineaApi {
  lineaId: string
  itemId: string
  itemNombre: string
  unidadMedida: string | null
  stockSistema: string
  cantidadContada: string | null
  diferencia: string | null
  motivoDiferenciaId: string | null
}

interface RecuentoDetalleApi {
  id: string
  estado: string
  motivoDiferenciaDefaultId: string | null
  comentario: string | null
  creadoEl: string
  aplicadoEl: string | null
  lineas: RecuentoLineaApi[]
}

interface LineaRow extends RecuentoLineaApi {
  /** Input local del conteo; '' representa "sin contar". Se persiste al blur. */
  cantidadInput: string
  /** Sentinel SIN_CAUSA = "usar la causa por defecto de la sesión". */
  motivoInput: string
  guardando: boolean
}

interface Opt { label: string; value: string }

const route = useRoute()
const recuentoId = computed(() => route.params.id as string)

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatFecha, formatStock } = useFormatters()
const permissionsStore = usePermissionsStore()

const loading = ref(true)
const notFound = ref(false)
const detalle = ref<RecuentoDetalleApi | null>(null)
const lineas = ref<LineaRow[]>([])
const motivos = ref<MotivoOpt[]>([])

const readOnly = computed(() => detalle.value?.estado !== 'borrador')

const puedeAplicar = computed(() =>
  permissionsStore.esAdmin || permissionsStore.can('Inventario', 'Actualizar'),
)

// Sentinel no-vacío: un value:'' en los items de USelectMenu choca con cómo
// Reka UI trata la cadena vacía como "sin selección" y rompe el Combobox al
// abrirlo (bug reproducido en smoke test — ver informe de la tarea).
const SIN_CAUSA = '__sin_causa__'

const motivoOpts = computed<Opt[]>(() =>
  motivos.value.filter(m => m.activo).map(m => ({ label: m.nombre, value: m.id })),
)

// Si una causa ya asignada (default de la sesión u override de línea) se
// desactiva después, sigue sin estar en motivoOpts (solo activas) — sin esto
// el USelectMenu no tendría su label y mostraría el select vacío aunque el
// dato siga persistido. Se agrega marcada como inactiva, sin duplicar si ya
// está entre las activas.
function opcionCausaAsignada(id: string | null): Opt[] {
  if (!id) return []
  const m = motivos.value.find(m => m.id === id)
  if (!m || m.activo) return []
  return [{ label: `${m.nombre} (inactiva)`, value: m.id }]
}

const motivoDefaultOpts = computed<Opt[]>(() => [
  { label: 'Sin causa por defecto', value: SIN_CAUSA },
  ...motivoOpts.value,
  ...opcionCausaAsignada(detalle.value?.motivoDiferenciaDefaultId ?? null),
])
function motivoOverrideOpts(lineaMotivoId: string | null): Opt[] {
  return [
    { label: 'Usar la causa por defecto', value: SIN_CAUSA },
    ...motivoOpts.value,
    ...opcionCausaAsignada(lineaMotivoId),
  ]
}

const sesionForm = ref({ motivoDiferenciaDefaultId: SIN_CAUSA, comentario: '' })
let comentarioOriginal = ''

function lineaAFila(l: RecuentoLineaApi): LineaRow {
  return {
    ...l,
    cantidadInput: l.cantidadContada ?? '',
    motivoInput: l.motivoDiferenciaId ?? SIN_CAUSA,
    guardando: false,
  }
}

function aplicarDetalle(d: RecuentoDetalleApi) {
  detalle.value = d
  lineas.value = d.lineas.map(lineaAFila)
  sesionForm.value = {
    motivoDiferenciaDefaultId: d.motivoDiferenciaDefaultId ?? SIN_CAUSA,
    comentario: d.comentario ?? '',
  }
  comentarioOriginal = sesionForm.value.comentario
}

async function cargarDetalle() {
  try {
    const d = await useApiFetch<RecuentoDetalleApi>(`${apiUrl}/recuentos/${recuentoId.value}`)
    aplicarDetalle(d)
  }
  catch (e: unknown) {
    notFound.value = true
    toast.add({ title: apiErrorMsg(e, 'No se pudo cargar el recuento'), color: 'error' })
  }
}

async function cargarMotivos() {
  try {
    motivos.value = await useApiFetch<MotivoOpt[]>(`${apiUrl}/motivos-diferencia-inventario`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar causas'), color: 'error' })
  }
}

onMounted(async () => {
  loading.value = true
  await Promise.all([cargarDetalle(), cargarMotivos()])
  loading.value = false
})

// ── Diferencia en vivo por línea (Decimal.js, igual que el backend) ─────────

function diferenciaLinea(row: LineaRow): string | null {
  return calcularDiferenciaRecuento(row.cantidadInput, row.stockSistema)
}

// ── Editar líneas: contado y causa override (blur-commit, con revert) ──────

async function guardarCantidad(row: LineaRow) {
  if (readOnly.value) return
  const nuevo = row.cantidadInput.trim()
  const actual = row.cantidadContada ?? ''
  if (nuevo === actual) return
  row.guardando = true
  try {
    const res = await useApiFetch<RecuentoLineaApi>(
      `${apiUrl}/recuentos/${recuentoId.value}/lineas/${row.lineaId}`,
      { method: 'PATCH', body: { cantidadContada: nuevo === '' ? null : nuevo } },
    )
    row.cantidadContada = res.cantidadContada
    row.diferencia = res.diferencia
    row.cantidadInput = res.cantidadContada ?? ''
  }
  catch (e: unknown) {
    row.cantidadInput = row.cantidadContada ?? ''
    toast.add({ title: apiErrorMsg(e, 'Error al guardar el conteo'), color: 'error' })
  }
  finally {
    row.guardando = false
  }
}

async function guardarMotivoLinea(row: LineaRow, valor: string) {
  if (readOnly.value) return
  const prev = row.motivoInput
  row.motivoInput = valor
  row.guardando = true
  try {
    const res = await useApiFetch<RecuentoLineaApi>(
      `${apiUrl}/recuentos/${recuentoId.value}/lineas/${row.lineaId}`,
      { method: 'PATCH', body: { motivoDiferenciaId: valor === SIN_CAUSA ? null : valor } },
    )
    row.motivoDiferenciaId = res.motivoDiferenciaId
  }
  catch (e: unknown) {
    row.motivoInput = prev
    toast.add({ title: apiErrorMsg(e, 'Error al asignar la causa'), color: 'error' })
  }
  finally {
    row.guardando = false
  }
}

// ── Editar la sesión: causa por defecto y comentario ────────────────────────

const guardandoDefault = ref(false)

async function guardarMotivoDefault(valor: string) {
  if (readOnly.value || !detalle.value) return
  const prev = sesionForm.value.motivoDiferenciaDefaultId
  sesionForm.value.motivoDiferenciaDefaultId = valor
  guardandoDefault.value = true
  try {
    await useApiFetch(`${apiUrl}/recuentos/${recuentoId.value}`, {
      method: 'PATCH',
      body: { motivoDiferenciaDefaultId: valor === SIN_CAUSA ? null : valor },
    })
    detalle.value.motivoDiferenciaDefaultId = valor === SIN_CAUSA ? null : valor
  }
  catch (e: unknown) {
    sesionForm.value.motivoDiferenciaDefaultId = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar la causa por defecto'), color: 'error' })
  }
  finally {
    guardandoDefault.value = false
  }
}

async function guardarComentario() {
  if (readOnly.value || !detalle.value) return
  const nuevo = sesionForm.value.comentario.trim()
  if (nuevo === comentarioOriginal) return
  try {
    await useApiFetch(`${apiUrl}/recuentos/${recuentoId.value}`, {
      method: 'PATCH',
      body: { comentario: nuevo || null },
    })
    detalle.value.comentario = nuevo || null
    comentarioOriginal = nuevo
  }
  catch (e: unknown) {
    sesionForm.value.comentario = comentarioOriginal
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar el comentario'), color: 'error' })
  }
}

// ── Aplicar / cancelar ───────────────────────────────────────────────────────

const lineasAMoverCount = computed(() => contarLineasAMover(lineas.value))
const lineasSinCausaCount = computed(() =>
  contarLineasSinCausa(lineas.value, detalle.value?.motivoDiferenciaDefaultId ?? null),
)

const aplicarModalOpen = ref(false)
const aplicando = ref(false)
const cancelarModalOpen = ref(false)
const cancelando = ref(false)

async function aplicar() {
  aplicando.value = true
  try {
    const res = await useApiFetch<{
      recuentoId: string
      lineasAplicadas: number
      lineasDescartadas: { itemId: string; itemNombre: string; razon: string }[]
    }>(`${apiUrl}/recuentos/${recuentoId.value}/aplicar`, { method: 'POST' })

    aplicarModalOpen.value = false
    toast.add({
      title: res.lineasAplicadas > 0
        ? `Recuento aplicado — ${res.lineasAplicadas} línea(s) movida(s)`
        : 'Recuento aplicado — ninguna línea tenía diferencia',
      color: 'success',
    })
    if (res.lineasDescartadas.length) {
      toast.add({
        title: `${res.lineasDescartadas.length} producto(s) descartado(s) del recuento`,
        description: res.lineasDescartadas
          .map(d => `${d.itemNombre}: ${d.razon}`)
          .join(' · '),
        color: 'warning',
        duration: 10000,
      })
    }
    await cargarDetalle()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al aplicar el recuento'), color: 'error' })
  }
  finally {
    aplicando.value = false
  }
}

async function cancelar() {
  cancelando.value = true
  try {
    await useApiFetch(`${apiUrl}/recuentos/${recuentoId.value}/cancelar`, { method: 'POST' })
    cancelarModalOpen.value = false
    toast.add({ title: 'Recuento cancelado', color: 'success' })
    await cargarDetalle()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cancelar el recuento'), color: 'error' })
  }
  finally {
    cancelando.value = false
  }
}

const columns: TableColumn<LineaRow>[] = [
  { accessorKey: 'itemNombre', header: 'Producto' },
  { id: 'stockSistema', header: 'Stock sistema', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'cantidadContada', header: 'Contado', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'diferencia', header: 'Diferencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'motivo', header: 'Causa' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Detalle de recuento" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <ULink
          to="/inventario/recuentos"
          class="text-sm text-highlighted inline-flex items-center gap-1"
        >
          <UIcon name="i-lucide-arrow-left" class="w-4 h-4" />
          Volver a recuentos
        </ULink>

        <div
          v-if="loading"
          class="py-8 text-center text-sm text-muted"
        >
          Cargando…
        </div>

        <div
          v-else-if="notFound || !detalle"
          class="py-8 text-center text-sm text-muted"
        >
          No se encontró el recuento.
        </div>

        <div
          v-else
          class="space-y-6"
        >
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <h1 class="text-2xl font-semibold text-default">
                Recuento del {{ formatFecha(detalle.creadoEl) }}
              </h1>
              <UBadge
                :label="estadoRecuentoLabel(detalle.estado)"
                :color="estadoRecuentoColor(detalle.estado)"
                variant="subtle"
              />
            </div>

            <div
              v-if="!readOnly"
              class="flex gap-2"
            >
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-x"
                @click="() => { cancelarModalOpen = true }"
              >
                Cancelar recuento
              </UButton>
              <UButton
                v-if="puedeAplicar"
                icon="i-lucide-check"
                @click="() => { aplicarModalOpen = true }"
              >
                Aplicar
              </UButton>
            </div>
          </div>

          <UCard>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Causa por defecto"
                help="Se usa en las líneas con diferencia que no tengan una causa propia."
              >
                <USelectMenu
                  :model-value="sesionForm.motivoDiferenciaDefaultId"
                  :items="motivoDefaultOpts"
                  value-key="value"
                  :disabled="readOnly || guardandoDefault"
                  class="w-full"
                  @update:model-value="(v: string) => guardarMotivoDefault(v)"
                />
              </UFormField>

              <UFormField label="Comentario">
                <UTextarea
                  v-model="sesionForm.comentario"
                  :rows="1"
                  :disabled="readOnly"
                  placeholder="Opcional"
                  class="w-full"
                  @blur="guardarComentario"
                />
              </UFormField>
            </div>
          </UCard>

          <CrudTable
            :data="lineas"
            :columns="columns"
          >
            <template #itemNombre-cell="{ row }">
              <span class="font-medium text-default">{{ row.original.itemNombre }}</span>
            </template>

            <template #stockSistema-cell="{ row }">
              {{ formatStock(row.original.stockSistema, row.original.unidadMedida) }}
            </template>

            <template #cantidadContada-cell="{ row }">
              <UInput
                v-model="row.original.cantidadInput"
                inputmode="decimal"
                placeholder="Sin contar"
                :disabled="readOnly || row.original.guardando"
                class="w-32"
                @blur="guardarCantidad(row.original)"
              />
            </template>

            <template #diferencia-cell="{ row }">
              <span
                class="font-medium"
                :class="claseDiferenciaRecuento(diferenciaLinea(row.original))"
              >
                {{ diferenciaLinea(row.original) ?? '—' }}
              </span>
            </template>

            <template #motivo-cell="{ row }">
              <USelectMenu
                :model-value="row.original.motivoInput"
                :items="motivoOverrideOpts(row.original.motivoDiferenciaId)"
                value-key="value"
                :disabled="readOnly || row.original.guardando"
                class="w-56"
                @update:model-value="(v: string) => guardarMotivoLinea(row.original, v)"
              />
            </template>

            <template #empty>
              <div class="py-8 text-center text-sm text-muted">
                No hay productos en este recuento.
              </div>
            </template>
          </CrudTable>
        </div>

        <UModal
          v-model:open="aplicarModalOpen"
          title="Aplicar recuento"
        >
          <template #body>
            <div class="space-y-2 text-sm text-default">
              <p>
                Se van a mover <strong>{{ lineasAMoverCount }}</strong> línea(s) al kardex.
                Las líneas sin contar o con diferencia cero no generan movimiento.
              </p>
              <p v-if="lineasSinCausaCount > 0" class="text-warning">
                {{ lineasSinCausaCount }} línea(s) con diferencia no tienen causa asignada
                ni causa por defecto — la aplicación se rechazará hasta indicarla.
              </p>
            </div>
          </template>
          <template #footer>
            <AppModalFooter>
              <UButton
                color="neutral"
                variant="ghost"
                @click="() => { aplicarModalOpen = false }"
              >
                Cancelar
              </UButton>
              <UButton
                :loading="aplicando"
                @click="aplicar"
              >
                Aplicar
              </UButton>
            </AppModalFooter>
          </template>
        </UModal>

        <CrudModal
          v-model:open="cancelarModalOpen"
          title="Cancelar recuento"
          message="¿Cancelar esta sesión de recuento? No se moverá stock y quedará como solo lectura."
          confirm-label="Cancelar recuento"
          confirm-color="error"
          :loading="cancelando"
          @confirm="cancelar"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
