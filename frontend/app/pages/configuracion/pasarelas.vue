<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

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

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const { formatFecha } = useFormatters()
const permissionsStore = usePermissionsStore()

const tab = ref('config')
const tabs = [
  { label: 'Mis pasarelas', value: 'config', icon: 'i-lucide-plug-zap' },
  { label: 'API Keys', value: 'keys', icon: 'i-lucide-key-round' },
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
  // Write-only: la configuración solo viaja si el usuario la tipeó. El backend
  // reemplaza el JSON completo (no mergea), así que en modo individual exigimos
  // las 3 credenciales juntas para no borrar las no reingresadas.
  if (tocoCredenciales.value) {
    if (form.value.modoIntegracion === 'mall') {
      payload.configuracion = { commerceCodeHijo: form.value.commerceCodeHijo }
    }
    else {
      const cred = form.value.credencialesIndividual
      if (!cred.mallCommerceCode || !cred.apiKeySecret || !cred.commerceCodeHijo) {
        toast.add({
          title: 'En modo individual debes reingresar las 3 credenciales juntas',
          color: 'warning',
        })
        return
      }
      payload.configuracion = { ...cred }
    }
  }
  savingConfig.value = true
  try {
    if (editingId.value) {
      const saved = await useApiFetch<Partial<TenantPasarelaRow> & { tenantPasarelaId: string }>(
        `${apiUrl}/pasarela/admin/config/${editingId.value}`,
        { method: 'PATCH', body: payload },
      )
      const idx = configs.value.findIndex(c => c.tenantPasarelaId === saved.tenantPasarelaId)
      if (idx >= 0) {
        configs.value[idx] = { ...configs.value[idx], ...saved }
      }
    }
    else {
      const saved = await useApiFetch<TenantPasarelaRow>(
        `${apiUrl}/pasarela/admin/config`,
        { method: 'POST', body: payload },
      )
      configs.value = [...configs.value, saved]
    }
    toast.add({ title: 'Pasarela guardada', color: 'success' })
    drawerOpen.value = false
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
    const id = eliminandoConfig.value.tenantPasarelaId
    await useApiFetch(
      `${apiUrl}/pasarela/admin/config/${id}`,
      { method: 'DELETE' },
    )
    configs.value = configs.value.filter(c => c.tenantPasarelaId !== id)
    toast.add({ title: 'Pasarela eliminada', color: 'success' })
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
    const res = await useApiFetch<ApiKeyRow & { apiKey: string }>(
      `${apiUrl}/pasarela/admin/api-keys`,
      {
        method: 'POST',
        body: { nombre: nuevaKeyNombre.value },
      },
    )
    keyCreada.value = res.apiKey
    const { apiKey: _apiKey, ...row } = res
    keys.value = [row, ...keys.value]
    crearKeyOpen.value = false
    keyCreadaModal.value = true
    nuevaKeyNombre.value = ''
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
    const res = await useApiFetch<{ apiKeyId: string, revocadaEl: string }>(
      `${apiUrl}/pasarela/admin/api-keys/${revocando.value.apiKeyId}`,
      { method: 'DELETE' },
    )
    const idx = keys.value.findIndex(k => k.apiKeyId === res.apiKeyId)
    if (idx >= 0) {
      keys.value[idx] = { ...keys.value[idx], revocadaEl: res.revocadaEl }
    }
    toast.add({ title: 'API key revocada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al revocar'), color: 'error' })
  }
  finally {
    revocarOpen.value = false
  }
}

onMounted(() => {
  cargarConfig()
  cargarKeys()
})

function subtituloConfig(c: TenantPasarelaRow): string {
  const modo = c.modoIntegracion === 'mall' ? 'Mall' : 'Individual'
  const ambiente = c.ambiente === 'pruebas' ? 'Pruebas' : 'Producción'
  return `${modo} · ${ambiente} · prioridad ${c.prioridad}`
}

const configColumns: TableColumn<TenantPasarelaRow>[] = [
  { accessorKey: 'nombre', header: 'Pasarela' },
  { id: 'estado', header: 'Estado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const keyColumns: TableColumn<ApiKeyRow>[] = [
  { accessorKey: 'nombre', header: 'API key' },
  { id: 'ultimoUso', header: 'Último uso' },
  { id: 'estado', header: 'Estado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
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

      <CrudTable :data="configs" :columns="configColumns" :loading="loadingConfig">
        <template #nombre-cell="{ row }">
          <CrudListItem
            :title="row.original.nombre"
            :subtitle="subtituloConfig(row.original)"
          />
        </template>

        <template #estado-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge v-if="!row.original.tieneCredenciales" color="warning" variant="subtle">
              Sin credenciales
            </UBadge>
            <UBadge :color="row.original.activo ? 'success' : 'neutral'" variant="subtle">
              {{ row.original.activo ? 'Activa' : 'Inactiva' }}
            </UBadge>
          </div>
        </template>

        <template #acciones-cell="{ row }">
          <div class="flex justify-end gap-1">
            <UButton
              v-if="permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Actualizar')"
              icon="i-lucide-square-pen"
              color="neutral"
              variant="ghost"
              aria-label="Editar"
              @click="abrirEditar(row.original)"
            />
            <UButton
              v-if="permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Eliminar')"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              aria-label="Eliminar"
              @click="eliminandoConfig = row.original; eliminarConfigOpen = true"
            />
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            Aún no tienes pasarelas configuradas.
          </div>
        </template>
      </CrudTable>
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

      <CrudTable :data="keys" :columns="keyColumns" :loading="loadingKeys">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
            <p class="text-sm text-muted font-mono">
              {{ row.original.prefijo }}
            </p>
          </div>
        </template>

        <template #ultimoUso-cell="{ row }">
          <span class="text-sm text-muted">
            {{ row.original.ultimoUsoEl ? formatFecha(row.original.ultimoUsoEl) : 'nunca' }}
          </span>
        </template>

        <template #estado-cell="{ row }">
          <UBadge :color="row.original.revocadaEl ? 'neutral' : 'success'" variant="subtle">
            {{ row.original.revocadaEl ? 'Revocada' : 'Activa' }}
          </UBadge>
        </template>

        <template #acciones-cell="{ row }">
          <div class="flex justify-end gap-1">
            <UButton
              v-if="!row.original.revocadaEl && (permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Eliminar'))"
              icon="i-lucide-ban"
              color="error"
              variant="ghost"
              aria-label="Revocar"
              @click="revocando = row.original; revocarOpen = true"
            />
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            Sin API keys. Crea una para conectar tus apps externas.
          </div>
        </template>
      </CrudTable>
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
