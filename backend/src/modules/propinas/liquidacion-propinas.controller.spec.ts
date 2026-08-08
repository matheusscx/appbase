import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { LiquidacionPropinasController } from './liquidacion-propinas.controller';
import { type LiquidacionPropinasService } from './liquidacion-propinas.service';

/**
 * El `preview` es el tercer punto de entrada del período, y el único que valida
 * en el controller: `crear()` y `liquidar()` reciben el DTO y normalizan
 * adentro, mientras que `computarReparto` recibe dos `Date` ya construidos.
 *
 * Existe porque la doc promete el rechazo en **los tres** endpoints
 * (`docs/features/liquidacion-propinas-motor.md`) y los otros dos ya tienen su
 * test en `liquidacion-propinas.service.spec.ts`. Sin esto, el `preview` era el
 * único de los tres sin nada que lo fije.
 */
describe('LiquidacionPropinasController — el período del preview', () => {
  const tenantId = '550e8400-e29b-41d4-a716-446655440001';
  const request = { user: { tenantId, id: 'user-1' } } as unknown as Request;
  const liquidaciones = { computarReparto: jest.fn() };
  const controller = new LiquidacionPropinasController(
    liquidaciones as unknown as LiquidacionPropinasService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('convierte el período y lo delega con el tenant del JWT', () => {
    controller.preview(request, {
      fechaDesde: '2026-07-17',
      fechaHasta: '2026-07-18T12:00:00Z',
      turnoIds: ['turno-1'],
    });

    expect(liquidaciones.computarReparto).toHaveBeenCalledWith(
      tenantId,
      new Date('2026-07-17'),
      new Date('2026-07-18T12:00:00Z'),
      ['turno-1'],
      undefined,
    );
  });

  // `2026-W32-1` pasa `@IsISO8601({ strict: true })` —es ISO válida— y
  // `new Date` la deja en `Invalid Date`. La guarda de orden no la ve porque
  // compara `NaN <= NaN`. Sin el normalizador llegaba a la query y Postgres
  // cortaba con un 500.
  it.each(['2026-W32-1', '20260807'])(
    'rechaza %s con un 400, sin llamar al service',
    (valor) => {
      expect(() =>
        controller.preview(request, {
          fechaDesde: '2026-07-17',
          fechaHasta: valor,
        }),
      ).toThrow(BadRequestException);
      expect(liquidaciones.computarReparto).not.toHaveBeenCalled();
    },
  );

  it('rechaza un período invertido sin llamar al service', () => {
    expect(() =>
      controller.preview(request, {
        fechaDesde: '2026-07-18',
        fechaHasta: '2026-07-17',
      }),
    ).toThrow('La fecha hasta debe ser posterior a desde');
    expect(liquidaciones.computarReparto).not.toHaveBeenCalled();
  });
});
