/**
 * Corta el acceso a las pantallas cuyo backend exige `TenantAdminGuard`.
 *
 * Va **además** de esconderlas del menú (`configuracion.vue` ya las agrupa bajo
 * `esAdmin`): sin guard de ruta, escribir la URL a mano abre la pantalla igual
 * —la lectura de esos endpoints es abierta, así que la tabla carga— y el
 * usuario descubre que no puede escribir recién al recibir un 403 del backend.
 *
 * Esconder no es seguridad (invariante 6): el candado real es el guard del
 * backend. Esto evita el callejón sin salida, nada más.
 *
 * `ensureCargado` no es opcional: el middleware corre ANTES del `onMounted` que
 * puebla el store, así que sin esperar la carga un admin entrando por URL o F5
 * se leería como no-admin y quedaría expulsado de su propia pantalla.
 */
export default defineNuxtRouteMiddleware(async () => {
  const permissionsStore = usePermissionsStore()
  await permissionsStore.ensureCargado()

  // Si los permisos no se pudieron cargar NO se redirige: no sabemos si es
  // admin, y expulsarlo por un error de red rompe el acceso de alguien que sí
  // puede. Se deja pasar porque esto es UX y el candado real es el guard del
  // backend, que va a responder 403 igual (invariante 6). Al revés —redirigir
  // ante la duda— se ve como "a veces me tira al índice" y nadie lo reporta
  // como bug de permisos.
  if (permissionsStore.error) return

  // Mismo criterio que el menú: `esAdmin` del tenant activo. El superadmin es
  // un eje aparte, con sus propias rutas `/admin/*` y su propio guard.
  if (!permissionsStore.esAdmin) return navigateTo('/configuracion')
})
