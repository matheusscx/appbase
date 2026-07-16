import Decimal from 'decimal.js'
import { useApiFetch } from './useApiFetch'
import type { CalcularVentaInput } from './useCalculoPrecios'
import type { PersonalizacionPayload } from './useRecetaPersonalizacion'

// ── Tipos (espejo del contrato del backend salones) ─────────────────────────

export type EstadoCuenta = 'abierta' | 'cerrada' | 'cancelada'

export type FormaMesa = 'redonda' | 'cuadrada' | 'rectangular'
export type TamanoMesa = 'pequeno' | 'mediano' | 'grande' | 'extra_grande'

export const FORMA_MESA_OPTIONS: { label: string, value: FormaMesa }[] = [
  { label: 'Redonda', value: 'redonda' },
  { label: 'Cuadrada', value: 'cuadrada' },
  { label: 'Rectangular', value: 'rectangular' },
]

export const TAMANO_MESA_OPTIONS: { label: string, value: TamanoMesa }[] = [
  { label: 'Pequeña', value: 'pequeno' },
  { label: 'Mediana', value: 'mediano' },
  { label: 'Grande', value: 'grande' },
  { label: 'Extra grande', value: 'extra_grande' },
]

export interface MesaResumen {
  id: string
  nombre: string
  posX: string
  posY: string
  forma: FormaMesa
  tamano: TamanoMesa
  cuentasAbiertas: number
  ocupada: boolean
}

export interface SalonConMesas {
  id: string
  nombre: string
  mesas: MesaResumen[]
}

export interface CuentaLineaDetalle {
  id: string
  itemId: string
  nombre: string
  precioBase: string
  monedaId: string
  cantidad: string
  cantidadPresentacion?: string | null
  unidadCodigoPresentacion?: string | null
  personalizacion?: {
    omitidos: string[]
    extras: { ingredienteItemId: string, cantidad: string, unidadCodigo: string, precioExtra: string, unidades: string }[]
    comentario?: string
  } | null
  personalizacionTexto?: string
}

export interface CuentaDetalle {
  id: string
  numero: number
  nombre: string | null
  estado: EstadoCuenta
  mesaId: string
  ventaId: string | null
  garzonAperturaId: string | null
  garzonAperturaNombre: string | null
  garzonCierreId: string | null
  garzonCierreNombre: string | null
  lineas: CuentaLineaDetalle[]
}

export interface MesaPosicion {
  mesaId: string
  posX: number
  posY: number
}

export interface CerrarCuentaBody {
  pin: string
  pagos?: { metodoPagoId: string, monto: string, referencia?: string }[]
  tipoDocumentoId?: string
  customer?: Record<string, unknown>
}

/** precioBase + Σ extras cuando la línea tiene personalización con extras. */
export function precioUnitarioLinea(linea: CuentaLineaDetalle): string {
  const base = new Decimal(linea.precioBase || '0')
  const extras = linea.personalizacion?.extras ?? []
  if (extras.length === 0) return base.toString()
  return extras.reduce(
    (acc, e) => acc.plus(new Decimal(e.precioExtra || '0').mul(e.unidades || '1')),
    base,
  ).toString()
}

/** Mapea las líneas de una cuenta a la entrada del motor de precios. */
export function cuentaToCalcularInput(cuenta: CuentaDetalle): CalcularVentaInput {
  return {
    lineas: cuenta.lineas.map((l) => {
      const precioUnitario = l.personalizacion?.extras?.length
        ? precioUnitarioLinea(l)
        : undefined
      return {
        itemId: l.itemId,
        cantidad: l.cantidad,
        ...(precioUnitario ? { precioUnitario } : {}),
      }
    }),
  }
}

export function useSalones() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  // Administración: salones
  const listarSalones = () =>
    useApiFetch<SalonConMesas[]>(`${apiUrl}/salones`)

  const crearSalon = (nombre: string) =>
    useApiFetch<{ id: string, nombre: string }>(`${apiUrl}/salones`, {
      method: 'POST',
      body: { nombre },
    })

  const actualizarSalon = (id: string, nombre: string) =>
    useApiFetch<{ id: string, nombre: string }>(`${apiUrl}/salones/${id}`, {
      method: 'PATCH',
      body: { nombre },
    })

  const eliminarSalon = (id: string) =>
    useApiFetch(`${apiUrl}/salones/${id}`, { method: 'DELETE' })

  // Administración: mesas
  const crearMesa = (
    salonId: string,
    body: { nombre: string, posX?: number, posY?: number, forma?: FormaMesa, tamano?: TamanoMesa },
  ) =>
    useApiFetch<{
      id: string
      nombre: string
      posX: string
      posY: string
      forma: FormaMesa
      tamano: TamanoMesa
    }>(`${apiUrl}/salones/${salonId}/mesas`, { method: 'POST', body })

  const actualizarMesa = (
    id: string,
    body: { nombre?: string, posX?: number, posY?: number, forma?: FormaMesa, tamano?: TamanoMesa },
  ) =>
    useApiFetch<{
      id: string
      nombre: string
      posX: string
      posY: string
      forma: FormaMesa
      tamano: TamanoMesa
    }>(`${apiUrl}/mesas/${id}`, { method: 'PATCH', body })

  const eliminarMesa = (id: string) =>
    useApiFetch(`${apiUrl}/mesas/${id}`, { method: 'DELETE' })

  const guardarLayout = (salonId: string, mesas: MesaPosicion[]) =>
    useApiFetch(`${apiUrl}/salones/${salonId}/layout`, {
      method: 'PATCH',
      body: { mesas },
    })

  // Operación (garzón)
  const listarOperacion = () =>
    useApiFetch<SalonConMesas[]>(`${apiUrl}/salones/operacion`)

  const listarCuentas = (mesaId: string) =>
    useApiFetch<CuentaDetalle[]>(`${apiUrl}/mesas/${mesaId}/cuentas`)

  const abrirCuenta = (mesaId: string, pin: string, nombre?: string) =>
    useApiFetch<CuentaDetalle>(`${apiUrl}/mesas/${mesaId}/cuentas`, {
      method: 'POST',
      body: { pin, nombre },
    })

  const fusionarCuentas = (mesaId: string, cuentaIds: string[]) =>
    useApiFetch<CuentaDetalle>(`${apiUrl}/mesas/${mesaId}/cuentas/fusionar`, {
      method: 'POST',
      body: { cuentaIds },
    })

  const agregarLinea = (
    cuentaId: string,
    itemId: string,
    cantidad: string,
    personalizacion?: PersonalizacionPayload,
  ) =>
    useApiFetch<CuentaDetalle>(`${apiUrl}/cuentas/${cuentaId}/lineas`, {
      method: 'POST',
      body: {
        itemId,
        cantidad,
        ...(personalizacion ? { personalizacion } : {}),
      },
    })

  const actualizarLinea = (
    cuentaId: string,
    lineaId: string,
    body: {
      cantidad: string
      cantidadPresentacion?: string
      unidadCodigoPresentacion?: string
    },
  ) =>
    useApiFetch<CuentaDetalle>(
      `${apiUrl}/cuentas/${cuentaId}/lineas/${lineaId}`,
      { method: 'PATCH', body },
    )

  const quitarLinea = (cuentaId: string, lineaId: string) =>
    useApiFetch<CuentaDetalle>(
      `${apiUrl}/cuentas/${cuentaId}/lineas/${lineaId}`,
      { method: 'DELETE' },
    )

  const cancelarCuenta = (cuentaId: string) =>
    useApiFetch<CuentaDetalle>(`${apiUrl}/cuentas/${cuentaId}/cancelar`, {
      method: 'POST',
    })

  const cerrarCuenta = (cuentaId: string, body: CerrarCuentaBody) =>
    useApiFetch<{ cuenta: CuentaDetalle, ventaId: string }>(
      `${apiUrl}/cuentas/${cuentaId}/cerrar`,
      { method: 'POST', body },
    )

  return {
    listarSalones,
    crearSalon,
    actualizarSalon,
    eliminarSalon,
    crearMesa,
    actualizarMesa,
    eliminarMesa,
    guardarLayout,
    listarOperacion,
    listarCuentas,
    abrirCuenta,
    fusionarCuentas,
    agregarLinea,
    actualizarLinea,
    quitarLinea,
    cancelarCuenta,
    cerrarCuenta,
  }
}
