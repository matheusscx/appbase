import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage, ValidationTypes } from 'class-validator';
import type { ValidationMetadata } from 'class-validator/types/metadata/ValidationMetadata';

// Invariante: todo `@ValidateNested` va con un `@IsObject` del mismo `each`.
//
// `ValidateNested` itera cualquier array que encuentre, también uno anidado:
// con `lineas: [[]]` no tiene nada que validar y el pipe lo deja pasar, y el
// service recibe un elemento con todos sus campos `undefined`. En un objeto
// suelto (`@ValidateNested()`), un array pasa igual. `IsObject` rechaza el
// array (y el `null`); un primitivo ya lo rechazaba `ValidateNested`. Se cerró
// en la personalización (bf7d4511) y en los 40 restantes el 2026-10-08; lo que
// hacía cada puerta con el `[]` está en docs/agent/resueltos.md.

const SRC = join(__dirname, '..', '..');

function findTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
      out.push(full);
  }
  return out;
}

// Por conducta, no por nombre de archivo: todo fuente que declara un
// `@ValidateNested`, sea o no un `.dto.ts`. Importarlo registra sus
// decoradores en el storage global de class-validator.
const fuentes = findTsFiles(SRC).filter((f) =>
  readFileSync(f, 'utf8').includes('@ValidateNested('),
);
for (const file of fuentes) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(file);
}

const NESTED = ValidationTypes.NESTED_VALIDATION;

const metadatas = (
  getMetadataStorage() as unknown as {
    validationMetadatas: Map<object, ValidationMetadata[]>;
  }
).validationMetadatas;

describe('Invariante: @ValidateNested va con @IsObject del mismo each', () => {
  it('todo @ValidateNested tiene su @IsObject en la misma propiedad', () => {
    const offenders: string[] = [];
    for (const [target, propias] of metadatas) {
      for (const nested of propias.filter((m) => m.type === NESTED)) {
        const each = nested.each === true;
        const conIsObject = propias.some(
          (m) =>
            m.name === 'isObject' &&
            m.propertyName === nested.propertyName &&
            (m.each === true) === each,
        );
        if (!conIsObject) {
          const nombre = (target as { name: string }).name;
          offenders.push(
            `${nombre}.${nested.propertyName} (falta @IsObject(${each ? '{ each: true }' : ''}))`,
          );
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  // Sin esto, un cambio que dejara de importar los DTOs daría verde vacío.
  it('vio todos los @ValidateNested del fuente', () => {
    const enFuente = fuentes
      .map((f) => readFileSync(f, 'utf8').split('@ValidateNested(').length - 1)
      .reduce((a, b) => a + b, 0);
    const registrados = [...metadatas.values()]
      .flat()
      .filter((m) => m.type === NESTED).length;
    expect(fuentes.length).toBeGreaterThan(0);
    // `PartialType` y compañía copian la metadata a la clase nueva: puede
    // haber más registrados que en el fuente, nunca menos.
    expect(registrados).toBeGreaterThanOrEqual(enFuente);
  });
});
