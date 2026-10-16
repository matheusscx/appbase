<script setup lang="ts">
/**
 * El marco de las pantallas públicas de marca (las que no usan layout): fondo
 * blanco, el logo de Venka arriba, el título con la letra de marca y el
 * contenido en una columna centrada.
 *
 * - `icono`: el ícono de **la acción** de la pantalla (llave, sobre, edificio).
 *   Va como una placa suave arriba del título; el logo no se reemplaza, se suma.
 * - slot `lateral`: panel de marca para escritorio. A partir de `lg` la página
 *   pasa a dos columnas iguales (panel a la izquierda, formulario a la derecha)
 *   y el logo positivo se oculta —ya lo trae el panel—. Por debajo de `lg` el
 *   panel no se ve y el logo positivo queda arriba del formulario.
 */
withDefaults(defineProps<{
  titulo?: string
  subtitulo?: string
  /** Ícono de la acción, `i-lucide-*`. */
  icono?: string
  ancho?: 'sm' | 'lg'
}>(), {
  titulo: undefined,
  subtitulo: undefined,
  icono: undefined,
  ancho: 'sm',
})
</script>

<template>
  <div
    class="min-h-screen bg-default"
    :class="{ 'lg:grid lg:grid-cols-2': $slots.lateral }"
  >
    <div
      v-if="$slots.lateral"
      data-qa="marco-lateral"
      class="hidden lg:flex"
    >
      <slot name="lateral" />
    </div>

    <main class="flex min-h-screen items-center justify-center px-4 py-12">
      <div
        data-qa="marco-columna"
        class="w-full"
        :class="ancho === 'lg' ? 'max-w-lg' : 'max-w-sm'"
      >
        <header
          class="mb-6 text-center"
          :class="{ 'lg:text-left': $slots.lateral }"
        >
          <img
            src="/marca/venka-positivo.svg"
            alt="Venka"
            class="mx-auto mb-7 h-10 w-auto"
            :class="{ 'lg:hidden': $slots.lateral }"
          >
          <div
            v-if="icono"
            data-qa="marco-icono"
            class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10"
          >
            <UIcon :name="icono" class="size-6 text-primary" />
          </div>
          <h1
            v-if="titulo"
            class="font-display text-2xl font-bold tracking-tight text-primary-800 dark:text-highlighted sm:text-3xl"
          >
            {{ titulo }}
          </h1>
          <p v-if="subtitulo" class="mt-2 text-sm text-muted">
            {{ subtitulo }}
          </p>
        </header>

        <slot />
      </div>
    </main>
  </div>
</template>
