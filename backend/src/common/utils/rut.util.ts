/**
 * RUT chileno normalizado: sin puntos ni espacios, `K` mayúscula, guion antes
 * del DV. `'76.543.210-3'` → `'76543210-3'`; `'765432103'` → `'76543210-3'`
 * (spec compras-xml-dte § 3.1). No valida: un texto que no es RUT sale
 * igual con un guion antes del último carácter. Para eso, `rutValido`.
 */
export function normalizarRut(rut: string): string {
  const limpio = rut
    .trim()
    .toUpperCase()
    .replace(/[.\s]/g, '')
    .replace(/-/g, '');
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return `${cuerpo}-${dv}`;
}

/**
 * ¿Es un RUT que el SII acepta en `RUTRecep`? Cuerpo numérico entre 100.000 y
 * 99.999.999 y dígito verificador módulo 11 (SII, Formato DTE v2.5, campo 50).
 * Acepta las formas que `normalizarRut` entiende (con o sin puntos y guion).
 *
 * Gemela de `rutValido` en `frontend/app/composables/useReceptor.ts`: los
 * mismos casos están en las dos specs. Tocar una implica revisar la otra.
 */
export function rutValido(rut: string): boolean {
  const [cuerpo, dv] = normalizarRut(rut).split('-');
  if (!/^\d+$/.test(cuerpo) || !/^[\dK]$/.test(dv)) return false;
  const n = Number(cuerpo);
  if (n < 100_000 || n > 99_999_999) return false;
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado;
}
