<script setup lang="ts">
const emit = defineEmits<{ opened: [cajaId: string] }>()

const cajaStore = useCajaStore()
const toast = useToast()
const loadingCajones = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const seleccionado = ref<{ cajonId: string, nombre: string } | null>(null)

const form = ref({ saldoInicial: '', comentario: '' })

const sinCajones = computed(
  () => !loadingCajones.value && cajaStore.cajonesDisponibles.length === 0,
)

const drawerTitle = computed(() =>
  seleccionado.value ? `Abrir caja — ${seleccionado.value.nombre}` : 'Abrir caja',
)

onMounted(async () => {
  loadingCajones.value = true
  try {
    await cajaStore.cargarCajonesDisponibles()
  }
  catch {
    toast.add({ title: 'Error al cargar los cajones disponibles', color: 'error' })
  }
  finally {
    loadingCajones.value = false
  }
})

watch(drawerOpen, (open) => {
  if (!open) {
    seleccionado.value = null
    form.value = { saldoInicial: '', comentario: '' }
  }
})

function abrirDrawer(cajon: { cajonId: string, nombre: string }) {
  seleccionado.value = { cajonId: cajon.cajonId, nombre: cajon.nombre }
  form.value = { saldoInicial: '', comentario: '' }
  drawerOpen.value = true
}

async function abrir() {
  if (!seleccionado.value) return
  if (!form.value.saldoInicial) {
    toast.add({ title: 'Ingresa el saldo inicial', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const caja = await cajaStore.abrir({
      saldoInicial: form.value.saldoInicial,
      comentario: form.value.comentario || undefined,
      cajonId: seleccionado.value.cajonId,
    })
    toast.add({ title: 'Caja abierta correctamente', color: 'success' })
    drawerOpen.value = false
    emit('opened', caja.id)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al abrir la caja')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="w-full">
    <div v-if="loadingCajones" class="py-12 text-center text-sm text-muted">
      <UIcon name="i-lucide-loader" class="w-6 h-6 animate-spin mx-auto mb-2" />
      Cargando cajones…
    </div>

    <p v-else-if="sinCajones" class="text-sm text-warning">
      No hay cajas disponibles para abrir. Pedí al administrador que te habilite una.
    </p>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="cajon in cajaStore.cajonesDisponibles"
        :key="cajon.cajonId"
        class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
        @click="abrirDrawer(cajon)"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-lock-open" class="w-5 h-5 text-primary-500" />
            <span class="font-semibold text-default truncate">{{ cajon.nombre }}</span>
          </div>
        </template>
        <p class="text-sm text-muted">
          Disponible. Hacé click para abrir tu caja.
        </p>
      </UCard>
    </div>

    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="caja-apertura-grid-form" :state="form" class="space-y-4" @submit="abrir">
          <UFormField label="Saldo inicial" required>
            <MoneyInput v-model="form.saldoInicial" oficial class="w-full" />
          </UFormField>

          <UFormField label="Comentario">
            <UInput
              v-model="form.comentario"
              placeholder="Observaciones del turno (opcional)"
              class="w-full"
            />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="caja-apertura-grid-form"
          icon="i-lucide-lock-open"
          :loading="saving"
        >
          Abrir caja
        </UButton>
      </template>
    </AppDrawer>
  </div>
</template>
