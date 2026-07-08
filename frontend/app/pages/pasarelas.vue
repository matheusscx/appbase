<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface PasarelaGlobal {
  pasarelaId: string
  codigo: string
  nombre: string
  soportaTokenizacion: boolean
  soportaCobroRecurrente: boolean
  soportaMall: boolean
}
interface TenantPasarelaRow {
  tenantPasarelaId: string
  pasarelaId: string
  codigo: string
  nombre: string
  ambiente: string
  modoIntegracion: string
  activo: boolean
  prioridad: number
  tieneCredenciales: boolean
  creadoEl: string
}
interface ApiKeyRow {
  apiKeyId: string
  nombre: string
  prefijo: string
  ultimoUsoEl: string | null
  revocadaEl: string | null
  creadoEl: string
}
interface OrdenRow {
  ordenId: string
  codigoOrden: string
  pagadorRef: string | null
  referenciaExterna: string | null
  descripcion: string
  monto: string
  moneda: string
  estado: string
  origen: string
  creadoEl: string
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const { formatFecha, formatMonto } = useFormatters()
const permissionsStore = usePermissionsStore()

const tab = ref('config')
const tabs = [
  { label: 'Mis pasarelas', value: 'config', icon: 'i-lucide-plug-zap' },
  { label: 'API Keys', value: 'keys', icon: 'i-lucide-key-round' },
  { label: 'Órdenes', value: 'ordenes', icon: 'i-lucide-receipt' },
]

// ---------- Tab 1: Mis pasarelas ----------
const configs = ref<TenantPasarelaRow[]>([])
const globales = ref<PasarelaGlobal[]>([])
const loadingConfig = ref(false)
const savingConfig = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)

function emptyForm() {
  return {
    pasarelaId: '',
    ambiente: 'pruebas',
    modoIntegracion: 'mall',
    commerceCodeHijo: '',
    credencialesIndividual: { mallCommerceCode: '', apiKeySecret: '', commerceCodeHijo: '' },
    activo: true,
    prioridad: '1',
  }
}
const form = ref(emptyForm())
const tocoCredenciales = ref(false) // write-only: solo mandar si se tipeó algo

const drawerTitle = computed(() => (editingId.value ? 'Editar pasarela' : 'Agregar pasarela'))

async function cargarConfig() {
  loadingConfig.value = true
  try {
    const [cfg, glob] = await Promise.all([
      useApiFetch<TenantPasarelaRow[]>(`${apiUrl}/pasarela/admin/config`),
      useApiFetch<PasarelaGlobal[]>(`${apiUrl}/pasarela/admin/pasarelas-disponibles`),
    ])
    configs.value = cfg
    globales.value = glob
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar pasarelas'), color: 'error' })
  }
  finally {
    loadingConfig.value = false
  }
}

function abrirCrear() {
  editingId.value = null
  form.value = emptyForm()
  tocoCredenciales.value = false
  drawerOpen.value = true
}

function abrirEditar(row: TenantPasarelaRow) {
  editingId.value = row.tenantPasarelaId
  form.value = {
    ...emptyForm(),
    pasarelaId: row.pasarelaId,
    ambiente: row.ambiente,
    modoIntegracion: row.modoIntegracion,
    activo: row.activo,
    prioridad: String(row.prioridad),
  }
  tocoCredenciales.value = false
  drawerOpen.value = true
}

async function guardarConfig() {
  const payload: Record<string, unknown> = {
    ambiente: form.value.ambiente,
    modoIntegracion: form.value.modoIntegracion,
    activo: form.value.activo,
    prioridad: Number(form.value.prioridad),
  }
  if (!editingId.value) payload.pasarelaId = form.value.pasarelaId
  // Write-only: la configuración solo viaja si el usuario la tipeó
  if (tocoCredenciales.value) {
    payload.configuracion
      = form.value.modoIntegracion === 'mall'
        ? { commerceCodeHijo: form.value.commerceCodeHijo }
        : { ...form.value.credencialesIndividual }
  }
  savingConfig.value = true
  try {
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/pasarela/admin/config/${editingId.value}`, {
        method: 'PATCH',
        body: payload,
      })
    }
    else {
      await useApiFetch(`${apiUrl}/pasarela/admin/config`, { method: 'POST', body: payload })
    }
    toast.add({ title: 'Pasarela guardada', color: 'success' })
    drawerOpen.value = false
    await cargarConfig()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    savingConfig.value = false
  }
}

const eliminandoConfig = ref<TenantPasarelaRow | null>(null)
const eliminarConfigOpen = ref(false)
async function confirmarEliminarConfig() {
  if (!eliminandoConfig.value) return
  try {
    await useApiFetch(
      `${apiUrl}/pasarela/admin/config/${eliminandoConfig.value.tenantPasarelaId}`,
      { method: 'DELETE' },
    )
    toast.add({ title: 'Pasarela eliminada', color: 'success' })
    await cargarConfig()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    eliminarConfigOpen.value = false
  }
}

// ---------- Tab 2: API Keys ----------
const keys = ref<ApiKeyRow[]>([])
const loadingKeys = ref(false)
const creandoKey = ref(false)
const nuevaKeyNombre = ref('')
const keyCreadaModal = ref(false)
const keyCreada = ref('')
const crearKeyOpen = ref(false)

async function cargarKeys() {
  loadingKeys.value = true
  try {
    keys.value = await useApiFetch<ApiKeyRow[]>(`${apiUrl}/pasarela/admin/api-keys`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar API keys'), color: 'error' })
  }
  finally {
    loadingKeys.value = false
  }
}

async function crearKey() {
  creandoKey.value = true
  try {
    const res = await useApiFetch<{ apiKey: string }>(`${apiUrl}/pasarela/admin/api-keys`, {
      method: 'POST',
      body: { nombre: nuevaKeyNombre.value },
    })
    keyCreada.value = res.apiKey
    crearKeyOpen.value = false
    keyCreadaModal.value = true
    nuevaKeyNombre.value = ''
    await cargarKeys()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al crear la key'), color: 'error' })
  }
  finally {
    creandoKey.value = false
  }
}

async function copiarKey() {
  await navigator.clipboard.writeText(keyCreada.value)
  toast.add({ title: 'Key copiada al portapapeles', color: 'success' })
}

const revocando = ref<ApiKeyRow | null>(null)
const revocarOpen = ref(false)
async function confirmarRevocar() {
  if (!revocando.value) return
  try {
    await useApiFetch(`${apiUrl}/pasarela/admin/api-keys/${revocando.value.apiKeyId}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'API key revocada', color: 'success' })
    await cargarKeys()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al revocar'), color: 'error' })
  }
  finally {
    revocarOpen.value = false
  }
}

// ---------- Tab 3: Órdenes ----------
const {
  items: ordenes,
  meta: ordenesMeta,
  page: ordenesPage,
  loading: loadingOrdenes,
} = usePaginatedList<OrdenRow>({ path: '/pasarela/admin/ordenes' })

const estadoColor: Record<string, 'success' | 'error' | 'warning' | 'neutral' | 'info'> = {
  pagada: 'success',
  fallida: 'error',
  en_proceso: 'warning',
  expirada: 'neutral',
  reembolsada: 'info',
  creada: 'neutral',
}

onMounted(() => {
  cargarConfig()
  cargarKeys()
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Pasarelas de pago" />
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <CrudPageHeader
          title="Pasarelas de pago"
          description="Configura tus proveedores de pago (Oneclick, Webpay…) y genera las API keys para tus aplicaciones externas."
        />

        <UTabs v-model="tab" :items="tabs" />

        <!-- Tab 1: Mis pasarelas -->
        <template v-if="tab === 'config'">
          <div class="flex justify-end">
            <UButton
              v-if="permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Crear')"
              icon="i-lucide-plus"
              label="Agregar pasarela"
              @click="abrirCrear"
            />
          </div>
          <div v-if="loadingConfig" class="text-center text-muted py-8">
            Cargando…
          </div>
          <div v-else-if="!configs.length" class="text-center text-muted py-8">
            Aún no tienes pasarelas configuradas.
          </div>
          <ul v-else class="divide-y divide-default">
            <li
              v-for="c in configs" :key="c.tenantPasarelaId"
              class="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <p class="font-medium text-default">
                  {{ c.nombre }}
                </p>
                <p class="text-sm text-muted">
                  {{ c.modoIntegracion === 'mall' ? 'Mall' : 'Individual' }} ·
                  {{ c.ambiente === 'pruebas' ? 'Pruebas' : 'Producción' }} ·
                  prioridad {{ c.prioridad }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge v-if="!c.tieneCredenciales" color="warning" variant="subtle">
                  Sin credenciales
                </UBadge>
                <UBadge :color="c.activo ? 'success' : 'neutral'" variant="subtle">
                  {{ c.activo ? 'Activa' : 'Inactiva' }}
                </UBadge>
                <UButton
                  icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs"
                  @click="abrirEditar(c)"
                />
                <UButton
                  icon="i-lucide-trash-2" color="error" variant="ghost" size="xs"
                  @click="eliminandoConfig = c; eliminarConfigOpen = true"
                />
              </div>
            </li>
          </ul>
        </template>

        <!-- Tab 2: API Keys -->
        <template v-else-if="tab === 'keys'">
          <div class="flex justify-end">
            <UButton
              v-if="permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Crear')"
              icon="i-lucide-plus"
              label="Nueva API key"
              @click="crearKeyOpen = true"
            />
          </div>
          <div v-if="loadingKeys" class="text-center text-muted py-8">
            Cargando…
          </div>
          <div v-else-if="!keys.length" class="text-center text-muted py-8">
            Sin API keys. Crea una para conectar tus apps externas.
          </div>
          <ul v-else class="divide-y divide-default">
            <li v-for="k in keys" :key="k.apiKeyId" class="flex items-center justify-between gap-4 py-3">
              <div>
                <p class="font-medium text-default">
                  {{ k.nombre }}
                </p>
                <p class="text-sm text-muted font-mono">
                  {{ k.prefijo }}
                </p>
              </div>
              <div class="flex items-center gap-2 text-sm text-muted">
                <span>Último uso: {{ k.ultimoUsoEl ? formatFecha(k.ultimoUsoEl) : 'nunca' }}</span>
                <UBadge :color="k.revocadaEl ? 'neutral' : 'success'" variant="subtle">
                  {{ k.revocadaEl ? 'Revocada' : 'Activa' }}
                </UBadge>
                <UButton
                  v-if="!k.revocadaEl"
                  icon="i-lucide-ban" color="error" variant="ghost" size="xs"
                  @click="revocando = k; revocarOpen = true"
                />
              </div>
            </li>
          </ul>
        </template>

        <!-- Tab 3: Órdenes -->
        <template v-else>
          <div v-if="loadingOrdenes" class="text-center text-muted py-8">
            Cargando…
          </div>
          <div v-else-if="!ordenes.length" class="text-center text-muted py-8">
            Sin órdenes de cobro todavía.
          </div>
          <template v-else>
            <ul class="divide-y divide-default">
              <li v-for="o in ordenes" :key="o.ordenId" class="flex items-center justify-between gap-4 py-3">
                <div>
                  <p class="font-medium text-default">
                    {{ o.descripcion }}
                  </p>
                  <p class="text-sm text-muted font-mono">
                    {{ o.codigoOrden }}
                    <span v-if="o.referenciaExterna"> · ref {{ o.referenciaExterna }}</span>
                    <span v-if="o.pagadorRef"> · {{ o.pagadorRef }}</span>
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <span class="font-medium text-default">{{ formatMonto(o.monto) }}</span>
                  <UBadge :color="estadoColor[o.estado] ?? 'neutral'" variant="subtle">
                    {{ o.estado }}
                  </UBadge>
                  <span class="text-sm text-muted">{{ formatFecha(o.creadoEl) }}</span>
                </div>
              </li>
            </ul>
            <div v-if="ordenesMeta.total > ordenesMeta.pageSize" class="flex justify-end pt-4">
              <UPagination
                v-model:page="ordenesPage"
                :items-per-page="ordenesMeta.pageSize"
                :total="ordenesMeta.total"
              />
            </div>
          </template>
        </template>

        <!-- Drawer alta/edición de pasarela -->
        <AppDrawer v-model:open="drawerOpen" width="40%">
          <template #header>
            <span class="font-semibold text-default">{{ drawerTitle }}</span>
          </template>

          <template #body>
            <div class="space-y-4">
              <UFormField v-if="!editingId" label="Pasarela">
                <USelectMenu
                  v-model="form.pasarelaId" value-key="pasarelaId" label-key="nombre"
                  :items="globales" placeholder="Selecciona un proveedor"
                />
              </UFormField>
              <UFormField label="Ambiente">
                <USelect
                  v-model="form.ambiente"
                  :items="[{ label: 'Pruebas', value: 'pruebas' }, { label: 'Producción', value: 'produccion' }]"
                />
              </UFormField>
              <UFormField label="Modo de integración">
                <USelect
                  v-model="form.modoIntegracion"
                  :items="[
                    { label: 'Mall (comercio de la plataforma)', value: 'mall' },
                    { label: 'Individual (credenciales propias)', value: 'individual' },
                  ]"
                />
              </UFormField>

              <template v-if="form.modoIntegracion === 'mall'">
                <UFormField label="Código de comercio hijo" help="Asignado por la plataforma dentro de su mall">
                  <UInput
                    v-model="form.commerceCodeHijo"
                    :placeholder="editingId ? '•••• (escribe para reemplazar)' : '597055555542'"
                    @input="tocoCredenciales = true"
                  />
                </UFormField>
              </template>
              <template v-else>
                <UFormField label="Código de comercio mall">
                  <UInput
                    v-model="form.credencialesIndividual.mallCommerceCode"
                    :placeholder="editingId ? '•••• (escribe para reemplazar)' : ''"
                    @input="tocoCredenciales = true"
                  />
                </UFormField>
                <UFormField label="API key secret">
                  <UInput
                    v-model="form.credencialesIndividual.apiKeySecret" type="password"
                    :placeholder="editingId ? '•••• (escribe para reemplazar)' : ''"
                    @input="tocoCredenciales = true"
                  />
                </UFormField>
                <UFormField label="Código de comercio hijo">
                  <UInput
                    v-model="form.credencialesIndividual.commerceCodeHijo"
                    :placeholder="editingId ? '•••• (escribe para reemplazar)' : ''"
                    @input="tocoCredenciales = true"
                  />
                </UFormField>
              </template>

              <UFormField label="Prioridad">
                <UInput v-model="form.prioridad" inputmode="numeric" />
              </UFormField>
              <UFormField label="Activa">
                <USwitch v-model="form.activo" />
              </UFormField>
            </div>
          </template>

          <template #actions>
            <UButton color="neutral" variant="ghost" @click="drawerOpen = false">
              Cancelar
            </UButton>
            <UButton :loading="savingConfig" @click="guardarConfig">
              Guardar
            </UButton>
          </template>
        </AppDrawer>

        <!-- Modales -->
        <CrudModal
          v-model:open="eliminarConfigOpen"
          title="Eliminar pasarela"
          :message="`¿Eliminar la configuración de ${eliminandoConfig?.nombre ?? ''}? Las apps que la usen dejarán de poder cobrar.`"
          @confirm="confirmarEliminarConfig"
        />
        <CrudModal
          v-model:open="revocarOpen"
          title="Revocar API key"
          :message="`¿Revocar la key '${revocando?.nombre ?? ''}'? Las apps que la usen recibirán 401 inmediatamente.`"
          @confirm="confirmarRevocar"
        />

        <UModal v-model:open="crearKeyOpen" title="Nueva API key">
          <template #body>
            <UFormField label="Nombre descriptivo" help="Ej: app móvil bodega">
              <UInput v-model="nuevaKeyNombre" placeholder="Nombre de la key" />
            </UFormField>
          </template>
          <template #footer>
            <AppModalFooter>
              <UButton color="neutral" variant="ghost" @click="crearKeyOpen = false">
                Cancelar
              </UButton>
              <UButton label="Crear" :loading="creandoKey" :disabled="!nuevaKeyNombre.trim()" @click="crearKey" />
            </AppModalFooter>
          </template>
        </UModal>

        <UModal v-model:open="keyCreadaModal" title="API key creada">
          <template #body>
            <div class="space-y-3">
              <p class="text-sm text-muted">
                Copia la key ahora — <strong>no volverás a verla</strong>. Guárdala en un lugar seguro.
              </p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-sm bg-elevated rounded px-3 py-2 break-all">{{ keyCreada }}</code>
                <UButton icon="i-lucide-copy" color="neutral" variant="ghost" @click="copiarKey" />
              </div>
            </div>
          </template>
          <template #footer>
            <AppModalFooter>
              <UButton label="Entendido" @click="keyCreadaModal = false" />
            </AppModalFooter>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
