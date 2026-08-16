import type { MesaResumen } from '~/composables/useSalones'

/**
 * Tamaño dibujado de una mesa, en **píxeles fijos**.
 *
 * Vive acá y no dentro de `MesaNode.vue` porque lo necesitan dos consumidores:
 * el nodo que la dibuja y el plano que detecta si una mesa se soltó encima de
 * otra. Dos tablas de píxeles que tienen que coincidir y viven en archivos
 * distintos divergen — el aviso de solapamiento marcaría una cosa y el ojo
 * vería otra.
 *
 * ⚠️ **El servidor no puede evaluar el solapamiento, y por eso esto es
 * frontend.** La posición se persiste como fracción `0..1` de un contenedor
 * responsivo (`mesa.posX`/`posY`, `numeric(6,5)`), pero el tamaño se dibuja en
 * píxeles fijos: dos mesas que no se pisan en 1920 px sí se pisan en 1024. El
 * alto del plano además lo redimensiona el usuario y se guarda en
 * `localStorage`. La limitación asumida: el aviso depende del tamaño de pantalla
 * de quien acomodó el plano. La alternativa que la sacaría —guardar el tamaño
 * también en fracciones— se evaluó y se descartó por costo (toca esquema, render
 * y editor).
 */
export const TAMANO_MESA_PX: Record<MesaResumen['tamano'], number> = {
  pequeno: 64,
  mediano: 80,
  grande: 96,
  extra_grande: 112,
}

/** Ancho y alto en px. La rectangular es 1,5× de ancho. */
export function dimensionesMesaPx(
  forma: MesaResumen['forma'],
  tamano: MesaResumen['tamano'],
): { width: number, height: number } {
  const base = TAMANO_MESA_PX[tamano]
  return {
    width: forma === 'rectangular' ? base * 1.5 : base,
    height: base,
  }
}

/**
 * ¿Se pisan dos mesas, dadas las dimensiones del plano en píxeles?
 *
 * Las posiciones son el **centro** de la mesa (el nodo se dibuja con
 * `-translate-x-1/2 -translate-y-1/2`), así que la caja va de centro ± mitad.
 *
 * Se exige un solape real y no el borde exacto: dos mesas pegadas lado a lado
 * —que es una distribución legítima— comparten el borde y no deben avisar.
 */
export function mesasSePisan(
  a: Pick<MesaResumen, 'posX' | 'posY' | 'forma' | 'tamano'>,
  b: Pick<MesaResumen, 'posX' | 'posY' | 'forma' | 'tamano'>,
  plano: { width: number, height: number },
): boolean {
  const caja = (m: typeof a) => {
    const { width, height } = dimensionesMesaPx(m.forma, m.tamano)
    const cx = Number(m.posX) * plano.width
    const cy = Number(m.posY) * plano.height
    return {
      x1: cx - width / 2,
      x2: cx + width / 2,
      y1: cy - height / 2,
      y2: cy + height / 2,
    }
  }
  const ca = caja(a)
  const cb = caja(b)
  return ca.x1 < cb.x2 && cb.x1 < ca.x2 && ca.y1 < cb.y2 && cb.y1 < ca.y2
}
