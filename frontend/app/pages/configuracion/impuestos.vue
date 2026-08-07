<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface Impuesto {
  id: string
  nombre: string
  porcentaje: string
  activo: boolean
  origen: 'sistema' | 'personalizado'
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('impuestos')

const impuestos = ref<Impuesto[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)

// ── Pausar: confirmación con el alcance ─────────────────────────────────────
const {
  toggling,
  confirmPausarNombre,
  confirmPausarItems,
  confirmPausarModalOpen,
  toggleActivo: pausarOReactivar,
  cerrarPausar,
  confirmarPausar,
} = usePausaRegla('impuestos', 'Impuesto', impuestos)

// El catálogo oficial no se pausa: es regla de impuestos, no de pausar, así que
// el guard vive acá y no en el composable. El switch ya no se rinde para esas
// filas (`v-if` en la tabla); esto lo sostiene si alguien saca ese `v-if`.
async function toggleActivo(imp: Impuesto) {
  if (imp.origen === 'sistema') return
  await pausarOReactivar(imp)
}

const emptyForm = () => ({
  nombre: '',
  porcentaje: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar impuesto' : 'Nuevo impuesto',
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

// Cola serial, mismo patrón que `configuracion/categorias.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `impuestos.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del
// switch. Esta pantalla NO usa `usePaginatedList`, así que no hereda la cola
// que vive ahí: va local, como en categorías.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      impuestos.value = await useApiFetch<Impuesto[]>(`${apiUrl}/impuestos${query}`)
    }
    catch (e: unknown) {
      const msg = apiErrorMsg(e, 'Error al cargar impuestos')
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

function upsertLocal(saved: Impuesto) {
  const idx = impuestos.value.findIndex(i => i.id === saved.id)
  if (idx >= 0) {
    impuestos.value[idx] = { ...impuestos.value[idx], ...saved }
  }
  else {
    impuestos.value.push(saved)
  }
  impuestos.value = [...impuestos.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  impuestos.value = impuestos.value.filter(i => i.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(imp: Impuesto) {
  if (imp.origen === 'sistema' || imp.eliminadoEl) return
  resetDrawer()
  editingId.value = imp.id
  form.value = {
    nombre: imp.nombre,
    porcentaje: imp.porcentaje,
    activo: imp.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      porcentaje: form.value.porcentaje,
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Impuesto>(`${apiUrl}/impuestos`, { method: 'POST', body })
      : await useApiFetch<Impuesto>(`${apiUrl}/impuestos/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    // El backend no incluye `origen` en la respuesta de POST/PATCH (solo en GET);
    // toda fila que llega aquí es siempre personalizada (las de sistema no
    // pasan por este form, ver guard en abrirEditar).
    upsertLocal({ ...saved, origen: 'personalizado' })
    toast.add({ title: isNew ? 'Impuesto creado' : 'Impuesto actualizado', color: 'success' })
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

function pedirEliminar(imp: Impuesto) {
  if (imp.origen === 'sistema' || imp.eliminadoEl) return
  confirmDeleteId.value = imp.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/impuestos/${id}`, {
      method: 'DELETE',
    })
    // Con la papelera abierta la fila no desaparece: pasa a "eliminado" con su
    // autor y fecha. El DELETE no devuelve esos datos —solo llegan en el
    // próximo GET con el flag—, así que acá hace falta recargar en vez del
    // patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      removeLocal(id)
    }
    toast.add({ title: 'Impuesto eliminado', color: 'success' })
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

async function restaurarImpuesto(id: string) {
  // Mismo guard de `origen` que editar/eliminar/togglear: el catálogo oficial
  // del país no es del tenant, y el listado de la papelera SÍ devuelve esas
  // filas (vienen por la rama `pais_id` del `OR`), así que sin el guard la UI
  // ofrecería un botón que el backend rechaza con 404 por diseño.
  //
  // ⚠️ Este guard de `origen` es INALCANZABLE desde el template de hoy —la
  // rama de "Restaurar" ya exige `origen === 'personalizado'`—, y por eso NO
  // tiene test propio: cualquiera que se escriba pasaría sin poder fallar. Se
  // deja igual, como la capa que sobrevive si alguien afloja la condición del
  // template. Mismo criterio en los guards de `abrirEditar`, `toggleActivo` y
  // `pedirEliminar`.
  const imp = impuestos.value.find(i => i.id === id)
  if (!imp || imp.origen === 'sistema') return
  // El de reentrancia, en cambio, SÍ tiene test, porque la conducta que fija
  // es alcanzable: el modal no se cierra solo al confirmar (lo cierra el
  // `finally` de acá), así que mientras el POST viaja el segundo click manda
  // un segundo `POST /restaurar` sobre una fila que el primero ya revivió, el
  // backend contesta 404 "no está en la papelera" y el usuario ve un toast de
  // ERROR inmediatamente después de un restore exitoso.
  //
  // ⚠️ Corrección de lo que decía antes acá: este guard NO es lo único que lo
  // impide. Medido con mutantes sobre `descuentos.vue` (mismo molde): el
  // `:loading="restaurando"` del modal ya deshabilita el botón, así que sacar
  // cualquiera de los dos por separado deja el test en verde. El test fija la
  // conducta —un solo POST—, no cuál de las dos capas la sostiene.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id)
    imp.eliminadoEl = null
    imp.eliminadoPorNombre = null
    toast.add({ title: 'Impuesto restaurado', color: 'success' })
  }
  catch (e: unknown) {
    // El error del backend sube tal cual (404 "no está en la papelera"): trae
    // más información que un genérico.
    const msg = apiErrorMsg(e, 'Error al restaurar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    restaurando.value = false
    confirmRestaurarId.value = null
    confirmRestaurarModalOpen.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<Impuesto>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Impuestos"
      description="Impuestos oficiales del país (Sistema) e impuestos propios del tenant (en decimal: 0.19 = 19%)."
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
            Nuevo impuesto
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="impuestos" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <CrudListItem
              :title="row.original.nombre"
              :subtitle="`Porcentaje: ${row.original.porcentaje}`"
            />
            <UBadge
              :label="row.original.origen === 'sistema' ? 'Sistema' : 'Personalizado'"
              :color="row.original.origen === 'sistema' ? 'info' : 'neutral'"
              variant="soft"
              size="sm"
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

        <template #activo-cell="{ row }">
          <div class="flex justify-end">
            <USwitch
              v-if="row.original.origen === 'personalizado'"
              :model-value="row.original.activo"
              :disabled="toggling.has(row.original.id) || !!row.original.eliminadoEl"
              @update:model-value="toggleActivo(row.original)"
            />
          </div>
        </template>

        <template #acciones-cell="{ row }">
          <!-- `&& origen === 'personalizado'`: el catálogo oficial del país
               aparece en el listado de la papelera pero no se restaura (ver
               `restaurarImpuesto`). Sin esta condición la fila cae acá y no en
               la rama de abajo, o sea perdería también su "Catálogo oficial". -->
          <div
            v-if="row.original.eliminadoEl && row.original.origen === 'personalizado'"
            class="flex justify-end"
          >
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
            <template v-if="row.original.origen === 'personalizado'">
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
            </template>
            <span v-else class="text-xs text-muted">Catálogo oficial</span>
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay impuestos registrados.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="impuesto-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <!-- El error caro se comete acá, no en el ítem: nombrar "IVA" a un
               impuesto propio lo suma al IVA automático (38%). No se bloquea la
               creación —el tenant es dueño de su catálogo y la heurística de
               nombre tiene falsos positivos—, se avisa. Ver ADR-018. -->
          <UFormField required>
            <template #label>
              <span class="inline-flex items-center gap-1">
                Nombre
                <AppInfoButton title="El IVA no se crea acá">
                  <div class="space-y-3">
                    <p>
                      El IVA sale de la clasificación tributaria de cada ítem
                      (Afecto / Exento) y el sistema lo aplica solo.
                    </p>
                    <p>
                      Si creás acá un impuesto llamado «IVA», se va a
                      <span class="font-medium text-default">sumar</span> al
                      automático y vas a cobrar de más.
                    </p>
                    <p>
                      Esta pantalla es para los demás impuestos —verde, específicos,
                      municipales—, que sí se aplican tanto a ítems afectos como
                      exentos.
                    </p>
                  </div>
                </AppInfoButton>
              </span>
            </template>
            <UInput
              v-model="form.nombre"
              placeholder="Impuesto verde"
              autofocus
            />
          </UFormField>
          <UFormField label="Porcentaje (decimal)" required>
            <UInput
              v-model="form.porcentaje"
              inputmode="decimal"
              placeholder="0.05"
            />
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
          form="impuesto-form"
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

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar impuesto"
      message="¿Eliminar este impuesto? Podés recuperarlo desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar impuesto"
      message="¿Restaurar este impuesto? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="confirmRestaurarId = null"
      @confirm="confirmRestaurarId && restaurarImpuesto(confirmRestaurarId)"
    />
  </div>
</template>
