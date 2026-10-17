<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PaqueteConfiguracionRespuesta, TarifaPagoFila } from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard`. Sin guard de ruta, la URL escrita a mano la
// abría igual y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { formatOficial } = useCurrency()

const loading = ref(true)
const saving = ref(false)
// Arranca en `true` para que el aviso no parpadee antes de saber qué contestó el backend.
const configurada = ref(true)
// Strings de punta a punta (docs/patterns/frontend.md § 7): `MoneyInput` los entrega limpios.
const form = ref({ precioEnvioDefecto: '' })

const incompleto = computed(() => form.value.precioEnvioDefecto === '')

function aplicar(config: PaqueteConfiguracionRespuesta) {
  configurada.value = config.configurada
  form.value = { precioEnvioDefecto: config.precioEnvioDefecto }
}

async function cargar() {
  loading.value = true
  try {
    aplicar(await useApiFetch<PaqueteConfiguracionRespuesta>(`${apiUrl}/paquetes/configuracion`))
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar los valores por defecto'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function guardar() {
  saving.value = true
  try {
    aplicar(await useApiFetch<PaqueteConfiguracionRespuesta>(`${apiUrl}/paquetes/configuracion`, {
      method: 'PUT',
      body: { precioEnvioDefecto: form.value.precioEnvioDefecto },
    }))
    toast.add({ title: 'Precio de envío guardado', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

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

// Que haya o no una tarifa por defecto cambia `configurada`; el precio que se está tipeando no se toca.
async function releerConfigurada() {
  try {
    const config = await useApiFetch<PaqueteConfiguracionRespuesta>(`${apiUrl}/paquetes/configuracion`)
    configurada.value = config.configurada
  }
  catch {
    // El aviso queda como estaba; la tabla ya refleja lo que pasó.
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
    await Promise.all([cargarTarifas(), releerConfigurada()])
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
    await Promise.all([cargarTarifas(), releerConfigurada()])
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
    await Promise.all([cargarTarifas(), releerConfigurada()])
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

onMounted(() => {
  cargar()
  cargarTarifas()
})
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Valores por defecto"
      description="El precio con que nace cada paquete. Después se puede cambiar paquete por paquete."
    />

    <div v-if="loading" class="py-8 text-center text-sm text-muted">
      Cargando...
    </div>

    <template v-else>
      <UAlert
        v-if="!configurada"
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        title="Hasta que guardes el precio de envío y haya una tarifa de pago por defecto no se pueden escanear paquetes nuevos."
        data-qa="paqueteria-sin-configurar"
      />

      <UCard class="max-w-xl">
        <UForm :state="form" class="space-y-5" @submit="guardar">
          <UFormField
            label="Precio de envío"
            description="Lo que cuesta el envío de cada paquete."
          >
            <MoneyInput
              v-model="form.precioEnvioDefecto"
              oficial
              class="w-48"
              data-qa="paqueteria-precio-envio"
            />
          </UFormField>

          <div class="flex justify-end">
            <UButton
              type="submit"
              :loading="saving"
              :disabled="incompleto"
              data-qa="paqueteria-guardar"
            >
              Guardar
            </UButton>
          </div>
        </UForm>
      </UCard>
    </template>

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
