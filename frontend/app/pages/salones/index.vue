<script setup lang="ts">
import Decimal from 'decimal.js'
import { descontarStockCatalogo, type ItemCatalogo, type PagoInput } from '~/composables/useVenta'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import {
  cuentaToCalcularInput,
  precioUnitarioLinea,
  type SalonConMesas,
  type MesaResumen,
  type CuentaDetalle,
  type CuentaLineaDetalle,
} from '~/composables/useSalones'
import type { PersonalizacionPayload } from '~/composables/useRecetaPersonalizacion'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface TipoDoc { id: string, nombre: string, customerRequerido: boolean }
interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const toast = useToast()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const cajaStore = useCajaStore()
const salonesApi = useSalones()
const { calcular } = useCalculoPrecios()
const { formatMonto } = useFormatters()
const impresorasApi = useImpresoras()
const tenantStore = useTenantStore()

const enviandoComanda = ref(false)
const imprimiendoPrecuenta = ref(false)

const salones = ref<SalonConMesas[]>([])
const loading = ref(false)
const selectedSalonId = ref<string | undefined>(undefined)

const items = ref<ItemCatalogo[]>([])
const metodos = ref<MetodoPago[]>([])
const tiposDocumento = ref<TipoDoc[]>([])
const loadingCatalogo = ref(false)

const selectedMesa = ref<MesaResumen | null>(null)
const mesaDrawerOpen = ref(false)
const cuentas = ref<CuentaDetalle[]>([])
const loadingCuentas = ref(false)
const activeCuenta = ref<CuentaDetalle | null>(null)

/** Catálogo restando lo ya pedido en las cuentas abiertas de la mesa (stock / disponible). */
const itemsVisibles = computed(() => {
  const reservas = cuentas.value.flatMap(c =>
    c.lineas.map(l => ({ item: { id: l.itemId }, cantidad: l.cantidad })),
  )
  return descontarStockCatalogo(items.value, reservas)
})
const resultado = ref<ResultadoVenta | null>(null)

const fusionMode = ref(false)
const seleccionadasFusion = ref<string[]>([])
const fusionando = ref(false)

const cobroOpen = ref(false)
const submitting = ref(false)
const cancelOpen = ref(false)
const recetaDrawerOpen = ref(false)
const recetaItemId = ref<string | null>(null)

// ── Identificación de garzón por PIN ───────────────────────────────────────
const pinModalOpen = ref(false)
const pinModalTitle = ref('Identifícate con tu PIN')
let pinAction: ((pin: string, nombre: string) => void) | null = null

function solicitarPin(
  title: string,
  action: (pin: string, nombre: string) => void,
) {
  pinModalTitle.value = title
  pinAction = action
  pinModalOpen.value = true
}

function onPinConfirmado(pin: string, nombre: string) {
  const action = pinAction
  pinAction = null
  action?.(pin, nombre)
}

const selectedSalon = computed(() =>
  salones.value.find(s => s.id === selectedSalonId.value) ?? null,
)
const salonItems = computed(() =>
  salones.value.map(s => ({ label: s.nombre, value: s.id })),
)
const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')

// En el detalle de cuenta cada columna scrollea internamente (catálogo / líneas),
// así que el body del drawer no debe scrollear como unidad (evita el doble scroll).
const drawerBodyUi = computed(() => ({
  body: activeCuenta.value
    ? 'flex-1 min-h-0 overflow-hidden px-6 py-4'
    : 'flex-1 min-h-0 overflow-y-auto px-6 py-4',
}))

async function cargarSalones() {
  loading.value = true
  try {
    salones.value = await salonesApi.listarOperacion()
    if (!selectedSalonId.value || !selectedSalon.value) {
      selectedSalonId.value = salones.value[0]?.id ?? undefined
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar salones'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

/** Ajusta el contador de cuentas abiertas/ocupación sin re-fetch de salones. */
function patchMesaOcupacion(mesaId: string, deltaAbiertas: number) {
  for (const salon of salones.value) {
    const mesa = salon.mesas.find(m => m.id === mesaId)
    if (!mesa) continue
    mesa.cuentasAbiertas = Math.max(0, mesa.cuentasAbiertas + deltaAbiertas)
    mesa.ocupada = mesa.cuentasAbiertas > 0
    if (selectedMesa.value?.id === mesaId) {
      selectedMesa.value = { ...mesa }
    }
    break
  }
}

async function cargarCatalogo() {
  loadingCatalogo.value = true
  try {
    // Solo tipos vendibles (producto + receta). Los ingredientes (y resto) no van al catálogo.
    const [productosRes, recetasRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=producto&pageSize=100`),
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?tipo=receta&pageSize=100`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = [...productosRes.data, ...recetasRes.data]
    metodos.value = metodosRes
    tiposDocumento.value = tiposRes
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar el catálogo'), color: 'error' })
  }
  finally {
    loadingCatalogo.value = false
  }
}

onMounted(async () => {
  await Promise.all([cajaStore.cargarActiva(), cargarSalones(), cargarCatalogo()])
})

// ── Selección de mesa ──────────────────────────────────────────────────────
async function onSelectMesa(mesa: MesaResumen) {
  selectedMesa.value = mesa
  activeCuenta.value = null
  resultado.value = null
  fusionMode.value = false
  seleccionadasFusion.value = []
  mesaDrawerOpen.value = true
  await cargarCuentas(mesa.id)
}

async function cargarCuentas(mesaId: string) {
  loadingCuentas.value = true
  try {
    cuentas.value = await salonesApi.listarCuentas(mesaId)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar cuentas'), color: 'error' })
  }
  finally {
    loadingCuentas.value = false
  }
}

async function recalcular() {
  const cuenta = activeCuenta.value
  if (!cuenta || cuenta.lineas.length === 0) {
    resultado.value = null
    return
  }
  try {
    resultado.value = await calcular(cuentaToCalcularInput(cuenta))
  }
  catch {
    resultado.value = null
  }
}

function nuevaCuenta() {
  if (!selectedMesa.value) return
  solicitarPin('PIN del garzón para abrir la cuenta', (pin, nombre) => {
    void abrirCuentaConPin(pin, nombre)
  })
}

async function abrirCuentaConPin(pin: string, nombre: string) {
  if (!selectedMesa.value) return
  try {
    const mesaId = selectedMesa.value.id
    const cuenta = await salonesApi.abrirCuenta(mesaId, pin)
    cuentas.value.push(cuenta)
    patchMesaOcupacion(mesaId, 1)
    abrirCuenta(cuenta)
    toast.add({ title: `Cuenta abierta por ${nombre}`, color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al abrir la cuenta'), color: 'error' })
  }
}

function abrirCuenta(cuenta: CuentaDetalle) {
  if (fusionMode.value) {
    toggleSeleccionFusion(cuenta)
    return
  }
  activeCuenta.value = cuenta
  void recalcular()
}

function volverACuentas() {
  activeCuenta.value = null
  resultado.value = null
}

// ── Fusionar cuentas (ej. "1 y 3", "3 y 4" o todas) ────────────────────────
function toggleFusionMode() {
  fusionMode.value = !fusionMode.value
  seleccionadasFusion.value = []
}

function toggleSeleccionFusion(cuenta: CuentaDetalle) {
  const idx = seleccionadasFusion.value.indexOf(cuenta.id)
  if (idx === -1) seleccionadasFusion.value.push(cuenta.id)
  else seleccionadasFusion.value.splice(idx, 1)
}

function seleccionarTodasFusion() {
  seleccionadasFusion.value = cuentas.value.map(c => c.id)
}

async function fusionarSeleccionadas() {
  if (!selectedMesa.value || seleccionadasFusion.value.length < 2) return
  fusionando.value = true
  try {
    const fusedIds = new Set(seleccionadasFusion.value)
    const cuenta = await salonesApi.fusionarCuentas(selectedMesa.value.id, seleccionadasFusion.value)
    const eliminadas = cuentas.value.filter(c => fusedIds.has(c.id) && c.id !== cuenta.id).length
    cuentas.value = [
      cuenta,
      ...cuentas.value.filter(c => !fusedIds.has(c.id)),
    ]
    if (eliminadas > 0) {
      patchMesaOcupacion(selectedMesa.value.id, -eliminadas)
    }
    toast.add({ title: `Cuentas fusionadas en Cuenta ${cuenta.numero}`, color: 'success' })
    fusionMode.value = false
    seleccionadasFusion.value = []
    activeCuenta.value = cuenta
    void recalcular()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al fusionar las cuentas'), color: 'error' })
  }
  finally {
    fusionando.value = false
  }
}

function syncCuenta(cuenta: CuentaDetalle) {
  activeCuenta.value = cuenta
  const idx = cuentas.value.findIndex(c => c.id === cuenta.id)
  if (idx !== -1) cuentas.value[idx] = cuenta
  void recalcular()
}

// ── Líneas de la cuenta ────────────────────────────────────────────────────
function personalizacionVacia(p: PersonalizacionPayload): boolean {
  return p.omitidos.length === 0 && p.extras.length === 0 && !p.comentario?.trim()
}

async function addProducto(item: ItemCatalogo) {
  if (!activeCuenta.value) return
  if (item.tipo === 'receta') {
    recetaItemId.value = item.id
    recetaDrawerOpen.value = true
    return
  }
  try {
    const cuenta = await salonesApi.agregarLinea(activeCuenta.value.id, item.id, '1')
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al agregar el producto'), color: 'error' })
  }
}

async function onRecetaConfirm(payload: PersonalizacionPayload, _resumen: string, _precioPreview?: string) {
  if (!activeCuenta.value || !recetaItemId.value) return
  try {
    const personalizacion = personalizacionVacia(payload) ? undefined : payload
    const cuenta = await salonesApi.agregarLinea(
      activeCuenta.value.id,
      recetaItemId.value,
      '1',
      personalizacion,
    )
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al agregar la receta'), color: 'error' })
  }
  finally {
    recetaDrawerOpen.value = false
    recetaItemId.value = null
  }
}

async function cambiarCantidad(linea: CuentaLineaDetalle, cantidad: string) {
  if (!activeCuenta.value || !cantidad || new Decimal(cantidad || '0').lte(0)) return
  try {
    const cuenta = await salonesApi.actualizarLinea(activeCuenta.value.id, linea.id, cantidad)
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar la cantidad'), color: 'error' })
  }
}

async function quitarLinea(linea: CuentaLineaDetalle) {
  if (!activeCuenta.value) return
  try {
    const cuenta = await salonesApi.quitarLinea(activeCuenta.value.id, linea.id)
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al quitar el producto'), color: 'error' })
  }
}

function lineaSubtotal(linea: CuentaLineaDetalle): string {
  return new Decimal(precioUnitarioLinea(linea)).times(linea.cantidad || '0').toString()
}

// ── Comanda / precuenta ─────────────────────────────────────────────────────
async function enviarComanda() {
  if (!activeCuenta.value || !selectedMesa.value) return
  enviandoComanda.value = true
  try {
    const estaciones = await impresorasApi.imprimirComanda(activeCuenta.value.id, {
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      garzonNombre: activeCuenta.value.garzonAperturaNombre,
    })
    // null = no hay impresoras de comanda activas → se saltó el flujo sin toast.
    if (estaciones === null) return
    toast.add({
      title: estaciones.length === 0
        ? 'No hay productos nuevos para enviar'
        : `Comanda enviada a ${estaciones.length} estación(es)`,
      color: estaciones.length === 0 ? 'neutral' : 'success',
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al enviar la comanda (¿QZ Tray está abierto?)'), color: 'error' })
  }
  finally {
    enviandoComanda.value = false
  }
}

// Recibe el resultado explícito (no lee `resultado.value` vivo): al cerrar la cuenta
// el ref puede recomputarse, así que el llamador pasa el snapshot que capturó.
function itemsParaTicket(cuenta: CuentaDetalle, res: ResultadoVenta) {
  return res.lineas.map(l => ({
    nombre: cuenta.lineas.find(cl => cl.itemId === l.itemId)?.nombre ?? '',
    cantidad: l.cantidad,
    totalLinea: l.totalLinea,
  }))
}

async function imprimirPrecuenta() {
  if (!activeCuenta.value || !selectedMesa.value || !resultado.value) return
  imprimiendoPrecuenta.value = true
  try {
    await impresorasApi.imprimirPrecuenta({
      tenantNombre: tenantStore.activeTenant?.nombre ?? '',
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      items: itemsParaTicket(activeCuenta.value, resultado.value),
      totales: resultado.value.totales,
      formatMonto: (v: string) => formatMonto(v),
    })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al imprimir la precuenta (¿QZ Tray está abierto?)'), color: 'error' })
  }
  finally {
    imprimiendoPrecuenta.value = false
  }
}

// ── Cancelar / cerrar cuenta ───────────────────────────────────────────────
async function confirmarCancelar() {
  if (!activeCuenta.value || !selectedMesa.value) return
  try {
    const mesaId = selectedMesa.value.id
    await salonesApi.cancelarCuenta(activeCuenta.value.id)
    toast.add({ title: 'Cuenta cancelada', color: 'success' })
    cuentas.value = cuentas.value.filter(c => c.id !== activeCuenta.value?.id)
    patchMesaOcupacion(mesaId, -1)
    volverACuentas()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cancelar la cuenta'), color: 'error' })
  }
  finally {
    cancelOpen.value = false
  }
}

function confirmarCobro(pagos: PagoInput[]) {
  if (!activeCuenta.value) return
  // El cobro recolecta los pagos; el PIN identifica al garzón que cierra.
  cobroOpen.value = false
  solicitarPin('PIN del garzón para cerrar la cuenta', (pin) => {
    void cerrarCuentaConPin(pagos, pin)
  })
}

async function cerrarCuentaConPin(pagos: PagoInput[], pin: string) {
  if (!activeCuenta.value) return
  submitting.value = true
  const cuentaCerrada = activeCuenta.value
  const resultadoCerrado = resultado.value
  try {
    await salonesApi.cerrarCuenta(cuentaCerrada.id, {
      pin,
      pagos,
      tipoDocumentoId: tiposDocumento.value[0]?.id,
    })
    toast.add({ title: 'Cuenta cerrada — venta generada', color: 'success' })

    if (resultadoCerrado) {
      try {
        await impresorasApi.imprimirBoleta({
          tenantNombre: tenantStore.activeTenant?.nombre ?? '',
          items: itemsParaTicket(cuentaCerrada, resultadoCerrado),
          totales: resultadoCerrado.totales,
          pagos: pagos.map(p => ({
            nombre: metodos.value.find(m => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          formatMonto: (v: string) => formatMonto(v),
        })
      }
      catch (e: unknown) {
        toast.add({ title: apiErrorMsg(e, 'Venta generada, pero falló la impresión de la boleta'), color: 'warning' })
      }
    }

    cuentas.value = cuentas.value.filter(c => c.id !== cuentaCerrada.id)
    if (selectedMesa.value) {
      patchMesaOcupacion(selectedMesa.value.id, -1)
    }
    const pagosConMonto = pagos.filter(p => new Decimal(p.monto || '0').gt(0))
    const bruto = pagosConMonto.reduce(
      (acc, p) => acc.plus(p.monto || '0'),
      new Decimal(0),
    )
    // Vuelto no viene en el cierre de cuenta aquí; el neto se aproxima con el total cobrado.
    const neto = resultadoCerrado
      ? Decimal.min(bruto, new Decimal(resultadoCerrado.totales.totalFinal)).toFixed(4)
      : bruto.toFixed(4)
    cajaStore.aplicarCobroLocal(neto, pagosConMonto.length)
    volverACuentas()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cerrar la cuenta'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Salones">
        <template #right>
          <UBadge
            v-if="tieneCaja"
            label="Caja abierta"
            color="success"
            variant="soft"
            icon="i-lucide-banknote"
            class="mr-2"
          />
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <div v-if="loading" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader" class="h-8 w-8 animate-spin text-muted" />
        </div>

        <div v-else-if="salones.length === 0" class="py-12 text-center text-sm text-muted">
          No hay salones configurados. Pídele a un administrador que los cree.
        </div>

        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <USelectMenu
              v-model="selectedSalonId"
              :items="salonItems"
              value-key="value"
              class="w-56"
            />
            <p class="text-sm text-muted">
              Selecciona una mesa para gestionar sus cuentas.
            </p>
          </div>

          <SalonesSalonPlano
            v-if="selectedSalon"
            :mesas="selectedSalon.mesas"
            @select="onSelectMesa"
          />
        </template>
      </div>

      <!-- Drawer de la mesa: lista de cuentas o detalle de una cuenta -->
      <AppDrawer v-model:open="mesaDrawerOpen" width="90%" :ui="drawerBodyUi">
        <template #header>
          <div class="flex items-center gap-2 sm:gap-3">
            <UButton
              v-if="activeCuenta"
              icon="i-lucide-arrow-left"
              label="Cuentas"
              color="neutral"
              variant="subtle"
              size="sm"
              @click="volverACuentas"
            />
            <span class="font-semibold text-default">
              {{ selectedMesa?.nombre }}
              <template v-if="activeCuenta"> — Cuenta {{ activeCuenta.numero }}</template>
            </span>
            <span
              v-if="activeCuenta?.garzonAperturaNombre"
              class="flex items-center gap-1 text-xs text-muted"
            >
              <UIcon name="i-lucide-user" class="size-3" />
              {{ activeCuenta.garzonAperturaNombre }}
            </span>
          </div>
        </template>

        <template #body>
          <!-- Lista de cuentas de la mesa -->
          <div v-if="!activeCuenta" class="space-y-4">
            <div class="flex flex-wrap items-center justify-end gap-2">
              <UButton
                v-if="cuentas.length >= 2"
                icon="i-lucide-merge"
                color="neutral"
                :variant="fusionMode ? 'solid' : 'soft'"
                @click="toggleFusionMode"
              >
                {{ fusionMode ? 'Cancelar fusión' : 'Fusionar cuentas' }}
              </UButton>
              <UButton icon="i-lucide-plus" @click="nuevaCuenta">
                Nueva cuenta
              </UButton>
            </div>

            <div v-if="fusionMode" class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-muted p-3">
              <p class="text-sm text-muted">
                Selecciona las cuentas a combinar (ej. 1 y 3, 3 y 4, o todas). Se fusionan en la de menor número.
              </p>
              <div class="ml-auto flex items-center gap-2">
                <UButton size="sm" color="neutral" variant="ghost" @click="seleccionarTodasFusion">
                  Todas
                </UButton>
                <UButton
                  size="sm"
                  :disabled="seleccionadasFusion.length < 2"
                  :loading="fusionando"
                  @click="fusionarSeleccionadas"
                >
                  Fusionar ({{ seleccionadasFusion.length }})
                </UButton>
              </div>
            </div>

            <div v-if="loadingCuentas" class="flex justify-center py-8">
              <UIcon name="i-lucide-loader" class="h-6 w-6 animate-spin text-muted" />
            </div>
            <div v-else-if="cuentas.length === 0" class="py-8 text-center text-sm text-muted">
              La mesa no tiene cuentas abiertas. Crea una nueva para empezar.
            </div>
            <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <UCard
                v-for="cuenta in cuentas"
                :key="cuenta.id"
                class="cursor-pointer transition-colors hover:bg-muted"
                :class="fusionMode && seleccionadasFusion.includes(cuenta.id) ? 'ring-2 ring-primary' : ''"
                @click="abrirCuenta(cuenta)"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <UCheckbox
                      v-if="fusionMode"
                      :model-value="seleccionadasFusion.includes(cuenta.id)"
                      @click.stop="toggleSeleccionFusion(cuenta)"
                    />
                    <div>
                      <p class="font-semibold text-default">Cuenta {{ cuenta.numero }}</p>
                      <p class="text-sm text-muted">
                        {{ cuenta.lineas.length }} producto(s)
                      </p>
                      <p
                        v-if="cuenta.garzonAperturaNombre"
                        class="mt-0.5 flex items-center gap-1 text-xs text-muted"
                      >
                        <UIcon name="i-lucide-user" class="size-3" />
                        {{ cuenta.garzonAperturaNombre }}
                      </p>
                    </div>
                  </div>
                  <UIcon v-if="!fusionMode" name="i-lucide-chevron-right" class="h-5 w-5 text-muted" />
                </div>
              </UCard>
            </div>
          </div>

          <!-- Detalle de una cuenta: catálogo + productos -->
          <div v-else class="grid h-full min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-5">
            <div class="flex min-h-0 flex-col overflow-hidden lg:col-span-3">
              <VentasCatalogoGrid
                :items="itemsVisibles"
                :loading="loadingCatalogo"
                @add="addProducto"
              />
            </div>

            <div class="flex min-h-0 flex-col gap-3 overflow-hidden lg:col-span-2">
              <p class="shrink-0 text-sm font-medium text-default">Productos de la cuenta</p>

              <div class="min-h-0 flex-1 overflow-y-auto">
                <div v-if="activeCuenta.lineas.length === 0" class="py-6 text-center text-sm text-muted">
                  Agrega productos desde el catálogo.
                </div>
                <div v-else class="divide-y divide-default">
                  <div
                    v-for="linea in activeCuenta.lineas"
                    :key="linea.id"
                    class="flex items-center gap-2 py-2"
                  >
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium text-default">{{ linea.nombre }}</p>
                      <p v-if="linea.personalizacionTexto" class="text-xs text-muted">
                        {{ linea.personalizacionTexto }}
                      </p>
                      <p class="text-xs text-muted">{{ formatMonto(lineaSubtotal(linea), linea.monedaId) }}</p>
                    </div>
                    <UInput
                      :model-value="linea.cantidad"
                      inputmode="decimal"
                      size="sm"
                      class="w-20"
                      @change="cambiarCantidad(linea, ($event.target as HTMLInputElement).value)"
                    />
                    <UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      size="xs"
                      @click="quitarLinea(linea)"
                    />
                  </div>
                </div>
              </div>

              <div class="shrink-0 border-t border-default pt-3">
                <div class="mb-3 flex justify-between text-base font-semibold text-default">
                  <span>Total</span>
                  <span>{{ formatMonto(totalFinal) }}</span>
                </div>
                <UAlert
                  v-if="!tieneCaja"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-triangle-alert"
                  title="Sin caja abierta"
                  description="Necesitas una caja física abierta para cobrar."
                  class="mb-3"
                />
                <div class="mb-2 flex gap-2">
                  <UButton
                    color="neutral"
                    variant="soft"
                    class="flex-1 justify-center"
                    icon="i-lucide-chef-hat"
                    :loading="enviandoComanda"
                    :disabled="activeCuenta.lineas.length === 0"
                    @click="enviarComanda"
                  >
                    Enviar a cocina
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="soft"
                    class="flex-1 justify-center"
                    icon="i-lucide-receipt"
                    :loading="imprimiendoPrecuenta"
                    :disabled="activeCuenta.lineas.length === 0"
                    @click="imprimirPrecuenta"
                  >
                    Imprimir precuenta
                  </UButton>
                </div>
                <div class="flex gap-2">
                  <UButton
                    color="error"
                    variant="soft"
                    class="flex-1 justify-center"
                    @click="cancelOpen = true"
                  >
                    Cancelar cuenta
                  </UButton>
                  <UButton
                    color="primary"
                    class="flex-1 justify-center"
                    :disabled="activeCuenta.lineas.length === 0 || !tieneCaja"
                    @click="cobroOpen = true"
                  >
                    Cerrar y cobrar
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </template>
      </AppDrawer>

      <VentasRecetaPersonalizacionDrawer
        v-model:open="recetaDrawerOpen"
        :item-id="recetaItemId"
        @confirm="onRecetaConfirm"
      />

      <VentasCobroModal
        v-model:open="cobroOpen"
        :total="totalFinal"
        :metodos="metodos"
        :submitting="submitting"
        @confirmar="confirmarCobro"
      />

      <CrudModal
        v-model:open="cancelOpen"
        title="Cancelar cuenta"
        message="Se anulará la cuenta sin generar venta. Esta acción no se puede deshacer."
        confirm-label="Cancelar cuenta"
        @confirm="confirmarCancelar"
      />

      <SalonesGarzonPinModal
        v-model:open="pinModalOpen"
        :title="pinModalTitle"
        @confirm="onPinConfirmado"
      />
    </template>
  </UDashboardPanel>
</template>
