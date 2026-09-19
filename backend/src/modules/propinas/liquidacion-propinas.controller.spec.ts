import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { LiquidacionPropinasController } from './liquidacion-propinas.controller';
import { type LiquidacionPropinasService } from './liquidacion-propinas.service';

/**
 * El `preview` es el tercer punto de entrada del período. Hasta Task 4 de
 * `hora-de-corte` normalizaba con `rangoLiquidacionDesde` (síncrona, sin
 * base) directo en el controller; ahora el período puede requerir el día del
 * negocio del tenant (zona + `hora_corte`), que sale de una consulta, así que
 * el controller **no toca la base**: delega en
 * `LiquidacionPropinasService.resolverPeriodo` (async), que envuelve
 * `rangoLiquidacion` — ahí vive la guarda de orden y la de "fecha ISO que
 * `new Date` no sabe leer", cubiertas en `rango-liquidacion.spec.ts`.
 *
 * Lo que este test fija es la ÚNICA responsabilidad que le queda al
 * controller: pasarle a `resolverPeriodo` el tenant del JWT (nunca del body)
 * y las fechas crudas del DTO, y propagar tanto el resultado como el rechazo
 * a `computarReparto` sin tocarlos.
 */
describe('LiquidacionPropinasController — el período del preview', () => {
  const tenantId = '550e8400-e29b-41d4-a716-446655440001';
  const request = { user: { tenantId, id: 'user-1' } } as unknown as Request;
  const liquidaciones = {
    computarReparto: jest.fn(),
    resolverPeriodo: jest.fn(),
  };
  const controller = new LiquidacionPropinasController(
    liquidaciones as unknown as LiquidacionPropinasService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('resuelve el período vía el service, con el tenant del JWT y las fechas crudas del DTO', async () => {
    const fechaDesde = new Date('2026-07-17T00:00:00.000Z');
    const fechaHasta = new Date('2026-07-18T12:00:00.000Z');
    liquidaciones.resolverPeriodo.mockResolvedValue({
      fechaDesde,
      fechaHasta,
    });

    await controller.preview(request, {
      fechaDesde: '2026-07-17',
      fechaHasta: '2026-07-18T12:00:00Z',
      turnoIds: ['turno-1'],
    });

    expect(liquidaciones.resolverPeriodo).toHaveBeenCalledWith(
      tenantId,
      '2026-07-17',
      '2026-07-18T12:00:00Z',
    );
    expect(liquidaciones.computarReparto).toHaveBeenCalledWith(
      tenantId,
      fechaDesde,
      fechaHasta,
      ['turno-1'],
      undefined,
    );
  });

  // El controller no repite ninguna guarda: solo confirma que un rechazo de
  // `resolverPeriodo` (orden invertido, fecha ISO que `new Date` no sabe leer,
  // etc. — casos cubiertos en `rango-liquidacion.spec.ts`) llega tal cual al
  // caller y nunca dispara `computarReparto`.
  it('propaga el rechazo de resolverPeriodo sin llamar a computarReparto', async () => {
    liquidaciones.resolverPeriodo.mockRejectedValue(
      new BadRequestException('La fecha hasta debe ser posterior a desde'),
    );

    await expect(
      controller.preview(request, {
        fechaDesde: '2026-07-18',
        fechaHasta: '2026-07-17',
      }),
    ).rejects.toThrow('La fecha hasta debe ser posterior a desde');
    expect(liquidaciones.computarReparto).not.toHaveBeenCalled();
  });
});
