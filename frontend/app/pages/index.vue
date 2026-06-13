<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const store = useAuthStore()
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
    <nav class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center">
          <UIcon name="i-heroicons-bolt" class="text-white w-4 h-4" />
        </div>
        <span class="font-semibold text-gray-900 dark:text-white text-sm">Prueba Técnica</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ store.user?.email }}</span>
        <UButton size="sm" variant="ghost" color="neutral" @click="store.logout()">
          Cerrar sesión
        </UButton>
      </div>
    </nav>

    <main class="max-w-2xl mx-auto px-6 py-16 text-center">
      <div class="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-950 flex items-center justify-center mx-auto mb-6">
        <UIcon name="i-heroicons-check-circle" class="w-8 h-8 text-primary-600" />
      </div>
      <h2 class="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
        Bienvenido, {{ store.user?.name }}
      </h2>
      <p class="text-gray-500 dark:text-gray-400 text-sm">
        Has iniciado sesión correctamente.
      </p>
    </main>
  </div>
</template>
