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
  let suscripcionRepoMock: {
    findOne: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
  };
  let itemsServiceMock: { findOne: jest.Mock };
  let calculoPreciosServiceMock: { calcular: jest.Mock };
  let ventasServiceMock: { crearEnTransaccion: jest.Mock };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  let managerMock: ReturnType<typeof buildManagerMock>;

  beforeEach(async () => {
    managerMock = buildManagerMock();
    suscripcionRepoMock = {
      findOne: jest.fn(),
      save: jest.fn(),
      softRemove: jest.fn(),
    };
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
        proximoCobro: '2026-07-13',
        activaHasta: null as string | null,
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

      expect(result).toEqual({
        id: SUSCRIPCION_ID,
        estado: 'pausada',
        activaHasta: null,
      });
      // scope cliente: la búsqueda filtra por usuario
      expect(suscripcionRepoMock.findOne).toHaveBeenCalledWith({
        where: {
          id: SUSCRIPCION_ID,
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
        },
      });
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

      // El período pagado sigue vigente: activa_hasta = proximo_cobro previo
      expect(result).toEqual({
        id: SUSCRIPCION_ID,
        estado: 'cancelada',
        activaHasta: '2026-07-13',
      });
      expect(suscripcionRepoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'cancelada',
          activaHasta: '2026-07-13',
        }),
      );
    });

    it('scope admin (usuarioId null): busca sin filtro de usuario y transiciona', async () => {
      const suscripcion = mockSuscripcion('activa');
      suscripcion.usuarioId = 'otro-usuario';
      suscripcionRepoMock.findOne.mockResolvedValueOnce(suscripcion);
      suscripcionRepoMock.save.mockImplementationOnce((s) =>
        Promise.resolve(s),
      );

      const result = await service.cambiarEstado(
        TENANT_ID,
        null,
        SUSCRIPCION_ID,
        { accion: 'cancelar' } as any,
      );

      expect(suscripcionRepoMock.findOne).toHaveBeenCalledWith({
        where: { id: SUSCRIPCION_ID, tenantId: TENANT_ID },
      });
      expect(result).toEqual({
        id: SUSCRIPCION_ID,
        estado: 'cancelada',
        activaHasta: '2026-07-13',
      });
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

  describe('findTodas()', () => {
    it('lista todas las suscripciones del tenant con datos del cliente', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        {
          suscripcion_id: SUSCRIPCION_ID,
          item_id: ITEM_ID,
          item_nombre: 'Plan mensual',
          precio_base: '30000.0000',
          moneda_id: 'moneda-1',
          usuario_id: USUARIO_ID,
          usuario_nombre: 'Juan Perez',
          usuario_email: 'juan@paris.com',
          frecuencia: 'mensual',
          dia_mes: 15,
          dia_semana: null,
          estado: 'cancelada',
          proximo_cobro: '2026-08-15',
          activa_hasta: '2026-08-15',
          tarjeta_marca: 'Visa',
          tarjeta_last4: '4242',
          venta_inicial_id: 'venta-1',
          creado_el: new Date('2026-07-06'),
        },
      ]);

      const result = await service.findTodas(TENANT_ID);

      const queryCalls = dataSourceMock.query.mock.calls as unknown[][];
      expect(queryCalls[0][1]).toEqual([TENANT_ID]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: SUSCRIPCION_ID,
          usuarioNombre: 'Juan Perez',
          usuarioEmail: 'juan@paris.com',
          estado: 'cancelada',
          activaHasta: '2026-08-15',
        }),
      );
    });
  });

  describe('eliminar()', () => {
    it('cancelada → soft delete', async () => {
      const suscripcion = {
        id: SUSCRIPCION_ID,
        tenantId: TENANT_ID,
        estado: 'cancelada',
      };
      suscripcionRepoMock.findOne.mockResolvedValueOnce(suscripcion);
      suscripcionRepoMock.softRemove.mockResolvedValueOnce(suscripcion);

      const result = await service.eliminar(TENANT_ID, SUSCRIPCION_ID);

      expect(suscripcionRepoMock.softRemove).toHaveBeenCalledWith(suscripcion);
      expect(result).toEqual({ id: SUSCRIPCION_ID });
    });

    it('activa → BadRequestException (solo canceladas)', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce({
        id: SUSCRIPCION_ID,
        tenantId: TENANT_ID,
        estado: 'activa',
      });

      await expect(service.eliminar(TENANT_ID, SUSCRIPCION_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(suscripcionRepoMock.softRemove).not.toHaveBeenCalled();
    });

    it('no existe → NotFoundException', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce(null);

      await expect(service.eliminar(TENANT_ID, 'no-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
