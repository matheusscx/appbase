import type {
  ColorModePreference,
  PageSizePreference,
  UsuarioPreferencias,
} from '~/types/usuario-preferencias'
import {
  mergePreferencias,
  resolveColorMode,
  resolvePageSize,
} from '~/types/usuario-preferencias'

export function useUserPreferences() {
  const authStore = useAuthStore()
  const config = useRuntimeConfig()
  const toast = useToast()
  const colorMode = useColorMode()

  const preferences = computed(() => authStore.user?.preferencias ?? {})
  const pageSize = computed(() => resolvePageSize(preferences.value))
  const colorModePreference = computed(() => resolveColorMode(preferences.value))

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function persistPreferences(patch: UsuarioPreferencias) {
    try {
      const updated = await useApiFetch<UsuarioPreferencias>(
        `${config.public.apiUrl}/me/preferencias`,
        { method: 'PATCH', body: patch },
      )
      authStore.updateUser({ preferencias: updated })
    }
    catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      toast.add({ title: msg ?? 'Error al guardar preferencias', color: 'error' })
      throw e
    }
  }

  function updatePreferences(patch: UsuarioPreferencias) {
    const previous = authStore.user?.preferencias
    const merged = mergePreferencias(previous, patch)
    authStore.updateUser({ preferencias: merged })

    if (patch.ui?.colorMode) {
      colorMode.preference = patch.ui.colorMode
    }

    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      persistPreferences(patch).catch(() => {
        authStore.updateUser({ preferencias: previous })
        if (previous?.ui?.colorMode) {
          colorMode.preference = resolveColorMode(previous)
        }
      })
    }, 300)
  }

  function applyColorModeFromServer() {
    const pref = colorModePreference.value
    if (colorMode.preference !== pref) {
      colorMode.preference = pref
    }
  }

  function setPageSize(size: PageSizePreference) {
    updatePreferences({ ui: { pageSize: size } })
  }

  function setColorMode(mode: ColorModePreference) {
    updatePreferences({ ui: { colorMode: mode } })
  }

  return {
    preferences,
    pageSize,
    colorModePreference,
    updatePreferences,
    applyColorModeFromServer,
    setPageSize,
    setColorMode,
  }
}
