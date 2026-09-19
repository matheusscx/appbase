interface TenantMeDiaNegocio {
  horaCorte: number
  diaNegocioHoy: string
}

/**
 * Corte del día de negocio del tenant activo: `horaCorte` (entero 0–6) y
 * `diaNegocioHoy` (`YYYY-MM-DD`, calculado por el servidor con el corte
 * vigente — spec `docs/superpowers/specs/2026-09-18-hora-de-corte-dia-negocio-design.md`
 * § 3.1). A diferencia del cache a nivel de módulo de `useMonedaConversion.ts`
 * (`modoRedondeoTenant`), acá CADA instancia del composable trae sus propios
 * refs: cada pantalla llama `cargar()` en su propio `onMounted`, así que un
 * cambio de tenant nunca deja una pantalla mostrando el corte del tenant
 * anterior — el riesgo que ese otro cache sí corre (documentado en
 * `useMonedaConversion.ts:53-65`) y que acá no hace falta prevenir porque no
 * hay nada compartido que desalinear.
 */
export function useDiaNegocio() {
  const config = useRuntimeConfig()
  const apiUrl = config.public.apiUrl

  const horaCorte = ref<number | null>(null)
  const diaNegocioHoy = ref<string | null>(null)

  /**
   * Un error de red deja los dos en `null`: la nota es informativa y su
   * ausencia no rompe la pantalla, así que no amerita un toast que la
   * interrumpa (`DiaNegocioNota` simplemente no se dibuja).
   */
  async function cargar(): Promise<void> {
    try {
      const tenant = await useApiFetch<TenantMeDiaNegocio>(`${apiUrl}/tenants/me`)
      horaCorte.value = tenant.horaCorte
      diaNegocioHoy.value = tenant.diaNegocioHoy
    }
    catch {
      horaCorte.value = null
      diaNegocioHoy.value = null
    }
  }

  return { horaCorte, diaNegocioHoy, cargar }
}
