import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCausaMermaDto } from './update-causa-merma.dto';
import { UpdateMotivoDiferenciaDto } from '../../motivos-diferencia/dto/update-motivo-diferencia.dto';
import { UpdateMotivoDiferenciaInventarioDto } from '../../motivos-diferencia-inventario/dto/update-motivo-diferencia-inventario.dto';

/**
 * Los tres DTOs de catálogo que dejaban dejar una fila sin nombre. Son gemelos
 * y sirven **rutas distintas**, así que se prueban los tres juntos: la primera
 * corrección tocó uno de dos y el hueco quedó abierto en el otro.
 *
 * Va a nivel unitario además del e2e porque acá se ve **qué decorador** ataja
 * cada caso. Los tres son necesarios y ninguno cubre al otro:
 * `@IsNotEmpty()` → `''` · `@Transform` que trimea → `'   '` ·
 * `@ValidateIf` en vez de `@IsOptional()` → `null`.
 */

const CLASES = [
  ['UpdateCausaMermaDto', UpdateCausaMermaDto],
  ['UpdateMotivoDiferenciaDto', UpdateMotivoDiferenciaDto],
  ['UpdateMotivoDiferenciaInventarioDto', UpdateMotivoDiferenciaInventarioDto],
] as const;

/** Corre el pipe como en producción: `transform: true` → corre `@Transform`. */
async function errores(
  Clase: (typeof CLASES)[number][1],
  payload: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(Clase, payload);
  const res = await validate(dto as object);
  return res.map((e) => e.property);
}

describe.each(CLASES)('%s — nombre', (_nombre, Clase) => {
  it('acepta que el campo esté ausente: sigue siendo opcional', async () => {
    await expect(errores(Clase, { activo: true })).resolves.toEqual([]);
  });

  it('acepta un nombre normal', async () => {
    await expect(errores(Clase, { nombre: 'Rotura' })).resolves.toEqual([]);
  });

  it('rechaza el string vacío', async () => {
    await expect(errores(Clase, { nombre: '' })).resolves.toEqual(['nombre']);
  });

  // `@IsNotEmpty()` solo rechaza `''` exacto. Sin el `@Transform` que trimea
  // ANTES de validar, estos tres pasaban y el service los persistía trimeados.
  it.each(['   ', '\t', '\n', ' \t \n '])(
    'rechaza un nombre de solo espacios (%j)',
    async (blanco) => {
      await expect(errores(Clase, { nombre: blanco })).resolves.toEqual([
        'nombre',
      ]);
    },
  );

  // `@IsOptional()` trataba `null` igual que ausente y se salteaba TODOS los
  // validadores; el service después hacía `.trim()` sobre `null` → 500 crudo.
  it('rechaza null en vez de dejarlo pasar como si estuviera ausente', async () => {
    await expect(errores(Clase, { nombre: null })).resolves.toEqual(['nombre']);
  });

  it('rechaza un valor que no es string sin colarse por el Transform', async () => {
    await expect(errores(Clase, { nombre: 123 })).resolves.toEqual(['nombre']);
    await expect(errores(Clase, { nombre: { a: 1 } })).resolves.toEqual([
      'nombre',
    ]);
  });

  it('recorta los espacios de los bordes en vez de rechazar', async () => {
    const dto = plainToInstance(Clase, { nombre: '  Rotura  ' }) as {
      nombre?: string;
    };
    expect(dto.nombre).toBe('Rotura');
  });

  // Con el trim previo, `@MaxLength(120)` mide el string ya recortado.
  it('mide el largo sobre el nombre ya trimeado', async () => {
    const justo = ' '.repeat(3) + 'a'.repeat(120) + ' '.repeat(3);
    await expect(errores(Clase, { nombre: justo })).resolves.toEqual([]);
    await expect(errores(Clase, { nombre: 'a'.repeat(121) })).resolves.toEqual([
      'nombre',
    ]);
  });
});

describe.each(CLASES)('%s — activo', (_nombre, Clase) => {
  it('acepta que esté ausente', async () => {
    await expect(errores(Clase, { nombre: 'Rotura' })).resolves.toEqual([]);
  });

  // La columna es NOT NULL: un `null` que pasara terminaba en un 500 de
  // Postgres en vez de un 400.
  it('rechaza null', async () => {
    await expect(errores(Clase, { activo: null })).resolves.toEqual(['activo']);
  });

  it('rechaza un valor que no es booleano', async () => {
    await expect(errores(Clase, { activo: 'sí' })).resolves.toEqual(['activo']);
  });
});
