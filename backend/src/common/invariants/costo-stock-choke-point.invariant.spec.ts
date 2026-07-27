import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Invariante: item_producto.costo_actual y item_producto.stock NUNCA se
// escriben fuera de inventario.service.ts (registrarMovimiento). Ambos son
// valores derivados del kardex — costo_actual es un promedio ponderado
// móvil, stock es el saldo materializado de los movimientos — y escribirlos
// directo los corrompe sin dejar rastro. Fue exactamente el bug que originó
// este diseño: PATCH /items/:id escribía el costo (y, después, el stock) sin
// movimiento de inventario.
// Ver docs/superpowers/specs/2026-07-26-costeo-cpp-design.md

const ARCHIVOS_AUTORIZADOS = [
  join('modules', 'inventario', 'inventario.service.ts'),
  // El INSERT de creación del producto y el seeder no son UPDATE: el INSERT
  // siembra el costo/stock de apertura junto con el movimiento
  // inventario_inicial.
  join('modules', 'seeder', 'seeder.service.ts'),
];

function findTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

// `item_receta` e `item_combo` también tienen columna `costo_actual`, pero se
// recalculan desde una fórmula (suma de componentes/ingredientes), no desde el
// kardex de movimientos — no son parte de esta invariante. Se extraen los
// template literals (donde vive el SQL) para no marcar un UPDATE legítimo de
// esas tablas por compartir nombre de columna con item_producto.
function extraeTemplateLiterals(contenido: string): string[] {
  const out: string[] = [];
  const regex = /`([^`]*)`/gs;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(contenido)) !== null) {
    out.push(m[1]);
  }
  return out;
}

describe('Invariante: costo_actual y stock solo se escriben desde el kardex', () => {
  it('ningún UPDATE de item_producto toca costo_actual fuera de inventario.service', () => {
    const srcRoot = join(__dirname, '..', '..');
    const offenders: string[] = [];

    for (const file of findTsFiles(srcRoot)) {
      if (ARCHIVOS_AUTORIZADOS.some((a) => file.endsWith(a))) continue;
      const contenido = readFileSync(file, 'utf8');
      // Busca cualquier fragmento de SQL que asigne costo_actual (incluidos
      // los que arman el SET dinámicamente en varios literales), salvo que
      // sea explícitamente un UPDATE de item_receta o item_combo.
      // La excepción exige que item_receta/item_combo aparezca como tabla del
      // propio UPDATE (`UPDATE item_receta`/`UPDATE item_combo`), no solo en
      // cualquier parte del literal — de lo contrario un comentario SQL
      // (`-- item_combo`) al final de un UPDATE real de item_producto
      // evadiría la detección sin que Postgres le dé ningún significado.
      const sospechoso = extraeTemplateLiterals(contenido).some(
        (chunk) =>
          /costo_actual\s*=\s*\$/.test(chunk) &&
          !/UPDATE\s+item_(receta|combo)\b/i.test(chunk),
      );
      if (sospechoso) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it('ningún UPDATE de item_producto toca stock fuera de inventario.service', () => {
    const srcRoot = join(__dirname, '..', '..');
    const offenders: string[] = [];

    for (const file of findTsFiles(srcRoot)) {
      if (ARCHIVOS_AUTORIZADOS.some((a) => file.endsWith(a))) continue;
      const contenido = readFileSync(file, 'utf8');
      // A diferencia de costo_actual, `stock` no es columna de ninguna otra
      // tabla del esquema, así que no hace falta una excepción de tabla —
      // solo el `\b` inicial para no confundir `stock_sistema` (columna de
      // recuento_inventario_linea, congelada por INSERT, no por este UPDATE)
      // con `stock`.
      const sospechoso = extraeTemplateLiterals(contenido).some((chunk) =>
        /\bstock\s*=\s*\$/.test(chunk),
      );
      if (sospechoso) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
