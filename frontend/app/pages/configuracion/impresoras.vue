<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Impresora, RolImpresora, TipoConexionImpresora } from '~/composables/useImpresoras'

// La lectura es abierta (`Impresoras:Leer`), pero cada escritura pega a un
// endpoint con su propio `@RequiresPermiso`.
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Impresoras')

const toast = useToast()
const impresorasApi = useImpresoras()

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('impresoras')

const impresoras = ref<Impresora[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const toggling = reactive(new Set<string>())

const rolOptions: { label: string, value: RolImpresora }[] = [
  { label: 'Comanda (cocina/barra)', value: 'comanda' },
  { label: 'Boleta / precuenta', value: 'boleta' },
]
const tipoConexionOptions: { label: string, value: TipoConexionImpresora }[] = [
  { label: 'Red (host + puerto)', value: 'red' },
  { label: 'Sistema (cola instalada)', value: 'sistema' },
]

const emptyForm = () => ({
  nombre: '',
  rol: 'comanda' as RolImpresora,
  tipoConexion: 'red' as TipoConexionImpresora,
  host: '',
  puerto: '9100',
  nombreCola: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() => editingId.value ? 'Editar impresora' : 'Nueva impresora')
const submitLabel = computed(() => editingId.value ? 'Guardar' : 'Crear')

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => { if (!open) resetDrawer() })

function rolLabel(rol: RolImpresora) {
  return rolOptions.find(o => o.value === rol)?.label ?? rol
}

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `impresoras.value` sin
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
      impresoras.value = await impresorasApi.listar(undefined, verEliminados.value)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar impresoras'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: Impresora) {
  const idx = impresoras.value.findIndex(i => i.id === saved.id)
  if (idx >= 0) {
    impresoras.value[idx] = { ...impresoras.value[idx], ...saved }
  }
  else {
    impresoras.value.push(saved)
  }
  impresoras.value = [...impresoras.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  impresoras.value = impresoras.value.filter(i => i.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(imp: Impresora) {
  if (imp.eliminadoEl) return
  resetDrawer()
  editingId.value = imp.id
  form.value = {
    nombre: imp.nombre,
    rol: imp.rol,
    tipoConexion: imp.tipoConexion,
    host: imp.host ?? '',
    puerto: imp.puerto ? String(imp.puerto) : '9100',
    nombreCola: imp.nombreCola ?? '',
    activo: imp.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      rol: form.value.rol,
      tipoConexion: form.value.tipoConexion,
      host: form.value.tipoConexion === 'red' ? form.value.host : undefined,
      puerto: form.value.tipoConexion === 'red' ? Number(form.value.puerto) : undefined,
      nombreCola: form.value.tipoConexion === 'sistema' ? form.value.nombreCola : undefined,
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await impresorasApi.crear(body)
      : await impresorasApi.actualizar(editingId.value!, body)
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Impresora creada' : 'Impresora actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la impresora'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// ── Eliminar ────────────────────────────────────────────────────────────────
const deleteOpen = ref(false)
const toDelete = ref<Impresora | null>(null)

function confirmarEliminar(imp: Impresora) {
  if (imp.eliminadoEl) return
  toDelete.value = imp
  deleteOpen.value = true
}

async function eliminar() {
  if (!toDelete.value) return
  try {
    const id = toDelete.value.id
    await impresorasApi.eliminar(id)
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
    toast.add({ title: 'Impresora eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    deleteOpen.value = false
    toDelete.value = null
  }
}

async function toggleActivo(imp: Impresora) {
  if (imp.eliminadoEl) return
  if (toggling.has(imp.id)) return
  toggling.add(imp.id)
  const prev = imp.activo
  imp.activo = !prev
  try {
    const saved = await impresorasApi.actualizar(imp.id, { activo: imp.activo })
    upsertLocal(saved)
    toast.add({
      title: saved.activo ? 'Impresora activada' : 'Impresora desactivada',
      color: 'success',
    })
  }
  catch (e: unknown) {
    imp.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(imp.id)
  }
}

// ── Restaurar ────────────────────────────────────────────────────────────────
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)

function cerrarRestaurar() {
  confirmRestaurarId.value = null
  confirmRestaurarModalOpen.value = false
}

/**
 * Restaura una impresora de la papelera. A diferencia de `configuracion/
 * turnos.vue`, acá no hay colisión que resolver: `impresoras` no tiene
 * unicidad de nombre y `POST /impresoras/:id/restaurar` ni siquiera acepta
 * body — el catch solo tiene la rama de error terminal (toast), no hay
 * segundo modal que abrir.
 */
async function restaurarImpresora(id: string) {
  // Guard de reentrancia: el modal no se cierra solo al confirmar, así que
  // mientras el POST viaja un segundo click mandaría otro `POST .../restaurar`
  // sobre una fila ya revivida → 404 → toast de ERROR encima de un éxito.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id)
    const imp = impresoras.value.find(x => x.id === id)
    if (imp) {
      imp.eliminadoEl = null
      imp.eliminadoPorNombre = null
    }
    toast.add({ title: 'Impresora restaurada', color: 'success' })
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

const columns: TableColumn<Impresora>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'conexion', header: 'Conexión' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Impresoras"
      description="Configura las impresoras térmicas para comandas de cocina/barra y para boletas/precuenta."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <!-- El toggle solo si puede restaurar: sin `Impresoras:Eliminar`
               el backend rechaza el restaurar, así que mostrar la papelera
               sería ofrecer una acción que termina en 403. -->
          <div v-if="puedeEliminar" class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
            Nueva impresora
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="impresoras" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <CrudListItem :title="row.original.nombre" :subtitle="rolLabel(row.original.rol)" />
            <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
              Eliminado
            </UBadge>
          </div>
          <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
            {{ formatearBorradoPor(row.original) }}
          </p>
        </div>
      </template>

      <template #conexion-cell="{ row }">
        <span class="text-sm text-muted">
          <template v-if="row.original.tipoConexion === 'red'">
            {{ row.original.host }}:{{ row.original.puerto }}
          </template>
          <template v-else>
            Cola: {{ row.original.nombreCola }}
          </template>
        </span>
      </template>

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <!--
            Deshabilitado, no escondido: este switch además MUESTRA si la
            impresora está activa. Esconderlo le borraría el dato a quien puede
            leerlo. El permiso se suma a la condición que ya existía.
          -->
          <USwitch
            :model-value="row.original.activo"
            :disabled="toggling.has(row.original.id) || !puedeActualizar || !!row.original.eliminadoEl"
            aria-label="Activar o desactivar impresora"
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
        <div v-else class="flex justify-end gap-1">
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            aria-label="Editar"
            @click="abrirEditar(row.original)"
          />
          <UButton
            v-if="puedeEliminar"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            aria-label="Eliminar"
            @click="confirmarEliminar(row.original)"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay impresoras configuradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="impresora-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Cocina" autofocus />
          </UFormField>
          <UFormField label="Rol">
            <USelectMenu v-model="form.rol" :items="rolOptions" value-key="value" />
          </UFormField>
          <UFormField label="Tipo de conexión">
            <USelectMenu v-model="form.tipoConexion" :items="tipoConexionOptions" value-key="value" />
          </UFormField>

          <template v-if="form.tipoConexion === 'red'">
            <UFormField label="Host / IP" required>
              <UInput v-model="form.host" placeholder="192.168.1.50" />
            </UFormField>
            <UFormField label="Puerto" required>
              <UInput v-model="form.puerto" inputmode="decimal" placeholder="9100" />
            </UFormField>
          </template>
          <template v-else>
            <UFormField label="Nombre de la cola" required>
              <UInput v-model="form.nombreCola" placeholder="EPSON_TM_T20" />
            </UFormField>
          </template>

          <UFormField label="Activa">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton type="submit" form="impresora-form" :loading="saving">
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="deleteOpen"
      title="Eliminar impresora"
      message="¿Estás seguro de que quieres eliminar esta impresora? Las categorías que la usan quedarán sin ruta de comanda. Podés recuperarla desde «Ver eliminados»."
      @cancel="toDelete = null"
      @confirm="eliminar"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar impresora"
      message="¿Restaurar esta impresora? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarImpresora(confirmRestaurarId)"
    />
  </div>
</template>
