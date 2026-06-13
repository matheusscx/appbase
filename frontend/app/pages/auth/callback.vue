<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const store = useAuthStore()

onMounted(async () => {
  const token = route.query.token as string | undefined
  if (!token) return navigateTo('/login')
  store.setToken(token)
  await store.fetchMe()
  if (store.isAuthenticated) navigateTo('/')
  else navigateTo('/login')
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
    <div class="text-center space-y-3">
      <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 text-primary-600 animate-spin mx-auto" />
      <p class="text-sm text-gray-500 dark:text-gray-400">Iniciando sesión…</p>
    </div>
  </div>
</template>
