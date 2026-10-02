import type { EntityManager } from 'typeorm';
import { EstadoVenta } from './entities/venta.entity';
import {
  puedeAbonar,
  recalcularEstadoDeLaVenta,
  saldoDeVentaSql,
} from './saldo-venta';

describe('puedeAbonar', () => {
  it.each([
    ['pendiente', '40000.0000', true],
    ['pagada_parcial', '0.0001', true],
    // Sin saldo no hay qué cobrar, aunque el estado aún lo admita.
    ['pendiente', '0.0000', false],
    ['pagada_parcial', '0', false],
    // Con saldo pero en un estado que no admite abonos.
    ['pagada', '40000.0000', false],
    ['cancelada', '40000.0000', false],
  ])('%s con saldo %s: %s', (estado, saldo, esperado) => {
    expect(puedeAbonar(estado, saldo)).toBe(esperado);
  });
});

describe('recalcularEstadoDeLaVenta', () => {
  const manager = (filas: unknown) =>
    ({
      query: jest.fn().mockResolvedValue(filas),
    }) as unknown as EntityManager & {
      query: jest.Mock;
    };

  it('devuelve el estado y el saldo que dejó el UPDATE, con el saldo a 4 decimales', async () => {
    // TypeORM entrega un `UPDATE … RETURNING` como `[filas, cantidad]`.
    const m = manager([[{ estado: 'pagada', saldo: '0' }], 1]);

    await expect(
      recalcularEstadoDeLaVenta(m, 'tenant-1', 'venta-1'),
    ).resolves.toEqual({ estado: EstadoVenta.PAGADA, saldo: '0.0000' });
    expect(m.query.mock.calls[0][1]).toEqual(['venta-1', 'tenant-1']);
  });

  it('nunca toca una venta cancelada ni una borrada, y lee el saldo con la expresión única', async () => {
    const m = manager([[{ estado: 'pendiente', saldo: '100' }], 1]);

    await recalcularEstadoDeLaVenta(m, 'tenant-1', 'venta-1');

    const sql = m.query.mock.calls[0][0] as string;
    expect(sql).toContain("v.estado <> 'cancelada'");
    expect(sql).toContain('v.eliminado_el IS NULL');
    expect(sql).toContain(saldoDeVentaSql('v'));
  });

  it('sin fila (venta inexistente, de otro tenant, borrada o cancelada) falla fuerte, con el motivo', async () => {
    const m = manager([[], 0]);

    await expect(
      recalcularEstadoDeLaVenta(m, 'tenant-1', 'venta-fantasma'),
    ).rejects.toThrow(
      /No se pudo recalcular el estado de la venta venta-fantasma/,
    );
  });
});
