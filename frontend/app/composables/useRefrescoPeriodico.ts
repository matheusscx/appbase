import type { Ref } from 'vue'

export interface UseRefrescoPeriodicoOpts {
  intervaloMs?: number
}

export interface UseRefrescoPeriodicoResult<T> {
  datos: Ref<T | null>
  /** Última carga exitosa. */
  actualizadoEl: Ref<Date | null>
  /** La última carga falló: `datos` conserva el valor anterior. */
  sinConexion: Ref<boolean>
  /** Respondió 403: el bloque no se muestra — un módulo no contratado, no una falla. */
  oculto: Ref<boolean>
  refrescar: () => Promise<void>
}

/**
 * Refresco periódico de un bloque de la zona "Ahora" del dashboard de inicio
 * (spec `2026-09-18-dashboard-inicio-design.md` § 6) — el primer refresco
 * periódico del sistema. Carga al invocarse y después cada `intervaloMs`
 * (default 60 s), **solo si la pestaña está visible**; al volver a visible
 * (`visibilitychange`) dispara una carga extra, para no esperar hasta el
 * próximo tick.
 *
 * Un fallo de red conserva el último `datos` y marca `sinConexion`, **sin
 * reintentar antes del próximo ciclo** — el owner no quiere reintentos
 * automáticos (memoria `sin-reintento-automatico`); una carga exitosa la
 * apaga y actualiza `actualizadoEl`.
 *
 * Un **403** marca `oculto` y detiene el intervalo: es un módulo que el
 * tenant no contrató, no una falla (spec § 6) — reintentarlo no lo va a
 * arreglar. El status se lee como `useApiFetch`/`apiErrorMsg`:
 * `err?.status ?? err?.response?.status`.
 *
 * Sin dependencias nuevas: `@vueuse/core` no está en `package.json`.
 */
export function useRefrescoPeriodico<T>(
  cargar: () => Promise<T>,
  opts?: UseRefrescoPeriodicoOpts,
): UseRefrescoPeriodicoResult<T> {
  const intervaloMs = opts?.intervaloMs ?? 60_000

  const datos = ref<T | null>(null) as Ref<T | null>
  const actualizadoEl = ref<Date | null>(null)
  const sinConexion = ref(false)
  const oculto = ref(false)

  let intervalId: ReturnType<typeof setInterval> | null = null

  function detenerIntervalo() {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  async function refrescar(): Promise<void> {
    // Un bloque ya oculto (403 previo) no vuelve a pedir: el listener de
    // `visibilitychange` sigue vivo aunque el intervalo se haya detenido.
    if (oculto.value) return
    try {
      const resultado = await cargar()
      datos.value = resultado
      actualizadoEl.value = new Date()
      sinConexion.value = false
    }
    catch (e: unknown) {
      const status = (e as { status?: number })?.status
        ?? (e as { response?: { status?: number } })?.response?.status
      if (status === 403) {
        oculto.value = true
        detenerIntervalo()
        return
      }
      sinConexion.value = true
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') void refrescar()
  }

  // Carga inicial, al invocar el composable (no hay `onMounted`: se prueba
  // con un spec plano, sin instancia de componente activa).
  void refrescar()

  intervalId = setInterval(() => {
    if (document.visibilityState === 'visible') void refrescar()
  }, intervaloMs)

  document.addEventListener('visibilitychange', onVisibilityChange)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      detenerIntervalo()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    })
  }

  return { datos, actualizadoEl, sinConexion, oculto, refrescar }
}
