import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LineaVentaDto, PagoVentaDto } from './create-venta.dto';

const METODO_PAGO_ID = '550e8400-e29b-41d4-a716-446655440116';

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

  describe('número y clase del documento de la máquina', () => {
    const base = { metodoPagoId: METODO_PAGO_ID, monto: '1000' };

    it('acepta el número y la clase, y deja el número sin espacios', async () => {
      const dto = plainToInstance(PagoVentaDto, {
        ...base,
        numeroDocumento: '  A-123456  ',
        claseDocumento: 'voucher',
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.numeroDocumento).toBe('A-123456');
      expect(dto.claseDocumento).toBe('voucher');
    });

    it('los dos son opcionales', async () => {
      const dto = plainToInstance(PagoVentaDto, base);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rechaza un número de más de 40 caracteres', async () => {
      const dto = plainToInstance(PagoVentaDto, {
        ...base,
        numeroDocumento: '9'.repeat(41),
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'numeroDocumento')).toBe(true);
    });

    it('acepta uno de exactamente 40', async () => {
      const dto = plainToInstance(PagoVentaDto, {
        ...base,
        numeroDocumento: '9'.repeat(40),
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it.each([
      ['un salto de línea', '12\n34'],
      ['un NUL', '12\u000034'],
      ['un tabulador', '12\t34'],
      ['un DEL', '12\u007f34'],
    ])('rechaza un número con %s', async (_n, numero) => {
      const dto = plainToInstance(PagoVentaDto, {
        ...base,
        numeroDocumento: numero,
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'numeroDocumento')).toBe(true);
    });

    it('acepta letras, guiones, barras y espacios internos', async () => {
      const dto = plainToInstance(PagoVentaDto, {
        ...base,
        numeroDocumento: 'A-12/34 B',
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rechaza una clase fuera de voucher/boleta', async () => {
      const dto = plainToInstance(PagoVentaDto, {
        ...base,
        claseDocumento: 'factura',
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'claseDocumento')).toBe(true);
    });
  });
});

describe('LineaVentaDto.unidadIds', () => {
  const unidad = (n: number) =>
    `550e8400-e29b-41d4-a716-${String(n).padStart(12, '0')}`;
  const base = { itemId: unidad(1), cantidad: '1' };

  it('acepta hasta 200 unidades', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      ...base,
      unidadIds: Array.from({ length: 200 }, (_, i) => unidad(i + 2)),
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza más de 200 unidades', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      ...base,
      unidadIds: Array.from({ length: 201 }, (_, i) => unidad(i + 2)),
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'unidadIds')).toBe(true);
  });

  it('rechaza un valor que no es un arreglo', async () => {
    const dto = plainToInstance(LineaVentaDto, {
      ...base,
      unidadIds: unidad(2),
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'unidadIds')).toBe(true);
  });
});
