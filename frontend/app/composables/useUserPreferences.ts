import type {
  ColorModePreference,
  PageSizePreference,
  UsuarioPreferencias,
} from '~/types/usuario-preferencias'
import {
  COLOR_MODE_OPTIONS,
  mergePreferencias,
  PAGE_SIZE_OPTIONS,
  resolveColorMode,
  resolvePageSize,
} from '~/types/usuario-preferencias'

function successMessageForPatch(patch: UsuarioPreferencias): string {
  if (patch.ui?.colorMode) {
    const label = COLOR_MODE_OPTIONS.find(o => o.value === patch.ui!.colorMode)?.label
    return `Tema actualizado: ${label ?? patch.ui.colorMode}`
  }
  if (patch.ui?.pageSize) {
    const label = PAGE_SIZE_OPTIONS.find(o => o.value === patch.ui!.pageSize)?.label
    return `Filas por página: ${label ?? patch.ui.pageSize}`
  }
  return 'Preferencias actualizadas'
}

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
      toast.add({
        title: successMessageForPatch(patch),
        color: 'success',
        icon: 'i-lucide-check',
      })
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
    if (size === pageSize.value) return
    updatePreferences({ ui: { pageSize: size } })
  }

  function setColorMode(mode: ColorModePreference) {
    if (mode === colorModePreference.value) return
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
