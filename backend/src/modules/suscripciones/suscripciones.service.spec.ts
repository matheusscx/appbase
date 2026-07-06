import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { SuscripcionesService } from './suscripciones.service';
import { Suscripcion } from './entities/suscripcion.entity';
import { ItemsService } from '../items/items.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { VentasService } from '../ventas/ventas.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440056';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440300';
const METODO_PAGO_ID = '550e8400-e29b-41d4-a716-446655440105';
const SUSCRIPCION_ID = '550e8400-e29b-41d4-a716-446655440400';

const mockItemSuscripcionMensual = {
  id: ITEM_ID,
  nombre: 'Plan mensual',
  tipo: 'suscripcion',
  activo: true,
  frecuencia: 'mensual',
  precioBase: '30000.0000',
};

function buildManagerMock() {
  return {
    create: jest
      .fn()
      .mockImplementation(
        (_entity: unknown, data: Record<string, unknown>) => ({
          ...data,
        }),
      ),
    save: jest
      .fn()
      .mockImplementation(
        (_entity: unknown, data: Record<string, unknown>): Promise<unknown> =>
          Promise.resolve({ id: SUSCRIPCION_ID, ...data }),
      ),
  };
}

describe('SuscripcionesService', () => {
  let service: SuscripcionesService;
  let suscripcionRepoMock: { findOne: jest.Mock; save: jest.Mock };
  let itemsServiceMock: { findOne: jest.Mock };
  let calculoPreciosServiceMock: { calcular: jest.Mock };
  let ventasServiceMock: { crearEnTransaccion: jest.Mock };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  let managerMock: ReturnType<typeof buildManagerMock>;

  beforeEach(async () => {
    managerMock = buildManagerMock();
    suscripcionRepoMock = { findOne: jest.fn(), save: jest.fn() };
    itemsServiceMock = {
      findOne: jest.fn().mockResolvedValue(mockItemSuscripcionMensual),
    };
    calculoPreciosServiceMock = {
      calcular: jest
        .fn()
        .mockResolvedValue({ totales: { totalFinal: '30000.0000' } }),
    };
    ventasServiceMock = {
      crearEnTransaccion: jest.fn().mockResolvedValue({ id: 'venta-1' }),
    };
    dataSourceMock = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: typeof managerMock) => unknown) =>
          cb(managerMock),
        ),
      query: jest.fn().mockResolvedValue([{ nombre: 'Juan Perez' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuscripcionesService,
        {
          provide: getRepositoryToken(Suscripcion),
          useValue: suscripcionRepoMock,
        },
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: ItemsService, useValue: itemsServiceMock },
        { provide: CalculoPreciosService, useValue: calculoPreciosServiceMock },
        { provide: VentasService, useValue: ventasServiceMock },
      ],
    }).compile();

    service = module.get<SuscripcionesService>(SuscripcionesService);
  });

  describe('crear()', () => {
    it('happy path mensual: crea venta + suscripción en una transacción', async () => {
      const dto = {
        itemId: ITEM_ID,
        diaMes: 15,
        metodoPagoId: METODO_PAGO_ID,
      };

      const result = await service.crear(TENANT_ID, USUARIO_ID, dto);

      expect(ventasServiceMock.crearEnTransaccion).toHaveBeenCalledWith(
        managerMock,
        TENANT_ID,
        USUARIO_ID,
        expect.objectContaining({
          canal: 'online',
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: METODO_PAGO_ID, monto: '30000.0000' }],
        }),
      );

      expect(managerMock.save).toHaveBeenCalledWith(
        Suscripcion,
        expect.objectContaining({
          estado: 'activa',
          ventaInicialId: 'venta-1',
          frecuencia: 'mensual',
        }),
      );

      const saveCalls = managerMock.save.mock.calls as unknown[][];
      const savedData = saveCalls[0][1] as Record<string, unknown>;
      expect(savedData.proximoCobro).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      expect(result).toEqual(
        expect.objectContaining({
          id: SUSCRIPCION_ID,
          ventaInicialId: 'venta-1',
          estado: 'activa',
        }),
      );
      expect(result.proximoCobro).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('item tipo producto → BadRequestException', async () => {
      itemsServiceMock.findOne.mockResolvedValueOnce({
        ...mockItemSuscripcionMensual,
        tipo: 'producto',
        frecuencia: null,
      });
      const dto = { itemId: ITEM_ID, diaMes: 15, metodoPagoId: METODO_PAGO_ID };

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dto as any),
      ).rejects.toThrow(
        new BadRequestException('El item no es una suscripción'),
      );
    });

    it('item inactivo → BadRequestException', async () => {
      itemsServiceMock.findOne.mockResolvedValueOnce({
        ...mockItemSuscripcionMensual,
        activo: false,
      });
      const dto = { itemId: ITEM_ID, diaMes: 15, metodoPagoId: METODO_PAGO_ID };

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('mensual sin diaMes → BadRequestException', async () => {
      const dto = { itemId: ITEM_ID, metodoPagoId: METODO_PAGO_ID };

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('quincenal con diaMes: 14 → BadRequestException (máximo 13)', async () => {
      itemsServiceMock.findOne.mockResolvedValueOnce({
        ...mockItemSuscripcionMensual,
        frecuencia: 'quincenal',
      });
      const dto = { itemId: ITEM_ID, diaMes: 14, metodoPagoId: METODO_PAGO_ID };

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('semanal sin diaSemana → BadRequestException', async () => {
      itemsServiceMock.findOne.mockResolvedValueOnce({
        ...mockItemSuscripcionMensual,
        frecuencia: 'semanal',
      });
      const dto = { itemId: ITEM_ID, metodoPagoId: METODO_PAGO_ID };

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cambiarEstado()', () => {
    function mockSuscripcion(estado: string) {
      return {
        id: SUSCRIPCION_ID,
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        estado,
      };
    }

    it('pausar sobre activa → ok', async () => {
      const suscripcion = mockSuscripcion('activa');
      suscripcionRepoMock.findOne.mockResolvedValueOnce(suscripcion);
      suscripcionRepoMock.save.mockImplementationOnce((s) =>
        Promise.resolve(s),
      );

      const result = await service.cambiarEstado(
        TENANT_ID,
        USUARIO_ID,
        SUSCRIPCION_ID,
        { accion: 'pausar' } as any,
      );

      expect(result).toEqual({ id: SUSCRIPCION_ID, estado: 'pausada' });
    });

    it('pausar sobre pausada → BadRequestException', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce(
        mockSuscripcion('pausada'),
      );

      await expect(
        service.cambiarEstado(TENANT_ID, USUARIO_ID, SUSCRIPCION_ID, {
          accion: 'pausar',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('reanudar sobre cancelada → BadRequestException', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce(
        mockSuscripcion('cancelada'),
      );

      await expect(
        service.cambiarEstado(TENANT_ID, USUARIO_ID, SUSCRIPCION_ID, {
          accion: 'reanudar',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('cancelar sobre pausada → ok', async () => {
      const suscripcion = mockSuscripcion('pausada');
      suscripcionRepoMock.findOne.mockResolvedValueOnce(suscripcion);
      suscripcionRepoMock.save.mockImplementationOnce((s) =>
        Promise.resolve(s),
      );

      const result = await service.cambiarEstado(
        TENANT_ID,
        USUARIO_ID,
        SUSCRIPCION_ID,
        { accion: 'cancelar' } as any,
      );

      expect(result).toEqual({ id: SUSCRIPCION_ID, estado: 'cancelada' });
    });

    it('id ajeno (repo devuelve null) → NotFoundException', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce(null);

      await expect(
        service.cambiarEstado(TENANT_ID, USUARIO_ID, 'ajeno-id', {
          accion: 'pausar',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
