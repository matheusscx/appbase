<script setup lang="ts">
definePageMeta({ layout: false })
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm text-center">
      <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-6">
        <UIcon name="i-lucide-zap" class="text-white w-5 h-5" />
      </div>
      <h1 class="text-xl font-semibold mb-2">Recuperar contraseña</h1>
      <p class="text-sm text-muted mb-6">
        Esta funcionalidad estará disponible próximamente.
      </p>
      <NuxtLink to="/login">
        <UButton variant="outline" block>Volver al inicio de sesión</UButton>
      </NuxtLink>
    </div>
  </div>
</template>
