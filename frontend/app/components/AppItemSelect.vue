<script setup lang="ts" generic="T extends { id: string, nombre: string }">
/**
 * Selector de ítems con búsqueda en el servidor (spec
 * docs/superpowers/specs/2026-10-03-catalogo-paginado-design.md § 5): reemplaza al
 * `USelectMenu` que filtraba en el cliente sobre los primeros 100 ítems.
 *
 * ⚠️ **Las opciones son la UNIÓN de los resultados con los elegidos.** Un `USelectMenu` con
 * `value-key` pinta el nombre buscando el valor entre `items`; si el elegido no está en la
 * página de resultados se ve vacío. Los elegidos salen de `catalogo.porId`, y los que la
 * pantalla todavía no vio se piden con `catalogo.resolver` apenas cambia el modelo.
 *
 * `excluir` saca ids de los resultados (filas hermanas, el propio ítem) pero nunca a un
 * elegido: quitarlo de las opciones lo dejaría sin nombre.
 */
import type { FiltrosItems, ItemsPorId } from '~/composables/useItemsPorId'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** El caché de la pantalla (`useItemsPorId`): de ahí leen también sus cuentas. */
    catalogo: ItemsPorId<T>
    filtros?: FiltrosItems
    multiple?: boolean
    excluir?: string[]
    etiqueta?: (item: T) => string
    placeholder?: string
    disabled?: boolean
    clear?: boolean
  }>(),
  {
    filtros: () => ({}),
    multiple: false,
    excluir: () => [],
    etiqueta: undefined,
    placeholder: undefined,
    disabled: false,
    clear: false,
  },
)

/** `string[]` con `multiple`; `string | null` sin él. */
const model = defineModel<string | string[] | null>()

const ESPERA_BUSQUEDA_MS = 300

const toast = useToast()
const termino = ref('')
// `shallowRef`: `ref` desenvolvería `T` genérico (`UnwrapRefSimple<T>`) y no compilaría.
const resultados = shallowRef<T[]>([])
const buscando = ref(false)
const abierto = ref(false)
// Descarta la respuesta que llega tarde (mismo patrón que `useCatalogoVenta`).
let turno = 0
let espera: ReturnType<typeof setTimeout> | null = null

const elegidos = computed<string[]>(() => {
  const v = model.value
  if (Array.isArray(v)) return v
  return v ? [v] : []
})

function rotulo(item: T): string {
  return props.etiqueta ? props.etiqueta(item) : item.nombre
}

const opciones = computed(() => {
  const vistos = new Set<string>()
  const salida: { value: string, label: string }[] = []
  for (const id of elegidos.value) {
    const item = props.catalogo.porId.get(id)
    if (!item || vistos.has(id)) continue
    vistos.add(id)
    salida.push({ value: id, label: rotulo(item) })
  }
  const fuera = new Set(props.excluir)
  for (const item of resultados.value) {
    if (vistos.has(item.id) || fuera.has(item.id)) continue
    vistos.add(item.id)
    salida.push({ value: item.id, label: rotulo(item) })
  }
  return salida
})

async function buscar(q: string) {
  const mio = ++turno
  buscando.value = true
  try {
    const res = await props.catalogo.buscar(q.trim(), props.filtros)
    if (mio === turno) resultados.value = res
  }
  catch (e: unknown) {
    if (mio === turno) toast.add({ title: apiErrorMsg(e, 'Error al buscar ítems'), color: 'error' })
  }
  finally {
    if (mio === turno) buscando.value = false
  }
}

function cancelarEspera() {
  if (espera) clearTimeout(espera)
  espera = null
}

watch(termino, (q) => {
  cancelarEspera()
  espera = setTimeout(() => {
    espera = null
    void buscar(q)
  }, ESPERA_BUSQUEDA_MS)
})

function onOpen(estaAbierto: boolean) {
  abierto.value = estaAbierto
  if (!estaAbierto) return
  cancelarEspera()
  void buscar(termino.value)
}

// Otros filtros, otros resultados. `turno++` invalida la búsqueda en vuelo (pedida con los filtros
// viejos): sin eso aterriza después y muestra resultados que ya no corresponden. Con el menú
// abierto se vuelve a buscar de inmediato; cerrado, la próxima apertura busca.
watch(() => JSON.stringify(props.filtros), () => {
  turno++
  buscando.value = false
  resultados.value = []
  if (abierto.value) {
    cancelarEspera()
    void buscar(termino.value)
  }
})

watch(
  () => elegidos.value.join(','),
  async () => {
    try { await props.catalogo.resolver(elegidos.value) }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'No se pudo cargar un ítem elegido'), color: 'error' })
    }
  },
  { immediate: true },
)

onBeforeUnmount(cancelarEspera)
</script>

<template>
  <USelectMenu
    v-bind="$attrs"
    :model-value="(model as string & string[] | undefined)"
    v-model:search-term="termino"
    :items="opciones"
    value-key="value"
    :multiple="multiple"
    ignore-filter
    :loading="buscando"
    :placeholder="placeholder"
    :disabled="disabled"
    :clear="clear"
    @update:model-value="(v: unknown) => (model = v as string | string[] | null)"
    @update:open="onOpen"
  />
</template>
