import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ArrayUnique, IsArray, IsUUID, validate } from 'class-validator';
import { IdEnMinusculas } from './id-en-minusculas.decorator';

const ID = '550e8400-e29b-41d4-a716-446655440360';

class UnIdDto {
  @IdEnMinusculas()
  @IsUUID()
  id: unknown;
}

class IdsDto {
  @IsArray()
  @IdEnMinusculas()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids: unknown;
}

describe('IdEnMinusculas', () => {
  it('baja un id suelto y cada id de un array', () => {
    expect(plainToInstance(UnIdDto, { id: ID.toUpperCase() }).id).toBe(ID);
    expect(
      plainToInstance(IdsDto, { ids: [ID.toUpperCase(), ID] }).ids,
    ).toEqual([ID, ID]);
  });

  // Corre antes de validar: `@ArrayUnique` ve los dos casings como un repetido.
  it('[x, X] es un repetido para @ArrayUnique', async () => {
    const errores = await validate(
      plainToInstance(IdsDto, { ids: [ID, ID.toUpperCase()] }),
    );
    expect(errores.map((e) => e.constraints)).toEqual([
      { arrayUnique: "All ids's elements must be unique" },
    ]);
  });

  // Lo que no es string no se toca: lo rechaza el decorador de tipo, con su
  // mensaje, en vez de convertirse en otra cosa.
  it.each([42, null, { a: 1 }, true])('deja pasar %p sin tocar', (valor) => {
    expect(plainToInstance(UnIdDto, { id: valor }).id).toEqual(valor);
    expect(plainToInstance(IdsDto, { ids: [valor] }).ids).toEqual([valor]);
  });
});
