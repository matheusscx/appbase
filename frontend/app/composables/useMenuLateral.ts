import type { NavigationMenuItem } from '@nuxt/ui'

interface Pantalla {
  label: string
  icon: string
  to: string
}

/**
 * El menú lateral del layout `dashboard`, agrupado por módulo (owner, 2026-10-02;
 * las reglas para sumar una pantalla están en `docs/patterns/frontend.md` § 1).
 *
 * - Un módulo con varias pantallas es un grupo, aunque el rol vea una sola; un
 *   módulo de una sola pantalla es un link suelto.
 * - Cada pantalla conserva el gate exacto que tenía como entrada plana. Casi todas
 *   piden `Leer`, pero no todas: Punto de venta, Mesas, Anulaciones y Por pagar.
 * - Un grupo existe solo si al usuario le queda al menos una pantalla adentro.
 */
export function useMenuLateral() {
  const route = useRoute()
  const authStore = useAuthStore()
  const permissionsStore = usePermissionsStore()
  const { visibles: reportesVisibles } = useReportes()

  function puede(modulo: string, permiso: string) {
    return permissionsStore.esAdmin || permissionsStore.can(modulo, permiso)
  }

  function grupo(value: string, label: string, icon: string, hijas: (Pantalla | false)[]): NavigationMenuItem[] {
    const visibles = hijas.filter((hija): hija is Pantalla => hija !== false)
    const primera = visibles[0]
    if (!primera) return []
    return [{
      value,
      label,
      icon,
      // Desplegado, el grupo solo abre y cierra (`trigger`). Colapsado no hay
      // acordeón: el ícono lleva a la primera pantalla visible y el resto sale en
      // el popover.
      type: 'trigger',
      to: primera.to,
      // Marcado si la pantalla actual es una de sus hijas o un detalle suyo
      // (`/compras/123` es de Recepciones).
      active: visibles.some(hija => route.path === hija.to || route.path.startsWith(`${hija.to}/`)),
      children: visibles,
    }]
  }

  const items = computed<NavigationMenuItem[]>(() => {
    const menu: NavigationMenuItem[] = [
      {
        label: 'Inicio',
        icon: 'i-lucide-house',
        to: '/',
      },
    ]
    if (puede('MiCaja', 'Leer')) {
      menu.push({ label: 'Mi caja', icon: 'i-lucide-banknote', to: '/mi-caja' })
    }
    if (puede('Cajas', 'Leer')) {
      menu.push({ label: 'Cajas', icon: 'i-lucide-layout-dashboard', to: '/cajas' })
    }
    // Pagos y Órdenes son de otros módulos, pero son los cobros de lo vendido
    // (owner, 2026-10-02).
    menu.push(...grupo('ventas', 'Ventas', 'i-lucide-file-text', [
      puede('Ventas', 'Crear') && { label: 'Punto de venta', icon: 'i-lucide-shopping-cart', to: '/ventas/pos' },
      puede('Ventas', 'Leer') && { label: 'Historial', icon: 'i-lucide-history', to: '/ventas' },
      puede('Pagos', 'Leer') && { label: 'Pagos', icon: 'i-lucide-credit-card', to: '/pagos' },
      puede('Pasarelas', 'Leer') && { label: 'Órdenes', icon: 'i-lucide-receipt', to: '/ordenes' },
    ]))
    if (puede('Propinas', 'Leer')) {
      menu.push({ label: 'Propinas', icon: 'i-lucide-hand-coins', to: '/propinas' })
    }
    menu.push(...grupo('salones', 'Salones', 'i-lucide-utensils', [
      puede('Salones', 'Operar') && { label: 'Mesas', icon: 'i-lucide-armchair', to: '/salones' },
      puede('Salones', 'Leer') && { label: 'Sesiones', icon: 'i-lucide-timer', to: '/sesiones-garzon' },
      puede('Salones', 'Ver todas') && { label: 'Anulaciones', icon: 'i-lucide-ban', to: '/salones/anulaciones' },
    ]))
    menu.push(...grupo('tienda', 'Tienda Online', 'i-lucide-store', [
      puede('Tienda Online', 'Leer') && { label: 'Catálogo', icon: 'i-lucide-layout-grid', to: '/tienda' },
      puede('Tienda Online', 'Leer') && { label: 'Mis suscripciones', icon: 'i-lucide-repeat', to: '/tienda/suscripciones' },
      puede('Tienda Online', 'Leer') && { label: 'Medios de pago', icon: 'i-lucide-wallet', to: '/tienda/medios-pago' },
    ]))
    if (puede('Suscripciones', 'Leer')) {
      menu.push({ label: 'Suscripciones', icon: 'i-lucide-repeat-2', to: '/suscripciones' })
    }
    if (puede('Terceros', 'Leer')) {
      menu.push({ label: 'Terceros', icon: 'i-lucide-contact', to: '/terceros' })
    }
    // Costos desfasados es del módulo Items, pero el aviso nace donde cambia el
    // costo (owner, 2026-10-02).
    menu.push(...grupo('inventario', 'Inventario', 'i-lucide-clipboard-list', [
      puede('Inventario', 'Leer') && { label: 'Stock', icon: 'i-lucide-boxes', to: '/inventario' },
      puede('Inventario', 'Leer') && { label: 'Recuentos', icon: 'i-lucide-clipboard-check', to: '/inventario/recuentos' },
      puede('Inventario', 'Leer') && { label: 'Traslados', icon: 'i-lucide-arrow-left-right', to: '/inventario/traslados' },
      puede('Inventario', 'Leer') && { label: 'Mermas', icon: 'i-lucide-trash-2', to: '/mermas' },
      puede('Inventario', 'Leer') && { label: 'Stock mínimo', icon: 'i-lucide-package-minus', to: '/inventario/stock-minimo' },
      puede('Items', 'Leer') && { label: 'Costos desfasados', icon: 'i-lucide-scale', to: '/desfases' },
    ]))
    menu.push(...grupo('compras', 'Compras', 'i-lucide-truck', [
      puede('Compras', 'Leer') && { label: 'Recepciones', icon: 'i-lucide-package-check', to: '/compras' },
      // "Por pagar" (spec compras-deuda-proveedor § 8 y § 10, decisión 12): "el
      // bodeguero recibe y el dueño paga" — la entrada es de `Pagar`, no de
      // `Leer` como el resto del módulo (§ 1 del pattern frontend: acá el link
      // pregunta "¿puede pagar?", porque TODA la pantalla es de quien paga).
      puede('Compras', 'Pagar') && { label: 'Por pagar', icon: 'i-lucide-hand-coins', to: '/compras/por-pagar' },
    ]))
    // Visible si el usuario puede ver al menos un reporte: el catálogo y el
    // chequeo viven en `useReportes`, compartidos con el índice `/reportes`.
    if (reportesVisibles.value.length > 0) {
      menu.push({ label: 'Reportes', icon: 'i-lucide-chart-column', to: '/reportes' })
    }
    if (authStore.isSuperadmin) {
      menu.push({ label: 'Administración', icon: 'i-lucide-shield-check', to: '/admin' })
    }
    return menu
  })

  // Los grupos desplegados. El acordeón del componente lee `defaultOpen` una sola
  // vez, al montarse, y tras un F5 el menú se monta antes de que lleguen los
  // permisos (`esAdmin` arranca en `false`): con `defaultOpen`, el grupo de la
  // pantalla actual quedaría cerrado. Por eso el estado es propio y solo suma: lo
  // que el usuario abrió a mano sigue abierto, y lo que cerró no se le reabre
  // hasta que navegue.
  const gruposAbiertos = ref<string[]>([])
  const grupoActual = computed(() => items.value.find(item => item.children && item.active)?.value)

  watch([() => route.path, grupoActual], ([, actual]) => {
    if (actual && !gruposAbiertos.value.includes(actual)) {
      gruposAbiertos.value = [...gruposAbiertos.value, actual]
    }
  }, { immediate: true })

  return { items, gruposAbiertos }
}
