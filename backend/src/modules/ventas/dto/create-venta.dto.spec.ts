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

  it('acepta un precioUnitario en 0 (ítem de cortesía)', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      itemId: ITEM_ID,
      cantidad: '1',
      precioUnitario: '0',
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
