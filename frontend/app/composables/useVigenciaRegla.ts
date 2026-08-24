export type EstadoVigencia = 'vigente' | 'vencida' | 'programada'

type EstadoVigenciaConBadge = Exclude<EstadoVigencia, 'vigente'>

type VigenciaColor = 'error' | 'info'

const COLOR: Record<EstadoVigenciaConBadge, VigenciaColor> = {
  vencida: 'error',
  programada: 'info',
}

const ETIQUETA: Record<EstadoVigenciaConBadge, string> = {
  vencida: 'Vencida',
  programada: 'Programada',
}

/** 'YYYY-MM-DD' del navegador. NO `toISOString().slice(0, 10)`: eso da la fecha
 *  en UTC, que en husos negativos (Chile) puede ir un día atrás de la fecha
 *  local real — mismo motivo que documenta `inicioDiaIso` en `date-value.ts`. */
function hoyLocal(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Estado de vigencia de una regla de descuento/recargo (`fechaInicio`/`fechaFin`),
 * para el badge de las tablas de `configuracion/descuentos` y `configuracion/recargos`.
 *
 * Espeja el criterio de `calculo-precios.service.ts` → `indexarReglas`: fechas
 * `YYYY-MM-DD` comparadas como string (ordenan igual que cronológicamente), bordes
 * INCLUSIVOS los dos, y sin fecha en ese extremo el rango queda abierto de ese lado.
 * Una regla sin ninguna de las dos fechas es siempre `'vigente'`.
 *
 * ⚠️ **Limitación asumida a propósito, y va dicha acá porque no se ve leyendo el
 * código:** el "hoy" que usa esta función es la fecha LOCAL DEL NAVEGADOR, no la
 * del tenant — a diferencia del motor de cálculo, que si hay una cuenta abierta usa
 * `abierta_el` y si no, evalúa "ahora" (`instanteDeVigencia`, mismo archivo). Es una
 * etiqueta informativa, no plata: en la franja de unas pocas horas alrededor de la
 * medianoche del tenant, un usuario conectado desde otro huso horario puede ver un
 * badge que no coincide un instante con lo que el motor efectivamente cobra. La
 * alternativa exacta es que el backend devuelva el estado ya calculado con la zona
 * horaria del tenant, y no se justifica el costo para una etiqueta: el arreglo real
 * de plata está en el motor, no acá.
 */
export function useVigenciaRegla() {
  function estadoVigencia(fechaInicio: string | null, fechaFin: string | null): EstadoVigencia {
    const hoy = hoyLocal()
    if (fechaInicio && hoy < fechaInicio) return 'programada'
    if (fechaFin && hoy > fechaFin) return 'vencida'
    return 'vigente'
  }

  /** `undefined` para `'vigente'`: esa fila no lleva badge (ver `vigenciaLabel`). */
  function vigenciaColor(fechaInicio: string | null, fechaFin: string | null): VigenciaColor | undefined {
    const estado = estadoVigencia(fechaInicio, fechaFin)
    return estado === 'vigente' ? undefined : COLOR[estado]
  }

  /** `undefined` para `'vigente'`: una regla vigente no lleva badge — solo se
   *  marca la excepción (vencida/programada), no el caso esperado. */
  function vigenciaLabel(fechaInicio: string | null, fechaFin: string | null): string | undefined {
    const estado = estadoVigencia(fechaInicio, fechaFin)
    return estado === 'vigente' ? undefined : ETIQUETA[estado]
  }

  return { estadoVigencia, vigenciaColor, vigenciaLabel }
}
