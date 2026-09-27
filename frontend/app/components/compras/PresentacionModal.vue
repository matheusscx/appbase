<script setup lang="ts">
import Decimal from 'decimal.js'
import type { PresentacionCompra } from '~/composables/useCompras'

/**
 * Crear, editar o retirar una presentación de compra (pieza 2 § 3.1 y § 6):
 * "Caja" de 12 unidad, por (proveedor, producto). `presentacion` null = crear.
 * Molde: `DescuentoModal.vue`.
 */
const props = defineProps<{
  proveedorId: string
  item: { id: string, nombre: string, unidadMedida: string | null }
  presentacion: PresentacionCompra | null
}>()

const emit = defineEmits<{ guardada: [PresentacionCompra], retirada: [string] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const unidadesMedidaStore = useUnidadesMedidaStore()
const { cantidadParaEditar } = useCompras()

const editando = computed(() => props.presentacion != null)

const nombre = ref('')
const contenido = ref('')
const unidadCodigo = ref('')
const enviando = ref(false)
const retirarOpen = ref(false)

function resetear() {
  const p = props.presentacion
  nombre.value = p?.nombre ?? ''
  contenido.value = p ? cantidadParaEditar(p.contenido) : ''
  unidadCodigo.value = p?.unidadCodigo ?? props.item.unidadMedida ?? ''
  retirarOpen.value = false
}

watch(open, (v) => { if (v) resetear() }, { immediate: true })

/** Las unidades compatibles con la base del producto (mismo criterio que el
 *  selector de unidad de la línea, `pages/compras/[id].vue`): si la base es
 *  `unidad`, la única opción es `unidad` — queda fija sin lógica aparte. */
const unidadesCompatibles = computed<{ label: string, value: string }[]>(() => {
  const magnitud = unidadesMedidaStore.magnitudDe(props.item.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: u.codigo, value: u.codigo }))
})

const contenidoValido = computed(() => {
  const texto = contenido.value.trim()
  if (!texto) return false
  try {
    return new Decimal(texto).greaterThan(0)
  } catch {
    return false
  }
})

/** El body de crear (todos los campos) o de editar (solo lo que cambió, sin
 *  `null`): mismo idioma que `EditarPresentacionCompraDto` — ausente es "no se
 *  toca". */
function cuerpo(): Record<string, unknown> {
  if (!editando.value) {
    return {
      proveedorId: props.proveedorId,
      itemId: props.item.id,
      nombre: nombre.value.trim(),
      contenido: contenido.value.trim(),
      unidadCodigo: unidadCodigo.value,
    }
  }
  const actual = props.presentacion!
  const body: Record<string, unknown> = {}
  if (nombre.value.trim() !== actual.nombre) body.nombre = nombre.value.trim()
  if (contenido.value.trim() !== cantidadParaEditar(actual.contenido)) body.contenido = contenido.value.trim()
  if (unidadCodigo.value !== actual.unidadCodigo) body.unidadCodigo = unidadCodigo.value
  return body
}

/** Vacío o `0` no se manda; editando sin cambios tampoco — nada que corregir. */
const puedeGuardar = computed(() => {
  if (!nombre.value.trim() || !contenidoValido.value || !unidadCodigo.value) return false
  return !editando.value || Object.keys(cuerpo()).length > 0
})

async function guardar() {
  if (!puedeGuardar.value || enviando.value) return
  const body = cuerpo()
  enviando.value = true
  try {
    const res = editando.value
      ? await useApiFetch<PresentacionCompra>(
          `${apiUrl}/compras/presentaciones/${props.presentacion!.id}`,
          { method: 'PATCH', body },
        )
      : await useApiFetch<PresentacionCompra>(
          `${apiUrl}/compras/presentaciones`,
          { method: 'POST', body },
        )
    toast.add({ title: editando.value ? 'Presentación corregida' : 'Presentación creada', color: 'success' })
    open.value = false
    emit('guardada', res)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la presentación'), color: 'error' })
  }
  finally {
    enviando.value = false
  }
}

async function retirar() {
  if (!editando.value || enviando.value) return
  enviando.value = true
  try {
    await useApiFetch(`${apiUrl}/compras/presentaciones/${props.presentacion!.id}`, { method: 'DELETE' })
    toast.add({ title: 'Presentación retirada', color: 'success' })
    const id = props.presentacion!.id
    open.value = false
    emit('retirada', id)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al retirar la presentación'), color: 'error' })
  }
  finally {
    enviando.value = false
    retirarOpen.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="editando ? 'Corregir presentación' : 'Nueva presentación'"
    :description="item.nombre"
    :ui="shellUi.modal"
  >
    <template #body>
      <div class="flex flex-col gap-3" data-qa="presentacion-modal">
        <UFormField label="Nombre">
          <UInput
            v-model="nombre"
            placeholder="Caja"
            class="w-full"
            data-qa="presentacion-nombre"
          />
        </UFormField>
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Trae">
            <UInput
              v-model="contenido"
              inputmode="decimal"
              placeholder="12"
              class="w-full"
              data-qa="presentacion-contenido"
            />
          </UFormField>
          <UFormField label="Unidad">
            <USelect
              v-model="unidadCodigo"
              :items="unidadesCompatibles"
              :disabled="unidadesCompatibles.length <= 1"
              class="w-full"
              data-qa="presentacion-unidad"
            />
          </UFormField>
        </div>

        <div v-if="retirarOpen" class="flex flex-col gap-2 rounded-md border border-error/50 bg-error/5 p-3">
          <p class="text-sm text-default">
            Se retira del selector. Los borradores que la usan pasan a la unidad base al confirmar.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="ghost" size="sm" @click="() => { retirarOpen = false }" />
            <UButton
              label="Sí, retirar"
              color="error"
              size="sm"
              :loading="enviando"
              data-qa="presentacion-retirar-si"
              @click="retirar"
            />
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-between gap-2 w-full">
        <UButton
          v-if="editando"
          label="Retirar"
          color="error"
          variant="ghost"
          data-qa="presentacion-retirar"
          @click="() => { retirarOpen = true }"
        />
        <div class="flex flex-1 justify-end gap-2">
          <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
          <UButton
            label="Guardar"
            :loading="enviando"
            :disabled="!puedeGuardar"
            data-qa="presentacion-guardar"
            @click="guardar"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
