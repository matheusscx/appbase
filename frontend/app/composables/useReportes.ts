export interface Reporte {
  titulo: string
  descripcion: string
  icon: string
  to: string
}

interface ReporteConPermiso extends Reporte {
  modulo: string
  accion: string
}

/**
 * El catálogo del módulo de reportes (spec `2026-09-19-modulo-reportes-varianza-design.md`
 * § 3 y § 8): un reporte nuevo se agrega acá y aparece a la vez en el índice
 * `/reportes` y en el menú.
 *
 * ⛔ **Una sola lista para los dos consumidores.** El menú muestra "Reportes" si el
 * usuario puede ver **al menos uno**, y el índice muestra una tarjeta por cada uno
 * que puede ver; si cada uno repitiera el chequeo de permisos, un reporte nuevo
 * agregado solo en uno dejaría el menú apuntando a un índice vacío, o una
 * tarjeta sin entrada. Esconder no es seguridad (invariante 6): el candado es el
 * `@RequiresPermiso` de cada ruta y el middleware `permiso` de cada pantalla.
 */
const CATALOGO: ReporteConPermiso[] = [
  {
    titulo: 'Varianza',
    descripcion: 'Lo que las ventas dicen que se usó contra lo que los recuentos dicen que falta.',
    icon: 'i-lucide-scale',
    to: '/reportes/varianza',
    modulo: 'Varianza',
    accion: 'Leer',
  },
]

export function useReportes() {
  const permissionsStore = usePermissionsStore()

  const visibles = computed<Reporte[]>(() =>
    CATALOGO
      .filter(r => permissionsStore.esAdmin || permissionsStore.can(r.modulo, r.accion))
      .map(({ modulo: _m, accion: _a, ...r }) => r),
  )

  return { visibles }
}
