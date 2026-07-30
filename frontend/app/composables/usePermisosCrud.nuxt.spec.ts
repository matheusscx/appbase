// @vitest-environment nuxt
//
// Entorno `nuxt` porque el composable resuelve `usePermissionsStore` por
// auto-import: es justamente lo que permite que las pantallas lo mockeen con
// `mockNuxtImport` en sus component tests.
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { usePermisosCrud } from './usePermisosCrud'

const esAdmin = ref(false)
const permisos = ref<string[]>([])

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin.value },
    can: (modulo: string, permiso: string) =>
      permisos.value.includes(`${modulo}:${permiso}`),
  })
})

describe('usePermisosCrud', () => {
  beforeEach(() => {
    esAdmin.value = false
    permisos.value = []
  })

  it('sin permisos del módulo no habilita nada', () => {
    const { puedeLeer, puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')

    expect([puedeLeer.value, puedeCrear.value, puedeActualizar.value, puedeEliminar.value])
      .toEqual([false, false, false, false])
  })

  it('cada permiso es independiente: no se colapsan en uno solo', () => {
    // El modo de falla que motivó el composable: un `puedeEscribir` único le
    // escondería el botón de editar a quien solo tiene `Actualizar`.
    permisos.value = ['Salones:Actualizar']

    const { puedeLeer, puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')

    expect([puedeLeer.value, puedeCrear.value, puedeActualizar.value, puedeEliminar.value])
      .toEqual([false, false, true, false])
  })

  it('el admin del tenant los tiene todos sin permisos listados', () => {
    // El `esAdmin ||` es lo que de verdad se copiaba mal en cada pantalla:
    // olvidarlo deja al admin con una pantalla de solo lectura y sin saber por qué.
    esAdmin.value = true

    const { puedeLeer, puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')

    expect([puedeLeer.value, puedeCrear.value, puedeActualizar.value, puedeEliminar.value])
      .toEqual([true, true, true, true])
  })

  it('respeta el módulo: un permiso de otro módulo no habilita', () => {
    permisos.value = ['Impresoras:Crear']

    expect(usePermisosCrud('Salones').puedeCrear.value).toBe(false)
    expect(usePermisosCrud('Impresoras').puedeCrear.value).toBe(true)
  })

  it('devuelve computeds, no una foto del estado al montar', () => {
    // Los permisos se cargan por fetch DESPUÉS del setup de la pantalla: si esto
    // devolviera booleanos planos, el usuario vería la pantalla de un no-admin
    // hasta recargar.
    const { puedeCrear } = usePermisosCrud('Salones')
    expect(puedeCrear.value).toBe(false)

    permisos.value = ['Salones:Crear']

    expect(puedeCrear.value).toBe(true)
  })
})
