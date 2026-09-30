<script setup lang="ts">
import type { PresentacionCompra } from '~/composables/useCompras'
import type { DteLineaInfo, LineaDte } from '~/composables/useDte'

/** Un producto del catálogo de Compras (pieza 2 § 6): lo que hace falta para
 *  resolver el modo de inventario y la unidad base al elegirlo en una línea. */
export interface ProductoOpt {
  id: string
  nombre: string
  modoInventario: string | null
  unidadMedida: string | null
}

interface Opt { label: string, value: string }

/** Una línea del formulario de compra (borrador editable): espejo del estado
 *  que `pages/compras/[id].vue` guarda en `lineas`. */
export interface LineaForm {
  key: string
  itemId: string
  modoInventario: string | null
  unidadMedida: string | null
  cantidad: string
  unidadCodigo: string
  /** Una presentación del proveedor de la compra (pieza 2 § 4.1). Vacío =
   *  ninguna. Exactamente uno de `unidadCodigo`/`presentacionId` viaja. */
  presentacionId: string
  /** String vacío = falta costo: se completa cuando llega la factura. */
  precioUnitario: string
  /** Modo serie: una serie por renglón. */
  seriesTexto: string
  codigoLote: string
  fechaVencimiento: string
  /** Presente solo en una línea que vino del XML de la factura (tarea 4).
   *  `origen` es la línea cruda, para apartarla/traerla de vuelta sin perder
   *  sus datos (monto, unidad de la factura…) — nunca viaja al backend. */
  dte: (DteLineaInfo & { origen: LineaDte }) | null
}

/**
 * Una fila editable de `lineas` en `pages/compras/[id].vue` (backlog §1 de
 * `docs/agent/pendientes.md`, 2026-09-30): producto, cantidad, unidad o
 * presentación, precio, y los campos de serie o lote según `modoInventario`.
 *
 * Contrato como `ventas/CarritoPanel.vue`: `linea` entra de solo lectura y
 * cada cambio sale por un emit con su valor — la escritura la hace la
 * página, sobre el objeto real de `lineas.value` (nunca acá). El modal único
 * de presentación y los handlers que tocan varias filas a la vez
 * (`quitarLinea`, `apartarLinea`) también quedan en la página: acá solo
 * bajan sus botones, como emit.
 */
const props = defineProps<{
  linea: LineaForm
  productos: ProductoOpt[]
  presentaciones: PresentacionCompra[]
  proveedorId: string
}>()

const emit = defineEmits<{
  'seleccionar-item': [cambios: Partial<LineaForm>]
  'cambiar-cantidad': [cantidad: string]
  'cambiar-unidad': [cambios: Partial<LineaForm>]
  'nueva-presentacion': []
  'editar-presentacion': []
  'cambiar-precio': [precio: string]
  'cambiar-series': [cambios: Partial<LineaForm>]
  'cambiar-codigo-lote': [codigoLote: string]
  'cambiar-fecha-vencimiento': [fechaVencimiento: string]
  quitar: []
  apartar: []
}>()

const { formatMonto } = useFormatters()
const monedasStore = useMonedasStore()
const unidadesMedidaStore = useUnidadesMedidaStore()
const { totalLinea, etiquetaPresentacion, cuentaPresentacion } = useCompras()

const productoOpts = computed<Opt[]>(() => props.productos.map(p => ({ label: p.nombre, value: p.id })))

/** `u:<codigo>` / `p:<id>` / `''`: la traducción es propia de esta fila (no
 *  del composable), que es la única que arma el selector combinado. */
const valorUnidadActual = computed(() => {
  if (props.linea.presentacionId) return `p:${props.linea.presentacionId}`
  if (props.linea.unidadCodigo) return `u:${props.linea.unidadCodigo}`
  return ''
})

/** Las presentaciones de ESTE producto, ya elegidas por el proveedor vigente
 *  (`presentaciones` solo trae las del proveedor de la compra). */
const presentacionesDeLinea = computed(() =>
  props.presentaciones.filter(p => p.itemId === props.linea.itemId),
)

function presentacionDe(id: string) {
  return props.presentaciones.find(p => p.id === id)
}

/** La cuenta a la vista bajo la línea (spec § 6), o null sin presentación o
 *  sin una cantidad tipeable. */
const cuentaDeLinea = computed(() => {
  const p = presentacionDe(props.linea.presentacionId)
  if (!p) return null
  return cuentaPresentacion(
    props.linea.cantidad, p.contenido, p.unidadCodigo, props.linea.precioUnitario || null,
    monedasStore.monedaOficial,
  )
})

function unidadesCompatibles(): Opt[] {
  // Serie y lote solo admiten su unidad base (el backend lo rechaza si no).
  if (props.linea.modoInventario !== 'cantidad') {
    return props.linea.unidadMedida ? [{ label: props.linea.unidadMedida, value: props.linea.unidadMedida }] : []
  }
  const magnitud = unidadesMedidaStore.magnitudDe(props.linea.unidadMedida)
  if (!magnitud) return []
  return unidadesMedidaStore.unidades
    .filter(u => u.magnitud === magnitud)
    .map(u => ({ label: u.codigo, value: u.codigo }))
}

/**
 * El selector combinado (spec § 6): las unidades del catálogo, las
 * presentaciones de este proveedor para este producto, y "+ Nueva
 * presentación…" al final — deshabilitada sin proveedor o producto, ausente
 * en serie (ahí tampoco hay unidades del catálogo más que la base).
 */
const opcionesUnidad = computed<(Opt & { disabled?: boolean })[]>(() => {
  const items: (Opt & { disabled?: boolean })[] = [
    ...unidadesCompatibles().map(u => ({ label: u.label, value: `u:${u.value}` })),
    ...presentacionesDeLinea.value.map(p => ({ label: etiquetaPresentacion(p), value: `p:${p.id}` })),
  ]
  if (props.linea.modoInventario === 'serie') return items
  items.push({
    label: '+ Nueva presentación…',
    value: 'nueva',
    disabled: !props.proveedorId || !props.linea.itemId,
  })
  return items
})

const totalLineaTexto = computed(() => {
  const t = totalLinea(props.linea.cantidad, props.linea.precioUnitario || null)
  return t != null ? formatMonto(t) : '—'
})

/** Resetea todo lo que depende del producto elegido: un solo emit con los
 *  campos de una vez (no uno por campo) — la página los escribe de una. */
function onSeleccionarItem(itemId: string) {
  const producto = props.productos.find(p => p.id === itemId)
  const modoInventario = producto?.modoInventario ?? 'cantidad'
  // Una línea del XML no hereda la unidad base (tarea 4 § 6): "3 CJ" no es "3
  // unidad", y la real sale de que el encargado la asocie. Serie y lote solo
  // admiten la base de todos modos, así que ahí sí se fija.
  const dejarUnidadVacia = !!props.linea.dte && modoInventario === 'cantidad'
  emit('seleccionar-item', {
    itemId,
    modoInventario,
    unidadMedida: producto?.unidadMedida ?? null,
    unidadCodigo: dejarUnidadVacia ? '' : (producto?.unidadMedida ?? ''),
    presentacionId: '',
    seriesTexto: '',
    codigoLote: '',
    fechaVencimiento: '',
  })
}

function onCambiarUnidad(valor: string) {
  if (valor === 'nueva') {
    emit('nueva-presentacion')
    return
  }
  if (valor.startsWith('p:')) {
    emit('cambiar-unidad', { presentacionId: valor.slice(2), unidadCodigo: '' })
    return
  }
  if (valor.startsWith('u:')) {
    emit('cambiar-unidad', { presentacionId: '', unidadCodigo: valor.slice(2) })
  }
}

// En serie, la cantidad es la cuenta de las series, no un campo aparte que se
// pueda desincronizar (mismo criterio que traslados).
function onSeriesChange(texto: string) {
  const series = texto.split('\n').map(s => s.trim()).filter(Boolean)
  emit('cambiar-series', { seriesTexto: texto, cantidad: String(series.length) })
}
</script>

<template>
  <div class="border border-default rounded-md p-4 space-y-3" data-qa="compra-linea">
    <div class="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
      <UFormField label="Producto" class="md:col-span-4">
        <USelectMenu
          :model-value="linea.itemId"
          :items="productoOpts"
          value-key="value"
          searchable
          placeholder="Selecciona un producto"
          class="w-full"
          @update:model-value="(v: string) => onSeleccionarItem(v)"
        />
      </UFormField>
      <UFormField label="Cantidad" class="md:col-span-2">
        <UInput
          :model-value="linea.cantidad"
          inputmode="decimal"
          placeholder="0"
          :disabled="linea.modoInventario === 'serie'"
          class="w-full"
          data-qa="compra-cantidad"
          @update:model-value="(v: string) => emit('cambiar-cantidad', v)"
        />
      </UFormField>
      <UFormField label="Unidad" class="md:col-span-2">
        <div class="flex items-center gap-1">
          <USelect
            :model-value="valorUnidadActual"
            :items="opcionesUnidad"
            :disabled="!linea.itemId"
            class="w-full"
            @update:model-value="(v: string) => onCambiarUnidad(v)"
          />
          <UButton
            v-if="linea.presentacionId"
            icon="i-lucide-pencil"
            variant="ghost"
            size="sm"
            :data-qa="`compra-presentacion-editar-${linea.key}`"
            @click="emit('editar-presentacion')"
          />
        </div>
      </UFormField>
      <UFormField label="Precio unitario" class="md:col-span-2">
        <MoneyInput
          :model-value="linea.precioUnitario"
          oficial
          placeholder="Sin precio"
          class="w-full"
          data-qa="compra-precio"
          @update:model-value="(v: string) => emit('cambiar-precio', v)"
        />
      </UFormField>
      <div class="md:col-span-2 flex items-center justify-between gap-2">
        <span class="text-sm tabular-nums text-muted" data-qa="compra-total-linea">
          {{ totalLineaTexto }}
        </span>
        <UButton
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          size="sm"
          @click="emit('quitar')"
        />
      </div>
    </div>

    <p
      v-if="cuentaDeLinea"
      class="text-xs text-muted"
      data-qa="compra-cuenta-presentacion"
    >
      {{ cuentaDeLinea }}
    </p>

    <div v-if="linea.dte" class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted" data-qa="compra-dte-texto">{{ linea.dte.texto }}</span>
        <UBadge
          v-if="linea.dte.calzo"
          label="Calzó por código"
          color="neutral"
          variant="subtle"
          data-qa="compra-dte-calzo"
        />
        <UBadge
          v-else
          label="Por asociar"
          color="warning"
          variant="subtle"
          data-qa="compra-dte-por-asociar"
        />
      </div>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        data-qa="compra-dte-no-mercaderia"
        @click="emit('apartar')"
      >
        No es mercadería
      </UButton>
    </div>
    <p v-if="linea.dte?.nota" class="text-xs text-muted" data-qa="compra-dte-nota">
      {{ linea.dte.nota }}
    </p>
    <p v-if="linea.dte?.conAjusteDeLinea" class="text-xs text-muted" data-qa="compra-dte-ajuste">
      Incluye el descuento o recargo de la línea de la factura
    </p>

    <UFormField
      v-if="linea.modoInventario === 'serie'"
      label="Series (una por renglón)"
    >
      <UTextarea
        :model-value="linea.seriesTexto"
        :rows="3"
        class="w-full"
        @update:model-value="(v: string) => onSeriesChange(v)"
      />
    </UFormField>
    <div v-if="linea.modoInventario === 'lote'" class="grid grid-cols-2 gap-3">
      <UFormField label="Lote" required>
        <UInput
          :model-value="linea.codigoLote"
          placeholder="Código del lote"
          class="w-full"
          @update:model-value="(v: string) => emit('cambiar-codigo-lote', v)"
        />
      </UFormField>
      <UFormField label="Vence">
        <UInput
          :model-value="linea.fechaVencimiento"
          type="date"
          class="w-full"
          @update:model-value="(v: string) => emit('cambiar-fecha-vencimiento', v)"
        />
      </UFormField>
    </div>
  </div>
</template>
