import { useApiFetch } from './useApiFetch'

// ── Tipos (espejo del contrato del backend `promociones`) ───────────────────
// backend/src/modules/promociones/entities/promocion.entity.ts +
// promocion-scope.entity.ts + dto/create-promocion.dto.ts

export type TipoPromocion = 'porcentaje' | 'nxm' | 'precio_fijo'
export type TipoScope = 'items' | 'categoria' | 'venta'
export type CanalPromocion = 'fisico' | 'online'

export interface ScopePromocion {
  id: string
  slot: number
  tipoScope: TipoScope
  categoriaId: string | null
  /** Solo significa algo en `precio_fijo`: cuántas unidades pide este slot. */
  cantidad: number
  itemIds: string[]
}

/** Fila tal como la devuelve `GET/POST/PATCH /promociones` (`PromocionConScopes`). */
export interface Promocion {
  id: string
  nombre: string
  descripcion: string | null
  /** Pausa. Pausada no aplica y NO avisa (spec §Modelo de datos). */
  activo: boolean
  fechaInicio: string
  fechaFin: string
  horaInicio: string | null
  horaFin: string | null
  /** ISO-8601: 1=lunes…7=domingo. `null` = todos los días. */
  diasSemana: number[] | null
  /** `null` = los dos canales. */
  canal: CanalPromocion | null
  tipo: TipoPromocion
  /** Decimal: 2x1 = `'1.0000'`, "2do al 50%" = `'0.5000'`. */
  valorPorcentaje: string | null
  /** Solo `nxm`: 2x1→2, 3x2→3. */
  cadaN: number | null
  /** Solo `precio_fijo`: el precio del conjunto en moneda oficial. */
  valorMonto: string | null
  scopes: ScopePromocion[]
  creadoEl?: string
  actualizadoEl?: string
  eliminadoEl?: string | null
}

export interface ScopePromocionPayload {
  tipoScope: TipoScope
  categoriaId?: string | null
  cantidad?: number
  itemIds?: string[]
}

/** Body de `POST`/`PATCH /promociones`. Se manda completo en las dos
 *  operaciones (nunca delta parcial): más simple que la reconstrucción por
 *  campo de `descuentos`, y seguro porque el service reemplaza los scopes
 *  enteros en cuanto la key `scopes` viene en el body. */
export interface PromocionPayload {
  nombre: string
  descripcion?: string | null
  activo?: boolean
  tipo: TipoPromocion
  fechaInicio: string
  fechaFin: string
  horaInicio?: string | null
  horaFin?: string | null
  diasSemana?: number[] | null
  canal?: CanalPromocion | null
  valorPorcentaje?: string | null
  cadaN?: number | null
  valorMonto?: string | null
  scopes: ScopePromocionPayload[]
}

export function usePromociones() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const listar = () => useApiFetch<Promocion[]>(`${apiUrl}/promociones`)

  const crear = (body: PromocionPayload) =>
    useApiFetch<Promocion>(`${apiUrl}/promociones`, { method: 'POST', body })

  const actualizar = (id: string, body: Partial<PromocionPayload>) =>
    useApiFetch<Promocion>(`${apiUrl}/promociones/${id}`, { method: 'PATCH', body })

  const eliminar = (id: string) =>
    useApiFetch(`${apiUrl}/promociones/${id}`, { method: 'DELETE' })

  return { listar, crear, actualizar, eliminar }
}

// ── Estado derivado para el badge de la lista ───────────────────────────────

export type EstadoPromocion = 'pausada' | 'programada' | 'vigente' | 'vencida'

type EstadoPromocionConBadge = Exclude<EstadoPromocion, 'vigente'>
type ColorBadgePromocion = 'neutral' | 'info' | 'error'

const ESTADO_LABEL: Record<EstadoPromocionConBadge, string> = {
  pausada: 'Pausada',
  programada: 'Programada',
  vencida: 'Vencida',
}

const ESTADO_COLOR: Record<EstadoPromocionConBadge, ColorBadgePromocion> = {
  pausada: 'neutral',
  programada: 'info',
  vencida: 'error',
}

/** 'YYYY-MM-DD' del navegador. NO `toISOString().slice(0, 10)`: eso da la fecha
 *  en UTC, que en husos negativos (Chile) puede ir un día atrás de la fecha
 *  local real — mismo criterio que `useVigenciaRegla`. */
function hoyLocal(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Estado de una promo para el badge de la lista: `Programada` / `Vigente` /
 * `Vencida` / `Pausada`.
 *
 * `activo` gana sobre las fechas siempre — el diseño lo dice explícito:
 * "pausar una campaña es el gesto normal de apagarla" (spec §Modelo de
 * datos), así que una promo pausada se marca `Pausada` aunque esté en su
 * ventana vigente o programada.
 *
 * ⚠️ **Misma limitación asumida que `useVigenciaRegla`, y no se ve leyendo el
 * código:** el "hoy" es la fecha LOCAL DEL NAVEGADOR, no la del tenant. Es
 * una etiqueta informativa, no plata — el evaluador real corre server-side
 * con la zona horaria del tenant.
 */
export function estadoPromocion(
  p: Pick<Promocion, 'activo' | 'fechaInicio' | 'fechaFin'>,
): EstadoPromocion {
  if (!p.activo) return 'pausada'
  const hoy = hoyLocal()
  if (hoy < p.fechaInicio) return 'programada'
  if (hoy > p.fechaFin) return 'vencida'
  return 'vigente'
}

/** `null` para `'vigente'`: es el caso esperado, no lleva badge — solo se
 *  marca la excepción, igual que `useVigenciaRegla`. */
export function estadoPromocionBadge(
  p: Pick<Promocion, 'activo' | 'fechaInicio' | 'fechaFin'>,
): { label: string, color: ColorBadgePromocion } | null {
  const estado = estadoPromocion(p)
  if (estado === 'vigente') return null
  return { label: ESTADO_LABEL[estado], color: ESTADO_COLOR[estado] }
}
