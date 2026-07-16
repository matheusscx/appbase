import { createHash } from 'crypto';
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
