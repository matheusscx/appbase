<script setup lang="ts">
definePageMeta({ layout: false, middleware: 'auth' })
const authStore = useAuthStore()
</script>

<template>
  <AppMarco titulo="Sin acceso a empresas" icono="i-lucide-building-2">
    <div class="text-center">
      <p class="text-sm text-muted mb-8 leading-relaxed">
        Tu cuenta no pertenece a ninguna empresa todavía.<br>
        Contacta al administrador para que te agregue.
      </p>
      <div class="flex flex-col gap-3">
        <UButton v-if="authStore.isSuperadmin" to="/admin" block icon="i-lucide-settings">
          Ir a administración
        </UButton>
        <UButton variant="ghost" color="neutral" block @click="authStore.logout()">
          Cerrar sesión
        </UButton>
      </div>
    </div>
  </AppMarco>
</template>
