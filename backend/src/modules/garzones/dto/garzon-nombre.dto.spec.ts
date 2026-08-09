import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGarzonDto } from './create-garzon.dto';
import { UpdateGarzonDto } from './update-garzon.dto';

// La columna es `VARCHAR(100)`. Sin el `@MaxLength(100)` el nombre largo pasa la
// validación y muere en Postgres con un 500 genérico, en vez del 400 que dice
// qué corregir. Su DTO gemelo `CreateTurnoDto` ya lo tenía.
const CIEN = 'a'.repeat(100);
const CIENTO_UNO = 'a'.repeat(101);

describe('CreateGarzonDto / UpdateGarzonDto — largo del nombre', () => {
  it('acepta exactamente 100 caracteres, que es lo que entra en la columna', async () => {
    expect(
      await validate(plainToInstance(CreateGarzonDto, { nombre: CIEN })),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(UpdateGarzonDto, { nombre: CIEN })),
    ).toHaveLength(0);
  });

  it('rechaza 101 con un error de largo, no con un 500 de Postgres', async () => {
    // El tipo se ensancha a mano: los dos DTO dejaron de ser estructuralmente
    // compatibles cuando `UpdateGarzonDto` sumó `usuarioId`, y TS ya no puede
    // elegir una sobrecarga de `plainToInstance` para la unión. El test recorre
    // los dos a propósito — es su razón de ser.
    const dtos: (typeof CreateGarzonDto | typeof UpdateGarzonDto)[] = [
      CreateGarzonDto,
      UpdateGarzonDto,
    ];
    for (const Dto of dtos as (new () => object)[]) {
      const errores = await validate(
        plainToInstance(Dto, { nombre: CIENTO_UNO }),
      );
      expect(errores).toHaveLength(1);
      expect(errores[0]?.constraints).toHaveProperty('maxLength');
    }
  });

  it('el nombre sigue siendo opcional en Update y obligatorio en Create', async () => {
    expect(await validate(plainToInstance(UpdateGarzonDto, {}))).toHaveLength(
      0,
    );
    const sinNombre = await validate(plainToInstance(CreateGarzonDto, {}));
    expect(sinNombre).toHaveLength(1);
  });
});
