/**
 * Corta el acceso a las pantallas que exigen un permiso de módulo concreto.
 *
 * Se declara en la página con el permiso que pide su endpoint de lectura:
 *
 * ```ts
 * definePageMeta({ middleware: ['auth', 'permiso'], permiso: 'Cajas:Leer' })
 * ```
 *
 * Hermano del middleware `admin`, que resuelve el otro corte: aquél pregunta
 * "¿es admin del tenant?" y éste "¿tiene este permiso?". Esconder no es
 * seguridad (invariante 6): el candado real es el `@RequiresPermiso` del
 * backend. Esto evita el callejón sin salida, nada más.
 *
 * Reemplaza al guard copiado en el `onMounted` de seis pantallas, que además de
 * repetirse corría **después** de montar —la pantalla parpadeaba antes del
 * rebote— y decidía sobre permisos a medio cargar: hacía `fetchPermisos()` solo
 * si `!loading`, así que con un fetch en vuelo evaluaba el store vacío y echaba
 * a un usuario legítimo. `ensureCargado` espera el que ya está en vuelo en vez
 * de ignorarlo.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const permiso = to.meta.permiso
  if (!permiso) return

  const [modulo, accion] = permiso.split(':')
  if (!modulo || !accion) return

  const permissionsStore = usePermissionsStore()
  await permissionsStore.ensureCargado()

  // Si los permisos no se pudieron cargar NO se redirige: no sabemos qué tiene,
  // y expulsarlo por un error de red rompe el acceso de alguien que sí puede.
  // Mismo criterio que el middleware `admin`.
  if (permissionsStore.error) return

  if (permissionsStore.esAdmin || permissionsStore.can(modulo, accion)) return

  // `useToast` fuera de un componente funciona —los toasts viven en un
  // `useState` compartido, así que el aviso aparece cuando monta el toaster—,
  // pero su `inject` interno loguea un warning de Vue en dev. Es el precio de
  // no perder el aviso que la pantalla daba antes de rebotar.
  useToast().add({
    title: `No tenés acceso al módulo ${to.meta.permisoLabel ?? modulo}`,
    color: 'warning',
  })
  return navigateTo('/ventas')
})

declare module '#app' {
  interface PageMeta {
    /** Permiso que exige la pantalla, con el formato `Modulo:Accion`. */
    permiso?: string
    /** Nombre del módulo en pantalla, si difiere del de la BD (`MiCaja` → `Mi caja`). */
    permisoLabel?: string
  }
}
