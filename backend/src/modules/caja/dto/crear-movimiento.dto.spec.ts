import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearMovimientoDto } from './crear-movimiento.dto';

describe('CrearMovimientoDto', () => {
  it('acepta un monto positivo', async () => {
    const dto = plainToInstance(CrearMovimientoDto, {
      tipo: 'entrada',
      concepto: 'Vuelto inicial',
      monto: '10000',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza monto en 0', async () => {
    const dto = plainToInstance(CrearMovimientoDto, {
      tipo: 'entrada',
      concepto: 'Vuelto inicial',
      monto: '0',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza monto negativo', async () => {
    const dto = plainToInstance(CrearMovimientoDto, {
      tipo: 'entrada',
      concepto: 'Vuelto inicial',
      monto: '-5000',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  // Documenta por qué importa: `tipo` (entrada/salida) ya codifica el signo.
  // Si `monto` admitiera negativos, una "salida" con monto negativo SUMARÍA
  // al esperado de la caja en vez de restar (doble inversión de signo).
  it('rechaza una salida con monto negativo (no puede inflar el esperado)', async () => {
    const dto = plainToInstance(CrearMovimientoDto, {
      tipo: 'salida',
      concepto: 'Retiro no autorizado',
      monto: '-20000',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });
});
