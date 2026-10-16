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
  <AppMarco
    titulo="Ingresa a tu caja"
    subtitulo="Las cuentas claras conservan la amistad."
  >
    <template #lateral>
      <!-- Panel de marca (escritorio). Texto sobre petróleo: blanco y los tonos 100/200
           de la escala, todos ≥ 4,5:1 sobre #0E4D57. -->
      <section class="flex w-full flex-col justify-between bg-primary px-12 py-14 xl:px-16">
        <img
          src="/marca/venka-negativo.svg"
          alt="Venka"
          class="h-11 w-auto self-start"
        >

        <div>
          <p class="mb-5 font-display text-5xl font-bold leading-[1.02] tracking-tight text-white xl:text-[56px]">
            Tu caja,<br>a la vista.
          </p>
          <p class="max-w-105 text-lg leading-relaxed text-primary-100">
            Cada cortesía y anulación queda con nombre, hora y motivo. Cierras el local tranquilo.
          </p>

          <!-- Decorativa: ilustra el cierre de caja, no es contenido. -->
          <div
            aria-hidden="true"
            class="mt-9 max-w-sm rounded-2xl bg-primary-600 px-5 py-4 tabular-nums"
          >
            <div class="flex items-center justify-between text-sm text-primary-200">
              <span>Cierre de caja · Turno noche</span>
              <span class="inline-flex items-center gap-1.5 rounded-full bg-menta px-2.5 py-0.5 text-xs font-medium text-primary">
                <UIcon name="i-lucide-check" class="size-3.5" />
                Cuadró
              </span>
            </div>
            <dl class="mt-2.5 text-sm">
              <div class="flex justify-between py-2">
                <dt class="text-primary-100">Efectivo contado</dt>
                <dd class="font-medium text-white">$412.300</dd>
              </div>
              <div class="flex justify-between border-t border-primary-200/15 py-2">
                <dt class="text-primary-100">Cortesías</dt>
                <dd class="font-medium text-white">3 · con motivo</dd>
              </div>
              <div class="flex justify-between border-t border-primary-200/15 py-2">
                <dt class="text-primary-100">Testigo</dt>
                <dd class="font-medium text-white">Diego, desde su cuenta</dd>
              </div>
            </dl>
          </div>
        </div>

        <div class="flex gap-2 text-sm text-primary-100">
          <span class="inline-flex items-center gap-2 rounded-full border border-primary-200/35 px-3 py-1.5">
            <span class="size-2 rounded-full bg-menta" />
            Venka Restaurante
          </span>
          <span class="inline-flex items-center gap-2 rounded-full border border-primary-200/35 px-3 py-1.5">
            <span class="size-2 rounded-full bg-lima" />
            Venka Almacén
          </span>
        </div>
      </section>
    </template>

    <!-- Card -->
    <div class="bg-default rounded-2xl border border-default p-7 space-y-5">

      <!-- Error -->
      <UAlert
        v-if="store.error"
        color="error"
        variant="subtle"
        :description="store.error"
        icon="i-lucide-circle-alert"
      />

      <!-- Form -->
      <UForm :state="state" class="space-y-4" @submit="onLogin">
        <UFormField label="Email" name="email">
          <UInput
            v-model="state.email"
            type="email"
            placeholder="tu@email.com"
            autocomplete="email"
            :disabled="store.loading"
            size="xl"
            :ui="{ base: 'min-h-11' }"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Contraseña" name="password">
          <template #hint>
            <NuxtLink
              to="/forgot-password"
              class="inline-flex min-h-11 items-center text-xs font-medium text-primary hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </NuxtLink>
          </template>
          <UInput
            v-model="state.password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="••••••••"
            autocomplete="current-password"
            :disabled="store.loading"
            size="xl"
            :ui="{ base: 'min-h-11' }"
            class="w-full"
          >
            <template #trailing>
              <UButton
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                color="neutral"
                variant="link"
                size="xl"
                class="size-11 justify-center"
                :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                :aria-pressed="showPassword"
                @click="() => { showPassword = !showPassword }"
              />
            </template>
          </UInput>
        </UFormField>

        <UCheckbox
          v-model="state.keepSession"
          label="Mantener sesión iniciada"
          :disabled="store.loading"
          :ui="{ root: 'min-h-11 items-center' }"
        />

        <UButton
          type="submit"
          block
          size="xl"
          class="min-h-11"
          :loading="store.loading"
          :disabled="store.loading || !state.email || !state.password"
        >
          Iniciar sesión
        </UButton>
      </UForm>

      <!-- Divider -->
      <USeparator label="o" :ui="{ label: 'text-xs text-muted' }" />

      <!-- Google -->
      <UButton
        block
        size="xl"
        class="min-h-11"
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
    </div>

    <!-- Register link -->
    <p class="mt-6 text-center text-sm text-muted">
      ¿No tienes cuenta?
      <NuxtLink
        to="/register"
        class="inline-flex min-h-11 items-center text-primary hover:underline font-medium"
      >
        Crear cuenta
      </NuxtLink>
    </p>
  </AppMarco>
</template>
