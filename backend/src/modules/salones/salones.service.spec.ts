import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalonesService } from './salones.service';
import { Salon } from './entities/salon.entity';
import { Mesa } from './entities/mesa.entity';
import { Cuenta, EstadoCuenta } from './entities/cuenta.entity';
import { CuentaLinea } from './entities/cuenta-linea.entity';
import { VentasService } from '../ventas/ventas.service';
import { GarzonesService } from '../garzones/garzones.service';
import { ItemsService } from '../items/items.service';

const TENANT = 'tenant-uuid';
const USUARIO = 'usuario-uuid';
const MESA = 'mesa-uuid';
const CUENTA = 'cuenta-uuid';
const ITEM = 'item-uuid';
const RECETA = 'receta-uuid';
const ING = 'ing-uuid';
const GARZON = 'garzon-uuid';
const PIN = '111111';

const SNAPSHOT = {
  omitidos: [ING],
  extras: [],
  comentario: 'sin cebolla',
};

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
  let garzones: { resolverGarzonPorPin: jest.Mock };
  let items: { resolverPersonalizacionReceta: jest.Mock };
  let manager: {
    query: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
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
    garzones = {
      resolverGarzonPorPin: jest.fn().mockResolvedValue({
        id: GARZON,
        nombre: 'Ana Torres',
      }),
    };
    items = {
      resolverPersonalizacionReceta: jest.fn().mockResolvedValue({
        snapshot: SNAPSHOT,
        precioExtraTotal: '0.0000',
      }),
    };

    manager = {
      query: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((_e: unknown, row: unknown) => Promise.resolve(row)),
      create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
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
        { provide: GarzonesService, useValue: garzones },
        { provide: ItemsService, useValue: items },
      ],
    }).compile();

    service = module.get<SalonesService>(SalonesService);
  });

  describe('abrirCuenta', () => {
    it('asigna el número correlativo entre las cuentas abiertas de la mesa', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query
        .mockResolvedValueOnce([{ mesa_id: MESA }]) // FOR UPDATE mesa
        .mockResolvedValueOnce([{ next: '3' }]);

      const result = await service.abrirCuenta(TENANT, MESA, { pin: PIN });

      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FOR UPDATE'),
        [MESA, TENANT],
      );
      expect(manager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('mesa_id = $2 AND estado = $3'),
        [TENANT, MESA, EstadoCuenta.ABIERTA],
      );
      expect(result.numero).toBe(3);
      expect(manager.create).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          numero: 3,
          mesaId: MESA,
          tenantId: TENANT,
          garzonAperturaId: GARZON,
        }),
      );
    });

    it('rechaza abrir la cuenta si el PIN del garzón es inválido', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      garzones.resolverGarzonPorPin.mockRejectedValue(
        new BadRequestException('PIN inválido'),
      );

      await expect(
        service.abrirCuenta(TENANT, MESA, { pin: '000000' }),
      ).rejects.toThrow(BadRequestException);
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('reinicia en 1 cuando la mesa no tiene cuentas abiertas (quedó libre)', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query
        .mockResolvedValueOnce([{ mesa_id: MESA }])
        .mockResolvedValueOnce([{ next: '1' }]);

      const result = await service.abrirCuenta(TENANT, MESA, { pin: PIN });

      expect(result.numero).toBe(1);
    });

    it('lanza NotFound si la mesa no pertenece al tenant', async () => {
      mesaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.abrirCuenta(TENANT, MESA, { pin: PIN }),
      ).rejects.toThrow(NotFoundException);
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
        cantidadEnviada: '1',
      };
      const lineaOrigenMismoItem = {
        id: 'linea-b1',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-1',
        cantidad: '2',
        cantidadEnviada: '2',
      };
      const lineaOrigenOtroItem = {
        id: 'linea-b2',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-2',
        cantidad: '1',
        cantidadEnviada: '0',
      };

      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.findOne.mockImplementation(
        (
          _entity: unknown,
          opts: { where: { itemId?: string; cuentaId?: string } },
        ) => {
          if (opts.where.itemId === 'item-1' && opts.where.cuentaId === CUENTA_A)
            return Promise.resolve(lineaExistenteDestino);
          return Promise.resolve(null);
        },
      );
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: string; itemId?: string } }) => {
          if (entity === Cuenta) return Promise.resolve([cuentaB, cuentaA]);
          if (entity === CuentaLinea) {
            if (opts?.where?.cuentaId === CUENTA_B)
              return Promise.resolve([lineaOrigenMismoItem, lineaOrigenOtroItem]);
            if (
              opts?.where?.cuentaId === CUENTA_A &&
              opts?.where?.itemId === 'item-1'
            )
              return Promise.resolve([lineaExistenteDestino]);
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        },
      );
      manager.query.mockResolvedValue([]);

      const result = await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: [CUENTA_A, CUENTA_B],
      });

      expect(lineaExistenteDestino.cantidad).toBe('3');
      // cantidadEnviada también se suma para no reenviar lo ya impreso
      expect(lineaExistenteDestino.cantidadEnviada).toBe('3');
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
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT item_id, tipo'))
          return Promise.resolve([{ item_id: ITEM, tipo: 'producto' }]);
        return Promise.resolve([]);
      });
      dataSource.manager.query.mockResolvedValue([]);
    });

    it('crea una línea nueva cuando el ítem no está en la cuenta', async () => {
      cuentaLineaRepo.find.mockResolvedValue([]);

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

    it('suma la cantidad si el ítem ya está en la cuenta sin personalización', async () => {
      cuentaLineaRepo.find.mockResolvedValue([
        { id: 'linea-1', cantidad: '2', personalizacion: null },
      ]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '3',
      });

      expect(cuentaLineaRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cantidad: '5' }),
      );
    });

    it('guarda personalización JSONB en recetas', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT item_id, tipo'))
          return Promise.resolve([{ item_id: RECETA, tipo: 'receta' }]);
        return Promise.resolve([]);
      });
      cuentaLineaRepo.find.mockResolvedValue([]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: RECETA,
        cantidad: '1',
        personalizacion: { omitidos: [ING], comentario: 'sin cebolla' },
      });

      expect(items.resolverPersonalizacionReceta).toHaveBeenCalled();
      expect(cuentaLineaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ personalizacion: SNAPSHOT }),
      );
    });

    it('suma cantidad si misma personalización; crea línea nueva si difiere', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT item_id, tipo'))
          return Promise.resolve([{ item_id: RECETA, tipo: 'receta' }]);
        return Promise.resolve([]);
      });
      const lineaMisma = {
        id: 'linea-1',
        cantidad: '1',
        personalizacion: SNAPSHOT,
      };
      cuentaLineaRepo.find.mockResolvedValue([lineaMisma]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: RECETA,
        cantidad: '2',
        personalizacion: { omitidos: [ING], comentario: 'sin cebolla' },
      });

      expect(cuentaLineaRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cantidad: '3' }),
      );
      expect(cuentaLineaRepo.create).not.toHaveBeenCalled();

      cuentaLineaRepo.find.mockResolvedValue([
        {
          id: 'linea-1',
          cantidad: '1',
          personalizacion: { omitidos: ['otro-ing'], extras: [] },
        },
      ]);
      cuentaLineaRepo.create.mockClear();

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: RECETA,
        cantidad: '1',
        personalizacion: { omitidos: [ING], comentario: 'sin cebolla' },
      });

      expect(cuentaLineaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ personalizacion: SNAPSHOT }),
      );
    });

    it('rechaza personalización en ítems que no son receta', async () => {
      await expect(
        service.agregarLinea(TENANT, CUENTA, {
          itemId: ITEM,
          cantidad: '1',
          personalizacion: { omitidos: [ING] },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza cantidad menor o igual a cero', async () => {
      cuentaLineaRepo.find.mockResolvedValue([]);
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
      manager.find.mockResolvedValue([
        { itemId: ITEM, cantidad: '2', personalizacion: SNAPSHOT },
      ]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      const result = await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        pin: PIN,
        pagos: [{ metodoPagoId: 'mp-1', monto: '1000' }],
      });

      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          where: { id: CUENTA, tenantId: TENANT },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          canal: 'fisico',
          lineas: [
            {
              itemId: ITEM,
              cantidad: '2',
              personalizacion: {
                omitidos: [ING],
                extras: [],
                comentario: 'sin cebolla',
              },
            },
          ],
        }),
      );
      expect(result.ventaId).toBe('venta-1');
      expect(cuenta.estado).toBe(EstadoCuenta.CERRADA);
      expect(cuenta.ventaId).toBe('venta-1');
      expect((cuenta as { garzonCierreId?: string }).garzonCierreId).toBe(
        GARZON,
      );
    });

    it('rechaza cerrar una cuenta sin productos', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.find.mockResolvedValue([]);

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, { pin: PIN }),
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
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, { pin: PIN }),
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

  describe('previewComanda', () => {
    it('agrupa por impresora solo los ítems con diferencia pendiente, SIN persistir', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT item_id, nombre FROM items'))
          return Promise.resolve([{ item_id: ING, nombre: 'Cebolla' }]);
        return Promise.resolve([
          {
            cuenta_linea_id: 'linea-1',
            cantidad: '3',
            cantidad_enviada: '1',
            nombre: 'Lomo a lo pobre',
            impresora_id: 'impresora-cocina',
            impresora_nombre: 'Cocina',
            personalizacion: SNAPSHOT,
          },
          {
            cuenta_linea_id: 'linea-2',
            cantidad: '2',
            cantidad_enviada: '2',
            nombre: 'Agua mineral',
            impresora_id: 'impresora-barra',
            impresora_nombre: 'Barra',
            personalizacion: null,
          },
          {
            cuenta_linea_id: 'linea-3',
            cantidad: '1',
            cantidad_enviada: '0',
            nombre: 'Postre sin ruta',
            impresora_id: null,
            impresora_nombre: null,
            personalizacion: null,
          },
        ]);
      });

      const result = await service.previewComanda(TENANT, CUENTA);

      expect(result.estaciones).toEqual([
        {
          impresoraId: 'impresora-cocina',
          nombre: 'Cocina',
          items: [
            {
              cuentaLineaId: 'linea-1',
              nombre: 'Lomo a lo pobre',
              cantidad: '2',
              cantidadEnviada: '3',
              nota: 'Sin Cebolla · sin cebolla',
            },
          ],
        },
      ]);
      // preview NO persiste nada
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequest si la cuenta no está abierta', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(service.previewComanda(TENANT, CUENTA)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza NotFound si la cuenta no pertenece al tenant', async () => {
      cuentaRepo.findOne.mockResolvedValue(null);
      await expect(service.previewComanda(TENANT, CUENTA)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reclamarComanda', () => {
    it('avanza cantidad_enviada y devuelve estaciones en un solo claim', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.query
        .mockResolvedValueOnce([
          {
            cuenta_linea_id: 'linea-1',
            cantidad: '3',
            cantidad_enviada: '1',
            nombre: 'Lomo a lo pobre',
            impresora_id: 'impresora-cocina',
            impresora_nombre: 'Cocina',
          },
        ])
        .mockResolvedValueOnce(undefined); // UPDATE cantidad_enviada

      const result = await service.reclamarComanda(TENANT, CUENTA);

      expect(result.estaciones).toHaveLength(1);
      expect(result.estaciones[0].items[0].cantidad).toBe('2');
      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FOR UPDATE OF cl'),
        [CUENTA, TENANT],
      );
      expect(manager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SET cantidad_enviada'),
        ['3', 'linea-1', TENANT],
      );
    });

    it('segundo claim sobre la misma cuenta sin pendientes: estaciones vacías', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.query.mockResolvedValueOnce([
        {
          cuenta_linea_id: 'linea-1',
          cantidad: '3',
          cantidad_enviada: '3',
          nombre: 'Lomo',
          impresora_id: 'impresora-cocina',
          impresora_nombre: 'Cocina',
        },
      ]);

      const result = await service.reclamarComanda(TENANT, CUENTA);

      expect(result.estaciones).toEqual([]);
      expect(manager.query).toHaveBeenCalledTimes(1); // solo SELECT, sin UPDATE
    });
  });

  describe('confirmarComanda', () => {
    it('marca cantidad_enviada solo para las líneas impresas', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });

      await service.confirmarComanda(TENANT, CUENTA, {
        lineas: [{ cuentaLineaId: 'linea-1', cantidadEnviada: '3' }],
      });

      expect(manager.update).toHaveBeenCalledWith(
        CuentaLinea,
        { id: 'linea-1', tenantId: TENANT },
        { cantidadEnviada: '3' },
      );
    });

    it('lanza BadRequest si la cuenta no está abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(
        service.confirmarComanda(TENANT, CUENTA, { lineas: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
