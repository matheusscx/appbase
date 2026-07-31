import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateItemDto } from './update-item.dto';

/**
 * `clasificacionTributaria` usaba `@IsOptional()`, que saltea TODOS los
 * validadores cuando el valor es `null` explícito (no solo cuando la
 * propiedad falta). Antes de que la columna se volviera nullable (Task 3 del
 * plan de IVA derivado), un `PATCH { clasificacionTributaria: null }` lo
 * frenaba el `NOT NULL` de Postgres con un 500. Con la columna nullable, ese
 * mismo `null` pasa de largo el DTO, `update()` lo empuja crudo al `UPDATE`,
 * y el ítem queda sin clasificación tributaria en silencio (200) — un
 * producto que deja de cobrar IVA sin que nadie lo haya pedido.
 * `@ValidateIf` (mismo patrón que `costo`/`stock` en este DTO) solo saltea
 * cuando la propiedad falta; un `null` explícito sigue cayendo en `@IsIn`.
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
