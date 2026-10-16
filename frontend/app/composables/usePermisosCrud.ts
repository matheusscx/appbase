import type { ComputedRef } from 'vue'

export interface PermisosCrud {
  puedeLeer: ComputedRef<boolean>
  puedeCrear: ComputedRef<boolean>
  puedeActualizar: ComputedRef<boolean>
  puedeEliminar: ComputedRef<boolean>
}

/**
 * Los permisos de escritura de un módulo.
 *
 * El admin del tenant no tiene atajo: `mis-permisos` ya le trae todos los permisos de
 * los módulos que su tenant contrató, y el backend le contesta 403 en los demás
 * (`userHasPermiso` mira `tenant_modulos` también para él). Hasta el 2026-10-15 esto
 * era `esAdmin || can(...)`, y el tenant que contrató un solo módulo veía los botones
 * de todos los otros (owner, 2026-10-15).
 *
 * Devuelve los cuatro permisos y cada pantalla desestructura los que usa: son
 * `computed`, así que los que no se leen no se evalúan.
 *
 * **Esto es UX, no seguridad** (invariante 6): el candado es el `@RequiresPermiso`
 * del backend. Y los cuatro se devuelven por separado a propósito — colapsarlos en
 * un `puedeEscribir` único le escondería el botón de editar a quien solo tiene
 * `Actualizar`. Cada control se gatea con el permiso que exige **su** endpoint;
 * ver `docs/patterns/frontend.md` §1.1.
 */
export function usePermisosCrud(modulo: string | string[]): PermisosCrud {
  const permissionsStore = usePermissionsStore()
  // Una lista de módulos significa "alcanza con uno", espejo exacto de
  // `@RequiresAlgunPermiso` en el backend. Lo pide la gestión de garzones, que
  // habilitan `Salones` o `Propinas`: si acá se gateara con uno solo, la
  // pantalla le escondería los botones a media verdad — el backend los
  // aceptaría igual, que es el peor de los dos errores posibles porque nadie
  // lo reporta como bug de permisos.
  const modulos = Array.isArray(modulo) ? modulo : [modulo]
  const puede = (permiso: string) =>
    computed(() => modulos.some(m => permissionsStore.can(m, permiso)))

  return {
    puedeLeer: puede('Leer'),
    puedeCrear: puede('Crear'),
    puedeActualizar: puede('Actualizar'),
    puedeEliminar: puede('Eliminar'),
  }
}
