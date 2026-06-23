<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()

// ── Interfaces ─────────────────────────────────────────────────────────────

interface Item {
  id: string
  nombre: string
  descripcion: string | null
  tipo: string
  activo: boolean
  precioBase: string
  precioIncluyeImpuesto: boolean
  monedaId: string
  monedaCodigo: string
  monedaSimbolo: string | null
  categoriaId: string | null
  categoriaNombre: string | null
  creadoEl: string
  stock: string | null
  unidadMedida: string | null
  fechaElaboracion: string | null
  fechaVencimiento: string | null
  duracionEstimada: number | null
  requiereCita: boolean | null
  impuestosIds?: string[]
  recargosIds?: string[]
  descuentosIds?: string[]
}

interface Opt { label: string; value: string }

interface Movimiento {
  id: string
  itemNombre: string
  tipo: string
  motivo: string
  cantidad: string
  stockAnterior: string
  stockResultante: string
  usuarioNombre: string | null
  comentario: string | null
  creadoEl: string
}

// ── Estado ─────────────────────────────────────────────────────────────────

const items = ref<Item[]>([])
const loading = ref(false)
const saving = ref(false)
const ajustando = ref(false)
const modalOpen = ref(false)
const confirmModalOpen = ref(false)
const stockModalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const stockItemId = ref<string | null>(null)
const toggling = reactive(new Set<string>())
const filtroTipo = ref('')

// Catálogos
const monedasOpts = ref<Opt[]>([])
const categoriasOpts = ref<Opt[]>([])
const impuestosOpts = ref<Opt[]>([])
const descuentosOpts = ref<Opt[]>([])
const recargosOpts = ref<Opt[]>([])

const tiposOpts: Opt[] = [
  { label: 'Producto', value: 'producto' },
  { label: 'Servicio', value: 'servicio' },
]

const unidadesMedidaOpts: Opt[] = [
  { label: 'Unidad', value: 'unidad' },
  { label: 'Kilogramo (kg)', value: 'kg' },
  { label: 'Litro (l)', value: 'l' },
  { label: 'Metro (m)', value: 'm' },
]

const filtrosTipoOpts = [
  { label: 'Todos', value: '' },
  { label: 'Productos', value: 'producto' },
  { label: 'Servicios', value: 'servicio' },
]

// ── Formulario ─────────────────────────────────────────────────────────────

function emptyForm() {
  return {
    nombre: '',
    descripcion: '',
    precioBase: '',
    monedaId: '',
    categoriaId: '',
    tipo: 'producto',
    precioIncluyeImpuesto: false,
    activo: true,
    // producto
    stock: '0',
    unidadMedida: 'unidad',
    fechaElaboracion: '',
    fechaVencimiento: '',
    // servicio
    duracionEstimada: 0,
    requiereCita: false,
    // reglas
    impuestosIds: [] as string[],
    recargosIds: [] as string[],
    descuentosIds: [] as string[],
  }
}

const form = ref(emptyForm())

function emptyAjusteForm() {
  return { cantidad: '', tipo: 'entrada', motivo: 'ajuste_manual', comentario: '' }
}
const ajusteForm = ref(emptyAjusteForm())

const ajusteTipoOpts = [
  { label: 'Entrada (sumar)', value: 'entrada' },
  { label: 'Salida (restar)', value: 'salida' },
]

const motivoOpts = [
  { label: 'Compra', value: 'compra' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
]

// Historial (kardex)
const historialOpen = ref(false)
const historialLoading = ref(false)
const movimientos = ref<Movimiento[]>([])
const historialItemNombre = ref('')

async function abrirHistorial(item: Item) {
  historialItemNombre.value = item.nombre
  historialOpen.value = true
  historialLoading.value = true
  movimientos.value = []
  try {
    movimientos.value = await useApiFetch<Movimiento[]>(
      `${apiUrl}/inventario/movimientos?itemId=${item.id}`,
    )
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cargar historial'
    toast.add({ title: msg, color: 'error' })
  } finally {
    historialLoading.value = false
  }
}

// ── Lista filtrada ──────────────────────────────────────────────────────────

const itemsFiltrados = computed(() => {
  if (!filtroTipo.value) return items.value
  return items.value.filter((i) => i.tipo === filtroTipo.value)
})

// ── Carga inicial ──────────────────────────────────────────────────────────

async function cargar() {
  loading.value = true
  try {
    items.value = await useApiFetch<Item[]>(`${apiUrl}/items`)
  } catch {
    toast.add({ title: 'Error al cargar items', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function cargarCatalogos() {
  try {
    const [monedas, categorias, impuestos, descuentos, recargos] =
      await Promise.all([
        useApiFetch<any[]>(`${apiUrl}/monedas`),
        useApiFetch<any[]>(`${apiUrl}/categorias`),
        useApiFetch<any[]>(`${apiUrl}/impuestos`),
        useApiFetch<any[]>(`${apiUrl}/descuentos`),
        useApiFetch<any[]>(`${apiUrl}/recargos`),
      ])

    monedasOpts.value = monedas
      .filter((m) => m.habilitada)
      .map((m) => ({ label: `${m.nombre} (${m.codigoIso})`, value: m.monedaId }))

    const defaultMoneda = monedas.find((m) => m.esDefault || m.esOficial)
    if (defaultMoneda && !form.value.monedaId) {
      form.value.monedaId = defaultMoneda.monedaId
    }

    categoriasOpts.value = categorias
      .filter((c) => c.activo)
      .map((c) => ({ label: c.nombre, value: c.id }))

    impuestosOpts.value = impuestos
      .filter((i) => i.activo)
      .map((i) => ({ label: i.nombre, value: i.id }))

    descuentosOpts.value = descuentos
      .filter((d) => d.activo)
      .map((d) => ({ label: d.nombre, value: d.id }))

    recargosOpts.value = recargos
      .filter((r) => r.activo)
      .map((r) => ({ label: r.nombre, value: r.id }))
  } catch {
    toast.add({ title: 'Error al cargar catálogos', color: 'error' })
  }
}

onMounted(async () => {
  await Promise.all([cargar(), cargarCatalogos()])
})

// ── CRUD modal ─────────────────────────────────────────────────────────────

function abrirCrear() {
  editingId.value = null
  form.value = emptyForm()
  const defaultMoneda = monedasOpts.value[0]?.value ?? ''
  form.value.monedaId = defaultMoneda
  modalOpen.value = true
}

async function abrirEditar(item: Item) {
  editingId.value = item.id
  try {
    const detalle = await useApiFetch<Item>(`${apiUrl}/items/${item.id}`)
    form.value = {
      nombre: detalle.nombre,
      descripcion: detalle.descripcion ?? '',
      precioBase: detalle.precioBase,
      monedaId: detalle.monedaId,
      categoriaId: detalle.categoriaId ?? '',
      tipo: detalle.tipo,
      precioIncluyeImpuesto: detalle.precioIncluyeImpuesto,
      activo: detalle.activo,
      stock: detalle.stock ?? '0',
      unidadMedida: detalle.unidadMedida ?? 'unidad',
      fechaElaboracion: detalle.fechaElaboracion
        ? detalle.fechaElaboracion.slice(0, 10)
        : '',
      fechaVencimiento: detalle.fechaVencimiento
        ? detalle.fechaVencimiento.slice(0, 10)
        : '',
      duracionEstimada: detalle.duracionEstimada ?? 0,
      requiereCita: detalle.requiereCita ?? false,
      impuestosIds: detalle.impuestosIds ?? [],
      recargosIds: detalle.recargosIds ?? [],
      descuentosIds: detalle.descuentosIds ?? [],
    }
    modalOpen.value = true
  } catch {
    toast.add({ title: 'Error al cargar detalle del item', color: 'error' })
  }
}

async function guardar() {
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      nombre: form.value.nombre,
      descripcion: form.value.descripcion || undefined,
      precioBase: form.value.precioBase,
      monedaId: form.value.monedaId,
      categoriaId: form.value.categoriaId || undefined,
      precioIncluyeImpuesto: form.value.precioIncluyeImpuesto,
      activo: form.value.activo,
      impuestosIds: form.value.impuestosIds,
      recargosIds: form.value.recargosIds,
      descuentosIds: form.value.descuentosIds,
    }

    if (!editingId.value) {
      payload.tipo = form.value.tipo
    }

    if (form.value.tipo === 'producto') {
      payload.stock = form.value.stock
      payload.unidadMedida = form.value.unidadMedida
      if (form.value.fechaElaboracion) payload.fechaElaboracion = form.value.fechaElaboracion
      if (form.value.fechaVencimiento) payload.fechaVencimiento = form.value.fechaVencimiento
    } else {
      payload.duracionEstimada = form.value.duracionEstimada || undefined
      payload.requiereCita = form.value.requiereCita
    }

    if (editingId.value) {
      await useApiFetch(`${apiUrl}/items/${editingId.value}`, {
        method: 'PATCH',
        body: payload,
      })
      toast.add({ title: 'Item actualizado', color: 'success' })
    } else {
      await useApiFetch(`${apiUrl}/items`, {
        method: 'POST',
        body: payload,
      })
      toast.add({ title: 'Item creado', color: 'success' })
    }

    modalOpen.value = false
    await cargar()
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al guardar'
    toast.add({ title: msg, color: 'error' })
  } finally {
    saving.value = false
  }
}

function confirmarEliminar(id: string) {
  confirmDeleteId.value = id
  confirmModalOpen.value = true
}

async function eliminar() {
  if (!confirmDeleteId.value) return
  try {
    await useApiFetch(`${apiUrl}/items/${confirmDeleteId.value}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Item eliminado', color: 'success' })
    confirmModalOpen.value = false
    await cargar()
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al eliminar'
    toast.add({ title: msg, color: 'error' })
  }
}

// ── Toggle activo (optimista) ──────────────────────────────────────────────

async function toggleActivo(item: Item) {
  if (toggling.has(item.id)) return
  toggling.add(item.id)
  const prev = item.activo
  item.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/items/${item.id}`, {
      method: 'PATCH',
      body: { activo: item.activo },
    })
  } catch {
    item.activo = prev
    toast.add({ title: 'Error al actualizar estado', color: 'error' })
  } finally {
    toggling.delete(item.id)
  }
}

// ── Ajuste de stock ────────────────────────────────────────────────────────

function abrirAjusteStock(id: string) {
  stockItemId.value = id
  ajusteForm.value = emptyAjusteForm()
  stockModalOpen.value = true
}

async function ejecutarAjusteStock() {
  if (!stockItemId.value) return
  ajustando.value = true
  try {
    const result = await useApiFetch<{ stock: string }>(
      `${apiUrl}/items/${stockItemId.value}/stock`,
      { method: 'PATCH', body: ajusteForm.value },
    )
    const item = items.value.find((i) => i.id === stockItemId.value)
    if (item) item.stock = result.stock
    toast.add({ title: `Stock actualizado: ${result.stock}`, color: 'success' })
    stockModalOpen.value = false
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al ajustar stock'
    toast.add({ title: msg, color: 'error' })
  } finally {
    ajustando.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Cabecera -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Items</h1>
        <p class="text-sm text-muted">Productos y servicios del catálogo</p>
      </div>
      <UButton icon="i-heroicons-plus" @click="abrirCrear">Nuevo item</UButton>
    </div>

    <!-- Filtro por tipo -->
    <div class="flex gap-2">
      <USelectMenu
        v-model="filtroTipo"
        :items="filtrosTipoOpts"
        value-key="value"
        class="w-44"
        placeholder="Filtrar por tipo"
      />
    </div>

    <!-- Lista -->
    <UCard>
      <div v-if="loading" class="py-8 text-center text-muted">Cargando…</div>

      <div v-else-if="!itemsFiltrados.length" class="py-8 text-center text-muted">
        No hay items. Crea el primero con el botón de arriba.
      </div>

      <ul v-else class="divide-y divide-default">
        <li
          v-for="item in itemsFiltrados"
          :key="item.id"
          class="flex items-center justify-between py-3 gap-3"
        >
          <!-- Info -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <UBadge
                :label="item.tipo === 'producto' ? 'Producto' : 'Servicio'"
                :color="item.tipo === 'producto' ? 'primary' : 'secondary'"
                variant="subtle"
                size="sm"
              />
              <span class="font-medium truncate">{{ item.nombre }}</span>
            </div>
            <div class="text-sm text-muted mt-0.5 flex gap-3">
              <span>{{ item.monedaSimbolo ?? item.monedaCodigo }} {{ item.precioBase }}</span>
              <span v-if="item.categoriaNombre">· {{ item.categoriaNombre }}</span>
              <span v-if="item.tipo === 'producto' && item.stock !== null">
                · Stock: {{ item.stock }} {{ item.unidadMedida }}
              </span>
              <span v-if="item.tipo === 'servicio' && item.duracionEstimada">
                · {{ item.duracionEstimada }} min
              </span>
            </div>
          </div>

          <!-- Controles -->
          <div class="shrink-0 flex items-center gap-2">
            <USwitch
              :model-value="item.activo"
              :disabled="toggling.has(item.id)"
              size="sm"
              @update:model-value="toggleActivo(item)"
            />
            <UButton
              v-if="item.tipo === 'producto'"
              icon="i-heroicons-arrows-up-down"
              color="neutral"
              variant="ghost"
              size="sm"
              title="Ajustar stock"
              @click="abrirAjusteStock(item.id)"
            />
            <UButton
              v-if="item.tipo === 'producto'"
              icon="i-heroicons-clipboard-document-list"
              color="neutral"
              variant="ghost"
              size="sm"
              title="Historial de inventario"
              @click="abrirHistorial(item)"
            />
            <UButton
              icon="i-heroicons-pencil-square"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="abrirEditar(item)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="error"
              variant="ghost"
              size="sm"
              @click="confirmarEliminar(item.id)"
            />
          </div>
        </li>
      </ul>
    </UCard>

    <!-- Modal crear/editar -->
    <UModal v-model:open="modalOpen" :title="editingId ? 'Editar item' : 'Nuevo item'" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <!-- Campos base -->
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Nombre" class="col-span-2" required>
              <UInput v-model="form.nombre" placeholder="Nombre del item" class="w-full" />
            </UFormField>

            <UFormField label="Descripción" class="col-span-2">
              <UInput v-model="form.descripcion" placeholder="Descripción opcional" class="w-full" />
            </UFormField>

            <UFormField label="Precio base" required>
              <UInput v-model="form.precioBase" type="number" placeholder="0" class="w-full" />
            </UFormField>

            <UFormField label="Moneda" required>
              <USelectMenu
                v-model="form.monedaId"
                :items="monedasOpts"
                value-key="value"
                placeholder="Selecciona moneda"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Categoría">
              <USelectMenu
                v-model="form.categoriaId"
                :items="categoriasOpts"
                value-key="value"
                placeholder="Sin categoría"
                class="w-full"
              />
            </UFormField>

            <UFormField v-if="!editingId" label="Tipo" required>
              <USelectMenu
                v-model="form.tipo"
                :items="tiposOpts"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Precio incluye impuesto">
              <USwitch v-model="form.precioIncluyeImpuesto" />
            </UFormField>

            <UFormField label="Activo">
              <USwitch v-model="form.activo" />
            </UFormField>
          </div>

          <!-- Extensión producto -->
          <template v-if="form.tipo === 'producto'">
            <div class="border-t pt-4">
              <p class="text-sm font-medium text-muted mb-3">Datos de producto</p>
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Stock inicial">
                  <UInput v-model="form.stock" type="number" placeholder="0" class="w-full" />
                </UFormField>
                <UFormField label="Unidad de medida">
                  <USelectMenu
                    v-model="form.unidadMedida"
                    :items="unidadesMedidaOpts"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Fecha elaboración">
                  <UInput v-model="form.fechaElaboracion" type="date" class="w-full" />
                </UFormField>
                <UFormField label="Fecha vencimiento">
                  <UInput v-model="form.fechaVencimiento" type="date" class="w-full" />
                </UFormField>
              </div>
            </div>
          </template>

          <!-- Extensión servicio -->
          <template v-if="form.tipo === 'servicio'">
            <div class="border-t pt-4">
              <p class="text-sm font-medium text-muted mb-3">Datos de servicio</p>
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="Duración estimada (min)">
                  <UInput v-model="form.duracionEstimada" type="number" placeholder="60" class="w-full" />
                </UFormField>
                <UFormField label="Requiere cita">
                  <USwitch v-model="form.requiereCita" />
                </UFormField>
              </div>
            </div>
          </template>

          <!-- Reglas asociadas -->
          <div class="border-t pt-4 space-y-3">
            <p class="text-sm font-medium text-muted">Reglas asociadas</p>

            <UFormField label="Impuestos">
              <USelectMenu
                v-model="form.impuestosIds"
                :items="impuestosOpts"
                value-key="value"
                multiple
                placeholder="Sin impuestos"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Descuentos">
              <USelectMenu
                v-model="form.descuentosIds"
                :items="descuentosOpts"
                value-key="value"
                multiple
                placeholder="Sin descuentos"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Recargos">
              <USelectMenu
                v-model="form.recargosIds"
                :items="recargosOpts"
                value-key="value"
                multiple
                placeholder="Sin recargos"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="modalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="saving" @click="guardar">
            {{ editingId ? 'Guardar cambios' : 'Crear item' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal confirmar eliminar -->
    <UModal v-model:open="confirmModalOpen" title="Eliminar item">
      <template #body>
        <p>¿Estás seguro de que deseas eliminar este item? Esta acción no se puede deshacer.</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="confirmModalOpen = false">
            Cancelar
          </UButton>
          <UButton color="error" @click="eliminar">Eliminar</UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal ajuste de stock -->
    <UModal v-model:open="stockModalOpen" title="Ajustar stock">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Cantidad" required>
            <UInput v-model="ajusteForm.cantidad" type="number" placeholder="0" class="w-full" />
          </UFormField>
          <UFormField label="Tipo de movimiento" required>
            <USelectMenu
              v-model="ajusteForm.tipo"
              :items="ajusteTipoOpts"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Motivo" required>
            <USelectMenu
              v-model="ajusteForm.motivo"
              :items="motivoOpts"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Comentario">
            <UInput v-model="ajusteForm.comentario" placeholder="Opcional" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="stockModalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="ajustando" @click="ejecutarAjusteStock">
            Aplicar ajuste
          </UButton>
        </div>
      </template>
    </UModal>
    <!-- Modal historial de inventario -->
    <UModal
      v-model:open="historialOpen"
      :title="`Historial — ${historialItemNombre}`"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div v-if="historialLoading" class="py-8 text-center text-muted">Cargando…</div>
        <div v-else-if="!movimientos.length" class="py-8 text-center text-muted">
          Sin movimientos registrados.
        </div>
        <table v-else class="w-full text-sm">
          <thead class="text-muted text-left">
            <tr class="border-b border-default">
              <th class="py-2">Fecha</th>
              <th>Tipo</th>
              <th>Motivo</th>
              <th class="text-right">Cantidad</th>
              <th class="text-right">Resultante</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in movimientos" :key="m.id" class="border-b border-default">
              <td class="py-2">{{ new Date(m.creadoEl).toLocaleString() }}</td>
              <td>
                <UBadge
                  :label="m.tipo === 'entrada' ? 'Entrada' : 'Salida'"
                  :color="m.tipo === 'entrada' ? 'success' : 'warning'"
                  variant="subtle"
                  size="sm"
                />
              </td>
              <td>{{ m.motivo }}</td>
              <td class="text-right">{{ m.cantidad }}</td>
              <td class="text-right font-medium">{{ m.stockResultante }}</td>
              <td>{{ m.usuarioNombre ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton color="neutral" variant="ghost" @click="historialOpen = false">Cerrar</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
