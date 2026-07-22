import { describe, it, expect } from 'vitest'
import { agruparParaImpresion } from './usePropinaImpresion'

const garzones = [
  { id: 'g1', nombre: 'Ana', activo: true, tipo: 'garzon', creadoEl: '', actualizadoEl: '' },
  { id: 'g2', nombre: 'Pedro', activo: true, tipo: 'cocina', creadoEl: '', actualizadoEl: '' },
]

const detalle = {
  grupos: [
    { id: 'gr1', nombre: 'Garzones', montoGrupo: '1000.0000' },
    { id: 'gr2', nombre: 'Cocina', montoGrupo: '500.0000' },
  ],
  participantes: [
    { id: 'p1', grupoId: 'gr1', garzonId: 'g1', monto: '1000.0000', incluido: true },
    { id: 'p2', grupoId: 'gr2', garzonId: 'g2', monto: '500.0000', incluido: true },
    { id: 'p3', grupoId: 'gr2', garzonId: 'gX', monto: '0.0000', incluido: false },
  ],
} as never

describe('agruparParaImpresion', () => {
  it('agrupa personas incluidas con su nombre y monto', () => {
    const grupos = agruparParaImpresion(detalle, garzones as never)
    expect(grupos).toHaveLength(2)
    expect(grupos[0]!.nombre).toBe('Garzones')
    expect(grupos[0]!.personas).toEqual([{ garzonId: 'g1', nombre: 'Ana', monto: '1000.0000' }])
    // excluidos no aparecen
    expect(grupos[1]!.personas).toEqual([{ garzonId: 'g2', nombre: 'Pedro', monto: '500.0000' }])
  })
})
