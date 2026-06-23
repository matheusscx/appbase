<script setup lang="ts">
interface TipoRegla {
  tipo_regla_id: string
  nombre: string
}

interface Recargo {
  id: string
  nombre: string
  tipoReglaId: string
  modo: string
  valor: string
  condicionTipo: string
  condicionValor: string | null
  fechaInicio: string | null
  fechaFin: string | null
  activo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const recargos = ref<Recargo[]>([])
const tipos = ref<{ label: string, value: string }[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const modoOptions = [
  { label: 'Porcentaje', value: 'porcentaje' },
  { label: 'Monto fijo', value: 'monto_fijo' },
]

const condicionOptions = [
  { label: 'Ninguna', value: 'ninguna' },
  { label: 'Cliente', value: 'customer' },
  { label: 'Producto', value: 'producto' },
  { label: 'Categoría', value: 'categoria' },
  { label: 'Fecha', value: 'fecha' },
  { label: 'Método de pago', value: 'metodo_pago' },
  { label: 'Vencimiento', value: 'vencimiento' },
  { label: 'Monto mínimo', value: 'monto_minimo' },
  { label: 'Cantidad mínima', value: 'cantidad_minima' },
]

const emptyForm = () => ({
  nombre: '',
  tipoReglaId: '',
  modo: 'porcentaje',
  valor: '',
  condicionTipo: 'ninguna',
  condicionValor: '',
  fechaInicio: '',
  fechaFin: '',
  activo: true,
})
const form = ref(emptyForm())

async function cargar() {
  loading.value = true
  try {
    recargos.value = await useApiFetch<Recargo[]>(`${apiUrl}/recargos`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar recargos')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function cargarTipos() {
  try {
    const data = await useApiFetch<TipoRegla[]>(`${apiUrl}/tipos-regla?clase=recargo`)
    tipos.value = data.map(t => ({ label: t.nombre, value: t.tipo_regla_id }))
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar tipos de recargo')
    toast.add({ title: msg, color: 'error' })
  }
}

function abrirCrear() {
  editingId.value = null
  form.value = emptyForm()
  modalOpen.value = true
}

function abrirEditar(r: Recargo) {
  editingId.value = r.id
  form.value = {
    nombre: r.nombre,
    tipoReglaId: r.tipoReglaId,
    modo: r.modo,
    valor: r.valor,
    condicionTipo: r.condicionTipo,
    condicionValor: r.condicionValor ?? '',
    fechaInicio: r.fechaInicio ?? '',
    fechaFin: r.fechaFin ?? '',
    activo: r.activo,
  }
  modalOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      tipoReglaId: form.value.tipoReglaId,
      modo: form.value.modo,
      valor: form.value.valor,
      condicionTipo: form.value.condicionTipo,
      condicionValor: form.value.condicionValor || null,
      fechaInicio: form.value.fechaInicio || null,
      fechaFin: form.value.fechaFin || null,
      activo: form.value.activo,
    }
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/recargos/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      toast.add({ title: 'Recargo actualizado', color: 'success' })
    }
    else {
      await useApiFetch(`${apiUrl}/recargos`, {
        method: 'POST',
        body,
      })
      toast.add({ title: 'Recargo creado', color: 'success' })
    }
    modalOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(r: Recargo) {
  if (toggling.has(r.id)) return
  toggling.add(r.id)
  const prev = r.activo
  r.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/recargos/${r.id}`, {
      method: 'PATCH',
      body: { activo: r.activo },
    })
    toast.add({ title: r.activo ? 'Recargo activado' : 'Recargo desactivado', color: 'success' })
  }
  catch (e: unknown) {
    r.activo = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(r.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/recargos/${id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Recargo eliminado', color: 'success' })
    await cargar()
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

onMounted(() => {
  cargar()
  cargarTipos()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Recargos
        </h2>
        <p class="text-sm text-gray-500">
          Reglas de recargo aplicables en el cálculo de precios.
        </p>
      </div>
      <UButton
        icon="i-heroicons-plus"
        @click="abrirCrear"
      >
        Nuevo recargo
      </UButton>
    </div>

    <UCard>
      <div
        v-if="loading"
        class="py-8 text-center text-sm text-gray-500"
      >
        Cargando…
      </div>
      <div
        v-else-if="!recargos.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay recargos registrados.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="r in recargos"
          :key="r.id"
          class="flex items-center justify-between py-3"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ r.nombre }}
            </p>
            <p class="text-sm text-gray-500">
              {{ r.modo === 'porcentaje' ? `${r.valor} (porcentaje)` : `${r.valor} (monto fijo)` }}
            </p>
            <p
              v-if="r.condicionTipo !== 'ninguna'"
              class="text-sm text-gray-400 truncate"
            >
              Condición: {{ r.condicionTipo }}
            </p>
          </div>
          <div class="flex items-center gap-4 shrink-0 ml-4">
            <USwitch
              :model-value="r.activo"
              :disabled="toggling.has(r.id)"
              @update:model-value="toggleActivo(r)"
            />
            <div class="flex gap-2">
              <UButton
                icon="i-heroicons-pencil-square"
                color="neutral"
                variant="ghost"
                @click="abrirEditar(r)"
              />
              <UButton
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                @click="() => { confirmDeleteId = r.id; confirmModalOpen = true }"
              />
            </div>
          </div>
        </li>
      </ul>
    </UCard>

    <!-- Modal crear/editar -->
    <UModal
      v-model:open="modalOpen"
      :title="editingId ? 'Editar recargo' : 'Nuevo recargo'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Interés simple" />
          </UFormField>
          <UFormField label="Tipo de recargo" required>
            <USelectMenu
              v-model="form.tipoReglaId"
              :items="tipos"
              value-key="value"
              placeholder="Selecciona un tipo"
            />
          </UFormField>
          <UFormField label="Modo" required>
            <USelectMenu
              v-model="form.modo"
              :items="modoOptions"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Valor" required>
            <UInput
              v-model="form.valor"
              inputmode="decimal"
              placeholder="0.05 (= 5%) o monto fijo"
            />
          </UFormField>
          <UFormField label="Condición">
            <USelectMenu
              v-model="form.condicionTipo"
              :items="condicionOptions"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Valor de la condición">
            <UInput v-model="form.condicionValor" placeholder="Opcional" />
          </UFormField>
          <UFormField label="Fecha de inicio">
            <UInput v-model="form.fechaInicio" type="date" />
          </UFormField>
          <UFormField label="Fecha de fin">
            <UInput v-model="form.fechaFin" type="date" />
          </UFormField>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="modalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="saving" @click="guardar">
            Guardar
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal confirmación eliminar -->
    <UModal
      v-model:open="confirmModalOpen"
      title="Eliminar recargo"
    >
      <template #body>
        <p class="text-sm">
          ¿Estás seguro de que quieres eliminar este recargo? Esta acción no se puede deshacer.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="confirmModalOpen = false; confirmDeleteId = null">
            Cancelar
          </UButton>
          <UButton
            color="error"
            @click="confirmDeleteId && eliminar(confirmDeleteId)"
          >
            Eliminar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
