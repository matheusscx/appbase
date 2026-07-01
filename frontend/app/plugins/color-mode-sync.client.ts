export default defineNuxtPlugin(() => {
  const authStore = useAuthStore()
  const { applyColorModeFromServer } = useUserPreferences()

  watch(
    () => authStore.user,
    (user) => {
      if (user) applyColorModeFromServer()
    },
    { immediate: true },
  )
})
