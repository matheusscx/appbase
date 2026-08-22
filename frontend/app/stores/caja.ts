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
  /** Diferencia de la línea de EFECTIVO: el cuadre del cajón físico. */
  diferencia: string | null
  /**
   * Diferencia de TODAS las líneas del arqueo. Es la que responde "¿cuadró?";
   * `diferencia` sola deja invisible un descuadre de tarjeta. Solo la emite el
   * listado del historial, y es `null` mientras no haya arqueo congelado.
   */
  diferenciaTotal?: string | null
  fechaApertura: string
  fechaCierre: string | null
  comentario: string | null
  /** Comentario del CIERRE — lo escribe la fase 1 (`enviarConteo`) y, si llega uno nuevo, la fase 2 (`cerrar`). Columna separada de `comentario` (la apertura). */
  comentarioCierre?: string | null
  /** Quién contó (fase 1). Un cierre es forzado cuando difiere de `usuarioId` (el dueño de la caja). */
  cerradaPor?: string | null
  /** Garzones en turno al momento del conteo — congelado, no se recalcula después. */
  testigosDisponibles?: number | null
  cajonId: string | null
  cajonNombre: string | null
  /** Nombre del cajero dueño — solo lo resuelve `findOne` (detalle), no el resto de los endpoints. */
  usuarioNombre?: string | null
}

export interface TestigoEstado {
  id: string
  garzonId: string
  garzonNombre: string
  estado: 'pendiente' | 'firmada' | 'rechazada' | 'cancelada' | 'caducada'
  solicitadaEl: string
  resueltaEl: string | null
  comentarioGarzon: string | null
  viaFirma: 'cuenta' | 'pin' | null
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

export interface TendenciaDescuadres {
  usuarioId: string
  usuarioNombre: string
  cierres: number
  /** Suma CON signo de la línea de efectivo. Negativo = faltante. */
  efectivoSuma: string
  /** Todo lo que no es efectivo, aparte y nunca sumado al de arriba. */
  otrosMediosSuma: string
  conFaltante: number
  conSobrante: number
  cuadrados: number
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
  const testigos = ref<TestigoEstado[]>([])
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
    payload: { lineas: { metodoPagoId: string | null, motivoDiferenciaId?: string, comentarioDiferencia?: string }[], comentario?: string },
  ): Promise<{ caja: Caja, arqueo: ArqueoLinea[] }> {
    const res = await useApiFetch<{ caja: Caja, arqueo: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/cerrar`,
      { method: 'POST', body: payload },
    )
    // Solo se limpia el turno propio si la caja cerrada es la activa de quien
    // llama: un admin del tenant puede cerrar la caja de OTRO cajero (cierre
    // forzado, Task 6) desde /cajas sin que eso le borre su propia sesión de
    // /mi-caja.
    if (activa.value?.id === cajaId) {
      resumenTurno.value = null
      activa.value = null
    }
    if (detalle.value?.id === cajaId) {
      // MERGE, no reemplazo (revisión independiente, hallazgo 1): `POST
      // /caja/:id/cerrar` devuelve la ENTIDAD cruda, y `cajonNombre` /
      // `usuarioNombre` los resuelve solo `findOne` (`GET /caja/:id`).
      // Pisar el detalle con la entidad los dejaba `undefined` en runtime —
      // el tipo los declara requeridos, así que `vue-tsc` no lo veía— y el
      // header pasaba de "Barra" a "Caja" hasta un F5. Peor en el cierre
      // forzado: el nombre del cajero, que es EL dato de esta feature,
      // caía al texto de fallback justo al cerrar.
      detalle.value = {
        ...detalle.value,
        ...res.caja,
        cajonNombre: detalle.value.cajonNombre,
        usuarioNombre: detalle.value.usuarioNombre,
      }
    }
    return res
  }

  /**
   * Estado de las solicitudes de testigo de una caja (Task 6): lo que el
   * encargado mira mientras espera la firma.
   *
   * Vacía ANTES de pedir (revisión independiente, hallazgo 4): el array es del
   * store, no de una caja. Si la carga de la caja B fallaba, quedaban vivas las
   * firmas de la caja A y `hayFirmaAlguna` daba `true` para B — el gate del
   * comentario obligatorio se apagaba con datos de otra caja. Vaciar primero
   * hace que un error degrade hacia el lado seguro: sin firmas conocidas, se
   * exige la explicación.
   */
  async function cargarTestigos(cajaId: string): Promise<void> {
    testigos.value = []
    testigos.value = await useApiFetch<TestigoEstado[]>(
      `${config.public.apiUrl}/caja/${cajaId}/testigos`,
    )
  }

  /** El encargado pide fe a uno o varios garzones en turno. Recarga el estado tras pedir. */
  async function solicitarTestigos(cajaId: string, garzonIds: string[]): Promise<void> {
    await useApiFetch(`${config.public.apiUrl}/caja/${cajaId}/testigos`, {
      method: 'POST',
      body: { garzonIds },
    })
    await cargarTestigos(cajaId)
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

  /**
   * Tendencia de descuadres por cajero. Lectura de supervisión (`Cajas:Leer`):
   * no hay versión "la mía" — el cajero no ve su propio acumulado.
   */
  async function cargarTendencia(
    desde?: string,
    hasta?: string,
  ): Promise<TendenciaDescuadres[]> {
    const qs = new URLSearchParams()
    if (desde) qs.set('desde', desde)
    if (hasta) qs.set('hasta', hasta)
    const sufijo = qs.toString() ? `?${qs.toString()}` : ''
    return useApiFetch<TendenciaDescuadres[]>(
      `${config.public.apiUrl}/caja/tendencia${sufijo}`,
    )
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
    testigos,
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
    cargarTestigos,
    solicitarTestigos,
    justificarDiferencias,
    cargarCajonesEstado,
    cargarDetalle,
    cargarTendencia,
    cargarCajonesDisponibles,
    cargarArqueo,
    cargarArqueoCiego,
    guardarArqueoCiego,
    cargarMotivos,
  }
})
