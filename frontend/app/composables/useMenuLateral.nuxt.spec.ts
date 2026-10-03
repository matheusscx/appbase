// @vitest-environment nuxt
//
// Entorno `nuxt` porque el composable resuelve los stores, `useReportes` y
// `useRoute` por auto-import: así se mockean con `mockNuxtImport`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { effectScope, nextTick, reactive, ref } from 'vue'
import type { NavigationMenuItem } from '@nuxt/ui'
import { useMenuLateral } from './useMenuLateral'

const esAdmin = ref(false)
const permisos = ref<string[]>([])
const esSuperadmin = ref(false)
const reportesVisibles = ref<unknown[]>([])
const ruta = reactive({ path: '/' })

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin.value },
    can: (modulo: string, permiso: string) =>
      permisos.value.includes(`${modulo}:${permiso}`),
  })
})
mockNuxtImport('useAuthStore', () => {
  return () => ({
    get isSuperadmin() { return esSuperadmin.value },
  })
})
mockNuxtImport('useReportes', () => {
  return () => ({ visibles: reportesVisibles })
})
mockNuxtImport('useRoute', () => {
  return () => ruta
})

/**
 * Las entradas del menú plano anterior (`layouts/dashboard.vue` a 98803f9c) con
 * el permiso que mostraba cada una. Agrupar no puede perder, duplicar ni
 * re-gatear ninguna. Fuera de la tabla: Inicio (siempre), Reportes (algún
 * reporte visible) y Administración (superadmin).
 */
const GATE_POR_RUTA: Record<string, string> = {
  '/mi-caja': 'MiCaja:Leer',
  '/cajas': 'Cajas:Leer',
  '/ventas': 'Ventas:Leer',
  '/pagos': 'Pagos:Leer',
  '/propinas': 'Propinas:Leer',
  '/ventas/pos': 'Ventas:Crear',
  '/salones': 'Salones:Operar',
  '/sesiones-garzon': 'Salones:Leer',
  '/salones/anulaciones': 'Salones:Ver todas',
  '/tienda': 'Tienda Online:Leer',
  '/tienda/suscripciones': 'Tienda Online:Leer',
  '/tienda/medios-pago': 'Tienda Online:Leer',
  '/suscripciones': 'Suscripciones:Leer',
  '/terceros': 'Terceros:Leer',
  '/inventario': 'Inventario:Leer',
  '/mermas': 'Inventario:Leer',
  '/inventario/recuentos': 'Inventario:Leer',
  '/inventario/traslados': 'Inventario:Leer',
  '/inventario/stock-minimo': 'Inventario:Leer',
  '/compras': 'Compras:Leer',
  '/compras/por-pagar': 'Compras:Pagar',
  '/desfases': 'Items:Leer',
  '/ordenes': 'Pasarelas:Leer',
}

/** El árbol aprobado por el owner el 2026-10-02 (docs/patterns/frontend.md § 1). */
const ARBOL_DEL_ADMIN = [
  ['Inicio', '/'],
  ['Mi caja', '/mi-caja'],
  ['Cajas', '/cajas'],
  ['Ventas', [
    ['Punto de venta', '/ventas/pos'],
    ['Historial', '/ventas'],
    ['Pagos', '/pagos'],
    ['Órdenes', '/ordenes'],
  ]],
  ['Propinas', '/propinas'],
  ['Salones', [
    ['Mesas', '/salones'],
    ['Sesiones', '/sesiones-garzon'],
    ['Anulaciones', '/salones/anulaciones'],
  ]],
  ['Tienda Online', [
    ['Catálogo', '/tienda'],
    ['Mis suscripciones', '/tienda/suscripciones'],
    ['Medios de pago', '/tienda/medios-pago'],
  ]],
  ['Suscripciones', '/suscripciones'],
  ['Terceros', '/terceros'],
  ['Inventario', [
    ['Stock', '/inventario'],
    ['Recuentos', '/inventario/recuentos'],
    ['Traslados', '/inventario/traslados'],
    ['Mermas', '/mermas'],
    ['Stock mínimo', '/inventario/stock-minimo'],
    ['Costos desfasados', '/desfases'],
  ]],
  ['Compras', [
    ['Recepciones', '/compras'],
    ['Por pagar', '/compras/por-pagar'],
  ]],
  ['Reportes', '/reportes'],
  ['Administración', '/admin'],
]

/** El árbol reducido a nombres y rutas, que es lo que el usuario ve. */
function forma(items: NavigationMenuItem[]) {
  return items.map(item => item.children
    ? [item.label, item.children.map(hija => [hija.label, hija.to])]
    : [item.label, item.to])
}

/** Las pantallas a las que se llega: los links sueltos y las hijas de los grupos. */
function pantallas(items: NavigationMenuItem[]) {
  return items.flatMap(item => item.children
    ? item.children.map(hija => hija.to)
    : [item.to])
}

let scope: ReturnType<typeof effectScope> | undefined

/** El composable vive en un scope propio para que su `watch` muera con el test. */
function montarMenu() {
  scope = effectScope()
  return scope.run(() => useMenuLateral())!
}

describe('useMenuLateral', () => {
  beforeEach(() => {
    esAdmin.value = false
    permisos.value = []
    esSuperadmin.value = false
    reportesVisibles.value = []
    ruta.path = '/'
  })

  afterEach(() => {
    scope?.stop()
  })

  describe('el árbol', () => {
    beforeEach(() => {
      esAdmin.value = true
      esSuperadmin.value = true
      reportesVisibles.value = [{ to: '/reportes/varianza' }]
    })

    it('el admin ve el árbol aprobado, en orden', () => {
      const { items } = montarMenu()

      expect(forma(items.value)).toEqual(ARBOL_DEL_ADMIN)
    })

    it('cada pantalla del menú plano aparece exactamente una vez', () => {
      // Ordenado y no como conjunto: así falla tanto la pantalla que falta como la
      // que quedó repetida en dos grupos (un Set la escondería).
      const { items } = montarMenu()
      const esperadas = ['/', '/reportes', '/admin', ...Object.keys(GATE_POR_RUTA)]

      expect([...pantallas(items.value)].sort()).toEqual([...esperadas].sort())
    })
  })

  describe('los permisos', () => {
    it('sin permisos queda solo Inicio', () => {
      const { items } = montarMenu()

      expect(forma(items.value)).toEqual([['Inicio', '/']])
    })

    // Un gate por caso, en las dos direcciones: con solo ese permiso aparecen
    // exactamente sus pantallas. Si una hija perdiera su gate propio —"Mesas"
    // con `Salones:Leer` en vez de `Operar`—, este caso lo ve por los dos lados.
    it.each([...new Set(Object.values(GATE_POR_RUTA))])(
      'con solo %s ve exactamente sus pantallas, y ningún grupo vacío',
      (gate) => {
        permisos.value = [gate]
        const { items } = montarMenu()
        const suyas = Object.keys(GATE_POR_RUTA).filter(r => GATE_POR_RUTA[r] === gate)

        expect([...pantallas(items.value)].sort()).toEqual(['/', ...suyas].sort())
        expect(items.value.filter(item => item.children?.length === 0)).toEqual([])
      },
    )

    it('Reportes aparece solo si hay al menos un reporte visible', () => {
      const sinReportes = montarMenu()
      expect(pantallas(sinReportes.items.value)).not.toContain('/reportes')

      reportesVisibles.value = [{ to: '/reportes/varianza' }]

      expect(pantallas(sinReportes.items.value)).toContain('/reportes')
    })

    it('Administración es solo del superadmin, aunque sea admin del tenant', () => {
      esAdmin.value = true
      const { items } = montarMenu()
      expect(pantallas(items.value)).not.toContain('/admin')

      esSuperadmin.value = true

      expect(pantallas(items.value)).toContain('/admin')
    })

    it('un módulo de varias pantallas sigue siendo grupo aunque el rol vea una sola', () => {
      // El bodeguero recibe y no paga (decisión del owner, 2026-10-02): ve el
      // grupo Compras con "Recepciones" adentro, no un link suelto.
      permisos.value = ['Compras:Leer', 'Compras:Crear', 'Compras:Actualizar', 'Compras:Anular']
      const { items } = montarMenu()

      expect(forma(items.value)).toEqual([
        ['Inicio', '/'],
        ['Compras', [['Recepciones', '/compras']]],
      ])
    })
  })

  describe('con el lateral colapsado', () => {
    it('el ícono del grupo lleva a la primera pantalla que el usuario ve', () => {
      // Colapsado no hay acordeón: el clic en el ícono navega. Con solo `Pagar`,
      // la primera visible es "Por pagar", no "Recepciones".
      permisos.value = ['Compras:Pagar']
      const soloPaga = montarMenu()
      expect(soloPaga.items.value.find(i => i.label === 'Compras')?.to).toBe('/compras/por-pagar')

      permisos.value = ['Compras:Leer', 'Compras:Pagar']

      expect(soloPaga.items.value.find(i => i.label === 'Compras')?.to).toBe('/compras')
    })
  })

  describe('el grupo de la pantalla actual', () => {
    beforeEach(() => {
      esAdmin.value = true
    })

    it('queda marcado también en un detalle, y ningún otro', () => {
      ruta.path = '/compras/123'
      const { items } = montarMenu()

      const marcados = items.value.filter(item => item.children && item.active)
      expect(marcados.map(g => g.label)).toEqual(['Compras'])
    })

    it('se abre al entrar a una de sus pantallas', () => {
      ruta.path = '/inventario/recuentos'
      const { gruposAbiertos } = montarMenu()

      expect(gruposAbiertos.value).toEqual(['inventario'])
    })

    it('tras un F5 se abre cuando llegan los permisos, no solo al montar', async () => {
      // El acordeón del componente lee `defaultOpen` una vez, al montarse; tras un
      // F5 el menú se monta con el store vacío (`esAdmin` arranca en `false`).
      esAdmin.value = false
      ruta.path = '/inventario/recuentos'
      const { gruposAbiertos } = montarMenu()
      expect(gruposAbiertos.value).toEqual([])

      esAdmin.value = true
      await nextTick()

      expect(gruposAbiertos.value).toEqual(['inventario'])
    })

    it('al navegar suma el grupo nuevo sin cerrar los que se abrieron a mano', async () => {
      ruta.path = '/inventario'
      const { gruposAbiertos } = montarMenu()
      gruposAbiertos.value = [...gruposAbiertos.value, 'compras']

      ruta.path = '/ventas/pos'
      await nextTick()

      expect(gruposAbiertos.value).toEqual(['inventario', 'compras', 'ventas'])
    })

    it('si el usuario lo cierra, no se le reabre hasta que navegue', async () => {
      ruta.path = '/inventario'
      const { gruposAbiertos } = montarMenu()
      gruposAbiertos.value = []

      // Un cambio que recalcula el menú sin navegar: no es motivo para reabrir.
      reportesVisibles.value = [{ to: '/reportes/varianza' }]
      await nextTick()
      expect(gruposAbiertos.value).toEqual([])

      ruta.path = '/inventario/recuentos'
      await nextTick()

      expect(gruposAbiertos.value).toEqual(['inventario'])
    })
  })
})
