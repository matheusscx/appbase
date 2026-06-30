<script setup lang="ts">
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
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const loading = ref(false)
const saving = ref(false)

const paises = ref<Pais[]>([])
const provincias = ref<Provincia[]>([])

const form = ref({
  nombre: '',
  correo: '',
  telefono: '',
  direccion: '',
  paisId: '',
  provinciaId: '',
})

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

async function guardar() {
  saving.value = true
  try {
    const body: Record<string, unknown> = {
      nombre: form.value.nombre,
      correo: form.value.correo,
      telefono: form.value.telefono || null,
      direccion: form.value.direccion || null,
    }
    if (form.value.provinciaId) {
      body.provinciaId = form.value.provinciaId
    }
    await useApiFetch(`${apiUrl}/tenants/me`, {
      method: 'PATCH',
      body,
    })
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
    <div>
      <h2 class="text-lg font-semibold">
        Empresa
      </h2>
      <p class="text-sm text-muted">
        Datos de tu organización.
      </p>
    </div>

    <div
      v-if="loading"
      class="py-8 text-center text-sm text-muted"
    >
      Cargando…
    </div>

    <UCard v-else>
      <div class="space-y-4">
        <UFormField label="Nombre">
          <UInput v-model="form.nombre" placeholder="Nombre de la empresa" />
        </UFormField>

        <UFormField label="Correo">
          <UInput v-model="form.correo" type="email" placeholder="contacto@empresa.cl" />
        </UFormField>

        <UFormField label="Teléfono">
          <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
        </UFormField>

        <UFormField label="Dirección">
          <UInput v-model="form.direccion" placeholder="Av. Ejemplo 123, Ciudad" />
        </UFormField>

        <UFormField label="País">
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

        <div class="flex justify-end pt-2">
          <UButton
            :loading="saving"
            :disabled="saving"
            @click="guardar"
          >
            Guardar cambios
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
