<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Row } from '@tanstack/vue-table'
import type { TableColumn } from '@nuxt/ui'
import type { TendenciaDescuadres } from '~/stores/caja'

const cajaStore = useCajaStore()
const toast = useToast()
const { formatMonto } = useFormatters()

/** `YYYY-MM-DD` en la zona del navegador. `toISOString()` daría UTC y al oeste
 *  de Greenwich correría los dos bordes un día después de las ~21:00 local. */
function fechaLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

function haceDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return fechaLocal(d)
}

const filtroDesde = ref(haceDias(30))
const filtroHasta = ref(fechaLocal(new Date()))

const filas = ref<TendenciaDescuadres[]>([])
const loading = ref(false)
const fallo = ref(false)

// Cola serial, mismo patrón que `configuracion/categorias.vue` → `cargar()` y
// que el `fetchEnCurso` de `usePaginatedList`: cada invocación espera a la
// anterior antes de escribir `filas`, así el orden de escritura queda atado al
// orden en que el supervisor movió los filtros y no a qué respuesta de red
// llega primero. Son DOS `AppDateInput` y un `watch` sobre los dos, así que
// mover `desde` y después `hasta` deja dos GET en vuelo.
//
// Acá pesa más que en un listado común: sin la cola, una respuesta vieja que
// llega tarde repuebla `filas` y **borra el cartel de error** —el `#empty` deja
// de renderizarse porque la lista ya no está vacía—, o sea que anula la
// protección de abajo y encima muestra los agregados de OTRO rango como si
// fueran los del rango pedido.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    fallo.value = false
    try {
      filas.value = await cajaStore.cargarTendencia(
        filtroDesde.value || undefined,
        filtroHasta.value || undefined,
      )
    }
    catch (e: unknown) {
      // Sin esto, un 500 o un corte de red dejaba la tabla en su estado vacío —
      // y en una pantalla antifraude "no pude cargar" se leía como "no hay
      // descuadres", que es la lectura opuesta. La lista se vacía a propósito:
      // mejor sin datos que con datos que mienten.
      filas.value = []
      fallo.value = true
      toast.add({ title: apiErrorMsg(e, 'Error al cargar la tendencia'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch([filtroDesde, filtroHasta], cargar)
onMounted(cargar)

// Los tres conteos son de la LÍNEA DE EFECTIVO, no del arqueo entero, así que
// el rótulo lo dice **en el header de la columna** y no solo en el párrafo de
// arriba: quien lee la tabla sola tiene que verlo igual. Sin eso, una caja con
// el efectivo exacto y -500 en tarjeta se lee como "cuadrada" a secas.
const columns: TableColumn<TendenciaDescuadres>[] = [
  { accessorKey: 'usuarioNombre', header: 'Cajero' },
  { accessorKey: 'cierres', header: 'Cierres', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'efectivoSuma', header: 'Efectivo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'otrosMediosSuma', header: 'Otros medios', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'conFaltante', header: 'Turnos con faltante de efectivo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'conSobrante', header: 'Turnos con sobrante de efectivo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'cuadrados', header: 'Turnos cuadrados en efectivo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

/** Tres estados, no dos: el cero no es "positivo" y no lleva signo ni verde. */
function claseMonto(val: string): string {
  const d = new Decimal(val)
  if (d.isZero()) return 'text-muted'
  return d.gt(0)
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400'
}

function signo(val: string): string {
  return new Decimal(val).gt(0) ? '+' : ''
}

// Al detalle de ESE cajero: `/cajas/historial` ya lee `usuarioId` de la query.
// El guard no es decorativo: `usuarioId` es nullable (la caja puede no tener
// dueño) y sin él la fila navegaba a `?usuarioId=null`, que filtra por un
// usuario inexistente y devuelve una lista vacía sin ningún error visible.
function onSelectFila(_e: Event, row: Row<TendenciaDescuadres>) {
  if (!row.original.usuarioId) return
  navigateTo(`/cajas/historial?usuarioId=${row.original.usuarioId}`)
}
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Lo que delata no es el monto sino el lado: un cajero descuadra más porque
          su caja es la más cargada, pero descuadrar
          <strong>siempre para el mismo lado</strong> es otra cosa.
        </p>
        <p class="text-sm text-muted">
          Las tres columnas de turnos cuentan <strong>solo el efectivo</strong>: una
          caja con el efectivo exacto y −500 en tarjeta figura como turno cuadrado, y
          ese −500 aparece en <strong>Otros medios</strong>. Van separadas a propósito
          — el robo vive en el efectivo, pero ningún descuadre se esconde.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <AppDateInput v-model="filtroDesde" class="w-40" qa="tendencia-desde" />
          <AppDateInput v-model="filtroHasta" class="w-40" qa="tendencia-hasta" />
        </div>
      </div>
    </template>

    <UTable
      :data="filas"
      :columns="columns"
      :loading="loading"
      :ui="{ tr: 'cursor-pointer' }"
      @select="onSelectFila"
    >
      <template #efectivoSuma-cell="{ row }">
        <span class="font-mono font-semibold" :class="claseMonto(row.original.efectivoSuma)">
          {{ signo(row.original.efectivoSuma) }}{{ formatMonto(row.original.efectivoSuma) }}
        </span>
      </template>
      <template #otrosMediosSuma-cell="{ row }">
        <span class="font-mono" :class="claseMonto(row.original.otrosMediosSuma)">
          {{ signo(row.original.otrosMediosSuma) }}{{ formatMonto(row.original.otrosMediosSuma) }}
        </span>
      </template>
      <template #empty>
        <div v-if="fallo" class="py-10 text-center text-sm text-error">
          No se pudo cargar la tendencia. Volvé a intentar — esto no significa que
          no haya descuadres.
        </div>
        <div v-else-if="loading" class="py-10 text-center text-sm text-muted">
          Cargando…
        </div>
        <!-- Recién cuando terminó de cargar se puede afirmar que no hay nada:
             decirlo mientras el GET está en vuelo es la misma lectura invertida
             que previene el `catch`, corrida a la ventana de carga. -->
        <div v-else class="py-10 text-center text-sm text-muted">
          Ninguna caja con el conteo cerrado en este rango.
        </div>
      </template>
    </UTable>
  </UCard>
</template>
