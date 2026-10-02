import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompletarDocumentoDto } from './completar-documento.dto';

const errorEn = async (cuerpo: Record<string, unknown>, campo: string) =>
  (await validate(plainToInstance(CompletarDocumentoDto, cuerpo))).some(
    (e) => e.property === campo,
  );

describe('CompletarDocumentoDto', () => {
  it('acepta el número solo y lo deja sin espacios en los extremos', async () => {
    const dto = plainToInstance(CompletarDocumentoDto, {
      numero: '  F-98123  ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.numero).toBe('F-98123');
    expect(dto.clase).toBeUndefined();
  });

  it('acepta la clase voucher o boleta', async () => {
    for (const clase of ['voucher', 'boleta']) {
      const dto = plainToInstance(CompletarDocumentoDto, {
        numero: '445566',
        clase,
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.clase).toBe(clase);
    }
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
  ])('rechaza un número %s: tras el trim no queda nada', async (_n, numero) => {
    expect(await errorEn({ numero }, 'numero')).toBe(true);
  });

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['un número JSON', 445566],
  ])('rechaza un número %s', async (_n, numero) => {
    expect(await errorEn({ numero }, 'numero')).toBe(true);
  });

  it('rechaza un número de más de 40 caracteres y acepta uno de exactamente 40', async () => {
    expect(await errorEn({ numero: '9'.repeat(41) }, 'numero')).toBe(true);
    expect(await errorEn({ numero: '9'.repeat(40) }, 'numero')).toBe(false);
  });

  it.each([
    ['un salto de línea', '12\n34'],
    ['un NUL', '12\u000034'],
    ['un tabulador', '12\t34'],
    ['un DEL', '12\u007f34'],
  ])('rechaza un número con %s', async (_n, numero) => {
    expect(await errorEn({ numero }, 'numero')).toBe(true);
  });

  it('rechaza una clase fuera de voucher/boleta', async () => {
    expect(await errorEn({ numero: '1', clase: 'factura' }, 'clase')).toBe(
      true,
    );
  });

  it('rechaza una clase null: omitirla y mandarla null no son lo mismo', async () => {
    expect(await errorEn({ numero: '1', clase: null }, 'clase')).toBe(true);
  });
});
