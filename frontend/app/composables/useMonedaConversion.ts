import Decimal from 'decimal.js'
import type { MonedaDisplayConfig } from '~/types/moneda'
import { useApiFetch } from './useApiFetch'

/**
 * Traduce `modo_redondeo` del tenant al enum de Decimal.js. Espejo de
 * `modoToRounding` en `backend/src/modules/calculo-precios/calculo-precios.engine.ts`
 * — este monorepo no comparte código entre frontend y backend (decisión del owner,
 * ver nota "workspace compartido" en memoria del agente), así que la traducción se
 * mantiene a mano en los dos lados. Mismo default (`HALF_UP`) que el `default:` del
 * backend.
 */
function modoRedondeoADecimalRounding(modo: string): Decimal.Rounding {
  switch (modo) {
    case 'HALF_EVEN':
      return Decimal.ROUND_HALF_EVEN
    case 'FLOOR':
      return Decimal.ROUND_FLOOR
    case 'CEIL':
      return Decimal.ROUND_CEIL
    case 'HALF_UP':
    default:
      return Decimal.ROUND_HALF_UP
  }
}

/**
 * precio × tasa, cuantizado con el modo de redondeo del tenant. Misma fórmula y mismo
 * modo que `CalculoPreciosService.convertirAMonedaOficial` (backend); acá la escala la
 * pasa el llamador porque no todo consumidor de esta función cuantiza a la misma escala.
 */
export function convertir(
  precio: string,
  tasa: string,
  config: { modoRedondeo: string, decimales: number },
): string {
  return new Decimal(precio || '0')
    .times(tasa)
    .toDecimalPlaces(config.decimales, modoRedondeoADecimalRounding(config.modoRedondeo))
    .toFixed(config.decimales)
}

/**
 * Decimales a los que el backend persiste la conversión a moneda oficial
 * (`ESCALA_PERSISTIDA` en `calculo-precios.service.ts`) — NO los decimales de display
 * de la moneda. Lo que esta pantalla muestra (p.ej. "≈ $X c/u") es una vista previa;
 * el backend recalcula y persiste la cifra real al cerrar la venta. Coincidir en
 * escala y modo evita mostrarle al usuario un número distinto del que el backend
 * termina guardando.
 */
const ESCALA_CONVERSION_OFICIAL = 4

// Cache a nivel de módulo: un solo fetch de `modoRedondeo` por tenant activo,
// compartido por todas las instancias del composable (mismo patrón que la variable
// `refreshing` de `useApiFetch.ts`). Arranca en 'HALF_UP' —el default del backend—
// así que mientras el fetch no resuelve, `convertirAMonedaOficial` se comporta igual
// que antes de este cambio; una vez resuelto, las llamadas siguientes (reactivas,
// por ser `ref`) usan el modo real del tenant.
const modoRedondeoTenant = ref<string>('HALF_UP')
const modoRedondeoTenantId = ref<string | null>(null)
// El dedup de "fetch en curso" está atado al tenantId que se está pidiendo, no es un
// booleano global: si el fetch del tenant A sigue en vuelo y el usuario cambia al
// tenant B, el fetch de B tiene que salir igual — un booleano compartido lo bloquearía
// hasta que A resolviera, sirviendo el modo de redondeo equivocado mientras tanto.
let modoRedondeoFetchTenantId: string | null = null

function ensureModoRedondeoCargado(tenantId: string | null): void {
  if (!tenantId) return
  if (modoRedondeoTenantId.value === tenantId) return
  if (modoRedondeoFetchTenantId === tenantId) return
  modoRedondeoFetchTenantId = tenantId
  const apiUrl = useRuntimeConfig().public.apiUrl
  useApiFetch<{ modoRedondeo: string }>(`${apiUrl}/tenants/me`)
    .then((tenant) => {
      modoRedondeoTenant.value = tenant.modoRedondeo
      modoRedondeoTenantId.value = tenantId
    })
    // Sin red o 401 en curso: se queda en el default y reintenta en la próxima
    // llamada — no se marca `modoRedondeoTenantId`, así que el guard de arriba no lo bloquea.
    .catch(() => {})
    .finally(() => {
      if (modoRedondeoFetchTenantId === tenantId) modoRedondeoFetchTenantId = null
    })
}

/**
 * El modo vigente PARA el tenant activo — nunca el cache a secas. `modoRedondeoTenant`
 * puede quedar poblado con el modo del tenant ANTERIOR mientras el fetch del nuevo
 * sigue en vuelo (o si nunca se disparó): leer el `ref` sin comparar el tenantId
 * serviría el `modo_redondeo` de un tenant a otro, justo la clase de bug que las
 * invariantes del proyecto prohíben (multi-tenant). Con este guard, el peor caso ante
 * un cache desalineado es el mismo default de antes de esta tarea (`HALF_UP`), nunca
 * el modo de un tenant ajeno.
 */
function modoRedondeoVigente(tenantId: string | null): string {
  return tenantId && modoRedondeoTenantId.value === tenantId
    ? modoRedondeoTenant.value
    : 'HALF_UP'
}

/**
 * Limpia el cache. NO evita servirle a un tenant el modo de otro —eso lo hace
 * `modoRedondeoVigente` comparando el tenantId en cada lectura, así que la
 * corrección no depende de que nadie llame esto—; lo que hace es invalidar el
 * valor cacheado para el MISMO tenant cuando cambia, típicamente porque el admin
 * lo acaba de guardar (`preferencias-financieras.vue` lo llama tras el `PUT`). Sin
 * esto, la vista previa de conversión seguiría mostrando el modo viejo por el
 * resto de la sesión SPA.
 *
 * ⚠️ **No la enganches en `auth.ts#clearAuth` ni en `tenant.ts#switchTenant`** —se
 * intentó (mismo gesto que `useMonedasStore().reset()` / `usePermissionsStore().reset()`,
 * llamados desde esos dos lugares) y **rompió otros stores**: un store importando un
 * composable que a su vez llama `useAuthStore()` cierra un ciclo en el grafo de
 * auto-imports de Nuxt, y aunque no lanza en el path feliz, corrompió
 * `useUnidadesMedidaStore` en `items.nuxt.spec.ts` (`unidades.value` llegaba
 * `undefined`) — medido, no teórico: revertido cuando el test lo cazó. La
 * comparación por tenantId de `modoRedondeoVigente` ya cubre ese caso sin el reset,
 * así que no hace falta forzar el enganche ahí.
 */
export function resetModoRedondeoTenant(): void {
  modoRedondeoTenant.value = 'HALF_UP'
  modoRedondeoTenantId.value = null
  modoRedondeoFetchTenantId = null
}

export function useMonedaConversion() {
  const store = useMonedasStore()
  const authStore = useAuthStore()
  const { formatMonto } = useFormatters()

  ensureModoRedondeoCargado(authStore.activeTenantId)

  const monedaOficial = computed(() => store.monedaOficial)

  function esMonedaExtranjera(monedaId: string): boolean {
    const oficial = store.monedaOficial
    return !!oficial && monedaId !== oficial.monedaId
  }

  function getConfig(monedaId: string): MonedaDisplayConfig | undefined {
    return store.getById(monedaId)
  }

  /**
   * Convierte a la moneda oficial con el modo de redondeo del tenant ACTIVO — misma
   * fórmula que `CalculoPreciosService.convertirAMonedaOficial` (backend), no un
   * `.toFixed()` fijo (eso redondeaba siempre HALF_UP, el default de Decimal.js, sin
   * mirar `modo_redondeo`). Dispara `ensureModoRedondeoCargado` de nuevo por si el
   * tenant activo cambió después de que se creó este composable (la misma instancia
   * de componente sobrevive un `switchTenant`) y usa `modoRedondeoVigente`, que
   * ignora el cache si no es del tenant de ESTA llamada.
   */
  function convertirAMonedaOficial(precio: string, monedaId: string): string {
    if (!esMonedaExtranjera(monedaId)) return precio
    const tasa = store.getById(monedaId)?.valorDelDia ?? '1'
    ensureModoRedondeoCargado(authStore.activeTenantId)
    return convertir(precio, tasa, {
      modoRedondeo: modoRedondeoVigente(authStore.activeTenantId),
      decimales: ESCALA_CONVERSION_OFICIAL,
    })
  }

  function monedasExtranjerasDeIds(monedaIds: string[]): MonedaDisplayConfig[] {
    const seen = new Set<string>()
    const result: MonedaDisplayConfig[] = []
    for (const id of monedaIds) {
      if (!esMonedaExtranjera(id) || seen.has(id)) continue
      seen.add(id)
      const cfg = store.getById(id)
      if (cfg) result.push(cfg)
    }
    return result
  }

  function formatTasa(moneda: MonedaDisplayConfig): string {
    const oficial = store.monedaOficial
    if (!oficial) return '—'
    return `1 ${moneda.codigoIso} = ${formatMonto(moneda.valorDelDia, oficial.monedaId)}`
  }

  return {
    monedaOficial,
    esMonedaExtranjera,
    getConfig,
    convertirAMonedaOficial,
    monedasExtranjerasDeIds,
    formatTasa,
  }
}
