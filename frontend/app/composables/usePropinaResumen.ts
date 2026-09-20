import { useApiFetch } from './useApiFetch'

/**
 * Rango [primer día del mes, primer día del mes siguiente) para el resumen
 * mensual de propinas por defecto. `hasta` es EXCLUSIVO — el llamador
 * (`GET /propinas/reportes/resumen`) compensa, no cambiar el contrato acá.
 *
 * Arma las dos fechas por COMPONENTES LOCALES (`getFullYear`/`getMonth`),
 * nunca con `toISOString().slice(0, 10)`: esa conversión pasa por UTC, y en
 * husos POSITIVOS (Europa) la medianoche local del día 1 cae la tarde
 * anterior en UTC — `desde` salía un día antes del mes real. En Chile (huso
 * negativo) no se nota, por eso el bug pasó dos temporadas sin que nadie lo
 * viera. Mismo criterio que `hoyLocal()` en `useVigenciaRegla.ts`.
 *
 * Recibe `ahora` para poder fijar el "hoy" del test (evita una carrera con
 * el reloj real en el borde de un mes); el llamador de producción no manda
 * nada y usa el momento actual.
 */
export function rangoMesActual(ahora: Date = new Date()): { desde: string, hasta: string } {
  const fmt = (d: Date) => {
    const mes = String(d.getMonth() + 1).padStart(2, '0')
    const dia = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mes}-${dia}`
  }
  return {
    desde: fmt(new Date(ahora.getFullYear(), ahora.getMonth(), 1)),
    hasta: fmt(new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1)),
  }
}

interface ReporteResumenRaw {
  cobranza: { montoCobrado: string }
  estadoActual: { pendienteLibreMonto: string }
}

export interface PropinaResumenMinimo {
  pendienteLibreMonto: string
  montoCobrado: string
}

export function usePropinaResumen() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const resumen = async (desde: string, hasta: string): Promise<PropinaResumenMinimo> => {
    const params = new URLSearchParams({ desde, hasta })
    const raw = await useApiFetch<ReporteResumenRaw>(
      `${apiUrl}/propinas/reportes/resumen?${params.toString()}`,
    )
    return {
      pendienteLibreMonto: raw.estadoActual.pendienteLibreMonto,
      montoCobrado: raw.cobranza.montoCobrado,
    }
  }

  return { resumen }
}
