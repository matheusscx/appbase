<script setup lang="ts">
import type { SalonConMesas, MesaResumen, FormaMesa, TamanoMesa } from '~/composables/useSalones'
import { FORMA_MESA_OPTIONS, TAMANO_MESA_OPTIONS } from '~/composables/useSalones'

const toast = useToast()
const salonesApi = useSalones()

const salones = ref<SalonConMesas[]>([])
const loading = ref(false)
const selectedSalonId = ref<string | undefined>(undefined)

// Copia local editable de las mesas del salón seleccionado (posiciones drag).
const localMesas = ref<MesaResumen[]>([])
const savingLayout = ref(false)

const selectedSalon = computed(() =>
  salones.value.find(s => s.id === selectedSalonId.value) ?? null,
)

const salonItems = computed(() =>
  salones.value.map(s => ({ label: s.nombre, value: s.id })),
)

function syncLocalMesas() {
  localMesas.value = (selectedSalon.value?.mesas ?? []).map(m => ({ ...m }))
}

function patchSalonMesas(salonId: string, mesas: MesaResumen[]) {
  const salon = salones.value.find(s => s.id === salonId)
  if (!salon) return
  salon.mesas = mesas.map(m => ({ ...m }))
  if (selectedSalonId.value === salonId) syncLocalMesas()
}

async function cargar() {
  loading.value = true
  try {
    salones.value = await salonesApi.listarSalones()
    if (!selectedSalonId.value || !selectedSalon.value) {
      selectedSalonId.value = salones.value[0]?.id ?? undefined
    }
    syncLocalMesas()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar salones'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

watch(selectedSalonId, syncLocalMesas)

onMounted(cargar)

// ── Drag & drop de posiciones ──────────────────────────────────────────────
function onMove(mesaId: string, posX: number, posY: number) {
  const mesa = localMesas.value.find(m => m.id === mesaId)
  if (!mesa) return
  mesa.posX = posX.toFixed(5)
  mesa.posY = posY.toFixed(5)
}

async function guardarDistribucion() {
  if (!selectedSalonId.value) return
  savingLayout.value = true
  try {
    await salonesApi.guardarLayout(
      selectedSalonId.value,
      localMesas.value.map(m => ({
        mesaId: m.id,
        posX: Number(m.posX),
        posY: Number(m.posY),
      })),
    )
    patchSalonMesas(selectedSalonId.value, localMesas.value)
    toast.add({ title: 'Distribución guardada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la distribución'), color: 'error' })
  }
  finally {
    savingLayout.value = false
  }
}

// ── CRUD salón ─────────────────────────────────────────────────────────────
const salonDrawerOpen = ref(false)
const salonEditingId = ref<string | null>(null)
const salonForm = ref({ nombre: '' })
const savingSalon = ref(false)
const deleteSalonOpen = ref(false)

const salonDrawerTitle = computed(() =>
  salonEditingId.value ? 'Editar salón' : 'Nuevo salón',
)

function abrirCrearSalon() {
  salonEditingId.value = null
  salonForm.value = { nombre: '' }
  salonDrawerOpen.value = true
}

function abrirEditarSalon() {
  if (!selectedSalon.value) return
  salonEditingId.value = selectedSalon.value.id
  salonForm.value = { nombre: selectedSalon.value.nombre }
  salonDrawerOpen.value = true
}

async function guardarSalon() {
  savingSalon.value = true
  try {
    if (salonEditingId.value) {
      const saved = await salonesApi.actualizarSalon(
        salonEditingId.value,
        salonForm.value.nombre,
      )
      const salon = salones.value.find(s => s.id === saved.id)
      if (salon) salon.nombre = saved.nombre
      salones.value = [...salones.value].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es'),
      )
      toast.add({ title: 'Salón actualizado', color: 'success' })
    }
    else {
      const saved = await salonesApi.crearSalon(salonForm.value.nombre)
      salones.value = [...salones.value, { id: saved.id, nombre: saved.nombre, mesas: [] }]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      selectedSalonId.value = saved.id
      toast.add({ title: 'Salón creado', color: 'success' })
    }
    salonDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar el salón'), color: 'error' })
  }
  finally {
    savingSalon.value = false
  }
}

async function eliminarSalon() {
  if (!selectedSalonId.value) return
  try {
    const id = selectedSalonId.value
    await salonesApi.eliminarSalon(id)
    salones.value = salones.value.filter(s => s.id !== id)
    selectedSalonId.value = salones.value[0]?.id
    syncLocalMesas()
    toast.add({ title: 'Salón eliminado', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar el salón'), color: 'error' })
  }
  finally {
    deleteSalonOpen.value = false
  }
}

// ── CRUD mesa ──────────────────────────────────────────────────────────────
const mesaDrawerOpen = ref(false)
const mesaEditingId = ref<string | null>(null)
const mesaForm = ref<{ nombre: string, forma: FormaMesa, tamano: TamanoMesa }>({
  nombre: '',
  forma: 'cuadrada',
  tamano: 'mediano',
})
const savingMesa = ref(false)
const deleteMesaOpen = ref(false)
const mesaToDelete = ref<MesaResumen | null>(null)

const mesaDrawerTitle = computed(() =>
  mesaEditingId.value ? 'Editar mesa' : 'Nueva mesa',
)

function abrirCrearMesa() {
  mesaEditingId.value = null
  mesaForm.value = { nombre: '', forma: 'cuadrada', tamano: 'mediano' }
  mesaDrawerOpen.value = true
}

function abrirEditarMesa(mesa: MesaResumen) {
  mesaEditingId.value = mesa.id
  mesaForm.value = { nombre: mesa.nombre, forma: mesa.forma, tamano: mesa.tamano }
  mesaToDelete.value = mesa
  mesaDrawerOpen.value = true
}

function eliminarMesaDesdeDrawer() {
  mesaDrawerOpen.value = false
  deleteMesaOpen.value = true
}

async function guardarMesa() {
  if (!selectedSalonId.value) return
  savingMesa.value = true
  try {
    const salonId = selectedSalonId.value
    const salon = salones.value.find(s => s.id === salonId)
    if (!salon) return

    if (mesaEditingId.value) {
      const saved = await salonesApi.actualizarMesa(mesaEditingId.value, {
        nombre: mesaForm.value.nombre,
        forma: mesaForm.value.forma,
        tamano: mesaForm.value.tamano,
      })
      const idx = salon.mesas.findIndex(m => m.id === saved.id)
      if (idx >= 0) {
        salon.mesas[idx] = {
          ...salon.mesas[idx],
          nombre: saved.nombre,
          posX: saved.posX,
          posY: saved.posY,
          forma: saved.forma,
          tamano: saved.tamano,
        }
      }
      syncLocalMesas()
      toast.add({ title: 'Mesa actualizada', color: 'success' })
    }
    else {
      const saved = await salonesApi.crearMesa(salonId, {
        nombre: mesaForm.value.nombre,
        posX: 0.5,
        posY: 0.5,
        forma: mesaForm.value.forma,
        tamano: mesaForm.value.tamano,
      })
      salon.mesas.push({
        id: saved.id,
        nombre: saved.nombre,
        posX: saved.posX,
        posY: saved.posY,
        forma: saved.forma,
        tamano: saved.tamano,
        cuentasAbiertas: 0,
        ocupada: false,
      })
      syncLocalMesas()
      toast.add({ title: 'Mesa creada', color: 'success' })
    }
    mesaDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la mesa'), color: 'error' })
  }
  finally {
    savingMesa.value = false
  }
}

async function eliminarMesa() {
  if (!mesaToDelete.value || !selectedSalonId.value) return
  try {
    const mesaId = mesaToDelete.value.id
    await salonesApi.eliminarMesa(mesaId)
    const salon = salones.value.find(s => s.id === selectedSalonId.value)
    if (salon) {
      salon.mesas = salon.mesas.filter(m => m.id !== mesaId)
      syncLocalMesas()
    }
    toast.add({ title: 'Mesa eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar la mesa'), color: 'error' })
  }
  finally {
    deleteMesaOpen.value = false
    mesaToDelete.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Salones y mesas"
      description="Configura los salones del local y la distribución de sus mesas."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrearSalon">
          Nuevo salón
        </UButton>
      </template>
    </CrudPageHeader>

    <div v-if="loading" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader" class="h-8 w-8 animate-spin text-muted" />
    </div>

    <div v-else-if="salones.length === 0" class="py-12 text-center text-sm text-muted">
      No hay salones. Crea el primero para empezar.
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <USelectMenu
          v-model="selectedSalonId"
          :items="salonItems"
          value-key="value"
          class="w-56"
        />
        <UButton
          icon="i-lucide-square-pen"
          color="neutral"
          variant="ghost"
          @click="abrirEditarSalon"
        />
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          @click="deleteSalonOpen = true"
        />
      </div>

      <div v-if="selectedSalon" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted">Distribución del salón</span>
            <AppInfoButton title="Cómo editar el plano">
              <ul class="space-y-3">
                <li class="flex items-start gap-2">
                  <UIcon name="i-lucide-move" class="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <span>Arrastra una mesa para ubicarla en el plano.</span>
                </li>
                <li class="flex items-start gap-2">
                  <UIcon name="i-lucide-mouse-pointer-click" class="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <span>Doble click en una mesa para editarla o eliminarla.</span>
                </li>
              </ul>
            </AppInfoButton>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="savingLayout" class="flex items-center gap-1.5 text-xs text-muted">
              <UIcon name="i-lucide-loader" class="h-3.5 w-3.5 animate-spin" />
              Guardando…
            </span>
            <UButton
              icon="i-lucide-plus"
              size="sm"
              variant="soft"
              @click="abrirCrearMesa"
            >
              Agregar mesa
            </UButton>
          </div>
        </div>

        <SalonesSalonPlano
          :mesas="localMesas"
          editable
          @move="onMove"
          @edit="abrirEditarMesa"
          @dragend="guardarDistribucion"
        />
      </div>
    </template>

    <!-- Drawer salón -->
    <AppDrawer v-model:open="salonDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ salonDrawerTitle }}</span>
      </template>
      <template #body>
        <UForm id="salon-form" :state="salonForm" class="space-y-4" @submit="guardarSalon">
          <UFormField label="Nombre" required>
            <UInput v-model="salonForm.nombre" placeholder="Salón Principal" autofocus />
          </UFormField>
        </UForm>
      </template>
      <template #actions>
        <UButton color="neutral" variant="ghost" @click="salonDrawerOpen = false">
          Cancelar
        </UButton>
        <UButton type="submit" form="salon-form" :loading="savingSalon">
          {{ salonEditingId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <!-- Drawer mesa -->
    <AppDrawer v-model:open="mesaDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ mesaDrawerTitle }}</span>
      </template>
      <template #body>
        <UForm id="mesa-form" :state="mesaForm" class="space-y-4" @submit="guardarMesa">
          <UFormField label="Nombre" required>
            <UInput v-model="mesaForm.nombre" placeholder="Mesa 1" autofocus />
          </UFormField>
          <UFormField label="Forma">
            <USelectMenu
              v-model="mesaForm.forma"
              :items="FORMA_MESA_OPTIONS"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Tamaño">
            <USelectMenu
              v-model="mesaForm.tamano"
              :items="TAMANO_MESA_OPTIONS"
              value-key="value"
            />
          </UFormField>
        </UForm>
      </template>
      <template #actions>
        <UButton
          v-if="mesaEditingId"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          class="mr-auto"
          @click="eliminarMesaDesdeDrawer"
        >
          Eliminar
        </UButton>
        <UButton color="neutral" variant="ghost" @click="mesaDrawerOpen = false">
          Cancelar
        </UButton>
        <UButton type="submit" form="mesa-form" :loading="savingMesa">
          {{ mesaEditingId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="deleteSalonOpen"
      title="Eliminar salón"
      message="Se eliminará el salón y sus mesas. Esta acción no se puede deshacer."
      @confirm="eliminarSalon"
    />
    <CrudModal
      v-model:open="deleteMesaOpen"
      title="Eliminar mesa"
      message="¿Eliminar esta mesa? Esta acción no se puede deshacer."
      @cancel="mesaToDelete = null"
      @confirm="eliminarMesa"
    />
  </div>
</template>
