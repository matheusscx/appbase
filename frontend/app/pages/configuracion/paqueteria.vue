<script setup lang="ts">
import type { PaqueteConfiguracionRespuesta } from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard`. Sin guard de ruta, la URL escrita a mano la
// abría igual y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl

const loading = ref(true)
const saving = ref(false)
// Arranca en `true` para que el aviso no parpadee antes de saber qué contestó el backend.
const configurada = ref(true)
// Strings de punta a punta (docs/patterns/frontend.md § 7): `MoneyInput` los entrega limpios.
const form = ref({ precioEnvioDefecto: '', pagoRepartidorDefecto: '' })

const incompleto = computed(() =>
  form.value.precioEnvioDefecto === '' || form.value.pagoRepartidorDefecto === '',
)

function aplicar(config: PaqueteConfiguracionRespuesta) {
  configurada.value = config.configurada
  form.value = {
    precioEnvioDefecto: config.precioEnvioDefecto,
    pagoRepartidorDefecto: config.pagoRepartidorDefecto,
  }
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
    // PUT reemplaza: los dos montos viajan siempre.
    aplicar(await useApiFetch<PaqueteConfiguracionRespuesta>(`${apiUrl}/paquetes/configuracion`, {
      method: 'PUT',
      body: {
        precioEnvioDefecto: form.value.precioEnvioDefecto,
        pagoRepartidorDefecto: form.value.pagoRepartidorDefecto,
      },
    }))
    toast.add({ title: 'Valores por defecto guardados', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Valores por defecto"
      description="Los montos con que nace cada paquete. Después se pueden cambiar paquete por paquete."
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
        title="Hasta que guardes estos valores no se pueden escanear paquetes nuevos."
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

          <UFormField
            label="Pago al repartidor"
            description="Lo que se le paga al repartidor por cada paquete que entrega."
          >
            <MoneyInput
              v-model="form.pagoRepartidorDefecto"
              oficial
              class="w-48"
              data-qa="paqueteria-pago-repartidor"
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
  </div>
</template>
