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
  saldoInicial: string
  totalEntradas: string
  totalSalidas: string
  saldoEsperado: string
  totalMovimientos: number
}

export interface CajaAbierta {
  id: string
  usuarioId: string | null
  usuarioNombre: string
  saldoInicial: string
  saldoEsperado: string
  fechaApertura: string
  esPropia: boolean
}

function recalcularSaldoEsperado(r: CajaTurnoResumen) {
  r.saldoEsperado = new Decimal(r.saldoInicial)
    .plus(r.totalEntradas)
    .minus(r.totalSalidas)
    .toFixed(4)
}

export const useCajaStore = defineStore('caja', () => {
  const config = useRuntimeConfig()

  const activa = ref<Caja | null>(null)
  const resumenTurno = ref<CajaTurnoResumen | null>(null)
  const abiertas = ref<CajaAbierta[]>([])
  const detalle = ref<Caja | null>(null)
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

  async function abrir(payload: { saldoInicial: string, comentario?: string }): Promise<Caja> {
    const caja = await useApiFetch<Caja>(
      `${config.public.apiUrl}/caja/abrir`,
      { method: 'POST', body: payload },
    )
    // Usar la respuesta del POST: evita depender de GET /activa justo después del write.
    activa.value = caja && typeof caja === 'object' ? caja : null
    resumenTurno.value = {
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

  /** Patch local del resumen tras un movimiento (sin GET). */
  function aplicarMovimientoLocal(tipo: 'entrada' | 'salida', monto: string, count = 1) {
    if (!resumenTurno.value) return
    const r = resumenTurno.value
    if (tipo === 'entrada') {
      r.totalEntradas = new Decimal(r.totalEntradas).plus(monto).toFixed(4)
    }
    else {
      r.totalSalidas = new Decimal(r.totalSalidas).plus(monto).toFixed(4)
    }
    r.totalMovimientos += count
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

  async function cerrar(cajaId: string, payload: { montoContado: string, comentario?: string }): Promise<Caja> {
    const caja = await useApiFetch<Caja>(
      `${config.public.apiUrl}/caja/${cajaId}/cerrar`,
      { method: 'POST', body: payload },
    )
    resumenTurno.value = null
    activa.value = null
    return caja
  }

  async function cargarAbiertas(): Promise<void> {
    abiertas.value = await useApiFetch<CajaAbierta[]>(
      `${config.public.apiUrl}/caja/abiertas`,
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
    abiertas,
    detalle,
    loadingActiva,
    loadingResumenTurno,
    cargarActiva,
    abrir,
    cargarResumenTurno,
    aplicarMovimientoLocal,
    aplicarCobroLocal,
    registrarMovimiento,
    cerrar,
    cargarAbiertas,
    cargarDetalle,
  }
})
