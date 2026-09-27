import Decimal from 'decimal.js';
import { ESCALA_COSTO } from '../../common/constants/escalas';

/**
 * Una fila de `cuenta_linea_reparto`: cuántas unidades de una línea entraron
 * con cada responsable vigente de la cuenta (spec
 * `2026-09-27-porcentaje-anulaciones-por-garzon-design.md` § 3).
 */
export interface FilaReparto {
  id: string;
  garzonId: string | null;
  cantidad: string;
  creadoEl: Date;
}

/**
 * Qué filas bajan, y a cuánto, al descontar `cantidad` de una línea (bajar la
 * cantidad o anular). Primero sale del responsable vigente; si no alcanza, de
 * las demás, la más reciente primero, desempate por id. Es regla técnica, no
 * de negocio: el porqué está en la spec § 3.3.
 *
 * Que no alcance es un error y no un caso: significa que la invariante
 * *Σ reparto = cantidad de la línea* ya se había roto antes.
 */
export function descontarReparto(
  filas: FilaReparto[],
  responsableId: string | null,
  cantidad: string,
): { id: string; cantidad: string }[] {
  const orden = [...filas].sort((a, b) => {
    const ra = a.garzonId === responsableId ? 0 : 1;
    const rb = b.garzonId === responsableId ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const porFecha = b.creadoEl.getTime() - a.creadoEl.getTime();
    if (porFecha !== 0) return porFecha;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let resta = new Decimal(cantidad);
  const cambios: { id: string; cantidad: string }[] = [];
  for (const f of orden) {
    if (resta.lte(0)) break;
    const tiene = new Decimal(f.cantidad);
    if (tiene.lte(0)) continue;
    const saca = Decimal.min(tiene, resta);
    cambios.push({
      id: f.id,
      cantidad: tiene.minus(saca).toFixed(ESCALA_COSTO),
    });
    resta = resta.minus(saca);
  }
  if (resta.gt(0)) {
    throw new Error(
      `El reparto de la línea no alcanza para descontar ${cantidad}: ` +
        'la suma del reparto ya no era la cantidad de la línea',
    );
  }
  return cambios;
}

/**
 * La fusión de cuentas junta una línea de origen con una igual del destino
 * (`fusionarCuentas`). Su reparto se va con ella: cada fila de origen suma a
 * la fila del mismo garzón en la línea destino, o se re-apunta a esa línea si
 * no tiene; la fila absorbida se borra. Todo en memoria: el llamador escribe
 * el resultado por lotes, no una consulta por fila.
 *
 * `destinoDe` mapea línea de origen → línea destino, SOLO para las que se
 * juntaron (las que se movieron enteras se llevan su reparto solas).
 */
export function fusionarRepartos(
  origen: (FilaReparto & { cuentaLineaId: string })[],
  destino: (FilaReparto & { cuentaLineaId: string })[],
  destinoDe: Map<string, string>,
): {
  actualizar: { id: string; cantidad: string }[];
  reapuntar: { id: string; cuentaLineaId: string }[];
  borrar: string[];
} {
  const clave = (lineaId: string, garzonId: string | null) =>
    `${lineaId}|${garzonId ?? ''}`;
  const vivas = new Map<string, { id: string; cantidad: Decimal }>();
  for (const d of destino)
    vivas.set(clave(d.cuentaLineaId, d.garzonId), {
      id: d.id,
      cantidad: new Decimal(d.cantidad),
    });

  const tocadas = new Set<string>();
  const reapuntar: { id: string; cuentaLineaId: string }[] = [];
  const borrar: string[] = [];
  for (const o of origen) {
    const lineaDestino = destinoDe.get(o.cuentaLineaId);
    if (!lineaDestino) continue;
    const k = clave(lineaDestino, o.garzonId);
    const existente = vivas.get(k);
    if (existente) {
      existente.cantidad = existente.cantidad.plus(o.cantidad);
      tocadas.add(existente.id);
      borrar.push(o.id);
    } else {
      vivas.set(k, { id: o.id, cantidad: new Decimal(o.cantidad) });
      reapuntar.push({ id: o.id, cuentaLineaId: lineaDestino });
    }
  }
  const actualizar = [...vivas.values()]
    .filter((v) => tocadas.has(v.id))
    .map((v) => ({ id: v.id, cantidad: v.cantidad.toFixed(ESCALA_COSTO) }));
  return { actualizar, reapuntar, borrar };
}
