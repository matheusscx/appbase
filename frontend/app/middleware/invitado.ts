/**
 * Pantallas de invitado (login, registro, recuperar): con la sesión abierta no
 * muestran el formulario, llevan al inicio (auditoría UX 08.21).
 *
 * ⚠️ Solo cuenta una sesión **completa**, es decir con empresa en el token. Un
 * token sin empresa es lo que deja `handlePostLogin` cuando falla el cambio de
 * empresa: el middleware `auth` manda a `/login` para que se vea el aviso, y si
 * esto lo devolviera al inicio se armaría un lazo.
 */
export default defineNuxtRouteMiddleware(() => {
  const { activeTenantId } = useAuthStore()
  if (activeTenantId) return navigateTo('/')
})
