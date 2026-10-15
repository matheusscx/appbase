import { BadRequestException } from '@nestjs/common';

/** Largo de la columna `paquetes.codigo`. */
export const MAX_CODIGO = 100;
/** Lo que el DTO deja entrar crudo: el QR de Mercado Libre trae un JSON más largo que el código. */
export const MAX_ENTRADA_CODIGO = 500;

/**
 * Lo que entrega la pistola (el contenido del QR) o lo que se tipea → el código del paquete.
 * La etiqueta de Mercado Libre se supone un JSON con `id` (spec § 3.1 y § 9, sin confirmar con
 * una etiqueta real): si lo es, el código es ese `id`; si no, el texto entero. La misma función
 * corre en el escaneo, el alta y la búsqueda, para que el código tipeado y el escaneado sean el
 * mismo paquete.
 */
export function normalizarCodigoPaquete(entrada: string): string {
  const texto = entrada.trim();
  const codigo = idDelJson(texto) ?? texto;
  if (!codigo)
    throw new BadRequestException('El código del paquete está vacío.');
  if (codigo.length > MAX_CODIGO) {
    throw new BadRequestException(
      `El código del paquete tiene más de ${MAX_CODIGO} caracteres.`,
    );
  }
  return codigo;
}

function idDelJson(texto: string): string | null {
  if (!texto.startsWith('{')) return null;
  try {
    const id: unknown = (JSON.parse(texto) as { id?: unknown }).id;
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
    if (typeof id === 'string' && id.trim()) return id.trim();
    return null;
  } catch {
    return null;
  }
}
