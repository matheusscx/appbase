<script setup lang="ts">
/**
 * Alta de un proveedor en plena carga de una compra (auditoría UX 06.11, owner 2026-10-16): quien
 * carga compras puede crear el proveedor sin pedirle a un admin, pero no editar ni borrar otros
 * (eso sigue en Terceros). Pega a `POST /compras/proveedores` (`Compras:Crear`), que fija el tipo
 * y el tenant: acá solo viajan los tres datos que hacen falta para empezar a cargar facturas.
 */
interface ProveedorCreado {
  id: string
  nombre: string
  rut: string | null
  plazoPagoDias: number | null
}

const emit = defineEmits<{ creado: [ProveedorCreado] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { errores, marcar, limpiar } = useErroresCampo()

const nombre = ref('')
const rut = ref('')
const plazo = ref('')
const enviando = ref(false)

watch(open, (v) => {
  if (!v) return
  nombre.value = ''
  rut.value = ''
  plazo.value = ''
  limpiar()
})

async function enviar() {
  if (enviando.value) return
  const faltan: Record<string, string> = {}
  if (!nombre.value.trim()) faltan.nombre = 'Escribe el nombre del proveedor'
  if (plazo.value.trim() && !/^[1-9]\d{0,3}$/.test(plazo.value.trim())) {
    faltan.plazo = 'El plazo son días enteros, por ejemplo 30'
  }
  if (marcar(faltan)) return
  enviando.value = true
  try {
    const body: Record<string, unknown> = { nombre: nombre.value.trim() }
    if (rut.value.trim()) body.rut = rut.value.trim()
    if (plazo.value.trim()) body.plazoPagoDias = Number(plazo.value.trim())
    const creado = await useApiFetch<ProveedorCreado>(`${apiUrl}/compras/proveedores`, { method: 'POST', body })
    toast.add({ title: 'Proveedor creado', color: 'success' })
    open.value = false
    emit('creado', creado)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al crear el proveedor'), color: 'error' })
  }
  finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Nuevo proveedor" :ui="shellUi.modal">
    <template #body>
      <form class="flex flex-col gap-4" data-qa="proveedor-modal" novalidate @submit.prevent="enviar">
        <UFormField label="Nombre" required :error="errores.nombre">
          <UInput
            v-model="nombre"
            placeholder="Distribuidora Andina"
            autofocus
            class="w-full"
            data-qa="proveedor-nombre"
            @update:model-value="limpiar('nombre')"
          />
        </UFormField>
        <UFormField label="RUT (opcional)">
          <UInput v-model="rut" placeholder="76.123.456-7" class="w-full" data-qa="proveedor-rut" />
        </UFormField>
        <UFormField label="Plazo de pago en días (opcional)" help="Vacío = 30 días." :error="errores.plazo">
          <UInput
            v-model="plazo"
            inputmode="numeric"
            class="w-full"
            data-qa="proveedor-plazo"
            @update:model-value="limpiar('plazo')"
          />
        </UFormField>
        <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
      </form>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton label="Crear proveedor" :loading="enviando" data-qa="proveedor-crear" @click="enviar" />
      </div>
    </template>
  </UModal>
</template>
