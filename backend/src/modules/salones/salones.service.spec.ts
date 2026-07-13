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
    softDelete: jest.Mock;
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
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
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

  describe('fusionarCuentas', () => {
    const CUENTA_A = 'cuenta-a';
    const CUENTA_B = 'cuenta-b';

    it('mueve las líneas de las cuentas de origen a la de menor número y las cancela', async () => {
      const cuentaA = {
        id: CUENTA_A,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 1,
        estado: EstadoCuenta.ABIERTA,
      };
      const cuentaB = {
        id: CUENTA_B,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 3,
        estado: EstadoCuenta.ABIERTA,
      };
      const lineaExistenteDestino = {
        id: 'linea-a1',
        tenantId: TENANT,
        cuentaId: CUENTA_A,
        itemId: 'item-1',
        cantidad: '1',
      };
      const lineaOrigenMismoItem = {
        id: 'linea-b1',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-1',
        cantidad: '2',
      };
      const lineaOrigenOtroItem = {
        id: 'linea-b2',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-2',
        cantidad: '1',
      };

      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation((entity: unknown) => {
        if (entity === Cuenta) return Promise.resolve([cuentaB, cuentaA]);
        if (entity === CuentaLinea)
          return Promise.resolve([lineaOrigenMismoItem, lineaOrigenOtroItem]);
        return Promise.resolve([]);
      });
      manager.findOne.mockImplementation(
        (_entity: unknown, opts: { where: { itemId: string } }) => {
          if (opts.where.itemId === 'item-1')
            return Promise.resolve(lineaExistenteDestino);
          return Promise.resolve(null);
        },
      );
      manager.query.mockResolvedValue([]);

      const result = await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: [CUENTA_A, CUENTA_B],
      });

      expect(lineaExistenteDestino.cantidad).toBe('3');
      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        lineaExistenteDestino,
      );
      expect(manager.softDelete).toHaveBeenCalledWith(CuentaLinea, {
        id: 'linea-b1',
        tenantId: TENANT,
      });
      expect(lineaOrigenOtroItem.cuentaId).toBe(CUENTA_A);
      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        lineaOrigenOtroItem,
      );
      expect(cuentaB.estado).toBe(EstadoCuenta.CANCELADA);
      expect(manager.save).toHaveBeenCalledWith(Cuenta, cuentaB);
      expect(result.id).toBe(CUENTA_A);
    });

    it('lanza BadRequest si alguna cuenta no está abierta o no pertenece a la mesa', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockResolvedValue([{ id: CUENTA_A, numero: 1 }]);

      await expect(
        service.fusionarCuentas(TENANT, MESA, {
          cuentaIds: [CUENTA_A, CUENTA_B],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequest si no hay al menos dos cuentas distintas', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });

      await expect(
        service.fusionarCuentas(TENANT, MESA, {
          cuentaIds: [CUENTA_A, CUENTA_A],
        }),
      ).rejects.toThrow(BadRequestException);
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
