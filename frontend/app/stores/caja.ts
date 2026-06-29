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
}

export const useCajaStore = defineStore('caja', () => {
  const config = useRuntimeConfig()

  const activa = ref<Caja | null>(null)
  const movimientos = ref<MovimientoCaja[]>([])
  const historial = ref<Caja[]>([])
  const loadingActiva = ref(false)
  const loadingMovimientos = ref(false)

  async function cargarActiva(): Promise<void> {
    loadingActiva.value = true
    try {
      activa.value = await useApiFetch<Caja | null>(
        `${config.public.apiUrl}/caja/activa`,
      )
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

  async function cargarMovimientos(cajaId: string): Promise<void> {
    loadingMovimientos.value = true
    try {
      movimientos.value = await useApiFetch<MovimientoCaja[]>(
        `${config.public.apiUrl}/caja/${cajaId}/movimientos`,
      )
    }
    finally {
      loadingMovimientos.value = false
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
    await cargarMovimientos(cajaId)
  }

  async function cerrar(cajaId: string, payload: { montoContado: string, comentario?: string }): Promise<void> {
    await useApiFetch<Caja>(
      `${config.public.apiUrl}/caja/${cajaId}/cerrar`,
      { method: 'POST', body: payload },
    )
    movimientos.value = []
    await cargarActiva()
  }

  async function cargarHistorial(todas: boolean): Promise<void> {
    historial.value = await useApiFetch<Caja[]>(
      `${config.public.apiUrl}/caja`,
      { query: { todas: todas ? 'true' : 'false' } },
    )
  }

  return {
    activa,
    movimientos,
    historial,
    loadingActiva,
    loadingMovimientos,
    cargarActiva,
    abrir,
    cargarMovimientos,
    registrarMovimiento,
    cerrar,
    cargarHistorial,
  }
})
