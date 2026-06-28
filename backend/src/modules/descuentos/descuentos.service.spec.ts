import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DescuentosService } from './descuentos.service';
import { Descuento } from './entities/descuento.entity';
import { DescuentoTramo } from './entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from './entities/descuento-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CondicionTipo } from '../../common/enums/reglas.enums';

const TENANT = 'tenant-uuid';

function makeTipo(codigo: string, clase: string = 'descuento') {
  return { id: `tipo-${codigo}`, codigo, clase, nombre: `Tipo ${codigo}` };
}

describe('DescuentosService', () => {
  let service: DescuentosService;
  let qbMock: { where: jest.Mock; andWhere: jest.Mock; getCount: jest.Mock };
  let managerMock: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
  };
  let dataSourceMock: { transaction: jest.Mock };
  let descuentoRepoMock: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let tipoReglaRepoMock: { findOne: jest.Mock; find: jest.Mock };
  let tramoRepoMock: { find: jest.Mock };
  let metodoPagoRepoMock: { find: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };

    managerMock = {
      create: jest.fn((_, data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      delete: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    dataSourceMock = {
      transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
        cb(managerMock),
      ),
    };

    descuentoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qbMock),
    };

    tipoReglaRepoMock = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    tramoRepoMock = { find: jest.fn().mockResolvedValue([]) };
    metodoPagoRepoMock = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DescuentosService,
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: getRepositoryToken(Descuento), useValue: descuentoRepoMock },
        { provide: getRepositoryToken(TipoRegla), useValue: tipoReglaRepoMock },
        {
          provide: getRepositoryToken(DescuentoTramo),
          useValue: tramoRepoMock,
        },
        {
          provide: getRepositoryToken(DescuentoMetodoPago),
          useValue: metodoPagoRepoMock,
        },
      ],
    }).compile();

    service = module.get<DescuentosService>(DescuentosService);
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects when tipoRegla does not exist', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.create(TENANT, { nombre: 'X', tipoReglaId: 'tr-x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when tipo clase is not descuento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('general', 'recargo'),
      );
      await expect(
        service.create(TENANT, { nombre: 'X', tipoReglaId: 'tipo-general' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates metodo_pago descuento with metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      await service.create(TENANT, {
        nombre: 'Desc MP',
        tipoReglaId: 'tipo-metodo_pago',
        metodoPagoIds: ['mp-1', 'mp-2'],
        valor: '0.10',
        modo: 'porcentaje',
      });
      // save called twice: once for descuento, once for metodos array
      expect(managerMock.save).toHaveBeenCalledTimes(2);
      const [, metodoArgs] = managerMock.save.mock.calls as Array<[unknown[]]>;
      expect(metodoArgs[0]).toHaveLength(2);
    });

    it('rejects metodo_pago without metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      await expect(
        service.create(TENANT, {
          nombre: 'Desc MP',
          tipoReglaId: 'tipo-metodo_pago',
          valor: '0.10',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates pronto_pago with diasVencimiento, forces modo=porcentaje', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('pronto_pago'));
      await service.create(TENANT, {
        nombre: 'Pronto pago',
        tipoReglaId: 'tipo-pronto_pago',
        diasVencimiento: 30,
        valor: '0.05',
      });
      // Check entity was created with condicionTipo=VENCIMIENTO and forced modo
      const firstCreateArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(firstCreateArgs[1]).toMatchObject({
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '30',
        modo: 'porcentaje',
      });
      // No children → save called once
      expect(managerMock.save).toHaveBeenCalledTimes(1);
    });

    it('rejects pronto_pago without diasVencimiento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('pronto_pago'));
      await expect(
        service.create(TENANT, {
          nombre: 'Pronto pago',
          tipoReglaId: 'tipo-pronto_pago',
          valor: '0.05',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects pronto_pago with diasVencimiento = 0', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('pronto_pago'));
      await expect(
        service.create(TENANT, {
          nombre: 'PP',
          tipoReglaId: 'tipo-pronto_pago',
          diasVencimiento: 0,
          valor: '0.10',
        }),
      ).rejects.toThrow('mayor a 0');
    });

    it('creates por_mayor with tramos', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await service.create(TENANT, {
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        tramos: [
          { minimo: '10', valor: '0.10' },
          { minimo: '100', valor: '0.15' },
        ],
        modo: 'porcentaje',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(2);
      const [, tramosCallArgs] = managerMock.save.mock.calls as Array<
        [unknown[]]
      >;
      expect(tramosCallArgs[0]).toHaveLength(2);
    });

    it('rejects por_mayor without tramos', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates por_monto_venta with tramos and optional dates', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_monto_venta'));
      await service.create(TENANT, {
        nombre: 'Por monto',
        tipoReglaId: 'tipo-por_monto_venta',
        tramos: [{ minimo: '500', valor: '0.10' }],
        modo: 'porcentaje',
        fechaInicio: '2024-01-01',
        fechaFin: '2024-12-31',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(2);
    });

    it('creates promocional with fechaInicio and fechaFin', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('promocional'));
      await service.create(TENANT, {
        nombre: 'Promo navidad',
        tipoReglaId: 'tipo-promocional',
        valor: '0.20',
        modo: 'porcentaje',
        fechaInicio: '2024-12-01',
        fechaFin: '2024-12-31',
      });
      // No children → save called once
      expect(managerMock.save).toHaveBeenCalledTimes(1);
    });

    it('rejects promocional without dates', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('promocional'));
      await expect(
        service.create(TENANT, {
          nombre: 'Promo',
          tipoReglaId: 'tipo-promocional',
          valor: '0.20',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate nombre', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      qbMock.getCount.mockResolvedValue(1);
      await expect(
        service.create(TENANT, {
          nombre: 'Existing',
          tipoReglaId: 'tipo-por_mayor',
          tramos: [{ minimo: '10', valor: '0.10' }],
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when descuento not found', async () => {
      descuentoRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.update(TENANT, 'x', { nombre: 'nuevo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('replaces tramos on update via softDelete', async () => {
      const existing = {
        id: 'd-1',
        tenantId: TENANT,
        nombre: 'Desc',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'porcentaje',
      };
      descuentoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));

      await service.update(TENANT, 'd-1', {
        tipoReglaId: 'tipo-por_mayor',
        tramos: [{ minimo: '20', valor: '0.15' }],
        modo: 'porcentaje',
      });

      expect(managerMock.softDelete).toHaveBeenCalledWith(DescuentoTramo, {
        descuentoId: 'd-1',
      });
    });

    it('replaces metodoPagoIds on update via soft-stamp', async () => {
      const existing = {
        id: 'd-2',
        tenantId: TENANT,
        nombre: 'Desc MP',
        tipoReglaId: 'tipo-metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
      };
      descuentoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));

      await service.update(TENANT, 'd-2', {
        tipoReglaId: 'tipo-metodo_pago',
        metodoPagoIds: ['mp-3'],
        valor: '0.10',
        modo: 'porcentaje',
      });

      expect(managerMock.update).toHaveBeenCalledWith(
        DescuentoMetodoPago,
        { descuentoId: 'd-2' },
        expect.objectContaining({ eliminadoEl: expect.any(Date) }),
      );
      const typedCalls = managerMock.save.mock.calls as Array<[unknown[]]>;
      const lastCallArgs = typedCalls[typedCalls.length - 1];
      expect(lastCallArgs[0]).toHaveLength(1);
    });

    it('does not touch children when not in dto (partial update)', async () => {
      const existing = {
        id: 'd-3',
        tenantId: TENANT,
        nombre: 'Desc',
        tipoReglaId: 'tipo-metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
      };
      descuentoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));

      await service.update(TENANT, 'd-3', { activo: false });

      expect(managerMock.softDelete).not.toHaveBeenCalled();
      expect(managerMock.update).not.toHaveBeenCalled();
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws NotFoundException when descuento not found', async () => {
      descuentoRepoMock.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, 'x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes when descuento belongs to tenant', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
      });
      await service.remove(TENANT, 'd1');
      expect(descuentoRepoMock.softDelete).toHaveBeenCalledWith({
        id: 'd1',
        tenantId: TENANT,
      });
    });
  });

  // ─── nombreDisponible ─────────────────────────────────────────────────────

  describe('nombreDisponible', () => {
    it('returns disponible:true when no match', async () => {
      qbMock.getCount.mockResolvedValue(0);
      const result = await service.nombreDisponible(TENANT, 'Nuevo');
      expect(result).toEqual({ disponible: true });
    });

    it('returns disponible:false when match exists', async () => {
      qbMock.getCount.mockResolvedValue(1);
      const result = await service.nombreDisponible(TENANT, 'Existente');
      expect(result).toEqual({ disponible: false });
    });

    it('adds excludeId condition when provided', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Nombre', 'some-id');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('descuento_id'),
        expect.objectContaining({ excludeId: 'some-id' }),
      );
    });
  });
});
