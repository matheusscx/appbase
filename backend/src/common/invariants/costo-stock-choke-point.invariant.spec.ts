import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Invariante: item_producto.costo_actual NUNCA se escribe fuera de
// inventario.service.ts (registrarMovimiento). Es un valor derivado del
// kardex —promedio ponderado móvil— y escribirlo directo lo corrompe sin
// dejar rastro. Fue exactamente el bug que originó este diseño: PATCH
// /items/:id escribía el costo (y, después, el stock) sin movimiento de
// inventario.
// Ver docs/superpowers/specs/2026-07-26-costeo-cpp-design.md
//
// Desde la Tarea 4 del frente "bodegas y traslados" (`item_producto.stock` se
// borró), el saldo materializado vive en `stock_ubicacion`, `lote_ubicacion`
// (saldo de un lote por ubicación) e `item_unidad.ubicacion_id` — las tres
// puertas nuevas por las que se puede escribir stock, y las tres quedan bajo
// la misma regla: solo `inventario.service.ts` (y el seeder, que las siembra
// junto con el movimiento `inventario_inicial`, no las actualiza).
// `lote_ubicacion` existe desde la Tarea 7: nace y se escribe siempre por
// `INSERT ... ON CONFLICT (lote_id, ubicacion_id) DO UPDATE` (saldo
// absoluto, nunca un `UPDATE` a secas), así que la guarda de esta puerta
// cubre las dos formas —`INSERT INTO lote_ubicacion` y `UPDATE
// lote_ubicacion`— aunque hoy solo la primera se ejercite.
// `item_unidad.ubicacion_id` existe desde la Tarea 6: la unidad NACE en su
// ubicación por `INSERT` (no hay `UPDATE` — una unidad serializada no cambia
// de lugar hasta que exista `POST /traslados`, Tarea 9), así que la guarda de
// esta puerta cubre las dos formas de escritura, no solo el `UPDATE`.

const ARCHIVOS_AUTORIZADOS = [
  join('modules', 'inventario', 'inventario.service.ts'),
  // El INSERT de creación del producto y el seeder no son UPDATE: el INSERT
  // siembra el costo/stock de apertura junto con el movimiento
  // inventario_inicial.
  join('modules', 'seeder', 'seeder.service.ts'),
];

// ⛔ ACÁ VIVÍA `MULETAS_E2E_AUTORIZADAS`, Y SE VACIÓ EL 2026-09-07.
// (Comentario suelto y no JSDoc a propósito: ya no documenta ninguna
// declaración, y pegado a `findTsFiles` diría algo que esa función no hace.)
//
/* Eran cinco specs que plantaban stock en una bodega con `INSERT` directo
 * porque `POST /traslados` no existía todavía (Tarea 9 del frente "bodegas y
 * traslados"). Con el endpoint en pie los cinco arman su escenario por la API
 * —`items-stock-por-ubicacion`, `recuentos-stock-por-ubicacion`,
 * `grupos-modificadores-stock-por-ubicacion`, `inventario-serie-ubicacion` e
 * `inventario-lote-ubicacion`— y la lista de excepciones desapareció con
 * ellas: el barrido de abajo ya no tiene escape.
 *
 * Se deja escrito y no se borra en silencio para que quede claro que la salida
 * no es volver a agregar un nombre acá. Si un escenario nuevo "solo se puede
 * montar con SQL", lo primero a sospechar es que sea un escenario que la API
 * no puede producir — o sea, un hueco del endpoint, no del test. */

function findTsFiles(dir: string, incluirSpecs = false): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsFiles(full, incluirSpecs));
    else if (
      entry.name.endsWith('.ts') &&
      (incluirSpecs || !entry.name.endsWith('.spec.ts'))
    ) {
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

  it('nadie escribe stock_ubicacion, lote_ubicacion ni item_unidad.ubicacion_id fuera de inventario.service', () => {
    const srcRoot = join(__dirname, '..', '..');
    // El e2e también, no solo `src/`: un spec que planta stock con SQL directo
    // escribe en la MISMA base que el chokepoint custodia, y hasta ahora esta
    // guarda no lo veía. Los unitarios de `src/**/*.spec.ts` siguen afuera
    // (`findTsFiles` los saltea) y ahí la asimetría es deliberada: corren con
    // el manager mockeado, no llegan a Postgres.
    const testRoot = join(srcRoot, '..', 'test');
    const offenders: string[] = [];

    const archivos = [...findTsFiles(srcRoot), ...findTsFiles(testRoot, true)];
    for (const file of archivos) {
      if (ARCHIVOS_AUTORIZADOS.some((a) => file.endsWith(a))) continue;
      const contenido = readFileSync(file, 'utf8');
      const sospechoso =
        extraeTemplateLiterals(contenido).some(
          (chunk) =>
            /INSERT\s+INTO\s+stock_ubicacion/i.test(chunk) ||
            /UPDATE\s+stock_ubicacion/i.test(chunk) ||
            /INSERT\s+INTO\s+lote_ubicacion/i.test(chunk) ||
            /UPDATE\s+lote_ubicacion/i.test(chunk) ||
            /UPDATE\s+item_unidad[\s\S]*ubicacion_id\s*=\s*\$/i.test(chunk) ||
            // La unidad nace con su ubicación por INSERT, no por UPDATE: la
            // guarda tiene que mirar las dos formas de escribir la misma
            // columna, o un `INSERT INTO item_unidad (..., ubicacion_id, ...)`
            // fuera del chokepoint pasa sin que este test lo vea.
            /INSERT\s+INTO\s+item_unidad\s*\([^)]*\bubicacion_id\b[^)]*\)/i.test(
              chunk,
            ) ||
            // Borrar la fila ES poner el saldo en cero: el `DELETE` es una puerta
            // más, no una excepción. (Y sí, choca con el soft delete: estas tablas
            // no lo tienen — son saldos materializados, no documentos.)
            /DELETE\s+FROM\s+stock_ubicacion/i.test(chunk) ||
            /DELETE\s+FROM\s+lote_ubicacion/i.test(chunk),
        ) ||
        // El SQL crudo no es la única puerta: `StockUbicacion` está registrada
        // en el array `entities` de `app.module.ts`, así que
        // `manager.getRepository(StockUbicacion).save(...)` escribe el saldo sin
        // que aparezca ni un template literal. Esto se busca sobre el archivo
        // entero, no sobre los literales, porque no es SQL.
        /(getRepository|InjectRepository)\(\s*(StockUbicacion|LoteUbicacion)\s*\)/.test(
          contenido,
        ) ||
        /\.(save|insert|update|upsert|delete|remove|softDelete|softRemove)\(\s*(StockUbicacion|LoteUbicacion)\b/.test(
          contenido,
        );
      if (sospechoso) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
