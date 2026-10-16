// @vitest-environment nuxt
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useReportes } from './useReportes'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

describe('useReportes', () => {
  beforeEach(() => {
    esAdmin = false
    permisos = []
  })

  it('el admin de un tenant que no contrató el reporte no lo ve', () => {
    // `mis-permisos` le trae al admin los permisos de los módulos contratados: sin `Varianza`
    // en la lista, el tenant no lo tiene, sea admin o no.
    esAdmin = true
    permisos = ['Paquetería:Leer']

    expect(useReportes().visibles.value).toEqual([])
  })

  it('quien tiene el permiso del reporte lo ve, admin o no', () => {
    permisos = ['Varianza:Leer']

    expect(useReportes().visibles.value.map(r => r.to)).toEqual(['/reportes/varianza'])
  })
})
