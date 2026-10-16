<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { hoyLocal } from '~/composables/useVigenciaRegla'
import type {
  EstadoPaquete,
  HojaRutaDetalle,
  PaqueteConfiguracionRespuesta,
  PaqueteFila,
  RepartidorFila,
} from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard` en todo el módulo.
definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })

interface Tercero {
  id: string
  nombre: string
  nombreLegal: string | null
  activo: boolean
}

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { formatOficial } = useCurrency()
const { rotuloEstadoPaquete, colorEstadoPaquete, fechaCorta } = usePaqueteria()
const { pageSize } = useUserPreferences()
const { diaNegocioHoy, cargar: cargarDiaNegocio } = useDiaNegocio()
const permissionsStore = usePermissionsStore()
// Paquetería no trae Terceros: en un tenant que no lo contrató `GET /terceros` es un 403 en cada carga,
// así que ni se pide ni se muestra el selector de remitente.
const puedeVerTerceros = computed(() => permissionsStore.can('Terceros', 'Leer'))
// El backend acepta hasta 500 caracteres de lo que lee la pistola (un QR de Mercado Libre es un JSON
// bastante más largo que el código) y lo normaliza a ≤100: cortar antes rechazaría un escaneo válido.
const MAX_ENTRADA_CODIGO = 500

// ── Filtros ───────────────────────────────────────────────────────────────

const filtroEstado = ref<EstadoPaquete | 'todos'>('todos')
const filtroCobro = ref<'todos' | 'si' | 'no'>('todos')
const filtroPorCompletar = ref(false)
const busqueda = ref('')
// El buscador manda la consulta 300 ms después de la última tecla: una por tecla era un GET por letra.
const busquedaAplicada = ref('')
let temporizadorBusqueda: ReturnType<typeof setTimeout> | undefined
watch(busqueda, (valor) => {
  clearTimeout(temporizadorBusqueda)
  temporizadorBusqueda = setTimeout(() => {
    busquedaAplicada.value = valor.trim()
  }, 300)
})
onBeforeUnmount(() => clearTimeout(temporizadorBusqueda))

const estadoOptions = [
  { label: 'Todos los estados', value: 'todos' },
  { label: 'Disponible', value: 'disponible' },
  { label: 'En ruta', value: 'en_ruta' },
  { label: 'Entregado', value: 'entregado' },
]
const cobroOptions = [
  { label: 'Con y sin cobro', value: 'todos' },
  { label: 'Con cobro en destino', value: 'si' },
  { label: 'Sin cobro en destino', value: 'no' },
]

// Solo viajan los filtros declarados y con valor: el backend rechaza con 400 cualquier otro parámetro.
const listFilters = computed(() => ({
  estado: filtroEstado.value !== 'todos' ? filtroEstado.value : undefined,
  cobroEnDestino: filtroCobro.value === 'todos' ? undefined : String(filtroCobro.value === 'si'),
  porCompletar: filtroPorCompletar.value ? 'true' : undefined,
  q: busquedaAplicada.value || undefined,
}))

const hayFiltrosActivos = computed(() =>
  filtroEstado.value !== 'todos'
  || filtroCobro.value !== 'todos'
  || filtroPorCompletar.value
  || busqueda.value.trim() !== '',
)

function limpiarFiltros() {
  filtroEstado.value = 'todos'
  filtroCobro.value = 'todos'
  filtroPorCompletar.value = false
  busqueda.value = ''
  clearTimeout(temporizadorBusqueda)
  busquedaAplicada.value = ''
}

const { items: paquetes, meta, page, loading, error, sinPermiso, fetch: recargar } =
  usePaginatedList<PaqueteFila>({
    path: '/paquetes',
    pageSize,
    filters: listFilters,
  })

// ── Selección para asignar ────────────────────────────────────────────────

const rowSelection = ref<Record<string, boolean>>({})

const disponibles = computed(() => paquetes.value.filter(p => p.estado === 'disponible'))
const seleccionados = computed(() =>
  disponibles.value.filter(p => rowSelection.value[p.id]),
)

// Al cambiar de página o de filtro (o tras recargar) solo sobreviven los que siguen en la lista y
// disponibles: un paquete que otro ya asignó no puede quedar tildado.
watch(paquetes, (lista) => {
  const vigentes = new Set(lista.filter(p => p.estado === 'disponible').map(p => p.id))
  rowSelection.value = Object.fromEntries(
    Object.entries(rowSelection.value).filter(([id, marcado]) => marcado && vigentes.has(id)),
  )
})

const todosMarcados = computed<boolean | 'indeterminate'>(() => {
  if (!disponibles.value.length || !seleccionados.value.length) return false
  return seleccionados.value.length === disponibles.value.length ? true : 'indeterminate'
})

function marcarTodos(marcar: boolean) {
  rowSelection.value = marcar
    ? Object.fromEntries(disponibles.value.map(p => [p.id, true]))
    : {}
}

// ── Catálogos del formulario y del modal ──────────────────────────────────

const config = ref<PaqueteConfiguracionRespuesta | null>(null)
const terceros = ref<Tercero[]>([])
const repartidores = ref<RepartidorFila[]>([])

async function cargarConfig() {
  try {
    config.value = await useApiFetch<PaqueteConfiguracionRespuesta>(`${apiUrl}/paquetes/configuracion`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar los valores por defecto'), color: 'error' })
  }
}

async function cargarTerceros() {
  if (!puedeVerTerceros.value) return
  try {
    terceros.value = await useApiFetch<Tercero[]>(`${apiUrl}/terceros`)
  }
  catch {
    // El remitente es opcional: sin la lista el paquete se puede crear igual.
  }
}

async function cargarRepartidores() {
  try {
    repartidores.value = await useApiFetch<RepartidorFila[]>(`${apiUrl}/repartidores`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar repartidores'), color: 'error' })
  }
}

onMounted(() => {
  cargarConfig()
  cargarTerceros()
  cargarRepartidores()
  cargarDiaNegocio()
})

// ── Alta y edición ────────────────────────────────────────────────────────

const drawerOpen = ref(false)
const saving = ref(false)
const editando = ref<PaqueteFila | null>(null)

const emptyForm = () => ({
  codigo: '',
  destinatarioNombre: '',
  destinatarioTelefono: '',
  direccion: '',
  comuna: '',
  nota: '',
  remitenteTerceroId: undefined as string | undefined,
  cobroEnDestino: false,
  precioEnvio: '',
  pagoRepartidor: '',
})
const form = ref(emptyForm())

const configurada = computed(() => config.value?.configurada ?? true)
const bloqueado = computed(() => editando.value?.bloqueado ?? false)
const drawerTitle = computed(() => editando.value ? 'Editar paquete' : 'Nuevo paquete')
const submitLabel = computed(() => editando.value ? 'Guardar' : 'Crear')

// Sin valores por defecto guardados, un alta sin montos es 400: se pide tipearlos acá.
const montosRequeridos = computed(() => !!editando.value || !configurada.value)
const montosFaltan = computed(() =>
  montosRequeridos.value && !bloqueado.value
  && (form.value.precioEnvio === '' || form.value.pagoRepartidor === ''),
)
const guardarDeshabilitado = computed(() => form.value.codigo.trim() === '' || montosFaltan.value)

const remitenteOptions = computed(() => {
  const opciones = terceros.value
    .filter(t => t.activo)
    .map(t => ({ label: t.nombreLegal || t.nombre, value: t.id }))
  // El remitente de un paquete existente puede haberse desactivado después: sin esto el selector
  // quedaría en blanco y guardar lo borraría sin que nadie lo pida.
  const actual = editando.value
  if (actual?.remitenteTerceroId && !opciones.some(o => o.value === actual.remitenteTerceroId)) {
    opciones.push({ label: actual.remitenteNombre ?? 'Remitente', value: actual.remitenteTerceroId })
  }
  return opciones
})

function resetDrawer() {
  editando.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

function abrirCrear() {
  resetDrawer()
  if (config.value?.configurada) {
    form.value.precioEnvio = config.value.precioEnvioDefecto
    form.value.pagoRepartidor = config.value.pagoRepartidorDefecto
  }
  drawerOpen.value = true
}

function abrirEditar(p: PaqueteFila) {
  resetDrawer()
  editando.value = p
  form.value = {
    codigo: p.codigo,
    destinatarioNombre: p.destinatarioNombre ?? '',
    destinatarioTelefono: p.destinatarioTelefono ?? '',
    direccion: p.direccion ?? '',
    comuna: p.comuna ?? '',
    nota: p.nota ?? '',
    remitenteTerceroId: p.remitenteTerceroId ?? undefined,
    cobroEnDestino: p.cobroEnDestino,
    precioEnvio: p.precioEnvio,
    pagoRepartidor: p.pagoRepartidor,
  }
  drawerOpen.value = true
}

// Vacío = `null`, nunca `""`: en el PATCH vaciar el campo lo borra, y en el POST se omite.
const textoONull = (valor: string) => valor.trim() || null

async function guardar() {
  saving.value = true
  try {
    const f = form.value
    const datos = {
      codigo: f.codigo.trim(),
      destinatarioNombre: textoONull(f.destinatarioNombre),
      destinatarioTelefono: textoONull(f.destinatarioTelefono),
      direccion: textoONull(f.direccion),
      comuna: textoONull(f.comuna),
      nota: textoONull(f.nota),
    }
    const remitente = f.remitenteTerceroId ?? null
    if (editando.value) {
      // El remitente viaja solo si cambió: el backend valida cualquier remitente que llegue, y uno
      // que se pausó o se borró después bloquearía completar la dirección del paquete.
      const remitenteCambio = remitente !== editando.value.remitenteTerceroId
        ? { remitenteTerceroId: remitente }
        : {}
      // Con la rendición hecha el backend rechaza cualquier cambio de montos o de cobro: ni se mandan.
      const montos = bloqueado.value
        ? {}
        : { cobroEnDestino: f.cobroEnDestino, precioEnvio: f.precioEnvio, pagoRepartidor: f.pagoRepartidor }
      const guardado = await useApiFetch<PaqueteFila>(`${apiUrl}/paquetes/${editando.value.id}`, {
        method: 'PATCH',
        body: { ...datos, ...remitenteCambio, ...montos },
      })
      paquetes.value = paquetes.value.map(p => p.id === guardado.id ? { ...p, ...guardado } : p)
      toast.add({ title: 'Paquete actualizado', color: 'success' })
    }
    else {
      const body = Object.fromEntries(
        Object.entries({
          ...datos,
          remitenteTerceroId: remitente,
          cobroEnDestino: f.cobroEnDestino,
          precioEnvio: f.precioEnvio || null,
          pagoRepartidor: f.pagoRepartidor || null,
        }).filter(([, valor]) => valor !== null),
      )
      await useApiFetch<PaqueteFila>(`${apiUrl}/paquetes`, { method: 'POST', body })
      toast.add({ title: 'Paquete creado', color: 'success' })
      // El orden y el total del listado cambian: acá la lista se vuelve a pedir.
      await recargar()
    }
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// ── Eliminar ──────────────────────────────────────────────────────────────

const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const eliminando = ref(false)
// El 400 de «ya salió en una hoja de ruta» se queda dentro del modal, a la vista.
const errorEliminar = ref<string | null>(null)

const paqueteAEliminar = computed(() =>
  paquetes.value.find(p => p.id === confirmDeleteId.value) ?? null,
)

function pedirEliminar(p: PaqueteFila) {
  confirmDeleteId.value = p.id
  errorEliminar.value = null
  confirmModalOpen.value = true
}

function cancelarEliminar() {
  confirmDeleteId.value = null
  errorEliminar.value = null
}

async function eliminar(id: string) {
  eliminando.value = true
  errorEliminar.value = null
  try {
    await useApiFetch(`${apiUrl}/paquetes/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Paquete eliminado', color: 'success' })
    confirmModalOpen.value = false
    confirmDeleteId.value = null
    // Si era el único de la última página, se retrocede una (el cambio de página ya recarga).
    if (paquetes.value.length === 1 && page.value > 1) page.value -= 1
    else await recargar()
  }
  catch (e: unknown) {
    errorEliminar.value = apiErrorMsg(e, 'Error al eliminar')
  }
  finally {
    eliminando.value = false
  }
}

// ── Asignar a repartidor ──────────────────────────────────────────────────

const asignarOpen = ref(false)
const asignando = ref(false)
const errorAsignar = ref<string | null>(null)
const repartidorId = ref<string | undefined>(undefined)
const fechaAsignar = ref('')

const repartidorOptions = computed(() =>
  repartidores.value
    .filter(r => r.activo)
    .map(r => ({ label: r.nombre, value: r.id })),
)
const repartidorElegido = computed(() =>
  repartidorOptions.value.find(o => o.value === repartidorId.value) ?? null,
)

const resumenAsignar = computed(() => {
  if (!repartidorElegido.value || !fechaAsignar.value) return null
  const n = seleccionados.value.length
  return `Vas a asignar ${n} ${n === 1 ? 'paquete' : 'paquetes'} a ${repartidorElegido.value.label} para el ${fechaCorta(fechaAsignar.value)}`
})

const asignarDeshabilitado = computed(() =>
  !repartidorId.value || !fechaAsignar.value || seleccionados.value.length === 0,
)

function abrirAsignar() {
  repartidorId.value = undefined
  errorAsignar.value = null
  // Si el día de negocio todavía no llegó (o falló), el calendario local es el respaldo.
  fechaAsignar.value = diaNegocioHoy.value ?? hoyLocal()
  asignarOpen.value = true
}

async function asignar() {
  if (asignarDeshabilitado.value) return
  asignando.value = true
  errorAsignar.value = null
  const cantidad = seleccionados.value.length
  const nombre = repartidorElegido.value!.label
  try {
    await useApiFetch<HojaRutaDetalle>(`${apiUrl}/hojas-ruta/asignar`, {
      method: 'POST',
      body: {
        repartidorId: repartidorId.value,
        fecha: fechaAsignar.value,
        paqueteIds: seleccionados.value.map(p => p.id),
      },
    })
    toast.add({
      title: `${cantidad} ${cantidad === 1 ? 'paquete asignado' : 'paquetes asignados'} a ${nombre}`,
      color: 'success',
    })
    asignarOpen.value = false
    // Cambian varios estados a la vez: acá el refetch es lo correcto.
    await recargar()
  }
  catch (e: unknown) {
    errorAsignar.value = apiErrorMsg(e, 'Error al asignar')
    // Si falló porque alguno ya no estaba disponible, la lista tiene que mostrar cómo quedó.
    await recargar()
  }
  finally {
    asignando.value = false
  }
}

// ── Tabla ─────────────────────────────────────────────────────────────────

const columns: TableColumn<PaqueteFila>[] = [
  { id: 'select', header: '' },
  { accessorKey: 'codigo', header: 'Código' },
  { id: 'destinatario', header: 'Destinatario' },
  { accessorKey: 'cobroEnDestino', header: 'Cobro en destino' },
  { accessorKey: 'precioEnvio', header: 'Envío', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'pagoRepartidor', header: 'Pago repartidor', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'estado', header: 'Estado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const porCompletar = (p: PaqueteFila) => !p.destinatarioNombre || !p.direccion
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Paquetes" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Paquetes"
          description="Los paquetes que llegan al local. Elige los disponibles y asígnalos a un repartidor para armar su hoja de ruta."
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-route"
              :disabled="seleccionados.length === 0"
              data-qa="paquetes-asignar"
              @click="abrirAsignar"
            >
              Asignar a repartidor<template v-if="seleccionados.length"> ({{ seleccionados.length }})</template>
            </UButton>
            <UButton icon="i-lucide-plus" data-qa="paquetes-nuevo" @click="abrirCrear">
              Nuevo paquete
            </UButton>
          </template>
        </CrudPageHeader>

        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="busqueda"
            icon="i-lucide-search"
            placeholder="Buscar por código..."
            class="min-w-48 flex-1 max-w-sm"
            data-qa="paquetes-buscar"
          />
          <USelectMenu
            v-model="filtroEstado"
            :items="estadoOptions"
            value-key="value"
            :search-input="false"
            class="w-48"
            aria-label="Filtrar por estado"
            data-qa="paquetes-filtro-estado"
          />
          <USelectMenu
            v-model="filtroCobro"
            :items="cobroOptions"
            value-key="value"
            :search-input="false"
            class="w-52"
            aria-label="Filtrar por cobro en destino"
            data-qa="paquetes-filtro-cobro"
          />
          <UCheckbox
            v-model="filtroPorCompletar"
            label="Datos por completar"
            data-qa="paquetes-filtro-por-completar"
          />
          <UButton
            v-if="hayFiltrosActivos"
            label="Limpiar filtros"
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="limpiarFiltros"
          />
        </div>

        <UCard class="w-full">
          <UTable
            v-model:row-selection="rowSelection"
            :get-row-id="(fila: PaqueteFila) => fila.id"
            :data="paquetes"
            :columns="columns"
            :loading="loading"
          >
            <template #select-header>
              <UCheckbox
                :model-value="todosMarcados"
                :disabled="!disponibles.length"
                aria-label="Seleccionar todos los disponibles"
                @update:model-value="(v: boolean | 'indeterminate') => marcarTodos(v === true)"
              />
            </template>
            <template #select-cell="{ row }">
              <UCheckbox
                :model-value="row.getIsSelected()"
                :disabled="row.original.estado !== 'disponible'"
                :aria-label="`Seleccionar ${row.original.codigo}`"
                @update:model-value="(v: boolean | 'indeterminate') => row.toggleSelected(v === true)"
              />
            </template>

            <template #codigo-cell="{ row }">
              <span class="font-mono text-sm font-medium text-highlighted">{{ row.original.codigo }}</span>
            </template>

            <template #destinatario-cell="{ row }">
              <div class="min-w-0 space-y-0.5">
                <p v-if="row.original.destinatarioNombre" class="text-sm text-highlighted truncate">
                  {{ row.original.destinatarioNombre }}
                </p>
                <p v-if="row.original.direccion" class="text-xs text-muted truncate">
                  {{ row.original.direccion }}<template v-if="row.original.comuna">, {{ row.original.comuna }}</template>
                </p>
                <UBadge
                  v-if="porCompletar(row.original)"
                  label="Por completar"
                  color="warning"
                  variant="subtle"
                  size="sm"
                />
              </div>
            </template>

            <template #cobroEnDestino-cell="{ row }">
              <UBadge
                v-if="row.original.cobroEnDestino"
                label="Cobra en destino"
                color="warning"
                variant="subtle"
                size="sm"
              />
              <span v-else class="text-sm text-muted">—</span>
            </template>

            <template #precioEnvio-cell="{ row }">
              <span class="text-sm">{{ formatOficial(row.original.precioEnvio) }}</span>
            </template>
            <template #pagoRepartidor-cell="{ row }">
              <span class="text-sm">{{ formatOficial(row.original.pagoRepartidor) }}</span>
            </template>

            <template #estado-cell="{ row }">
              <div class="space-y-0.5">
                <UBadge
                  :label="rotuloEstadoPaquete(row.original.estado)"
                  :color="colorEstadoPaquete(row.original.estado)"
                  variant="subtle"
                  size="sm"
                />
                <p v-if="row.original.repartidorNombre" class="text-xs text-muted">
                  {{ row.original.repartidorNombre }}
                </p>
              </div>
            </template>

            <template #acciones-cell="{ row }">
              <div class="flex justify-end gap-2">
                <UButton
                  :aria-label="`Editar el paquete ${row.original.codigo}`"
                  icon="i-lucide-square-pen"
                  color="neutral"
                  variant="ghost"
                  title="Editar"
                  @click="abrirEditar(row.original)"
                  class="size-11 justify-center"
                />
                <UButton
                  :aria-label="`Eliminar el paquete ${row.original.codigo}`"
                  v-if="row.original.estado === 'disponible'"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  title="Eliminar"
                  @click="pedirEliminar(row.original)"
                  class="size-11 justify-center"
                />
              </div>
            </template>

            <template #empty>
              <AppEstadoLista
                recurso="los paquetes"
                vacio="Todavía no hay paquetes. Escanéalos o crea el primero con «Nuevo paquete»."
                filtrado-texto="Ningún paquete coincide con los filtros."
                :error="error"
                :sin-permiso="sinPermiso"
                :filtrado="hayFiltrosActivos"
                @reintentar="recargar"
                @quitar-filtros="limpiarFiltros"
              />
            </template>
          </UTable>

          <div v-if="meta.total > pageSize" class="flex justify-end border-t border-default pt-4">
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="meta.total"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AppDrawer v-model:open="drawerOpen">
    <template #header>
      <span class="font-semibold text-default">{{ drawerTitle }}</span>
    </template>

    <template #body>
      <UForm
        id="paquete-form"
        :state="form"
        class="space-y-4"
        @submit="guardar"
      >
        <UAlert
          v-if="!editando && !configurada"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="Todavía no hay valores por defecto: escribe el precio de envío y el pago al repartidor de este paquete."
          data-qa="paquete-sin-configurar"
        />

        <UFormField label="Código" required>
          <UInput
            v-model="form.codigo"
            placeholder="Lo que lee la pistola"
            :maxlength="MAX_ENTRADA_CODIGO"
            class="w-full font-mono"
            autofocus
          />
        </UFormField>

        <UFormField label="Destinatario">
          <UInput v-model="form.destinatarioNombre" placeholder="María González" maxlength="150" class="w-full" />
        </UFormField>
        <UFormField label="Teléfono del destinatario">
          <UInput
            v-model="form.destinatarioTelefono"
            type="tel"
            inputmode="tel"
            placeholder="+56 9 1234 5678"
            maxlength="30"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Dirección">
          <UInput v-model="form.direccion" placeholder="Av. Los Leones 1234, depto 5" maxlength="255" class="w-full" />
        </UFormField>
        <UFormField label="Comuna">
          <UInput v-model="form.comuna" placeholder="Providencia" maxlength="100" class="w-full" />
        </UFormField>
        <UFormField label="Nota">
          <UTextarea v-model="form.nota" :rows="2" placeholder="Dejar con el conserje" class="w-full" />
        </UFormField>
        <UFormField v-if="puedeVerTerceros" label="Remitente" description="Quién manda el paquete, si está registrado en Proveedores.">
          <USelectMenu
            v-model="form.remitenteTerceroId"
            :items="remitenteOptions"
            value-key="value"
            clear
            placeholder="Sin remitente"
            class="w-full"
          />
        </UFormField>

        <div class="space-y-4 rounded-lg border border-default p-4">
          <UFormField label="Cobro en destino" description="El repartidor cobra el envío al entregar.">
            <USwitch v-model="form.cobroEnDestino" :disabled="bloqueado" aria-label="Cobro en destino" />
          </UFormField>
          <UFormField label="Precio de envío">
            <MoneyInput
              v-model="form.precioEnvio"
              oficial
              :disabled="bloqueado"
              class="w-48"
              data-qa="paquete-precio-envio"
            />
          </UFormField>
          <UFormField label="Pago al repartidor">
            <MoneyInput
              v-model="form.pagoRepartidor"
              oficial
              :disabled="bloqueado"
              class="w-48"
              data-qa="paquete-pago-repartidor"
            />
          </UFormField>
          <p v-if="bloqueado" class="text-sm text-muted" data-qa="paquete-bloqueado">
            Ya se rindió: los montos no se pueden cambiar.
          </p>
        </div>
      </UForm>
    </template>

    <template #actions>
      <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
        Cancelar
      </UButton>
      <UButton
        type="submit"
        form="paquete-form"
        :loading="saving"
        :disabled="guardarDeshabilitado"
      >
        {{ submitLabel }}
      </UButton>
    </template>
  </AppDrawer>

  <UModal
    v-model:open="asignarOpen"
    title="Asignar a repartidor"
    :ui="shellUi.modal"
  >
    <template #body>
      <div class="space-y-4" data-qa="paquetes-asignar-modal">
        <UAlert
          v-if="!repartidorOptions.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-user-x"
          title="No hay repartidores activos. Activa o crea uno en Configuración > Repartidores."
        />
        <UFormField label="Repartidor" required>
          <USelectMenu
            v-model="repartidorId"
            :items="repartidorOptions"
            value-key="value"
            :search-input="false"
            placeholder="Elige un repartidor"
            class="w-full"
            aria-label="Repartidor"
          />
        </UFormField>
        <UFormField label="Fecha de la hoja de ruta" required>
          <AppDateInput v-model="fechaAsignar" qa="paquetes-asignar-fecha" />
        </UFormField>
        <p v-if="resumenAsignar" class="text-sm text-default" data-qa="paquetes-asignar-resumen">
          {{ resumenAsignar }}
        </p>
        <UAlert
          v-if="errorAsignar"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorAsignar"
          data-qa="paquetes-asignar-error"
        />
      </div>
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton color="neutral" variant="ghost" @click="() => { asignarOpen = false }">
          Cancelar
        </UButton>
        <UButton
          :loading="asignando"
          :disabled="asignarDeshabilitado"
          data-qa="paquetes-asignar-confirmar"
          @click="asignar"
        >
          Asignar
        </UButton>
      </AppModalFooter>
    </template>
  </UModal>

  <CrudModal
    v-model:open="confirmModalOpen"
    title="Eliminar paquete"
    :message="`¿Eliminar el paquete ${paqueteAEliminar?.codigo ?? ''}? Si ya salió en una hoja de ruta no se puede eliminar.`"
    :loading="eliminando"
    @cancel="cancelarEliminar"
    @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
  >
    <template #detalle>
      <UAlert
        v-if="errorEliminar"
        class="mt-3"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="errorEliminar"
        data-qa="paquete-error-eliminar"
      />
    </template>
  </CrudModal>
</template>
