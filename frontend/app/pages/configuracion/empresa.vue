<script setup lang="ts">
// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface Pais {
  paisId: string
  nombre: string
  codigoIso: string
}

interface Provincia {
  provinciaId: string
  paisId: string
  nombre: string
}

interface TenantMe {
  id: string
  nombre: string
  correo: string
  telefono: string | null
  direccion: string | null
  provinciaId: string
  horaCorte: number
}

// 00:00…06:00 — mismo rango que acepta `UpdateMyTenantDto.horaCorte` en el
// backend (entero 0-6). Junto a la provincia porque las dos definen "cuándo
// es hoy" (spec § 3.1).
const horaCorteItems = Array.from({ length: 7 }, (_, h) => ({
  label: `${String(h).padStart(2, '0')}:00`,
  value: h,
}))

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const loading = ref(false)
const saving = ref(false)

const { errores, marcar, limpiar } = useErroresCampo()
const paises = ref<Pais[]>([])
const provincias = ref<Provincia[]>([])

const form = ref({
  nombre: '',
  correo: '',
  telefono: '',
  direccion: '',
  paisId: '',
  provinciaId: '',
  horaCorte: 0,
})

// Lo último que está guardado: "Guardar cambios" se apaga sin cambios, y el fin del día pide
// confirmación solo si cambió (auditoría UX 07.31).
const guardadoAntes = ref('')
const claveForm = () => JSON.stringify(form.value)
const hayCambios = computed(() => claveForm() !== guardadoAntes.value)

async function cargar() {
  loading.value = true
  try {
    const [tenant, ps] = await Promise.all([
      useApiFetch<TenantMe>(`${apiUrl}/tenants/me`),
      useApiFetch<Pais[]>(`${apiUrl}/catalog/paises`),
    ])
    paises.value = ps
    form.value.nombre = tenant.nombre
    form.value.correo = tenant.correo
    form.value.telefono = tenant.telefono ?? ''
    form.value.direccion = tenant.direccion ?? ''
    form.value.provinciaId = tenant.provinciaId
    form.value.horaCorte = tenant.horaCorte
    horaCorteGuardada.value = tenant.horaCorte

    // Cargar todas las provincias para inferir el país actual
    const todasProvincias = await useApiFetch<Provincia[]>(`${apiUrl}/catalog/provincias`)
    const provinciaActual = todasProvincias.find(p => p.provinciaId === tenant.provinciaId)
    if (provinciaActual) {
      form.value.paisId = provinciaActual.paisId
      await cargarProvincias(provinciaActual.paisId)
    }
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar datos de la empresa')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
    guardadoAntes.value = claveForm()
  }
}

async function cargarProvincias(paisId: string) {
  provincias.value = await useApiFetch<Provincia[]>(
    `${apiUrl}/catalog/provincias?paisId=${paisId}`,
  )
}

async function onPaisChange(paisId: string) {
  form.value.provinciaId = ''
  provincias.value = []
  if (paisId) {
    await cargarProvincias(paisId)
  }
}

const horaCorteGuardada = ref<number | null>(null)
const confirmarCorteOpen = ref(false)
const corteNuevo = computed(() => `${String(form.value.horaCorte).padStart(2, '0')}:00`)

/** El submit del formulario: valida, y si cambió el fin del día pide confirmar antes de guardar. */
function pedirGuardar() {
  const faltan: Record<string, string> = {}
  if (!form.value.nombre.trim()) faltan.nombre = 'Escribe el nombre de la empresa'
  if (!/^\S+@\S+\.\S+$/.test(form.value.correo.trim())) faltan.correo = 'Escribe un correo válido, por ejemplo contacto@tulocal.cl'
  if (marcar(faltan)) return
  if (horaCorteGuardada.value !== null && form.value.horaCorte !== horaCorteGuardada.value) {
    confirmarCorteOpen.value = true
    return
  }
  return guardar()
}

async function guardar() {
  confirmarCorteOpen.value = false
  saving.value = true
  try {
    const body: Record<string, unknown> = {
      nombre: form.value.nombre,
      correo: form.value.correo,
      telefono: form.value.telefono || null,
      direccion: form.value.direccion || null,
      horaCorte: form.value.horaCorte,
    }
    if (form.value.provinciaId) {
      body.provinciaId = form.value.provinciaId
    }
    await useApiFetch(`${apiUrl}/tenants/me`, {
      method: 'PATCH',
      body,
    })
    guardadoAntes.value = claveForm()
    horaCorteGuardada.value = form.value.horaCorte
    toast.add({ title: 'Datos de empresa actualizados', color: 'success' })
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

const paisItems = computed(() =>
  paises.value.map(p => ({ label: p.nombre, value: p.paisId })),
)

const provinciaItems = computed(() =>
  provincias.value.map(p => ({ label: p.nombre, value: p.provinciaId })),
)

onMounted(cargar)
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <CrudPageHeader
      title="Empresa"
      description="Datos de tu organización."
    />

    <div
      v-if="loading"
      class="py-8 text-center text-sm text-muted"
    >
      Cargando…
    </div>

    <UCard v-else>
      <UForm :state="form" class="space-y-4" @submit="pedirGuardar">
        <UFormField label="Nombre" required :error="errores.nombre">
          <UInput v-model="form.nombre" placeholder="Nombre de la empresa" @update:model-value="limpiar('nombre')" />
        </UFormField>

        <UFormField label="Correo" required :error="errores.correo">
          <UInput v-model="form.correo" type="email" placeholder="contacto@empresa.cl" @update:model-value="limpiar('correo')" />
        </UFormField>

        <UFormField label="Teléfono">
          <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
        </UFormField>

        <UFormField label="Dirección">
          <UInput v-model="form.direccion" placeholder="Av. Ejemplo 123, Ciudad" />
        </UFormField>

        <UFormField label="País" help="Lo define tu cuenta; para cambiarlo, escríbenos.">
          <USelectMenu
            v-model="form.paisId"
            :items="paisItems"
            value-key="value"
            label-key="label"
            placeholder="Selecciona un país"
            disabled
          />
        </UFormField>

        <UFormField label="Provincia / Región">
          <USelectMenu
            v-model="form.provinciaId"
            :items="provinciaItems"
            value-key="value"
            label-key="label"
            placeholder="Selecciona una provincia"
            :disabled="!form.paisId"
          />
        </UFormField>

        <UFormField
          label="Fin del día"
          help="Una venta a la 01:30 con corte a las 05:00 cuenta en el día anterior. Si lo cambias, los reportes pasados se recalculan con el corte nuevo."
        >
          <USelect
            v-model="form.horaCorte"
            :items="horaCorteItems"
          />
        </UFormField>

        <div class="flex justify-end pt-2">
          <UButton
            type="submit"
            :loading="saving"
            :disabled="saving || !hayCambios"
          >
            Guardar cambios
          </UButton>
        </div>
      </UForm>
    </UCard>

    <CrudModal
      v-model:open="confirmarCorteOpen"
      title="Cambiar el fin del día"
      :message="`Los reportes pasados se recalcularán con el corte de las ${corteNuevo}. ¿Quieres cambiarlo?`"
      confirm-label="Cambiar el corte"
      confirm-color="primary"
      cancel-label="Volver"
      :loading="saving"
      @confirm="guardar"
    />
  </div>
</template>
