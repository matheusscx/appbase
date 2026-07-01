<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const store = useAuthStore()

onMounted(async () => {
  const token = route.query.token as string | undefined
  if (!token) return navigateTo('/login')
  store.setToken(token)
  await store.fetchMe()
  if (!store.isAuthenticated) return navigateTo('/login')
  await store.handlePostLogin()
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated">
    <div class="text-center space-y-3">
      <UIcon name="i-lucide-loader" class="w-8 h-8 text-highlighted animate-spin mx-auto" />
      <p class="text-sm text-muted">Iniciando sesión…</p>
    </div>
  </div>
</template>
