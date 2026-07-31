import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateItemDto } from './update-item.dto';
import { CreateItemDto } from './create-item.dto';

/**
 * `clasificacionTributaria` usaba `@IsOptional()` en los dos DTOs, que saltea
 * TODOS los validadores cuando el valor es `null` explícito (no solo cuando
 * la propiedad falta). Antes de que la columna se volviera nullable (Task 3
 * del plan de IVA derivado), un `null` lo frenaba el `NOT NULL` de Postgres
 * con un 500. Con la columna nullable, ese mismo `null` pasa de largo el
 * DTO y el service lo persiste (o lo pisa con `?? 'afecto'` en `create()`,
 * que es una segunda barrera, no la principal — ver el comentario en
 * `items.service.ts`). `@ValidateIf` (mismo patrón que `costo`/`stock` en
 * `UpdateItemDto`) solo saltea cuando la propiedad falta; un `null` explícito
 * sigue cayendo en `@IsIn`.
 *
 * El caso de `CreateItemDto` es el más serio de los dos: el `INSERT` de
 * `create()` lista `clasificacion_tributaria` explícitamente en sus
 * columnas, así que el `DEFAULT 'afecto'` de la tabla NUNCA se activa por
 * ese camino — el `@ValidateIf` de acá es la única barrera real contra un
 * `POST { clasificacionTributaria: null }` que termine persistiendo `NULL`
 * para un ítem vendible.
 */
describe('UpdateItemDto — clasificacionTributaria', () => {
  it('acepta la propiedad ausente (PATCH parcial que no la toca)', async () => {
    const dto = plainToInstance(UpdateItemDto, { nombre: 'Otro nombre' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      false,
    );
  });

  it.each(['afecto', 'exento'])('acepta "%s"', async (valor) => {
    const dto = plainToInstance(UpdateItemDto, {
      clasificacionTributaria: valor,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      false,
    );
  });

  it('rechaza un null explícito', async () => {
    const dto = plainToInstance(UpdateItemDto, {
      clasificacionTributaria: null,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      true,
    );
  });

  it('rechaza un valor fuera de afecto/exento', async () => {
    const dto = plainToInstance(UpdateItemDto, {
      clasificacionTributaria: 'basura',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      true,
    );
  });
});

describe('CreateItemDto — clasificacionTributaria', () => {
  const MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
  const base = {
    nombre: 'Item de prueba',
    precioBase: '1000',
    monedaId: MONEDA_ID,
    tipo: 'producto',
  };

  it('acepta la propiedad ausente (el service completa con afecto)', async () => {
    const dto = plainToInstance(CreateItemDto, base);
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      false,
    );
  });

  it.each(['afecto', 'exento'])('acepta "%s"', async (valor) => {
    const dto = plainToInstance(CreateItemDto, {
      ...base,
      clasificacionTributaria: valor,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      false,
    );
  });

  it('rechaza un null explícito', async () => {
    const dto = plainToInstance(CreateItemDto, {
      ...base,
      clasificacionTributaria: null,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      true,
    );
  });

  it('rechaza un valor fuera de afecto/exento', async () => {
    const dto = plainToInstance(CreateItemDto, {
      ...base,
      clasificacionTributaria: 'basura',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'clasificacionTributaria')).toBe(
      true,
    );
  });
});
