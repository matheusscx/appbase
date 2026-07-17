import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import {
  EstadoVentaPropina,
  TipoVentaPropina,
  VentaPropina,
} from './entities/venta-propina.entity';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { VentaPropinaService } from './venta-propina.service';

describe('VentaPropinaService', () => {
  let service: VentaPropinaService;
  let manager: {
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    manager = {
      create: jest
        .fn()
        .mockImplementation((_e: unknown, data: Record<string, unknown>) => ({
          ...data,
        })),
      save: jest
        .fn()
        .mockImplementation((_e: unknown, data: Record<string, unknown>) =>
          Promise.resolve({ id: 'vp-1', ...data }),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [VentaPropinaService],
    }).compile();
    service = module.get(VentaPropinaService);
  });

  const base = {
    tenantId: 't1',
    ventaId: 'v1',
    garzonId: 'g1',
    porcentajeSugerido: '0.10',
    sesionGarzonId: null as string | null,
    turnoId: null as string | null,
    tipoGarzon: null as TipoGarzon | null,
  };

  it('tipo=sugerida y estado=pagada cuando montoPagado === montoSugerido > 0', async () => {
    const result = await service.crearEnTransaccion(
      manager as unknown as EntityManager,
      {
        ...base,
        montoSugerido: '5000',
        montoPagado: '5000',
      },
    );
    expect(result.tipo).toBe(TipoVentaPropina.SUGERIDA);
    expect(result.estado).toBe(EstadoVentaPropina.PAGADA);
    expect(manager.save).toHaveBeenCalledWith(
      VentaPropina,
      expect.objectContaining({
        tipo: TipoVentaPropina.SUGERIDA,
        estado: EstadoVentaPropina.PAGADA,
      }),
    );
  });

  it('estado=sin_propina y tipo=manual cuando montoPagado=0 y sugerido>0', async () => {
    const result = await service.crearEnTransaccion(
      manager as unknown as EntityManager,
      {
        ...base,
        montoSugerido: '5000',
        montoPagado: '0',
      },
    );
    expect(result.tipo).toBe(TipoVentaPropina.MANUAL);
    expect(result.estado).toBe(EstadoVentaPropina.SIN_PROPINA);
  });

  it('tipo=manual cuando montoPagado distinto del sugerido', async () => {
    const result = await service.crearEnTransaccion(
      manager as unknown as EntityManager,
      {
        ...base,
        montoSugerido: '5000',
        montoPagado: '3000',
      },
    );
    expect(result.tipo).toBe(TipoVentaPropina.MANUAL);
    expect(result.estado).toBe(EstadoVentaPropina.PAGADA);
  });

  it('rechaza montoPagado negativo', async () => {
    await expect(
      service.crearEnTransaccion(manager as unknown as EntityManager, {
        ...base,
        montoSugerido: '0',
        montoPagado: '-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('persiste sesion, turno y tipo_garzon', async () => {
    const result = await service.crearEnTransaccion(
      manager as unknown as EntityManager,
      {
        ...base,
        montoSugerido: '500',
        montoPagado: '500',
        sesionGarzonId: 's1',
        turnoId: 'tu1',
        tipoGarzon: TipoGarzon.GARZON,
      },
    );
    expect(manager.create).toHaveBeenCalledWith(
      VentaPropina,
      expect.objectContaining({
        sesionGarzonId: 's1',
        turnoId: 'tu1',
        tipoGarzon: TipoGarzon.GARZON,
        liquidacionId: null,
      }),
    );
    expect(result.sesionGarzonId).toBe('s1');
  });

  it('permite nulls en backfill/legado', async () => {
    await service.crearEnTransaccion(manager as unknown as EntityManager, {
      ...base,
      montoSugerido: '500',
      montoPagado: '500',
      sesionGarzonId: null,
      turnoId: null,
      tipoGarzon: null,
    });
    expect(manager.create).toHaveBeenCalledWith(
      VentaPropina,
      expect.objectContaining({
        sesionGarzonId: null,
        turnoId: null,
        tipoGarzon: null,
      }),
    );
  });

  it('rechaza sesión/turno/tipo desbalanceados', async () => {
    await expect(
      service.crearEnTransaccion(manager as unknown as EntityManager, {
        ...base,
        montoSugerido: '500',
        montoPagado: '500',
        sesionGarzonId: 's1',
        turnoId: null,
        tipoGarzon: null,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
