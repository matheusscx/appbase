<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ItemCatalogo, PagoInput } from '~/composables/useVenta'
import type { PaginatedResponse } from '~/composables/usePaginatedList'
import type { ResultadoVenta } from '~/composables/useCalculoPrecios'
import {
  cuentaToCalcularInput,
  type SalonConMesas,
  type MesaResumen,
  type CuentaDetalle,
  type CuentaLineaDetalle,
} from '~/composables/useSalones'

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
const resultado = ref<ResultadoVenta | null>(null)

const cobroOpen = ref(false)
const submitting = ref(false)
const cancelOpen = ref(false)

const selectedSalon = computed(() =>
  salones.value.find(s => s.id === selectedSalonId.value) ?? null,
)
const salonItems = computed(() =>
  salones.value.map(s => ({ label: s.nombre, value: s.id })),
)
const tieneCaja = computed(() => cajaStore.activa !== null)
const totalFinal = computed(() => resultado.value?.totales.totalFinal ?? '0')

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

async function cargarCatalogo() {
  loadingCatalogo.value = true
  try {
    const [itemsRes, metodosRes, tiposRes] = await Promise.all([
      useApiFetch<PaginatedResponse<ItemCatalogo>>(`${apiUrl}/items?pageSize=100`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
      useApiFetch<TipoDoc[]>(`${apiUrl}/tipos-documento`),
    ])
    items.value = itemsRes.data
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

async function nuevaCuenta() {
  if (!selectedMesa.value) return
  try {
    const cuenta = await salonesApi.abrirCuenta(selectedMesa.value.id)
    cuentas.value.push(cuenta)
    abrirCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al abrir la cuenta'), color: 'error' })
  }
}

function abrirCuenta(cuenta: CuentaDetalle) {
  activeCuenta.value = cuenta
  void recalcular()
}

function volverACuentas() {
  activeCuenta.value = null
  resultado.value = null
}

function syncCuenta(cuenta: CuentaDetalle) {
  activeCuenta.value = cuenta
  const idx = cuentas.value.findIndex(c => c.id === cuenta.id)
  if (idx !== -1) cuentas.value[idx] = cuenta
  void recalcular()
}

// ── Líneas de la cuenta ────────────────────────────────────────────────────
async function addProducto(item: ItemCatalogo) {
  if (!activeCuenta.value) return
  try {
    const cuenta = await salonesApi.agregarLinea(activeCuenta.value.id, item.id, '1')
    syncCuenta(cuenta)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al agregar el producto'), color: 'error' })
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
  return new Decimal(linea.precioBase || '0').times(linea.cantidad || '0').toString()
}

// ── Cancelar / cerrar cuenta ───────────────────────────────────────────────
async function confirmarCancelar() {
  if (!activeCuenta.value) return
  try {
    await salonesApi.cancelarCuenta(activeCuenta.value.id)
    toast.add({ title: 'Cuenta cancelada', color: 'success' })
    cuentas.value = cuentas.value.filter(c => c.id !== activeCuenta.value?.id)
    volverACuentas()
    await cargarSalones()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cancelar la cuenta'), color: 'error' })
  }
  finally {
    cancelOpen.value = false
  }
}

async function confirmarCobro(pagos: PagoInput[]) {
  if (!activeCuenta.value) return
  submitting.value = true
  try {
    await salonesApi.cerrarCuenta(activeCuenta.value.id, {
      pagos,
      tipoDocumentoId: tiposDocumento.value[0]?.id,
    })
    toast.add({ title: 'Cuenta cerrada — venta generada', color: 'success' })
    cobroOpen.value = false
    cuentas.value = cuentas.value.filter(c => c.id !== activeCuenta.value?.id)
    volverACuentas()
    await Promise.all([cargarSalones(), cajaStore.cargarActiva()])
  }
  catch (e: unknown) {
    cobroOpen.value = false
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
      <AppDrawer v-model:open="mesaDrawerOpen" width="90%">
        <template #header>
          <div class="flex items-center gap-2">
            <UButton
              v-if="activeCuenta"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="volverACuentas"
            />
            <span class="font-semibold text-default">
              {{ selectedMesa?.nombre }}
              <template v-if="activeCuenta"> — Cuenta {{ activeCuenta.numero }}</template>
            </span>
          </div>
        </template>

        <template #body>
          <!-- Lista de cuentas de la mesa -->
          <div v-if="!activeCuenta" class="space-y-4">
            <div class="flex justify-end">
              <UButton icon="i-lucide-plus" @click="nuevaCuenta">
                Nueva cuenta
              </UButton>
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
                @click="abrirCuenta(cuenta)"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <p class="font-semibold text-default">Cuenta {{ cuenta.numero }}</p>
                    <p class="text-sm text-muted">
                      {{ cuenta.lineas.length }} producto(s)
                    </p>
                  </div>
                  <UIcon name="i-lucide-chevron-right" class="h-5 w-5 text-muted" />
                </div>
              </UCard>
            </div>
          </div>

          <!-- Detalle de una cuenta: catálogo + productos -->
          <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div class="lg:col-span-3">
              <VentasCatalogoGrid
                :items="items"
                :loading="loadingCatalogo"
                @add="addProducto"
              />
            </div>

            <div class="lg:col-span-2 flex flex-col gap-3">
              <p class="text-sm font-medium text-default">Productos de la cuenta</p>

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

              <div class="mt-auto border-t border-default pt-3">
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
    </template>
  </UDashboardPanel>
</template>
