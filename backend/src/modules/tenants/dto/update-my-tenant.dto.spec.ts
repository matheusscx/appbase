import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMyTenantDto } from './update-my-tenant.dto';

/**
 * `nombre` es la identidad del tenant y sale en documentos: el mismo hueco
 * que se cerró en los DTOs de catálogo (`UpdateCausaMermaDto` y hermanos,
 * ver `mermas/dto/update-causa-merma.dto.spec.ts`) estaba abierto acá. Tres
 * decoradores, tres bugs distintos, ninguno cubre a los otros dos:
 * `@IsNotEmpty()` → `''` · `@Transform` que trimea → `'   '` ·
 * `@ValidateIf` en vez de `@IsOptional()` → `null`.
 */
async function errores(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateMyTenantDto, payload);
  const res = await validate(dto as object);
  return res.map((e) => e.property);
}

describe('UpdateMyTenantDto — nombre', () => {
  it('acepta que el campo esté ausente: sigue siendo opcional', async () => {
    await expect(errores({ correo: 'a@paris.cl' })).resolves.toEqual([]);
  });

  it('acepta un nombre normal', async () => {
    await expect(errores({ nombre: 'Paris' })).resolves.toEqual([]);
  });

  it('rechaza el string vacío', async () => {
    await expect(errores({ nombre: '' })).resolves.toEqual(['nombre']);
  });

  // `@IsNotEmpty()` solo rechaza `''` exacto. Sin el `@Transform` que trimea
  // ANTES de validar, esto pasaba y `updateMine()` persistía el `.trim()`
  // hecho por... nadie: el service no trimea, así que el tenant quedaba con
  // un nombre de puros espacios.
  it.each(['   ', '\t', '\n', ' \t \n '])(
    'rechaza un nombre de solo espacios (%j)',
    async (blanco) => {
      await expect(errores({ nombre: blanco })).resolves.toEqual(['nombre']);
    },
  );

  // `@IsOptional()` trata `null` igual que ausente y saltea TODOS los
  // validadores. `updateMine()` hace `Object.assign(tenant, dto)` sin volver
  // a chequear, así que un `null` que pasara la validación llegaba directo a
  // una columna NOT NULL: 500 crudo de Postgres en vez de un 400.
  it('rechaza null en vez de dejarlo pasar como si estuviera ausente', async () => {
    await expect(errores({ nombre: null })).resolves.toEqual(['nombre']);
  });

  it('rechaza un valor que no es string sin colarse por el Transform', async () => {
    await expect(errores({ nombre: 123 })).resolves.toEqual(['nombre']);
    await expect(errores({ nombre: { a: 1 } })).resolves.toEqual(['nombre']);
  });

  it('recorta los espacios de los bordes en vez de rechazar', async () => {
    const dto = plainToInstance(UpdateMyTenantDto, {
      nombre: '  Paris  ',
    });
    expect(dto.nombre).toBe('Paris');
  });

  // Con el trim previo, `@MaxLength(100)` mide el string ya recortado.
  it('mide el largo sobre el nombre ya trimeado', async () => {
    const justo = ' '.repeat(3) + 'a'.repeat(100) + ' '.repeat(3);
    await expect(errores({ nombre: justo })).resolves.toEqual([]);
    await expect(errores({ nombre: 'a'.repeat(101) })).resolves.toEqual([
      'nombre',
    ]);
  });

  // `correo` y `provinciaId` son NOT NULL igual que `nombre`: con
  // `@IsOptional()`, un `null` se salteaba `@IsEmail`/`@IsUUID` y llegaba a
  // `Object.assign` → 500 de Postgres. Lo señaló la revisión independiente:
  // estaban en el MISMO archivo que el fix y quedaron afuera.
  describe('correo y provinciaId — columnas NOT NULL', () => {
    it.each([
      ['correo', null],
      ['provinciaId', null],
    ])('rechaza %s en null en vez de dejarlo pasar', async (campo, valor) => {
      await expect(errores({ [campo]: valor })).resolves.toEqual([campo]);
    });

    it('sigue aceptando que estén ausentes', async () => {
      await expect(errores({ nombre: 'Paris' })).resolves.toEqual([]);
    });

    it('sigue aceptando valores válidos', async () => {
      await expect(
        errores({
          correo: 'contacto@paris.cl',
          provinciaId: '550e8400-e29b-41d4-a716-446655440007',
        }),
      ).resolves.toEqual([]);
    });
  });

  // Contrapunto: estas dos columnas SÍ son nullables, así que `null` es la
  // forma de borrar el dato y tiene que seguir pasando.
  describe('telefono y direccion — columnas nullables', () => {
    it.each(['telefono', 'direccion'])(
      'acepta %s en null, que es como se borra el dato',
      async (campo) => {
        await expect(errores({ [campo]: null })).resolves.toEqual([]);
      },
    );
  });
});
