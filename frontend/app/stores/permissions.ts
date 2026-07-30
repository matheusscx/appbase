import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export const usePermissionsStore = defineStore('permissions', () => {
  const config = useRuntimeConfig()
  const permisos = ref<string[]>([])
  const esAdmin = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  // "Ya se intentó cargar", distinto de "hay permisos": un admin puede tener
  // `permisos: []` y `esAdmin: true`, así que `permisos.length` no sirve para
  // saber si el store está poblado.
  const cargado = ref(false)
  let enVuelo: Promise<void> | null = null

  async function fetchPermisos(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const apiUrl = config.public.apiUrl
      const [perms, admin] = await Promise.all([
        useApiFetch<string[]>(`${apiUrl}/rbac/mis-permisos`),
        useApiFetch<{ esAdmin: boolean }>(`${apiUrl}/rbac/es-admin`),
      ])
      permisos.value = perms
      esAdmin.value = admin.esAdmin
    }
    catch (e: unknown) {
      error.value = apiErrorMsg(e, 'Error al cargar permisos')
    }
    finally {
      loading.value = false
      // Solo cuenta como cargado si de verdad se pobló: si el fetch falló,
      // `esAdmin` sigue en su default `false` y darlo por cargado haría que el
      // middleware `admin` expulse a un admin real por un hipo de red. Dejarlo
      // en `false` hace que la próxima navegación reintente.
      cargado.value = error.value === null
    }
  }

  /**
   * Garantiza que los permisos estén cargados antes de decidir con ellos.
   *
   * Lo necesita el middleware `admin`: la navegación corre ANTES del
   * `onMounted` donde el layout dispara `fetchPermisos`, así que un admin
   * entrando por URL directa o F5 leería `esAdmin: false` y se quedaría afuera
   * de su propia pantalla.
   *
   * Las llamadas concurrentes comparten el mismo request (`enVuelo`): sin eso,
   * middleware y layout montando a la vez pedían los permisos dos veces.
   */
  async function ensureCargado(): Promise<void> {
    if (cargado.value) return
    enVuelo ??= fetchPermisos().finally(() => {
      enVuelo = null
    })
    return enVuelo
  }

  function can(modulo: string, permiso: string): boolean {
    const auth = useAuthStore()
    if (auth.isSuperadmin) return true
    return permisos.value.includes(`${modulo}:${permiso}`)
  }

  function reset(): void {
    permisos.value = []
    esAdmin.value = false
    error.value = null
    // Al cambiar de tenant los permisos son otros: sin esto, `ensureCargado`
    // daría por bueno el estado del tenant anterior y el middleware decidiría
    // con permisos ajenos.
    cargado.value = false
    enVuelo = null
  }

  return {
    permisos,
    esAdmin,
    loading,
    error,
    cargado,
    fetchPermisos,
    ensureCargado,
    can,
    reset,
  }
})
