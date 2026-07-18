import { useApiFetch } from './useApiFetch'

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
