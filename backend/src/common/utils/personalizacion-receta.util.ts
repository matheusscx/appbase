import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import type { PersonalizacionRecetaSnapshot } from '../dto/personalizacion-receta.dto';

export type { PersonalizacionRecetaSnapshot };

export function hashPersonalizacion(
  p: PersonalizacionRecetaSnapshot | null | undefined,
): string {
  const normalized = p ?? { omitidos: [], extras: [] };
  const canonical = {
    omitidos: [...normalized.omitidos].sort(),
    extras: [...normalized.extras]
      .map((e) => ({ ...e, unidades: e.unidades ?? '1' }))
      .sort((a, b) => a.ingredienteItemId.localeCompare(b.ingredienteItemId)),
    ...(normalized.comentario !== undefined
      ? { comentario: normalized.comentario }
      : {}),
    // Dos combos/recetas con distinta opción de grupo elegida (p. ej. bebida
    // distinta) nunca deben fusionarse en la misma línea de cuenta.
    grupos: [...(normalized.grupos ?? [])]
      .map((g) => ({
        grupoId: g.grupoId,
        opciones: [...g.opciones]
          .map((o) => ({ itemId: o.itemId, unidades: o.unidades ?? '1' }))
          .sort((a, b) => a.itemId.localeCompare(b.itemId)),
      }))
      .sort((a, b) => a.grupoId.localeCompare(b.grupoId)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function textoComandaPersonalizacion(
  p: PersonalizacionRecetaSnapshot | null | undefined,
  nombres: Map<string, string>,
): string {
  if (!p) return '';

  const partes: string[] = [];

  for (const id of p.omitidos) {
    partes.push(`Sin ${nombres.get(id) ?? id}`);
  }

  for (const extra of p.extras) {
    const nombre = nombres.get(extra.ingredienteItemId) ?? extra.ingredienteItemId;
    const unidades = Number(extra.unidades ?? '1');
    partes.push(unidades > 1 ? `Extra ${nombre} x${unidades}` : `Extra ${nombre}`);
  }

  if (p.comentario) {
    partes.push(p.comentario);
  }

  return partes.join(' · ');
}

export interface PersonalizacionDetalleLinea {
  nombre: string;
  tipo: 'omitido' | 'extra';
  unidades?: number;
  monto: string;
}

/**
 * Detalle priceado de la personalización para boleta/precuenta (transparencia
 * ante reclamos): omitidos primero, siempre en $0 (nunca tienen costo);
 * extras después, con monto = precioExtra × unidades.
 */
export function detallePersonalizacion(
  p: PersonalizacionRecetaSnapshot | null | undefined,
  nombres: Map<string, string>,
): PersonalizacionDetalleLinea[] {
  if (!p) return [];

  const detalle: PersonalizacionDetalleLinea[] = [];

  for (const id of p.omitidos) {
    detalle.push({ nombre: nombres.get(id) ?? id, tipo: 'omitido', monto: '0' });
  }

  for (const extra of p.extras) {
    const nombre = nombres.get(extra.ingredienteItemId) ?? extra.ingredienteItemId;
    const unidades = Number(extra.unidades ?? '1');
    const monto = new Decimal(extra.precioExtra || '0').times(unidades).toString();
    detalle.push({ nombre, tipo: 'extra', unidades, monto });
  }

  return detalle;
}
