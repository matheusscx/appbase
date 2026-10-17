<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { TarifaEnvioFila, TarifaPagoFila } from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard`. Sin guard de ruta, la URL escrita a mano la
// abría igual y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { formatOficial } = useCurrency()

// ── Tarifas de envío al repartidor ─────────────────────────────────────────

const tarifasEnvio = ref<TarifaEnvioFila[]>([])
const cargandoTarifasEnvio = ref(false)
const guardandoTarifaEnvio = ref(false)
const tarifaDrawerOpenEnvio = ref(false)
const tarifaEditandoIdEnvio = ref<string | null>(null)
const tarifaFormEnvio = ref({ nombre: '', monto: '' })
const enCambioTarifaEnvio = reactive(new Set<string>())
// El 400 de «la por defecto no se desactiva» se queda a la vista sobre la tabla: un toast se iba
// antes de que se entendiera qué fila lo causó.
const errorTarifasEnvio = ref<string | null>(null)

const confirmTarifaIdEnvio = ref<string | null>(null)
const confirmTarifaOpenEnvio = ref(false)
const eliminandoTarifaEnvio = ref(false)
const errorEliminarTarifaEnvio = ref<string | null>(null)

const tarifaAEliminarEnvio = computed(() => tarifasEnvio.value.find(t => t.id === confirmTarifaIdEnvio.value) ?? null)
const tarifaIncompletaEnvio = computed(() =>
  tarifaFormEnvio.value.nombre.trim() === '' || tarifaFormEnvio.value.monto === '',
)

async function cargarTarifasEnvio() {
  cargandoTarifasEnvio.value = true
  try {
    tarifasEnvio.value = await useApiFetch<TarifaEnvioFila[]>(`${apiUrl}/tarifas-envio`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las tarifas de envío'), color: 'error' })
  }
  finally {
    cargandoTarifasEnvio.value = false
  }
}

function resetTarifaDrawerEnvio() {
  tarifaEditandoIdEnvio.value = null
  tarifaFormEnvio.value = { nombre: '', monto: '' }
}

watch(tarifaDrawerOpenEnvio, (open) => {
  if (!open) resetTarifaDrawerEnvio()
})

function abrirCrearTarifaEnvio() {
  resetTarifaDrawerEnvio()
  tarifaDrawerOpenEnvio.value = true
}

function abrirEditarTarifaEnvio(t: TarifaEnvioFila) {
  resetTarifaDrawerEnvio()
  tarifaEditandoIdEnvio.value = t.id
  tarifaFormEnvio.value = { nombre: t.nombre, monto: t.monto }
  tarifaDrawerOpenEnvio.value = true
}

async function guardarTarifaEnvio() {
  guardandoTarifaEnvio.value = true
  errorTarifasEnvio.value = null
  try {
    const body = { nombre: tarifaFormEnvio.value.nombre.trim(), monto: tarifaFormEnvio.value.monto }
    const nueva = !tarifaEditandoIdEnvio.value
    if (nueva) {
      await useApiFetch<TarifaEnvioFila>(`${apiUrl}/tarifas-envio`, { method: 'POST', body })
    }
    else {
      await useApiFetch<TarifaEnvioFila>(`${apiUrl}/tarifas-envio/${tarifaEditandoIdEnvio.value}`, { method: 'PATCH', body })
    }
    toast.add({ title: nueva ? 'Tarifa creada' : 'Tarifa actualizada', color: 'success' })
    tarifaDrawerOpenEnvio.value = false
    // La primera tarifa nace por defecto y mueve las demás: la lista se vuelve a pedir.
    await cargarTarifasEnvio()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la tarifa'), color: 'error' })
  }
  finally {
    guardandoTarifaEnvio.value = false
  }
}

async function cambiarTarifaEnvio(t: TarifaEnvioFila, body: { esDefecto?: boolean, activa?: boolean }, aviso: string) {
  if (enCambioTarifaEnvio.has(t.id)) return
  enCambioTarifaEnvio.add(t.id)
  errorTarifasEnvio.value = null
  try {
    await useApiFetch<TarifaEnvioFila>(`${apiUrl}/tarifas-envio/${t.id}`, { method: 'PATCH', body })
    toast.add({ title: aviso, color: 'success' })
    await cargarTarifasEnvio()
  }
  catch (e: unknown) {
    errorTarifasEnvio.value = apiErrorMsg(e, 'No se pudo actualizar la tarifa')
  }
  finally {
    enCambioTarifaEnvio.delete(t.id)
  }
}

const hacerDefectoEnvio = (t: TarifaEnvioFila) =>
  cambiarTarifaEnvio(t, { esDefecto: true }, `${t.nombre} es la tarifa por defecto`)
const alternarActivaEnvio = (t: TarifaEnvioFila) =>
  cambiarTarifaEnvio(t, { activa: !t.activa }, t.activa ? 'Tarifa desactivada' : 'Tarifa activada')

function pedirEliminarTarifaEnvio(t: TarifaEnvioFila) {
  confirmTarifaIdEnvio.value = t.id
  errorEliminarTarifaEnvio.value = null
  confirmTarifaOpenEnvio.value = true
}

function cancelarEliminarTarifaEnvio() {
  confirmTarifaIdEnvio.value = null
  errorEliminarTarifaEnvio.value = null
}

async function eliminarTarifaEnvio(id: string) {
  eliminandoTarifaEnvio.value = true
  errorEliminarTarifaEnvio.value = null
  try {
    await useApiFetch(`${apiUrl}/tarifas-envio/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Tarifa eliminada', color: 'success' })
    confirmTarifaOpenEnvio.value = false
    confirmTarifaIdEnvio.value = null
    await cargarTarifasEnvio()
  }
  catch (e: unknown) {
    // «Está en uso: desactívala» se queda dentro del modal, junto al botón que la causó.
    errorEliminarTarifaEnvio.value = apiErrorMsg(e, 'Error al eliminar la tarifa')
  }
  finally {
    eliminandoTarifaEnvio.value = false
  }
}

const columnasTarifasEnvio: TableColumn<TarifaEnvioFila>[] = [
  { accessorKey: 'nombre', header: 'Tarifa' },
  { id: 'activa', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

// ── Tarifas de pago al repartidor ─────────────────────────────────────────

const tarifas = ref<TarifaPagoFila[]>([])
const cargandoTarifas = ref(false)
const guardandoTarifa = ref(false)
const tarifaDrawerOpen = ref(false)
const tarifaEditandoId = ref<string | null>(null)
const tarifaForm = ref({ nombre: '', monto: '' })
const enCambioTarifa = reactive(new Set<string>())
// El 400 de «la por defecto no se desactiva» se queda a la vista sobre la tabla: un toast se iba
// antes de que se entendiera qué fila lo causó.
const errorTarifas = ref<string | null>(null)

const confirmTarifaId = ref<string | null>(null)
const confirmTarifaOpen = ref(false)
const eliminandoTarifa = ref(false)
const errorEliminarTarifa = ref<string | null>(null)

const tarifaAEliminar = computed(() => tarifas.value.find(t => t.id === confirmTarifaId.value) ?? null)
const tarifaIncompleta = computed(() =>
  tarifaForm.value.nombre.trim() === '' || tarifaForm.value.monto === '',
)

async function cargarTarifas() {
  cargandoTarifas.value = true
  try {
    tarifas.value = await useApiFetch<TarifaPagoFila[]>(`${apiUrl}/tarifas-pago`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las tarifas de pago'), color: 'error' })
  }
  finally {
    cargandoTarifas.value = false
  }
}

function resetTarifaDrawer() {
  tarifaEditandoId.value = null
  tarifaForm.value = { nombre: '', monto: '' }
}

watch(tarifaDrawerOpen, (open) => {
  if (!open) resetTarifaDrawer()
})

function abrirCrearTarifa() {
  resetTarifaDrawer()
  tarifaDrawerOpen.value = true
}

function abrirEditarTarifa(t: TarifaPagoFila) {
  resetTarifaDrawer()
  tarifaEditandoId.value = t.id
  tarifaForm.value = { nombre: t.nombre, monto: t.monto }
  tarifaDrawerOpen.value = true
}

async function guardarTarifa() {
  guardandoTarifa.value = true
  errorTarifas.value = null
  try {
    const body = { nombre: tarifaForm.value.nombre.trim(), monto: tarifaForm.value.monto }
    const nueva = !tarifaEditandoId.value
    if (nueva) {
      await useApiFetch<TarifaPagoFila>(`${apiUrl}/tarifas-pago`, { method: 'POST', body })
    }
    else {
      await useApiFetch<TarifaPagoFila>(`${apiUrl}/tarifas-pago/${tarifaEditandoId.value}`, { method: 'PATCH', body })
    }
    toast.add({ title: nueva ? 'Tarifa creada' : 'Tarifa actualizada', color: 'success' })
    tarifaDrawerOpen.value = false
    // La primera tarifa nace por defecto y mueve las demás: la lista se vuelve a pedir.
    await cargarTarifas()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la tarifa'), color: 'error' })
  }
  finally {
    guardandoTarifa.value = false
  }
}

async function cambiarTarifa(t: TarifaPagoFila, body: { esDefecto?: boolean, activa?: boolean }, aviso: string) {
  if (enCambioTarifa.has(t.id)) return
  enCambioTarifa.add(t.id)
  errorTarifas.value = null
  try {
    await useApiFetch<TarifaPagoFila>(`${apiUrl}/tarifas-pago/${t.id}`, { method: 'PATCH', body })
    toast.add({ title: aviso, color: 'success' })
    await cargarTarifas()
  }
  catch (e: unknown) {
    errorTarifas.value = apiErrorMsg(e, 'No se pudo actualizar la tarifa')
  }
  finally {
    enCambioTarifa.delete(t.id)
  }
}

const hacerDefecto = (t: TarifaPagoFila) =>
  cambiarTarifa(t, { esDefecto: true }, `${t.nombre} es la tarifa por defecto`)
const alternarActiva = (t: TarifaPagoFila) =>
  cambiarTarifa(t, { activa: !t.activa }, t.activa ? 'Tarifa desactivada' : 'Tarifa activada')

function pedirEliminarTarifa(t: TarifaPagoFila) {
  confirmTarifaId.value = t.id
  errorEliminarTarifa.value = null
  confirmTarifaOpen.value = true
}

function cancelarEliminarTarifa() {
  confirmTarifaId.value = null
  errorEliminarTarifa.value = null
}

async function eliminarTarifa(id: string) {
  eliminandoTarifa.value = true
  errorEliminarTarifa.value = null
  try {
    await useApiFetch(`${apiUrl}/tarifas-pago/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Tarifa eliminada', color: 'success' })
    confirmTarifaOpen.value = false
    confirmTarifaId.value = null
    await cargarTarifas()
  }
  catch (e: unknown) {
    // «Está en uso: desactívala» se queda dentro del modal, junto al botón que la causó.
    errorEliminarTarifa.value = apiErrorMsg(e, 'Error al eliminar la tarifa')
  }
  finally {
    eliminandoTarifa.value = false
  }
}

const columnasTarifas: TableColumn<TarifaPagoFila>[] = [
  { accessorKey: 'nombre', header: 'Tarifa' },
  { id: 'activa', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

// Sin una tarifa por defecto de cada tabla no se pueden escanear paquetes nuevos. Arranca en `true`
// para que el aviso no parpadee antes de que carguen las listas.
const configurada = computed(() =>
  (!cargandoTarifas.value && !cargandoTarifasEnvio.value)
    ? tarifas.value.some(t => t.esDefecto) && tarifasEnvio.value.some(t => t.esDefecto)
    : true,
)

onMounted(() => {
  cargarTarifas()
  cargarTarifasEnvio()
})
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="!configurada"
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      title="Hasta que haya una tarifa de envío y una tarifa de pago por defecto no se pueden escanear paquetes nuevos."
      data-qa="paqueteria-sin-configurar"
    />

    <CrudPageHeader
      title="Tarifas de envío"
      description="Lo que se cobra por cada paquete que se entrega. La por defecto se usa cuando el paquete no tiene una propia."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" data-qa="tarifa-envio-nueva" @click="abrirCrearTarifaEnvio">
          Nueva tarifa
        </UButton>
      </template>
    </CrudPageHeader>

    <UAlert
      v-if="errorTarifasEnvio"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="errorTarifasEnvio"
      data-qa="tarifa-envio-error"
    />

    <CrudTable :data="tarifasEnvio" :columns="columnasTarifasEnvio" :loading="cargandoTarifasEnvio">
      <template #nombre-cell="{ row }">
        <div class="flex flex-wrap items-center gap-2">
          <CrudListItem
            :title="row.original.nombre"
            :subtitle="formatOficial(row.original.monto)"
          />
          <UBadge
            v-if="row.original.esDefecto"
            label="Por defecto"
            color="primary"
            variant="subtle"
            size="sm"
            :data-qa="`tarifa-envio-defecto-${row.original.nombre}`"
          />
        </div>
      </template>

      <template #activa-cell="{ row }">
        <div class="flex items-center justify-end gap-2">
          <span class="text-sm text-muted">{{ row.original.activa ? 'Activa' : 'Inactiva' }}</span>
          <USwitch
            :model-value="row.original.activa"
            :disabled="enCambioTarifaEnvio.has(row.original.id)"
            :aria-label="`Activa: ${row.original.nombre}`"
            @update:model-value="alternarActivaEnvio(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton
            v-if="!row.original.esDefecto && row.original.activa"
            label="Hacer por defecto"
            color="neutral"
            variant="ghost"
            size="xl"
            class="min-h-11"
            :disabled="enCambioTarifaEnvio.has(row.original.id)"
            :data-qa="`tarifa-envio-hacer-defecto-${row.original.nombre}`"
            @click="hacerDefectoEnvio(row.original)"
          />
          <UButton
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            :aria-label="`Editar ${row.original.nombre}`"
            @click="abrirEditarTarifaEnvio(row.original)"
            class="size-11 justify-center"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            :aria-label="`Eliminar ${row.original.nombre}`"
            @click="pedirEliminarTarifaEnvio(row.original)"
            class="size-11 justify-center"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          Todavía no hay tarifas de envío. La primera que crees queda como la tarifa por defecto.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="tarifaDrawerOpenEnvio">
      <template #header>
        <span class="font-semibold text-default">{{ tarifaEditandoIdEnvio ? 'Editar tarifa' : 'Nueva tarifa' }}</span>
      </template>

      <template #body>
        <UForm
          id="tarifa-envio-form"
          :state="tarifaFormEnvio"
          class="space-y-4"
          @submit="guardarTarifaEnvio"
        >
          <UFormField label="Nombre" required>
            <UInput
              v-model="tarifaFormEnvio.nombre"
              placeholder="Estándar"
              maxlength="100"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UFormField label="Precio por paquete" description="Lo que se cobra por cada entrega." required>
            <MoneyInput
              v-model="tarifaFormEnvio.monto"
              oficial
              class="w-48"
              data-qa="tarifa-envio-monto"
            />
          </UFormField>
          <p v-if="tarifaEditandoIdEnvio" class="text-sm text-muted">
            Cambiar el monto no mueve las entregas que ya se marcaron: conservan el precio que se fijó al entregar.
          </p>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { tarifaDrawerOpenEnvio = false }">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="tarifa-envio-form"
          :loading="guardandoTarifaEnvio"
          :disabled="tarifaIncompletaEnvio"
        >
          {{ tarifaEditandoIdEnvio ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmTarifaOpenEnvio"
      title="Eliminar tarifa"
      :message="`¿Eliminar la tarifa ${tarifaAEliminarEnvio?.nombre ?? ''}? Si está en uso por un paquete no se puede eliminar: desactívala.`"
      :loading="eliminandoTarifaEnvio"
      @cancel="cancelarEliminarTarifaEnvio"
      @confirm="confirmTarifaIdEnvio && eliminarTarifaEnvio(confirmTarifaIdEnvio)"
    >
      <template #detalle>
        <UAlert
          v-if="errorEliminarTarifaEnvio"
          class="mt-3"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorEliminarTarifaEnvio"
          data-qa="tarifa-envio-error-eliminar"
        />
      </template>
    </CrudModal>

    <CrudPageHeader
      title="Tarifas de pago"
      description="Lo que se le paga al repartidor por cada paquete que entrega. La por defecto se usa cuando el repartidor y el paquete no tienen una propia."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" data-qa="tarifa-nueva" @click="abrirCrearTarifa">
          Nueva tarifa
        </UButton>
      </template>
    </CrudPageHeader>

    <UAlert
      v-if="errorTarifas"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="errorTarifas"
      data-qa="tarifa-error"
    />

    <CrudTable :data="tarifas" :columns="columnasTarifas" :loading="cargandoTarifas">
      <template #nombre-cell="{ row }">
        <div class="flex flex-wrap items-center gap-2">
          <CrudListItem
            :title="row.original.nombre"
            :subtitle="formatOficial(row.original.monto)"
          />
          <UBadge
            v-if="row.original.esDefecto"
            label="Por defecto"
            color="primary"
            variant="subtle"
            size="sm"
            :data-qa="`tarifa-defecto-${row.original.nombre}`"
          />
        </div>
      </template>

      <template #activa-cell="{ row }">
        <div class="flex items-center justify-end gap-2">
          <span class="text-sm text-muted">{{ row.original.activa ? 'Activa' : 'Inactiva' }}</span>
          <USwitch
            :model-value="row.original.activa"
            :disabled="enCambioTarifa.has(row.original.id)"
            :aria-label="`Activa: ${row.original.nombre}`"
            @update:model-value="alternarActiva(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton
            v-if="!row.original.esDefecto && row.original.activa"
            label="Hacer por defecto"
            color="neutral"
            variant="ghost"
            size="xl"
            class="min-h-11"
            :disabled="enCambioTarifa.has(row.original.id)"
            :data-qa="`tarifa-hacer-defecto-${row.original.nombre}`"
            @click="hacerDefecto(row.original)"
          />
          <UButton
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            :aria-label="`Editar ${row.original.nombre}`"
            @click="abrirEditarTarifa(row.original)"
            class="size-11 justify-center"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            :aria-label="`Eliminar ${row.original.nombre}`"
            @click="pedirEliminarTarifa(row.original)"
            class="size-11 justify-center"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          Todavía no hay tarifas. La primera que crees queda como la tarifa por defecto.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="tarifaDrawerOpen">
      <template #header>
        <span class="font-semibold text-default">{{ tarifaEditandoId ? 'Editar tarifa' : 'Nueva tarifa' }}</span>
      </template>

      <template #body>
        <UForm
          id="tarifa-form"
          :state="tarifaForm"
          class="space-y-4"
          @submit="guardarTarifa"
        >
          <UFormField label="Nombre" required>
            <UInput
              v-model="tarifaForm.nombre"
              placeholder="Moto"
              maxlength="100"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UFormField label="Monto por paquete" description="Lo que se le paga al repartidor por cada entrega." required>
            <MoneyInput
              v-model="tarifaForm.monto"
              oficial
              class="w-48"
              data-qa="tarifa-monto"
            />
          </UFormField>
          <p v-if="tarifaEditandoId" class="text-sm text-muted">
            Cambiar el monto no mueve las entregas que ya se marcaron: conservan lo que se fijó al entregar.
          </p>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { tarifaDrawerOpen = false }">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="tarifa-form"
          :loading="guardandoTarifa"
          :disabled="tarifaIncompleta"
        >
          {{ tarifaEditandoId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmTarifaOpen"
      title="Eliminar tarifa"
      :message="`¿Eliminar la tarifa ${tarifaAEliminar?.nombre ?? ''}? Si está en uso por un repartidor o un paquete no se puede eliminar: desactívala.`"
      :loading="eliminandoTarifa"
      @cancel="cancelarEliminarTarifa"
      @confirm="confirmTarifaId && eliminarTarifa(confirmTarifaId)"
    >
      <template #detalle>
        <UAlert
          v-if="errorEliminarTarifa"
          class="mt-3"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorEliminarTarifa"
          data-qa="tarifa-error-eliminar"
        />
      </template>
    </CrudModal>
  </div>
</template>
