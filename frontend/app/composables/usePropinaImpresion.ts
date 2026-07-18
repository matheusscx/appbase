import type { LiquidacionDetalle } from './usePropinaLiquidaciones'
import type { Garzon } from './useGarzones'

export interface PersonaImpresion {
  garzonId: string
  nombre: string
  monto: string
}

export interface GrupoImpresion {
  id: string
  nombre: string
  montoGrupo: string
  personas: PersonaImpresion[]
}

export function agruparParaImpresion(
  detalle: Pick<LiquidacionDetalle, 'grupos' | 'participantes'>,
  garzones: Garzon[],
): GrupoImpresion[] {
  const nombre = (id: string) => garzones.find(g => g.id === id)?.nombre ?? id
  return detalle.grupos.map(grupo => ({
    id: grupo.id,
    nombre: grupo.nombre,
    montoGrupo: grupo.montoGrupo,
    personas: detalle.participantes
      .filter(p => p.grupoId === grupo.id && p.incluido)
      .map(p => ({ garzonId: p.garzonId, nombre: nombre(p.garzonId), monto: p.monto })),
  }))
}
