import { nextTick, ref } from 'vue'

/**
 * Errores de formulario junto al campo (`<UFormField :error="errores.nombre">`).
 * `marcar` los pone y lleva el foco al primer campo con error: validar al enviar
 * y rechazos del servidor (`apiFieldErrors`) comparten el mismo camino.
 * Devuelve `true` si había algo que marcar.
 */
export function useErroresCampo() {
  const errores = ref<Record<string, string>>({})

  function marcar(nuevos: Record<string, string>): boolean {
    errores.value = { ...nuevos }
    const hay = Object.keys(nuevos).length > 0
    if (hay) void nextTick(enfocarPrimerError)
    return hay
  }

  function limpiar(campo?: string) {
    if (!campo) { errores.value = {}; return }
    if (!(campo in errores.value)) return
    const { [campo]: _, ...resto } = errores.value
    errores.value = resto
  }

  return { errores, marcar, limpiar }
}

function enfocarPrimerError() {
  const campo = document.querySelector('[data-slot="error"]')?.closest('[data-slot="root"]')
  campo?.querySelector<HTMLElement>('input, textarea, select, button, [role="combobox"]')?.focus()
}
