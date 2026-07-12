import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { SuscripcionesService } from './suscripciones.service';
import { Suscripcion } from './entities/suscripcion.entity';
import { ItemsService } from '../items/items.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { VentasService } from '../ventas/ventas.service';
import { MetodosPagoService } from '../metodos-pago/metodos-pago.service';
import { InscripcionesService } from '../pasarela/services/inscripciones.service';
import { CobrosService } from '../pasarela/services/cobros.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440056';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440300';
const METODO_PAGO_ID = '550e8400-e29b-41d4-a716-446655440105';
const INSCRIPCION_ID = '550e8400-e29b-41d4-a716-446655440500';
const OTRA_INSCRIPCION_ID = '550e8400-e29b-41d4-a716-446655440501';
const ORDEN_ID = '550e8400-e29b-41d4-a716-446655440600';
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
    find: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
  };
  let itemsServiceMock: { findOne: jest.Mock };
  let calculoPreciosServiceMock: { calcular: jest.Mock };
  let ventasServiceMock: { crearEnTransaccion: jest.Mock };
  let metodosPagoServiceMock: { resolverMetodoCredito: jest.Mock };
  let inscripcionesServiceMock: { resolverMedioDeUsuario: jest.Mock };
  let cobrosServiceMock: { cobrar: jest.Mock; vincularVenta: jest.Mock };
  let tenantPasarelaServiceMock: { resolverConfiguracionActiva: jest.Mock };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  let managerMock: ReturnType<typeof buildManagerMock>;

  beforeEach(async () => {
    managerMock = buildManagerMock();
    suscripcionRepoMock = {
      findOne: jest.fn(),
      find: jest.fn(),
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
    metodosPagoServiceMock = {
      resolverMetodoCredito: jest.fn().mockResolvedValue(METODO_PAGO_ID),
    };
    inscripcionesServiceMock = {
      resolverMedioDeUsuario: jest
        .fn()
        .mockResolvedValue({ marca: 'Visa', ultimos4: '6623' }),
    };
    cobrosServiceMock = {
      cobrar: jest
        .fn()
        .mockResolvedValue({ ordenId: ORDEN_ID, estado: 'pagada' }),
      vincularVenta: jest.fn().mockResolvedValue({}),
    };
    tenantPasarelaServiceMock = {
      resolverConfiguracionActiva: jest.fn().mockResolvedValue({}),
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
        { provide: MetodosPagoService, useValue: metodosPagoServiceMock },
        { provide: InscripcionesService, useValue: inscripcionesServiceMock },
        { provide: CobrosService, useValue: cobrosServiceMock },
        {
          provide: TenantPasarelaService,
          useValue: tenantPasarelaServiceMock,
        },
      ],
    }).compile();

    service = module.get<SuscripcionesService>(SuscripcionesService);
  });

  describe('crear()', () => {
    const dto = { itemId: ITEM_ID, diaMes: 15, inscripcionId: INSCRIPCION_ID };

    it('happy path: cobra Oneclick, crea venta + suscripción y concilia la orden', async () => {
      const result = await service.crear(TENANT_ID, USUARIO_ID, dto);

      // Valida ownership de la tarjeta antes de cobrar
      expect(
        inscripcionesServiceMock.resolverMedioDeUsuario,
      ).toHaveBeenCalledWith(TENANT_ID, INSCRIPCION_ID, USUARIO_ID);

      // Cobro real por la inscripción del usuario, origen interno
      expect(cobrosServiceMock.cobrar).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          inscripcionId: INSCRIPCION_ID,
          pagadorRef: USUARIO_ID,
          monto: '30000.0000',
        }),
        'interno',
      );

      // La venta registra el pago con el método contable resuelto server-side
      expect(ventasServiceMock.crearEnTransaccion).toHaveBeenCalledWith(
        managerMock,
        TENANT_ID,
        USUARIO_ID,
        expect.objectContaining({
          canal: 'online',
          pagos: [{ metodoPagoId: METODO_PAGO_ID, monto: '30000.0000' }],
        }),
      );

      // La suscripción queda amarrada a la inscripción + snapshot server-side
      expect(managerMock.save).toHaveBeenCalledWith(
        Suscripcion,
        expect.objectContaining({
          estado: 'activa',
          ventaInicialId: 'venta-1',
          inscripcionId: INSCRIPCION_ID,
          tarjetaMarca: 'Visa',
          tarjetaLast4: '6623',
        }),
      );

      // Concilia la orden con la venta
      expect(cobrosServiceMock.vincularVenta).toHaveBeenCalledWith(
        TENANT_ID,
        ORDEN_ID,
        'venta-1',
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: SUSCRIPCION_ID,
          ventaInicialId: 'venta-1',
          estado: 'activa',
        }),
      );
    });

    it('cobro rechazado → BadRequestException y NO crea venta/suscripción', async () => {
      cobrosServiceMock.cobrar.mockResolvedValueOnce({
        ordenId: ORDEN_ID,
        estado: 'fallida',
      });

      await expect(service.crear(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(ventasServiceMock.crearEnTransaccion).not.toHaveBeenCalled();
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });

    it('timeout del proveedor (502) se propaga sin crear nada', async () => {
      const boom = new Error('502 timeout');
      cobrosServiceMock.cobrar.mockRejectedValueOnce(boom);

      await expect(service.crear(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
        boom,
      );
      expect(ventasServiceMock.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('sin Oneclick activo → BadRequestException antes de cobrar', async () => {
      tenantPasarelaServiceMock.resolverConfiguracionActiva.mockRejectedValueOnce(
        new Error('no config'),
      );

      await expect(service.crear(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(cobrosServiceMock.cobrar).not.toHaveBeenCalled();
    });

    it('item tipo producto → BadRequestException', async () => {
      itemsServiceMock.findOne.mockResolvedValueOnce({
        ...mockItemSuscripcionMensual,
        tipo: 'producto',
        frecuencia: null,
      });

      await expect(service.crear(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
        new BadRequestException('El item no es una suscripción'),
      );
    });

    it('mensual sin diaMes → BadRequestException', async () => {
      const sinDia = { itemId: ITEM_ID, inscripcionId: INSCRIPCION_ID };

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, sinDia as never),
      ).rejects.toThrow(BadRequestException);
      expect(cobrosServiceMock.cobrar).not.toHaveBeenCalled();
    });

    it('quincenal con diaMes: 14 → BadRequestException (máximo 13)', async () => {
      itemsServiceMock.findOne.mockResolvedValueOnce({
        ...mockItemSuscripcionMensual,
        frecuencia: 'quincenal',
      });
      const q = { itemId: ITEM_ID, diaMes: 14, inscripcionId: INSCRIPCION_ID };

      await expect(service.crear(TENANT_ID, USUARIO_ID, q)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cambiarTarjeta()', () => {
    it('reasigna la tarjeta y actualiza el snapshot', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce({
        id: SUSCRIPCION_ID,
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        estado: 'activa',
        inscripcionId: INSCRIPCION_ID,
      });
      inscripcionesServiceMock.resolverMedioDeUsuario.mockResolvedValueOnce({
        marca: 'Mastercard',
        ultimos4: '1111',
      });
      suscripcionRepoMock.save.mockImplementationOnce((s) =>
        Promise.resolve(s),
      );

      const result = await service.cambiarTarjeta(
        TENANT_ID,
        USUARIO_ID,
        SUSCRIPCION_ID,
        OTRA_INSCRIPCION_ID,
      );

      expect(
        inscripcionesServiceMock.resolverMedioDeUsuario,
      ).toHaveBeenCalledWith(TENANT_ID, OTRA_INSCRIPCION_ID, USUARIO_ID);
      expect(result).toEqual({
        id: SUSCRIPCION_ID,
        inscripcionId: OTRA_INSCRIPCION_ID,
        tarjetaMarca: 'Mastercard',
        tarjetaLast4: '1111',
      });
    });

    it('suscripción cancelada → BadRequestException', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce({
        id: SUSCRIPCION_ID,
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        estado: 'cancelada',
      });

      await expect(
        service.cambiarTarjeta(
          TENANT_ID,
          USUARIO_ID,
          SUSCRIPCION_ID,
          OTRA_INSCRIPCION_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(
        inscripcionesServiceMock.resolverMedioDeUsuario,
      ).not.toHaveBeenCalled();
    });

    it('suscripción ajena/inexistente → NotFoundException', async () => {
      suscripcionRepoMock.findOne.mockResolvedValueOnce(null);

      await expect(
        service.cambiarTarjeta(
          TENANT_ID,
          USUARIO_ID,
          'ajena',
          OTRA_INSCRIPCION_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelarPorInscripcion()', () => {
    it('cancela las vigentes amarradas con activa_hasta = proximo_cobro', async () => {
      const vigentes = [
        {
          id: 's1',
          estado: 'activa',
          proximoCobro: '2026-08-01',
          activaHasta: null,
        },
        {
          id: 's2',
          estado: 'pausada',
          proximoCobro: '2026-08-05',
          activaHasta: null,
        },
      ];
      suscripcionRepoMock.find.mockResolvedValueOnce(vigentes);
      suscripcionRepoMock.save.mockResolvedValueOnce(vigentes);

      const result = await service.cancelarPorInscripcion(
        TENANT_ID,
        USUARIO_ID,
        INSCRIPCION_ID,
      );

      expect(result).toEqual({ canceladas: 2 });
      expect(vigentes[0]).toMatchObject({
        estado: 'cancelada',
        activaHasta: '2026-08-01',
      });
      expect(vigentes[1]).toMatchObject({
        estado: 'cancelada',
        activaHasta: '2026-08-05',
      });
    });

    it('sin suscripciones amarradas → no llama save', async () => {
      suscripcionRepoMock.find.mockResolvedValueOnce([]);

      const result = await service.cancelarPorInscripcion(
        TENANT_ID,
        USUARIO_ID,
        INSCRIPCION_ID,
      );

      expect(result).toEqual({ canceladas: 0 });
      expect(suscripcionRepoMock.save).not.toHaveBeenCalled();
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
        { accion: 'pausar' } as never,
      );

      expect(result).toEqual({
        id: SUSCRIPCION_ID,
        estado: 'pausada',
        activaHasta: null,
      });
      expect(suscripcionRepoMock.findOne).toHaveBeenCalledWith({
        where: {
          id: SUSCRIPCION_ID,
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
        },
      });
    });

    it('cancelar sobre pausada → activa_hasta = proximo_cobro', async () => {
      const suscripcion = mockSuscripcion('pausada');
      suscripcionRepoMock.findOne.mockResolvedValueOnce(suscripcion);
      suscripcionRepoMock.save.mockImplementationOnce((s) =>
        Promise.resolve(s),
      );

      const result = await service.cambiarEstado(
        TENANT_ID,
        USUARIO_ID,
        SUSCRIPCION_ID,
        { accion: 'cancelar' } as never,
      );

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
        } as never),
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
          inscripcion_id: INSCRIPCION_ID,
          tarjeta_marca: 'Visa',
          tarjeta_last4: '4242',
          venta_inicial_id: 'venta-1',
          creado_el: new Date('2026-07-06'),
        },
      ]);

      const result = await service.findTodas(TENANT_ID);

      const queryCalls = dataSourceMock.query.mock.calls as unknown[][];
      expect(queryCalls[0][1]).toEqual([TENANT_ID]);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: SUSCRIPCION_ID,
          usuarioNombre: 'Juan Perez',
          inscripcionId: INSCRIPCION_ID,
          estado: 'cancelada',
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
  });
});
