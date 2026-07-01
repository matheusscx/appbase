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

export const useCajaStore = defineStore('caja', () => {
  const config = useRuntimeConfig()

  const activa = ref<Caja | null>(null)
  const resumenTurno = ref<CajaTurnoResumen | null>(null)
  const historial = ref<Caja[]>([])
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

  async function abrir(payload: { saldoInicial: string, comentario?: string }): Promise<void> {
    await useApiFetch<Caja>(
      `${config.public.apiUrl}/caja/abrir`,
      { method: 'POST', body: payload },
    )
    await cargarActiva()
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

  async function registrarMovimiento(
    cajaId: string,
    payload: { tipo: 'entrada' | 'salida', concepto: string, monto: string, referencia?: string },
  ): Promise<void> {
    await useApiFetch<MovimientoCaja>(
      `${config.public.apiUrl}/caja/${cajaId}/movimientos`,
      { method: 'POST', body: payload },
    )
    await cargarResumenTurno(cajaId)
  }

  async function cerrar(cajaId: string, payload: { montoContado: string, comentario?: string }): Promise<void> {
    await useApiFetch<Caja>(
      `${config.public.apiUrl}/caja/${cajaId}/cerrar`,
      { method: 'POST', body: payload },
    )
    resumenTurno.value = null
    await cargarActiva()
  }

  async function cargarHistorial(todas: boolean): Promise<void> {
    historial.value = await useApiFetch<Caja[]>(
      `${config.public.apiUrl}/caja`,
      { query: { todas: todas ? 'true' : 'false' } },
    )
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
    historial,
    abiertas,
    detalle,
    loadingActiva,
    loadingResumenTurno,
    cargarActiva,
    abrir,
    cargarResumenTurno,
    registrarMovimiento,
    cerrar,
    cargarHistorial,
    cargarAbiertas,
    cargarDetalle,
  }
})
