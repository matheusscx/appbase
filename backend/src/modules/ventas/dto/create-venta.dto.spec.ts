import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LineaVentaDto, PagoVentaDto } from './create-venta.dto';

const METODO_PAGO_ID = '550e8400-e29b-41d4-a716-446655440116';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440117';

describe('PagoVentaDto', () => {
  it('acepta un monto positivo', async () => {
    const dto = plainToInstance(PagoVentaDto, {
      metodoPagoId: METODO_PAGO_ID,
      monto: '1069810.0000',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza monto en 0', async () => {
    const dto = plainToInstance(PagoVentaDto, {
      metodoPagoId: METODO_PAGO_ID,
      monto: '0',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza monto negativo', async () => {
    const dto = plainToInstance(PagoVentaDto, {
      metodoPagoId: METODO_PAGO_ID,
      monto: '-1000',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });
});

describe('LineaVentaDto', () => {
  it('acepta un precioUnitario positivo', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      itemId: ITEM_ID,
      cantidad: '1',
      precioUnitario: '1000',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'precioUnitario')).toBe(false);
  });

  /**
   * Este test decía lo contrario ("acepta un precioUnitario en 0, ítem de
   * cortesía") hasta la decisión del owner del 2026-08-11. Se invierte, no se
   * agrega: el `0` era el único camino para dejar una línea sin monto y sin
   * rastro de quién la regaló.
   */
  it('rechaza un precioUnitario en 0', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      itemId: ITEM_ID,
      cantidad: '1',
      precioUnitario: '0',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'precioUnitario')).toBe(true);
  });

  /**
   * El campo es OPCIONAL y esa es la razón por la que prohibir el `0` no
   * prohíbe vender gratis: omitirlo hace que el precio salga de
   * `item.precioBase`, que sí puede ser 0.
   */
  it('acepta una línea sin precioUnitario', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      itemId: ITEM_ID,
      cantidad: '1',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'precioUnitario')).toBe(false);
  });

  it('rechaza un precioUnitario negativo', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      itemId: ITEM_ID,
      cantidad: '1',
      precioUnitario: '-1000',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'precioUnitario')).toBe(true);
  });
});
