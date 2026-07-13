import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalonesService } from './salones.service';
import { Salon } from './entities/salon.entity';
import { Mesa } from './entities/mesa.entity';
import { Cuenta, EstadoCuenta } from './entities/cuenta.entity';
import { CuentaLinea } from './entities/cuenta-linea.entity';
import { VentasService } from '../ventas/ventas.service';

const TENANT = 'tenant-uuid';
const USUARIO = 'usuario-uuid';
const MESA = 'mesa-uuid';
const CUENTA = 'cuenta-uuid';
const ITEM = 'item-uuid';

type Repo = {
  find: jest.Mock;
  findOne: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  softDelete: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function makeRepo(): Repo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(),
  };
}

describe('SalonesService', () => {
  let service: SalonesService;
  let salonRepo: Repo;
  let mesaRepo: Repo;
  let cuentaRepo: Repo;
  let cuentaLineaRepo: Repo;
  let ventas: { crearEnTransaccion: jest.Mock };
  let manager: {
    query: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: {
    query: jest.Mock;
    transaction: jest.Mock;
    manager: { query: jest.Mock };
  };

  beforeEach(async () => {
    salonRepo = makeRepo();
    mesaRepo = makeRepo();
    cuentaRepo = makeRepo();
    cuentaLineaRepo = makeRepo();
    ventas = { crearEnTransaccion: jest.fn() };

    manager = {
      query: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((_e: unknown, row: unknown) => Promise.resolve(row)),
      create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
    };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalonesService,
        { provide: getRepositoryToken(Salon), useValue: salonRepo },
        { provide: getRepositoryToken(Mesa), useValue: mesaRepo },
        { provide: getRepositoryToken(Cuenta), useValue: cuentaRepo },
        { provide: getRepositoryToken(CuentaLinea), useValue: cuentaLineaRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: VentasService, useValue: ventas },
      ],
    }).compile();

    service = module.get<SalonesService>(SalonesService);
  });

  describe('abrirCuenta', () => {
    it('asigna el número correlativo entre las cuentas abiertas de la mesa', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query.mockResolvedValue([{ next: '3' }]);

      const result = await service.abrirCuenta(TENANT, MESA, {});

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('mesa_id = $2 AND estado = $3'),
        [TENANT, MESA, EstadoCuenta.ABIERTA],
      );
      expect(result.numero).toBe(3);
      expect(manager.create).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({ numero: 3, mesaId: MESA, tenantId: TENANT }),
      );
    });

    it('reinicia en 1 cuando la mesa no tiene cuentas abiertas (quedó libre)', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query.mockResolvedValue([{ next: '1' }]);

      const result = await service.abrirCuenta(TENANT, MESA, {});

      expect(result.numero).toBe(1);
    });

    it('lanza NotFound si la mesa no pertenece al tenant', async () => {
      mesaRepo.findOne.mockResolvedValue(null);
      await expect(service.abrirCuenta(TENANT, MESA, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('agregarLinea', () => {
    beforeEach(() => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      dataSource.query.mockResolvedValue([{ item_id: ITEM }]);
    });

    it('crea una línea nueva cuando el ítem no está en la cuenta', async () => {
      cuentaLineaRepo.findOne.mockResolvedValue(null);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '2',
      });

      expect(cuentaLineaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: ITEM,
          cantidad: '2',
          cuentaId: CUENTA,
        }),
      );
      expect(cuentaLineaRepo.save).toHaveBeenCalled();
    });

    it('suma la cantidad si el ítem ya está en la cuenta', async () => {
      cuentaLineaRepo.findOne.mockResolvedValue({
        id: 'linea-1',
        cantidad: '2',
      });

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '3',
      });

      expect(cuentaLineaRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cantidad: '5' }),
      );
    });

    it('rechaza cantidad menor o igual a cero', async () => {
      cuentaLineaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.agregarLinea(TENANT, CUENTA, { itemId: ITEM, cantidad: '0' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza operar sobre una cuenta no abierta', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(
        service.agregarLinea(TENANT, CUENTA, { itemId: ITEM, cantidad: '1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cerrarCuenta', () => {
    it('genera la venta con crearEnTransaccion y cierra la cuenta', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '2' }]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      const result = await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        pagos: [{ metodoPagoId: 'mp-1', monto: '1000' }],
      });

      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          canal: 'fisico',
          lineas: [{ itemId: ITEM, cantidad: '2' }],
        }),
      );
      expect(result.ventaId).toBe('venta-1');
      expect(cuenta.estado).toBe(EstadoCuenta.CERRADA);
      expect(cuenta.ventaId).toBe('venta-1');
    });

    it('rechaza cerrar una cuenta sin productos', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.find.mockResolvedValue([]);

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {}),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('rechaza cerrar una cuenta que no está abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CANCELADA,
      });

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {}),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });
  });

  describe('cancelarCuenta', () => {
    it('marca la cuenta como cancelada sin generar venta', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      };
      cuentaRepo.findOne.mockResolvedValue(cuenta);

      const result = await service.cancelarCuenta(TENANT, CUENTA);

      expect(cuenta.estado).toBe(EstadoCuenta.CANCELADA);
      expect(result.estado).toBe(EstadoCuenta.CANCELADA);
      expect(cuentaRepo.save).toHaveBeenCalled();
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });
  });

  describe('eliminarMesa', () => {
    it('lanza NotFound al eliminar una mesa de otro tenant', async () => {
      mesaRepo.findOne.mockResolvedValue(null);
      await expect(service.eliminarMesa(TENANT, MESA)).rejects.toThrow(
        NotFoundException,
      );
      expect(mesaRepo.softDelete).not.toHaveBeenCalled();
    });

    it('no elimina una mesa con cuentas abiertas', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.count.mockResolvedValue(1);
      await expect(service.eliminarMesa(TENANT, MESA)).rejects.toThrow(
        BadRequestException,
      );
      expect(mesaRepo.softDelete).not.toHaveBeenCalled();
    });
  });
});
