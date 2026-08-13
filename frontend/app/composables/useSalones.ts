import Decimal from 'decimal.js'
import { useApiFetch } from './useApiFetch'
import type { CalcularVentaInput } from './useCalculoPrecios'
import type { PersonalizacionPayload } from './useRecetaPersonalizacion'
import type { PersonalizacionDetalleLinea } from '~/utils/ticket-builder'

/** Snapshot congelado de un grupo de modificadores en una línea de cuenta (espejo de `SnapshotGrupo` del backend). */
export interface CuentaLineaGrupoSnapshot {
  grupoId: string
  grupoNombre: string
  opciones: {
    itemId: string
    nombre: string
    cantidad: string
    unidadCodigo?: string
    precioExtra: string
    unidades: string
  }[]
}

/** Combos: elección de grupos por componente, por unidad (espejo de `PersonalizacionRecetaSnapshot.componentes` del backend). */
export interface CuentaLineaComponenteSnapshot {
  componenteItemId: string
  componenteNombre: string
  unidad: number
  grupos: CuentaLineaGrupoSnapshot[]
}

// ── Tipos (espejo del contrato del backend salones) ─────────────────────────

export type EstadoCuenta = 'abierta' | 'cerrada' | 'cancelada'

export type MotivoCuentaAsignacion =
  | 'apertura'
  | 'transferencia_pin'
  | 'transferencia_admin'

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
  // Solo llegan con `listarSalones(true)` — la papelera (docs/features/papelera.md).
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

export interface SalonConMesas {
  id: string
  nombre: string
  mesas: MesaResumen[]
  // Solo llegan con `listarSalones(true)` — la papelera (docs/features/papelera.md).
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
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
    grupos?: CuentaLineaGrupoSnapshot[]
    componentes?: CuentaLineaComponenteSnapshot[]
  } | null
  personalizacionTexto?: string
  personalizacionDetalle?: PersonalizacionDetalleLinea[]
  /** El ítem se eliminó del catálogo con la cuenta ya abierta: hay que quitar
   *  la línea para poder cobrar. Gemelo de `CuentaLineaDetalle.itemEliminado`
   *  del backend (`salones.service.ts`), copiado a mano como el resto de este
   *  archivo: al tocar una punta, tocar la otra. */
  itemEliminado?: true
}

export interface CuentaAsignacionDetalle {
  id: string
  garzonId: string
  garzonNombre: string | null
  desdeEl: string
  hastaEl: string | null
  motivo: MotivoCuentaAsignacion
  origenGarzonId: string | null
  origenGarzonNombre: string | null
  actorUsuarioId: string | null
  actorUsuarioNombre: string | null
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
  garzonResponsableId: string | null
  garzonResponsableNombre: string | null
  garzonCierreId: string | null
  garzonCierreNombre: string | null
  lineas: CuentaLineaDetalle[]
}

export interface MesaPosicion {
  mesaId: string
  posX: number
  posY: number
}

/** Una línea del arqueo, tal como la ve el garzón: nunca `esperado` — espejo de
 *  `LineaTestigo` (`backend/src/modules/caja/caja-testigo.service.ts`). */
export interface LineaTestigoContado {
  metodoPagoId: string | null
  nombre: string
  esEfectivo: boolean
  contado: string | null
}

/** Lo que el garzón ve al entrar a su pantalla, por cada solicitud pendiente —
 *  espejo de `SolicitudPublica` del backend. */
export interface SolicitudTestigo {
  id: string
  cajaId: string
  solicitadaEl: string
  /** `true` = se resuelve por cuenta vinculada, sin PIN; `false` = por PIN. */
  garzonVinculado: boolean
  lineas: LineaTestigoContado[]
}

/**
 * La credencial que viaja en el body de las acciones del salón.
 *
 * En **modo personal** el garzón opera desde su propia tablet: el backend lo
 * resuelve del JWT y no hay PIN que mandar. Mandar `pin: ''` no es equivalente
 * a no mandarlo — el DTO valida `^\d{6}$` sobre el valor presente y rebota con
 * 400. Por eso el campo se **omite**, no se vacía.
 */
export function credencialGarzon(garzonId: string, pin: string) {
  return pin ? { garzonId, pin } : {}
}

export interface CerrarCuentaBody {
  garzonId?: string
  pin?: string
  pagos?: { metodoPagoId: string, monto: string, referencia?: string }[]
  tipoDocumentoId?: string
  customer?: Record<string, unknown>
  propinaMonto?: string
  propinaSugerida?: string
  propinaPorcentajeSugerido?: string
}

/**
 * precioBase + Σ extras + Σ opciones de grupo (propios del combo/receta) + Σ opciones de
 * grupo por componente (combos con grupos anidados) cuando la línea tiene recargo.
 */
export function precioUnitarioLinea(linea: CuentaLineaDetalle): string {
  const base = new Decimal(linea.precioBase || '0')
  const extras = linea.personalizacion?.extras ?? []
  const gruposOpciones = (linea.personalizacion?.grupos ?? []).flatMap((g) => g.opciones)
  const componentesOpciones = (linea.personalizacion?.componentes ?? []).flatMap((c) =>
    c.grupos.flatMap((g) => g.opciones),
  )
  if (extras.length === 0 && gruposOpciones.length === 0 && componentesOpciones.length === 0) {
    return base.toString()
  }
  return [...extras, ...gruposOpciones, ...componentesOpciones]
    .reduce(
      (acc, o) => acc.plus(new Decimal(o.precioExtra || '0').mul(o.unidades || '1')),
      base,
    )
    .toString()
}

function tienePersonalizacionConRecargo(l: CuentaLineaDetalle): boolean {
  return Boolean(
    l.personalizacion?.extras?.length
    || l.personalizacion?.grupos?.length
    || l.personalizacion?.componentes?.length,
  )
}

/** Mapea las líneas de una cuenta a la entrada del motor de precios. */
export function cuentaToCalcularInput(cuenta: CuentaDetalle): CalcularVentaInput {
  return {
    lineas: cuenta.lineas.map((l) => {
      const precioUnitario = tienePersonalizacionConRecargo(l)
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
  /** `incluirEliminados` es opcional y por default `false`: `salones/index.vue`
   *  (operación del garzón) sigue llamando `listarOperacion()`, que no toca
   *  este flag, así que ninguna otra pantalla ve borrados sin pedirlo. */
  const listarSalones = (incluirEliminados = false) =>
    useApiFetch<SalonConMesas[]>(
      `${apiUrl}/salones${incluirEliminados ? '?incluirEliminados=true' : ''}`,
    )

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

  const abrirCuenta = (mesaId: string, garzonId: string, pin: string, nombre?: string) =>
    useApiFetch<CuentaDetalle>(`${apiUrl}/mesas/${mesaId}/cuentas`, {
      method: 'POST',
      body: { ...credencialGarzon(garzonId, pin), nombre },
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

  const transferirCuenta = (cuentaId: string, garzonId: string, pin: string) =>
    useApiFetch<CuentaDetalle>(`${apiUrl}/cuentas/${cuentaId}/transferir`, {
      method: 'POST',
      body: credencialGarzon(garzonId, pin),
    })

  const transferirCuentaAdmin = (cuentaId: string, garzonId: string) =>
    useApiFetch<CuentaDetalle>(`${apiUrl}/cuentas/${cuentaId}/transferir-admin`, {
      method: 'POST',
      body: { garzonId },
    })

  const listarAsignaciones = (cuentaId: string) =>
    useApiFetch<CuentaAsignacionDetalle[]>(
      `${apiUrl}/cuentas/${cuentaId}/asignaciones`,
    )

  // ── Testigo del cierre forzado (el garzón da fe) ──────────────────────────
  /**
   * Lo que el garzón ve al entrar a su pantalla. POST con la credencial en el
   * body (nunca `garzonId` de ruta): el backend resuelve la identidad del JWT
   * en modo personal, o exige `garzonId` + PIN en un tótem compartido — mismo
   * contrato que el resto de esta pantalla (`credencialGarzon`).
   */
  const pendientesTestigo = (garzonId: string, pin: string) =>
    useApiFetch<SolicitudTestigo[]>(`${apiUrl}/caja/testigos/pendientes`, {
      method: 'POST',
      body: credencialGarzon(garzonId, pin),
    })

  /**
   * El garzón da fe (`firma: true`) o rechaza (`firma: false`) la SUYA. El PIN
   * se omite cuando el garzón está vinculado a una cuenta: mandarlo no ayuda,
   * esa vía queda rechazada para él en el backend (`CajaTestigoService.resolver`).
   */
  const resolverTestigo = (
    testigoId: string,
    body: { pin?: string, firma: boolean, comentario?: string },
  ) =>
    useApiFetch<{ id: string, estado: string }>(
      `${apiUrl}/caja/testigos/${testigoId}/resolver`,
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
    transferirCuenta,
    transferirCuentaAdmin,
    listarAsignaciones,
    pendientesTestigo,
    resolverTestigo,
  }
}
