import { describe, it, expect } from 'vitest'
import { motivoSinPermiso } from './motivo-sin-permiso'

describe('motivoSinPermiso', () => {
  it('dice qué permiso falta y en qué módulo', () => {
    expect(motivoSinPermiso('Crear', 'Impresoras')).toBe('Necesitas el permiso Crear en Impresoras')
  })

  it('nombra el permiso de edición y de borrado tal como se llaman en Roles', () => {
    expect(motivoSinPermiso('Actualizar', 'Productos')).toBe('Necesitas el permiso Actualizar en Productos')
    expect(motivoSinPermiso('Eliminar', 'Salones')).toBe('Necesitas el permiso Eliminar en Salones')
  })
})
