<script setup lang="ts">
definePageMeta({ layout: false })

const store = useAuthStore()

const state = reactive({
  email: '',
  password: '',
  keepSession: false,
})
const showPassword = ref(false)

async function onLogin() {
  const ok = await store.login(state.email, state.password)
  if (ok) await store.handlePostLogin()
}

async function onGoogle() {
  store.loginWithGoogle()
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-elevated px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600 mb-4">
          <UIcon name="i-heroicons-bolt" class="text-white w-5 h-5" />
        </div>
        <h1 class="text-xl font-semibold text-default">
          Prueba Técnica
        </h1>
      </div>

      <!-- Card -->
      <div class="bg-default rounded-2xl shadow-sm ring-1 ring-border-default p-8 space-y-5">

        <!-- Error -->
        <UAlert
          v-if="store.error"
          color="error"
          variant="subtle"
          :description="store.error"
          icon="i-heroicons-exclamation-circle"
        />

        <!-- Google -->
        <UButton
          block
          variant="outline"
          color="neutral"
          :disabled="store.loading"
          @click="onGoogle"
        >
          <template #leading>
            <svg class="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          </template>
          Continuar con Google
        </UButton>

        <!-- Divider -->
        <USeparator label="o" :ui="{ label: 'text-xs text-muted' }" />

        <!-- Form -->
        <UForm :state="state" class="space-y-4" @submit="onLogin">
          <UFormField label="Email" name="email">
            <UInput
              v-model="state.email"
              type="email"
              placeholder="tu@email.com"
              autocomplete="email"
              :disabled="store.loading"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Contraseña" name="password">
            <UInput
              v-model="state.password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="••••••••"
              autocomplete="current-password"
              :disabled="store.loading"
              class="w-full"
            >
              <template #trailing>
                <button
                  type="button"
                  tabindex="-1"
                  class="text-muted hover:text-default transition-colors"
                  @click="showPassword = !showPassword"
                >
                  <UIcon :name="showPassword ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'" class="w-4 h-4" />
                </button>
              </template>
            </UInput>
          </UFormField>

          <!-- Keep session + Forgot -->
          <div class="flex items-center justify-between">
            <UCheckbox v-model="state.keepSession" label="Mantener sesión iniciada" :disabled="store.loading" />
            <NuxtLink
              to="/forgot-password"
              class="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 transition-colors"
            >
              ¿Olvidaste tu contraseña?
            </NuxtLink>
          </div>

          <UButton
            type="submit"
            block
            :loading="store.loading"
            :disabled="store.loading || !state.email || !state.password"
          >
            Iniciar sesión
          </UButton>
        </UForm>
      </div>

      <!-- Register link -->
      <p class="mt-6 text-center text-sm text-muted">
        ¿No tienes cuenta?
        <NuxtLink
          to="/register"
          class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium transition-colors"
        >
          Crear cuenta
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
