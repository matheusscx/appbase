<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

// La lectura es abierta (`Terceros:Leer`), pero cada escritura pega a un
// endpoint con su propio `@RequiresPermiso`. Sin gatear, el usuario llena el
// drawer entero para recibir un 403.
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Terceros')

interface Tercero {
  id: string
  tipo: string
  nombre: string
  rut: string | null
  nombreLegal: string | null
  rutFiscal: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  activo: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('terceros')

const terceros = ref<Tercero[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)
const toggling = reactive(new Set<string>())

const tipoOptions = [
  { label: 'Proveedor', value: 'proveedor' },
  { label: 'Empresa', value: 'empresa' },
  { label: 'Persona natural', value: 'persona_natural' },
]

const emptyForm = () => ({
  tipo: 'proveedor',
  nombre: '',
  rut: '',
  nombreLegal: '',
  rutFiscal: '',
  correo: '',
  telefono: '',
  direccion: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar tercero' : 'Nuevo tercero',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

function tipoLabel(value: string) {
  return tipoOptions.find(o => o.value === value)?.label ?? value
}

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `terceros.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del
// switch. Esta pantalla no usa `usePaginatedList`, así que no hereda la cola
// que vive ahí: va local.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      terceros.value = await useApiFetch<Tercero[]>(`${apiUrl}/terceros${query}`)
    }
    catch (e: unknown) {
      const msg = apiErrorMsg(e, 'Error al cargar terceros')
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

function upsertLocal(saved: Tercero) {
  const idx = terceros.value.findIndex(t => t.id === saved.id)
  if (idx >= 0) {
    terceros.value[idx] = { ...terceros.value[idx], ...saved }
  }
  else {
    terceros.value.push(saved)
  }
  terceros.value = [...terceros.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  terceros.value = terceros.value.filter(t => t.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(tercero: Tercero) {
  if (tercero.eliminadoEl) return
  resetDrawer()
  editingId.value = tercero.id
  form.value = {
    tipo: tercero.tipo,
    nombre: tercero.nombre,
    rut: tercero.rut ?? '',
    nombreLegal: tercero.nombreLegal ?? '',
    rutFiscal: tercero.rutFiscal ?? '',
    correo: tercero.correo ?? '',
    telefono: tercero.telefono ?? '',
    direccion: tercero.direccion ?? '',
    activo: tercero.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      tipo: form.value.tipo,
      nombre: form.value.nombre,
      rut: form.value.rut || undefined,
      nombreLegal: form.value.nombreLegal || undefined,
      rutFiscal: form.value.rutFiscal || undefined,
      correo: form.value.correo || undefined,
      telefono: form.value.telefono || undefined,
      direccion: form.value.direccion || undefined,
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Tercero>(`${apiUrl}/terceros`, { method: 'POST', body })
      : await useApiFetch<Tercero>(`${apiUrl}/terceros/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Tercero creado' : 'Tercero actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(tercero: Tercero) {
  if (tercero.eliminadoEl) return
  if (toggling.has(tercero.id)) return
  toggling.add(tercero.id)
  const prev = tercero.activo
  tercero.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/terceros/${tercero.id}`, {
      method: 'PATCH',
      body: { activo: tercero.activo },
    })
    toast.add({ title: tercero.activo ? 'Tercero activado' : 'Tercero desactivado', color: 'success' })
  }
  catch (e: unknown) {
    tercero.activo = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(tercero.id)
  }
}

function pedirEliminar(tercero: Tercero) {
  if (tercero.eliminadoEl) return
  confirmDeleteId.value = tercero.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/terceros/${id}`, {
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
    toast.add({ title: 'Tercero eliminado', color: 'success' })
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
}

/**
 * Restaura un tercero de la papelera. A diferencia de `descuentos.vue`, acá no
 * hay colisión que resolver: `terceros` no tiene unicidad de nombre y
 * `POST /terceros/:id/restaurar` ni siquiera acepta body — el catch solo tiene
 * la rama de error terminal (toast), no hay segundo modal que abrir.
 */
async function restaurarTercero(id: string) {
  // Guard de reentrancia: el modal no se cierra solo al confirmar, así que
  // mientras el POST viaja un segundo click mandaría otro `POST .../restaurar`
  // sobre una fila ya revivida → 404 → toast de ERROR encima de un éxito.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id)
    const t = terceros.value.find(x => x.id === id)
    if (t) {
      t.eliminadoEl = null
      t.eliminadoPorNombre = null
    }
    toast.add({ title: 'Tercero restaurado', color: 'success' })
    cerrarRestaurar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al restaurar'), color: 'error' })
    cerrarRestaurar()
  }
  finally {
    restaurando.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<Tercero>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'contacto', header: 'Contacto' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Terceros" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Terceros"
          description="Directorio de proveedores, empresas y personas naturales recurrentes."
        >
          <template #actions>
            <div class="flex items-center gap-4">
              <!-- El toggle solo si puede restaurar: sin `Terceros:Eliminar`
                   el backend rechaza el restaurar, así que mostrar la
                   papelera sería ofrecer una acción que termina en 403. -->
              <div v-if="puedeEliminar" class="flex items-center gap-2">
                <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
                <span class="text-sm text-muted">Ver eliminados</span>
              </div>
              <UButton
                v-if="puedeCrear"
                icon="i-lucide-plus"
                @click="abrirCrear"
              >
                Nuevo tercero
              </UButton>
            </div>
          </template>
        </CrudPageHeader>

        <CrudTable :data="terceros" :columns="columns" :loading="loading">
          <template #nombre-cell="{ row }">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <CrudListItem
                  :title="row.original.nombre"
                  :subtitle="tipoLabel(row.original.tipo) + (row.original.rut ? ' · ' + row.original.rut : '')"
                />
                <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
                  Eliminado
                </UBadge>
              </div>
              <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
                {{ formatearBorradoPor(row.original) }}
              </p>
            </div>
          </template>

          <template #contacto-cell="{ row }">
            <div class="text-sm text-muted">
              <p v-if="row.original.correo">{{ row.original.correo }}</p>
              <p v-if="row.original.telefono">{{ row.original.telefono }}</p>
              <p v-if="!row.original.correo && !row.original.telefono">—</p>
            </div>
          </template>

          <template #activo-cell="{ row }">
            <div class="flex justify-end">
              <USwitch
                :model-value="row.original.activo"
                :disabled="toggling.has(row.original.id) || !puedeActualizar || !!row.original.eliminadoEl"
                @update:model-value="toggleActivo(row.original)"
              />
            </div>
          </template>

          <template #acciones-cell="{ row }">
            <div v-if="row.original.eliminadoEl" class="flex justify-end">
              <UButton
                v-if="puedeEliminar"
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
                v-if="puedeActualizar"
                icon="i-lucide-square-pen"
                color="neutral"
                variant="ghost"
                title="Editar"
                @click="abrirEditar(row.original)"
              />
              <UButton
                v-if="puedeEliminar"
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
              No hay terceros registrados.
            </div>
          </template>
        </CrudTable>

        <AppDrawer v-model:open="drawerOpen" width="50%">
          <template #header>
            <span class="font-semibold text-default">{{ drawerTitle }}</span>
          </template>

          <template #body>
            <UForm
              id="tercero-form"
              :state="form"
              class="space-y-4"
              @submit="guardar"
            >
              <UFormField label="Tipo" required>
                <USelectMenu
                  v-model="form.tipo"
                  :items="tipoOptions"
                  value-key="value"
                />
              </UFormField>
              <UFormField label="Nombre" required>
                <UInput
                  v-model="form.nombre"
                  placeholder="Distribuidora Andina"
                  autofocus
                />
              </UFormField>
              <UFormField label="RUT">
                <UInput v-model="form.rut" placeholder="76.123.456-7" />
              </UFormField>
              <UFormField label="Nombre legal (razón social)">
                <UInput v-model="form.nombreLegal" placeholder="Distribuidora Andina SpA" />
              </UFormField>
              <UFormField label="RUT fiscal">
                <UInput v-model="form.rutFiscal" placeholder="76.123.456-7" />
              </UFormField>
              <UFormField label="Correo">
                <UInput v-model="form.correo" type="email" placeholder="contacto@empresa.cl" />
              </UFormField>
              <UFormField label="Teléfono">
                <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
              </UFormField>
              <UFormField label="Dirección">
                <UTextarea v-model="form.direccion" :rows="2" />
              </UFormField>
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
              form="tercero-form"
              :loading="saving"
            >
              {{ submitLabel }}
            </UButton>
          </template>
        </AppDrawer>

        <CrudModal
          v-model:open="confirmModalOpen"
          title="Eliminar tercero"
          message="¿Eliminar este tercero? Podés recuperarlo desde «Ver eliminados»."
          @cancel="confirmDeleteId = null"
          @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
        />

        <CrudModal
          v-model:open="confirmRestaurarModalOpen"
          title="Restaurar tercero"
          message="¿Restaurar este tercero? Volverá a aparecer en el listado y podrá usarse de nuevo."
          confirm-label="Restaurar"
          confirm-color="neutral"
          :loading="restaurando"
          @cancel="cerrarRestaurar"
          @confirm="confirmRestaurarId && restaurarTercero(confirmRestaurarId)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
