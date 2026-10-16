<script setup lang="ts">
/**
 * Campo de contraseña con ojo para verla. El ojo es un botón de verdad: con
 * nombre, alcanzable con Tab y con su estado (`aria-pressed`) — antes era un
 * `<button tabindex="-1">` sin nombre (auditoría UX 08.9).
 *
 * Los demás atributos (`autocomplete`, `placeholder`, `name`, `disabled`…) pasan
 * al `UInput`. `compacto` es para Mi cuenta (40 px); el ingreso mide 44 px.
 */
const modelo = defineModel<string>({ default: '' })
withDefaults(defineProps<{ compacto?: boolean }>(), { compacto: false })
const visible = ref(false)
</script>

<template>
  <UInput
    v-model="modelo"
    :type="visible ? 'text' : 'password'"
    size="xl"
    :ui="{ base: compacto ? '' : 'min-h-11' }"
    class="w-full"
  >
    <template #trailing>
      <UButton
        type="button"
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        color="neutral"
        variant="link"
        size="xl"
        :class="compacto ? 'size-10 justify-center' : 'size-11 justify-center'"
        :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        :aria-pressed="visible"
        @click="() => { visible = !visible }"
      />
    </template>
  </UInput>
</template>
