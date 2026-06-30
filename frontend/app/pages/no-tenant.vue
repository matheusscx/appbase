<script setup lang="ts">
definePageMeta({ layout: false })
const authStore = useAuthStore()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm text-center">
      <div class="w-14 h-14 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center mx-auto mb-5">
        <UIcon name="i-heroicons-building-office-2" class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      </div>
      <h1 class="text-lg font-semibold text-default mb-2">
        Sin acceso a empresas
      </h1>
      <p class="text-sm text-muted mb-8 leading-relaxed">
        Tu cuenta no pertenece a ninguna empresa todavía.<br>
        Contacta al administrador para que te agregue.
      </p>
      <div class="flex flex-col gap-3">
        <UButton v-if="authStore.isSuperadmin" to="/admin" block icon="i-heroicons-cog-6-tooth">
          Ir a administración
        </UButton>
        <UButton variant="ghost" color="neutral" block @click="authStore.logout()">
          Cerrar sesión
        </UButton>
      </div>
    </div>
  </div>
</template>
