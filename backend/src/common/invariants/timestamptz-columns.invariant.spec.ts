import { readdirSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';

// Invariante: las tres columnas de auditoría (`creado_el`, `actualizado_el`,
// `eliminado_el`) declaran `type: 'timestamptz'` explícito.
//
// Sin él, `@CreateDateColumn()` y sus hermanos caen en el default de TypeORM,
// que es `timestamp` SIN zona. Medido el 2026-08-06 sobre Postgres real, antes
// de este invariante: de las 87 tablas con `eliminado_el`, 65 la tenían sin zona
// y 22 con zona — y el mismo split en `creado_el` (66/22) y `actualizado_el`
// (64/22). O sea ~195 columnas partidas por accidente, no por decisión.
//
// Por qué no es cosmético: comparar una columna de cada tipo sin cast deja que
// Postgres castee la que no tiene zona usando el `TimeZone` de LA SESIÓN QUE
// COMPARA, no el que estaba activo cuando se escribió el valor. Verificado con
// `SET TimeZone` en sesiones separadas: matchea 1 de 3 combinaciones. Ya le
// costó una ronda de revisión a `items.restaurar()` (ver el comentario largo en
// `items.service.ts`), que terminó anclando los dos lados a UTC a mano.
//
// Se enforca por metadata de TypeORM y no por grep del fuente porque el grep
// mide el MECANISMO (el decorador) y la regla es sobre la CONDUCTA (el tipo de
// la columna): 5 entities declaran estas columnas con `@Column` a secas y se le
// escaparían a un grep de `@DeleteDateColumn`. Acá se miran las dos puertas.
//
// Su límite, que es real: este test sólo ve columnas que reconoce como de
// auditoría. Una columna de fecha con otro nombre y `@Column` común le es
// invisible — `refresh_tokens.expires_at` lo fue. Esa la cubre el espejo del
// lado de la BD, `test/esquema.e2e-spec.ts`, que va sobre el esquema entero.

function findEntityFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findEntityFiles(full));
    else if (entry.name.endsWith('.entity.ts')) out.push(full);
  }
  return out;
}

// Importar todas las entities registra sus columnas en el storage global de
// TypeORM (no requiere conexión a BD).
const srcRoot = join(__dirname, '..', '..');
for (const file of findEntityFiles(srcRoot)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(file);
}

const COLUMNAS_AUDITORIA = new Set([
  'creado_el',
  'actualizado_el',
  'eliminado_el',
]);
const MODOS_FECHA = new Set(['createDate', 'updateDate', 'deleteDate']);

describe('Invariante: columnas de auditoría con timestamptz explícito', () => {
  it('toda columna de fecha de auditoría declara type: "timestamptz"', () => {
    const offenders = getMetadataArgsStorage()
      .columns.filter((c) => {
        const dbName = (c.options as { name?: string }).name ?? c.propertyName;
        // Las dos puertas: por decorador de fecha, o por nombre de columna.
        return MODOS_FECHA.has(c.mode) || COLUMNAS_AUDITORIA.has(dbName);
      })
      .filter((c) => (c.options as { type?: unknown }).type !== 'timestamptz')
      .map((c) => {
        const dbName = (c.options as { name?: string }).name ?? c.propertyName;
        return `${(c.target as { name: string }).name}.${dbName}`;
      })
      .sort();

    expect(offenders).toEqual([]);
  });

  // Ancla positiva. Sin esto, un filtro mal escrito —o un `findEntityFiles` que
  // dejara de encontrar las entities— daría una lista vacía y el test pasaría
  // sin haber mirado nada.
  it('el invariante está mirando columnas de verdad, no un set vacío', () => {
    const miradas = getMetadataArgsStorage().columns.filter((c) => {
      const dbName = (c.options as { name?: string }).name ?? c.propertyName;
      return MODOS_FECHA.has(c.mode) || COLUMNAS_AUDITORIA.has(dbName);
    });

    // El piso es deliberadamente bajo: lo que fija el número exacto es la BD
    // (`test/esquema.e2e-spec.ts`), no este archivo. Acá sólo se descarta el
    // cero.
    expect(miradas.length).toBeGreaterThan(100);
  });
});
