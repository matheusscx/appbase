import { readdirSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';

// Invariante ADR-004: toda columna PK/FK de UUID declara `type: 'uuid'` explícito.
// Sin él TypeORM infiere `varchar` y los JOINs en SQL raw fallan en silencio
// (comparación varchar vs uuid). Ver docs/agent/anti-patterns.md.
//
// Este test reemplaza la nota "candidato a test de esquema" del anti-patrón:
// la regla ya no se documenta, se enforca.

function findEntityFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findEntityFiles(full));
    else if (entry.name.endsWith('.entity.ts')) out.push(full);
  }
  return out;
}

// Importar todas las entities registra sus columnas en el storage global de TypeORM
// (no requiere conexión a BD).
const srcRoot = join(__dirname, '..', '..');
for (const file of findEntityFiles(srcRoot)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(file);
}

// Columnas cuyo nombre parece id (*_id / *Id) pero legítimamente NO son uuid:
// identificadores externos, no FKs internas. Cada entrada debe justificarse.
const NON_UUID_ID_ALLOWLIST = new Set<string>([
  'google_id', // id de cuenta Google (OAuth) — string externo, no un FK interno
]);

describe('Invariante ADR-004: columnas id con type uuid explícito', () => {
  it('toda columna *_id declara type: "uuid"', () => {
    const offenders = getMetadataArgsStorage()
      .columns.filter((c) => c.mode === 'regular')
      .filter((c) => {
        const dbName = (c.options as { name?: string }).name ?? c.propertyName;
        const looksLikeId =
          dbName.endsWith('_id') ||
          c.propertyName.endsWith('Id') ||
          c.propertyName === 'id';
        return looksLikeId && !NON_UUID_ID_ALLOWLIST.has(dbName);
      })
      .filter((c) => (c.options as { type?: unknown }).type !== 'uuid')
      .map((c) => `${(c.target as { name: string }).name}.${c.propertyName}`)
      .sort();

    expect(offenders).toEqual([]);
  });
});
