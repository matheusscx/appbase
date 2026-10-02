import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNotaCreditoDto } from './create-nota-credito.dto';

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';
const PAGO_ID = '550e8400-e29b-41d4-a716-446655440999';
const POR_EL_PAGO = { pagoId: PAGO_ID };

describe('CreateNotaCreditoDto', () => {
  it('acepta payload mínimo con monto y por dónde vuelve la plata', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      devolucion: POR_EL_PAGO,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta payload completo', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      comentario: 'Devolución cliente',
      devolucion: { sinPlata: true },
      devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza monto no numérico', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: 'abc',
      devolucion: POR_EL_PAGO,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza monto en 0', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '0',
      devolucion: POR_EL_PAGO,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza monto negativo', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '-5000',
      devolucion: POR_EL_PAGO,
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza devoluciones con itemId inválido', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      devolucion: POR_EL_PAGO,
      devoluciones: [{ itemId: 'no-es-uuid', cantidad: '2' }],
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'devoluciones')).toBe(true);
  });

  describe('devolucion: por dónde vuelve la plata', () => {
    const props = async (devolucion: unknown) => {
      const dto = plainToInstance(CreateNotaCreditoDto, {
        monto: '5000',
        devolucion,
      });
      const errores = await validate(dto);
      return errores.length;
    };

    it('es obligatoria', async () => {
      const dto = plainToInstance(CreateNotaCreditoDto, { monto: '5000' });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'devolucion')).toBe(true);
    });

    it.each([
      ['un pagoId', { pagoId: PAGO_ID }],
      ['sinPlata', { sinPlata: true }],
    ])('acepta %s', async (_n, devolucion) => {
      expect(await props(devolucion)).toBe(0);
    });

    it.each([
      ['las dos', { pagoId: PAGO_ID, sinPlata: true }],
      ['ninguna', {}],
      ['sinPlata en false', { sinPlata: false }],
      ['sinPlata como texto', { sinPlata: 'true' }],
      ['un pagoId que no es uuid', { pagoId: 'efectivo' }],
      ['un pagoId nulo', { pagoId: null }],
      ['null', null],
      ['un texto', 'efectivo'],
    ])('rechaza %s', async (_n, devolucion) => {
      expect(await props(devolucion)).toBeGreaterThan(0);
    });
  });
});
