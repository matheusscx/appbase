import { createHash } from 'crypto';
import type { PersonalizacionRecetaSnapshot } from '../dto/personalizacion-receta.dto';

export type { PersonalizacionRecetaSnapshot };

export function hashPersonalizacion(
  p: PersonalizacionRecetaSnapshot | null | undefined,
): string {
  const normalized = p ?? { omitidos: [], extras: [] };
  const canonical = {
    omitidos: [...normalized.omitidos].sort(),
    extras: [...normalized.extras].sort((a, b) =>
      a.ingredienteItemId.localeCompare(b.ingredienteItemId),
    ),
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
    partes.push(
      `Extra ${nombres.get(extra.ingredienteItemId) ?? extra.ingredienteItemId}`,
    );
  }

  if (p.comentario) {
    partes.push(p.comentario);
  }

  return partes.join(' · ');
}
