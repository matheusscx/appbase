import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RutChileno } from './rut-chileno.decorator';

class ConRutDto {
  @RutChileno()
  rut?: string | null;
}

async function errores(rut: unknown): Promise<string[]> {
  const dto = plainToInstance(ConRutDto, { rut });
  const lista = await validate(dto);
  return lista.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('RutChileno', () => {
  it.each([
    ['76.543.210-3', '76543210-3'],
    ['76543210-3', '76543210-3'],
    ['765432103', '76543210-3'],
    [' 10.000.013-k ', '10000013-K'],
  ])('%s es válido y queda como %s', async (entrada, guardado) => {
    expect(await errores(entrada)).toEqual([]);
    expect(plainToInstance(ConRutDto, { rut: entrada }).rut).toBe(guardado);
  });

  it.each([['76.543.210-5'], ['abc'], ['99999-7'], ['7654321A-3']])(
    '%s se rechaza con el mensaje en español',
    async (entrada) => {
      expect(await errores(entrada)).toEqual(['rut El RUT no es válido']);
    },
  );

  it.each([[undefined], [null], [''], ['   ']])(
    'vacío (%j) no se valida',
    async (entrada) => {
      expect(await errores(entrada)).toEqual([]);
    },
  );

  it('el vacío en blanco se guarda como null, no como texto', () => {
    expect(plainToInstance(ConRutDto, { rut: '  ' }).rut).toBeNull();
    expect(plainToInstance(ConRutDto, { rut: '' }).rut).toBeNull();
  });

  it('lo que no es texto lo rechaza', async () => {
    expect(await errores(76543210)).toEqual(['rut El RUT no es válido']);
  });
});
