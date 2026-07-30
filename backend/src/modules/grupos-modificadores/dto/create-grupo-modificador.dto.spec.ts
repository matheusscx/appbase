import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateGrupoModificadorDto } from './create-grupo-modificador.dto';
import { UpdateGrupoModificadorDto } from './update-grupo-modificador.dto';

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440101';

/** Aplana los `property` de un árbol de errores anidados (`ValidateNested`). */
function propiedadesConError(errores: ValidationError[]): string[] {
  return errores.flatMap((e) => [
    e.property,
    ...propiedadesConError(e.children ?? []),
  ]);
}

/**
 * `GrupoOpcionInputDto.precioExtra` es el gemelo exacto del `precioExtra` de
 * `items/dto/create-item.dto.ts` (ver `items/dto/dinero-signo.dto.spec.ts`): mismo
 * dinero, misma columna, mismo criterio **no negativo con el `0` válido** —una
 * opción sin recargo es el caso más común de un grupo de modificadores—.
 *
 * `UpdateGrupoModificadorDto` reusa este mismo DTO anidado, así que el decorador lo
 * cubre sin tocar el otro archivo.
 */
describe('GrupoOpcionInputDto.precioExtra — signo', () => {
  const opcion = { itemId: ITEM_ID, cantidad: '1', unidadCodigo: 'unidad' };

  it('acepta precioExtra en 0 (opción sin recargo)', async () => {
    const dto = plainToInstance(CreateGrupoModificadorDto, {
      nombre: 'Bebida',
      opciones: [{ ...opcion, precioExtra: '0' }],
    });
    const errores = await validate(dto);
    expect(errores).toHaveLength(0);
  });

  it('rechaza precioExtra negativo', async () => {
    const dto = plainToInstance(CreateGrupoModificadorDto, {
      nombre: 'Bebida',
      opciones: [{ ...opcion, precioExtra: '-800' }],
    });
    const errores = await validate(dto);
    expect(propiedadesConError(errores)).toContain('precioExtra');
  });

  it('rechaza precioExtra negativo también en UpdateGrupoModificadorDto', async () => {
    const dto = plainToInstance(UpdateGrupoModificadorDto, {
      opciones: [{ ...opcion, precioExtra: '-1' }],
    });
    const errores = await validate(dto);
    expect(propiedadesConError(errores)).toContain('precioExtra');
  });
});
