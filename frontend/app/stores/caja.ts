import Decimal from 'decimal.js'
import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export interface Caja {
  id: string
  tenantId: string
  usuarioId: string | null
  tipo: string
  estado: string
  saldoInicial: string
  saldoFinal: string | null
  montoContado: string | null
  diferencia: string | null
  fechaApertura: string
  fechaCierre: string | null
  comentario: string | null
  cajonId: string | null
  cajonNombre: string | null
}

export interface MovimientoCaja {
  id: string
  cajaId: string
  tipo: string
  concepto: string
  monto: string
  referencia: string | null
  fecha: string
  ventaId: string | null
}

export interface CajaTurnoResumen {
  ciego: boolean
  saldoInicial: string
  totalEntradas: string | null
  totalSalidas: string | null
  saldoEsperado: string | null
  totalMovimientos: number | null
}

export interface SesionCajon {
  cajaId: string
  usuarioId: string | null
  usuarioNombre: string
  saldoInicial: string
  /** `null` en modo ciego con la caja abierta: el backend lo retiene. */
  saldoEsperado: string | null
  fechaApertura: string
  esPropia: boolean
}

export interface CajonEstado {
  cajonId: string
  nombre: string
  sesion: SesionCajon | null
}

export interface CajonDisponible {
  cajonId: string
  nombre: string
}

export interface ArqueoLinea {
  metodoPagoId: string | null
  nombre: string
  esEfectivo: boolean
  esperado: string | null
  requiereConteo: boolean
  contado?: string | null
  diferencia?: string | null
  motivoDiferenciaId?: string | null
  motivoNombre?: string | null
  comentarioDiferencia?: string | null
}

export interface MotivoDiferencia {
  id: string
  nombre: string
  activo: boolean
  requiereComentario: boolean
  esFijo: boolean
}

function recalcularSaldoEsperado(r: CajaTurnoResumen) {
  if (r.ciego || r.saldoEsperado === null) return
  r.saldoEsperado = new Decimal(r.saldoInicial)
    .plus(r.totalEntradas ?? '0')
    .minus(r.totalSalidas ?? '0')
    .toFixed(4)
}

export const useCajaStore = defineStore('caja', () => {
  const config = useRuntimeConfig()

  const activa = ref<Caja | null>(null)
  const resumenTurno = ref<CajaTurnoResumen | null>(null)
  const cajonesEstado = ref<CajonEstado[]>([])
  const detalle = ref<Caja | null>(null)
  const cajonesDisponibles = ref<CajonDisponible[]>([])
  const arqueo = ref<ArqueoLinea[]>([])
  const arqueoCiego = ref(false)
  const motivos = ref<MotivoDiferencia[]>([])
  const loadingActiva = ref(false)
  const loadingResumenTurno = ref(false)

  async function cargarActiva(): Promise<void> {
    loadingActiva.value = true
    try {
      // El backend retorna `null` cuando no hay caja abierta, pero NestJS lo
      // envía como body vacío y ofetch lo deserializa como '' (string vacío).
      // Normalizamos a null para que `activa !== null` no dé un falso positivo.
      const data = await useApiFetch<Caja | null>(
        `${config.public.apiUrl}/caja/activa`,
      )
      activa.value = data && typeof data === 'object' ? data : null
    }
    finally {
      loadingActiva.value = false
    }
  }

  async function cargarCajonesDisponibles(): Promise<void> {
    cajonesDisponibles.value = await useApiFetch<CajonDisponible[]>(
      `${config.public.apiUrl}/caja/cajones-disponibles`,
    )
  }

  async function abrir(payload: { saldoInicial: string, comentario?: string, cajonId: string }): Promise<Caja> {
    const caja = await useApiFetch<Caja>(
      `${config.public.apiUrl}/caja/abrir`,
      { method: 'POST', body: payload },
    )
    // Usar la respuesta del POST: evita depender de GET /activa justo después del write.
    activa.value = caja && typeof caja === 'object' ? caja : null
    resumenTurno.value = {
      ciego: false,
      saldoInicial: caja.saldoInicial,
      totalEntradas: '0.0000',
      totalSalidas: '0.0000',
      saldoEsperado: caja.saldoInicial,
      totalMovimientos: 0,
    }
    return caja
  }

  async function cargarResumenTurno(cajaId: string): Promise<void> {
    loadingResumenTurno.value = true
    try {
      resumenTurno.value = await useApiFetch<CajaTurnoResumen>(
        `${config.public.apiUrl}/caja/${cajaId}/movimientos/resumen`,
      )
    }
    finally {
      loadingResumenTurno.value = false
    }
  }

  /** Patch local del resumen tras un movimiento (sin GET). No-op en modo ciego. */
  function aplicarMovimientoLocal(tipo: 'entrada' | 'salida', monto: string, count = 1) {
    const r = resumenTurno.value
    if (!r || r.ciego) return
    if (tipo === 'entrada') {
      r.totalEntradas = new Decimal(r.totalEntradas ?? '0').plus(monto).toFixed(4)
    }
    else {
      r.totalSalidas = new Decimal(r.totalSalidas ?? '0').plus(monto).toFixed(4)
    }
    r.totalMovimientos = (r.totalMovimientos ?? 0) + count
    recalcularSaldoEsperado(r)
  }

  /**
   * Cobro (venta / cierre de cuenta): un movimiento de entrada por pago neto.
   * `neto` = Σ(monto − vuelto); `cantidadMovimientos` = pagos con monto > 0.
   */
  function aplicarCobroLocal(neto: string, cantidadMovimientos: number) {
    if (cantidadMovimientos <= 0) return
    aplicarMovimientoLocal('entrada', neto, cantidadMovimientos)
  }

  async function registrarMovimiento(
    cajaId: string,
    payload: { tipo: 'entrada' | 'salida', concepto: string, monto: string, referencia?: string },
  ): Promise<MovimientoCaja> {
    const mov = await useApiFetch<MovimientoCaja>(
      `${config.public.apiUrl}/caja/${cajaId}/movimientos`,
      { method: 'POST', body: payload },
    )
    aplicarMovimientoLocal(payload.tipo, mov.monto ?? payload.monto)
    return mov
  }

  async function cargarArqueo(cajaId: string): Promise<void> {
    const res = await useApiFetch<{ ciego: boolean, lineas: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/arqueo`,
    )
    arqueo.value = res.lineas
    arqueoCiego.value = res.ciego
  }

  async function cargarArqueoCiego(): Promise<boolean> {
    const res = await useApiFetch<{ arqueoCiego: boolean }>(
      `${config.public.apiUrl}/caja/arqueo-ciego`,
    )
    return res.arqueoCiego
  }

  async function guardarArqueoCiego(valor: boolean): Promise<void> {
    await useApiFetch(`${config.public.apiUrl}/caja/arqueo-ciego`, {
      method: 'PUT',
      body: { arqueoCiego: valor },
    })
  }

  async function cargarMotivos(soloActivas?: boolean): Promise<void> {
    const qs = soloActivas ? '?soloActivas=true' : ''
    motivos.value = await useApiFetch<MotivoDiferencia[]>(
      `${config.public.apiUrl}/motivos-diferencia${qs}`,
    )
  }

  async function enviarConteo(
    cajaId: string,
    payload: { lineas: { metodoPagoId: string | null, montoContado: string }[], comentario?: string },
  ): Promise<{ estado: string, arqueo: ArqueoLinea[] }> {
    const res = await useApiFetch<{ estado: string, arqueo: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/conteo`,
      { method: 'POST', body: payload },
    )
    arqueo.value = res.arqueo
    if (res.estado === 'cerrada') {
      resumenTurno.value = null
      activa.value = null
    }
    else if (res.estado === 'en_conciliacion') {
      // Avanzar el estado local para que la detección de "retomar conciliación"
      // (drawer / dashboard) funcione dentro de la misma sesión sin recargar.
      if (activa.value?.id === cajaId) {
        activa.value = { ...activa.value, estado: 'en_conciliacion' }
      }
      if (detalle.value?.id === cajaId) {
        detalle.value = { ...detalle.value, estado: 'en_conciliacion' }
      }
    }
    return res
  }

  async function cerrar(
    cajaId: string,
    payload: { lineas: { metodoPagoId: string | null, motivoDiferenciaId?: string, comentarioDiferencia?: string }[] },
  ): Promise<{ caja: Caja, arqueo: ArqueoLinea[] }> {
    const res = await useApiFetch<{ caja: Caja, arqueo: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/cerrar`,
      { method: 'POST', body: payload },
    )
    resumenTurno.value = null
    activa.value = null
    return res
  }

  async function justificarDiferencias(
    cajaId: string,
    lineas: { metodoPagoId: string | null, motivoDiferenciaId?: string, comentarioDiferencia?: string }[],
  ): Promise<{ ciego: boolean, lineas: ArqueoLinea[] }> {
    return await useApiFetch<{ ciego: boolean, lineas: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/arqueo/motivos`,
      { method: 'PATCH', body: { lineas } },
    )
  }

  async function cargarCajonesEstado(): Promise<void> {
    cajonesEstado.value = await useApiFetch<CajonEstado[]>(
      `${config.public.apiUrl}/caja/cajones-estado`,
    )
  }

  async function cargarDetalle(cajaId: string): Promise<void> {
    const data = await useApiFetch<Caja | null>(
      `${config.public.apiUrl}/caja/${cajaId}`,
    )
    detalle.value = data && typeof data === 'object' ? data : null
  }

  return {
    activa,
    resumenTurno,
    cajonesEstado,
    detalle,
    cajonesDisponibles,
    arqueo,
    arqueoCiego,
    motivos,
    loadingActiva,
    loadingResumenTurno,
    cargarActiva,
    abrir,
    cargarResumenTurno,
    aplicarMovimientoLocal,
    aplicarCobroLocal,
    registrarMovimiento,
    enviarConteo,
    cerrar,
    justificarDiferencias,
    cargarCajonesEstado,
    cargarDetalle,
    cargarCajonesDisponibles,
    cargarArqueo,
    cargarArqueoCiego,
    guardarArqueoCiego,
    cargarMotivos,
  }
})
