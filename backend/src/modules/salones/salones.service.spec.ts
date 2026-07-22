import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalonesService } from './salones.service';
import { CuentaAsignacionesService } from './cuenta-asignaciones.service';
import { Salon } from './entities/salon.entity';
import { Mesa } from './entities/mesa.entity';
import { Cuenta, EstadoCuenta } from './entities/cuenta.entity';
import { CuentaLinea } from './entities/cuenta-linea.entity';
import { VentasService } from '../ventas/ventas.service';
import { GarzonesService } from '../garzones/garzones.service';
import { ItemsService } from '../items/items.service';
import { CatalogService } from '../catalog/catalog.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';

const UNIDADES_CATALOGO = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
];

const TENANT = 'tenant-uuid';
const USUARIO = 'usuario-uuid';
const MESA = 'mesa-uuid';
const CUENTA = 'cuenta-uuid';
const ITEM = 'item-uuid';
const RECETA = 'receta-uuid';
const COMBO = 'combo-uuid';
const GRUPO = 'grupo-uuid';
const OPCION_ITEM = 'opcion-item-uuid';
const ING = 'ing-uuid';
const GARZON = 'garzon-uuid';
const PIN = '111111';
const SESION_RESPONSABLE = 'sesion-responsable';
const TURNO = 'turno-uuid';
const GARZON_RESPONSABLE = 'garzon-responsable';

const SNAPSHOT = {
  omitidos: [ING],
  extras: [],
  comentario: 'sin cebolla',
};

const SNAPSHOT_COMBO = {
  omitidos: [],
  extras: [],
  grupos: [
    {
      grupoId: GRUPO,
      grupoNombre: 'Bebida',
      opciones: [
        {
          itemId: OPCION_ITEM,
          nombre: 'Coca-Cola',
          cantidad: '1',
          precioExtra: '1500',
          unidades: '1',
        },
      ],
    },
  ],
};

const SNAPSHOT_EXTRA = {
  omitidos: [],
  extras: [
    {
      ingredienteItemId: ING,
      cantidad: '1',
      unidadCodigo: 'unidad',
      precioExtra: '500',
      unidades: '3',
    },
  ],
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
  let sesiones: {
    assertSesionAbierta: jest.Mock;
    obtenerSesionAbierta: jest.Mock;
  };
  let asignaciones: {
    registrarApertura: jest.Mock;
    cerrarTramoVigente: jest.Mock;
    transferirPorPin: jest.Mock;
    transferirAdmin: jest.Mock;
    listar: jest.Mock;
  };
  let items: {
    resolverPersonalizacionReceta: jest.Mock;
    resolverPersonalizacionCombo: jest.Mock;
  };
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
    sesiones = {
      assertSesionAbierta: jest.fn().mockResolvedValue(undefined),
      obtenerSesionAbierta: jest.fn().mockResolvedValue({
        id: SESION_RESPONSABLE,
        turnoId: TURNO,
        tipoGarzon: TipoGarzon.GARZON,
      }),
    };
    asignaciones = {
      registrarApertura: jest.fn().mockResolvedValue(undefined),
      cerrarTramoVigente: jest.fn().mockResolvedValue(undefined),
      transferirPorPin: jest.fn(),
      transferirAdmin: jest.fn(),
      listar: jest.fn(),
    };
    items = {
      resolverPersonalizacionReceta: jest.fn().mockResolvedValue({
        snapshot: SNAPSHOT,
        precioExtraTotal: '0.0000',
      }),
      resolverPersonalizacionCombo: jest.fn().mockResolvedValue({
        snapshot: SNAPSHOT_COMBO,
        precioExtraTotal: '1500.0000',
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
        { provide: SesionesGarzonService, useValue: sesiones },
        { provide: CuentaAsignacionesService, useValue: asignaciones },
        { provide: ItemsService, useValue: items },
        {
          provide: CatalogService,
          useValue: {
            findAllUnidadesMedida: jest
              .fn()
              .mockResolvedValue(UNIDADES_CATALOGO),
          },
        },
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
      expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(TENANT, GARZON);
    });

    it('abrirCuenta rechaza si el garzón no tiene sesión abierta', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      sesiones.assertSesionAbierta.mockRejectedValue(
        new BadRequestException(
          'El garzón no tiene una sesión de trabajo abierta',
        ),
      );
      await expect(
        service.abrirCuenta(TENANT, MESA, { pin: PIN }),
      ).rejects.toThrow(BadRequestException);
      expect(manager.create).not.toHaveBeenCalled();
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

    it('asigna responsable = apertura y registra tramo APERTURA', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query
        .mockResolvedValueOnce([{ mesa_id: MESA }])
        .mockResolvedValueOnce([{ next: '1' }]);
      manager.save.mockImplementation(
        (_e: unknown, row: Record<string, unknown>) =>
          Promise.resolve({ ...row, id: CUENTA }),
      );

      await service.abrirCuenta(TENANT, MESA, { pin: PIN });

      expect(manager.create).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          garzonAperturaId: GARZON,
          garzonResponsableId: GARZON,
        }),
      );
      expect(asignaciones.registrarApertura).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ id: CUENTA }),
        GARZON,
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
        garzonResponsableId: 'garzon-destino',
      };
      const cuentaB = {
        id: CUENTA_B,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 3,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: 'garzon-origen',
        cerradaEl: null as Date | null,
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
          if (
            opts.where.itemId === 'item-1' &&
            opts.where.cuentaId === CUENTA_A
          )
            return Promise.resolve(lineaExistenteDestino);
          return Promise.resolve(null);
        },
      );
      manager.find.mockImplementation(
        (
          entity: unknown,
          opts?: { where?: { cuentaId?: string; itemId?: string } },
        ) => {
          if (entity === Cuenta) return Promise.resolve([cuentaB, cuentaA]);
          if (entity === CuentaLinea) {
            if (opts?.where?.cuentaId === CUENTA_B)
              return Promise.resolve([
                lineaOrigenMismoItem,
                lineaOrigenOtroItem,
              ]);
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
      expect(cuentaB.cerradaEl).toBeInstanceOf(Date);
      expect(manager.save).toHaveBeenCalledWith(Cuenta, cuentaB);
      expect(asignaciones.cerrarTramoVigente).toHaveBeenCalledWith(
        manager,
        TENANT,
        CUENTA_B,
        cuentaB.cerradaEl,
      );
      expect(cuentaA.garzonResponsableId).toBe('garzon-destino');
      expect(result.id).toBe(CUENTA_A);
      expect(manager.find).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT,
            mesaId: MESA,
            estado: EstadoCuenta.ABIERTA,
          }),
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('mantiene dos líneas si mismo itemId pero distinta personalización', async () => {
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
        numero: 2,
        estado: EstadoCuenta.ABIERTA,
      };
      const lineaDestinoSinPerso = {
        id: 'linea-a1',
        tenantId: TENANT,
        cuentaId: CUENTA_A,
        itemId: 'item-1',
        cantidad: '1',
        cantidadEnviada: '0',
        personalizacion: null,
      };
      const lineaOrigenConPerso = {
        id: 'linea-b1',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-1',
        cantidad: '2',
        cantidadEnviada: '0',
        personalizacion: SNAPSHOT,
      };

      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation(
        (
          entity: unknown,
          opts?: { where?: { cuentaId?: string; itemId?: string } },
        ) => {
          if (entity === Cuenta) return Promise.resolve([cuentaA, cuentaB]);
          if (entity === CuentaLinea) {
            if (opts?.where?.cuentaId === CUENTA_B)
              return Promise.resolve([lineaOrigenConPerso]);
            if (
              opts?.where?.cuentaId === CUENTA_A &&
              opts?.where?.itemId === 'item-1'
            )
              return Promise.resolve([lineaDestinoSinPerso]);
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        },
      );
      manager.query.mockResolvedValue([]);

      await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: [CUENTA_A, CUENTA_B],
      });

      expect(lineaDestinoSinPerso.cantidad).toBe('1');
      expect(lineaOrigenConPerso.cuentaId).toBe(CUENTA_A);
      expect(manager.softDelete).not.toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({ id: 'linea-b1' }),
      );
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
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            { item_id: ITEM, tipo: 'producto', unidad_medida: 'kg' },
          ]);
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

    it('500 g sobre item kg → cantidad BD 0.5; detalle expone presentación', async () => {
      cuentaLineaRepo.find.mockResolvedValue([]);
      dataSource.manager.query.mockResolvedValueOnce([
        {
          cuenta_linea_id: 'linea-pres',
          item_id: ITEM,
          cantidad: '0.5',
          cantidad_presentacion: '500',
          unidad_codigo_presentacion: 'g',
          nombre: 'Harina',
          precio_base: '1000',
          moneda_id: 'moneda-1',
          personalizacion: null,
        },
      ]);

      const detalle = await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '999',
        cantidadPresentacion: '500',
        unidadCodigoPresentacion: 'g',
      });

      expect(cuentaLineaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cantidad: '0.5',
          cantidadPresentacion: '500',
          unidadCodigoPresentacion: 'g',
        }),
      );
      expect(detalle.lineas[0]).toMatchObject({
        cantidad: '0.5',
        cantidadPresentacion: '500',
        unidadCodigoPresentacion: 'g',
      });
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
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            { item_id: RECETA, tipo: 'receta', unidad_medida: null },
          ]);
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

    it('guarda personalización de grupos en combos (resolverPersonalizacionCombo, no receta)', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            { item_id: COMBO, tipo: 'combo', unidad_medida: null },
          ]);
        return Promise.resolve([]);
      });
      cuentaLineaRepo.find.mockResolvedValue([]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: COMBO,
        cantidad: '1',
        personalizacion: {
          grupos: [
            {
              grupoId: GRUPO,
              opciones: [{ itemId: OPCION_ITEM, unidades: 1 }],
            },
          ],
        },
      });

      expect(items.resolverPersonalizacionCombo).toHaveBeenCalled();
      expect(items.resolverPersonalizacionReceta).not.toHaveBeenCalled();
      expect(cuentaLineaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ personalizacion: SNAPSHOT_COMBO }),
      );
    });

    it('suma cantidad si misma personalización; crea línea nueva si difiere', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            { item_id: RECETA, tipo: 'receta', unidad_medida: null },
          ]);
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
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
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
          propinaCierreMesa: expect.objectContaining({
            montoPagado: '0',
            montoSugerido: '0',
            porcentajeSugerido: '0.10',
            garzonId: GARZON_RESPONSABLE,
            sesionGarzonId: SESION_RESPONSABLE,
            turnoId: TURNO,
            tipoGarzon: TipoGarzon.GARZON,
            estrategia: 'no_vuelto',
          }),
        }),
      );
      expect(sesiones.obtenerSesionAbierta).toHaveBeenCalledWith(
        TENANT,
        GARZON_RESPONSABLE,
      );
      expect(result.ventaId).toBe('venta-1');
      expect(cuenta.estado).toBe(EstadoCuenta.CERRADA);
      expect(cuenta.ventaId).toBe('venta-1');
      expect((cuenta as { garzonCierreId?: string }).garzonCierreId).toBe(
        GARZON,
      );
      expect(cuenta.garzonResponsableId).toBe(GARZON_RESPONSABLE);
      expect(asignaciones.cerrarTramoVigente).toHaveBeenCalledWith(
        manager,
        TENANT,
        CUENTA,
        cuenta.cerradaEl,
      );
      expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(TENANT, GARZON);
    });

    it('reenvía personalizacion.grupos a la venta cuando la línea tiene un combo con grupos', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([
        { itemId: COMBO, cantidad: '1', personalizacion: SNAPSHOT_COMBO },
      ]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        pin: PIN,
        pagos: [{ metodoPagoId: 'mp-1', monto: '1500' }],
      });

      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          lineas: [
            expect.objectContaining({
              itemId: COMBO,
              cantidad: '1',
              personalizacion: expect.objectContaining({
                grupos: [
                  {
                    grupoId: GRUPO,
                    opciones: [{ itemId: OPCION_ITEM, unidades: 1 }],
                  },
                ],
              }),
            }),
          ],
        }),
      );
    });

    it('preserva las unidades de un extra al reconstruir la venta al cerrar', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([
        { itemId: ITEM, cantidad: '1', personalizacion: SNAPSHOT_EXTRA },
      ]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        pin: PIN,
        pagos: [{ metodoPagoId: 'mp-1', monto: '500' }],
      });

      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          lineas: [
            expect.objectContaining({
              personalizacion: expect.objectContaining({
                extras: [{ ingredienteItemId: ING, unidades: 3 }],
              }),
            }),
          ],
        }),
      );
    });

    it('pasa propinaCierreMesa con el monto y el garzón responsable', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-2' });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        pin: PIN,
        propinaMonto: '1500',
        propinaSugerida: '1200',
        propinaPorcentajeSugerido: '0.10',
        pagos: [{ metodoPagoId: 'mp-1', monto: '11500' }],
      });

      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          propinaCierreMesa: expect.objectContaining({
            montoPagado: '1500',
            montoSugerido: '1200',
            porcentajeSugerido: '0.10',
            garzonId: GARZON_RESPONSABLE,
            sesionGarzonId: SESION_RESPONSABLE,
            turnoId: TURNO,
            tipoGarzon: TipoGarzon.GARZON,
            estrategia: 'no_vuelto',
          }),
        }),
      );
    });

    it('pasa sesion/turno/tipo del responsable al crear venta', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-3' });
      sesiones.obtenerSesionAbierta.mockResolvedValueOnce({
        id: 's1',
        turnoId: 'tu1',
        tipoGarzon: TipoGarzon.COCINA,
      });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        pin: PIN,
        propinaMonto: '500',
        pagos: [{ metodoPagoId: 'mp-1', monto: '4000' }],
      });

      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          propinaCierreMesa: expect.objectContaining({
            garzonId: GARZON_RESPONSABLE,
            sesionGarzonId: 's1',
            turnoId: 'tu1',
            tipoGarzon: TipoGarzon.COCINA,
          }),
        }),
      );
    });

    it('rechaza propina negativa', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: GARZON_RESPONSABLE,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          pin: PIN,
          propinaMonto: '-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('rechaza cerrar sin garzón responsable', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: null,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, { pin: PIN }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('cerrarCuenta rechaza si el garzón no tiene sesión abierta', async () => {
      sesiones.assertSesionAbierta.mockRejectedValue(
        new BadRequestException(
          'El garzón no tiene una sesión de trabajo abierta',
        ),
      );
      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, { pin: PIN }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
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
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.query.mockResolvedValue([]);

      const result = await service.cancelarCuenta(TENANT, CUENTA);

      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          where: { id: CUENTA, tenantId: TENANT },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(cuenta.estado).toBe(EstadoCuenta.CANCELADA);
      expect(cuenta.cerradaEl).toBeInstanceOf(Date);
      expect(result.estado).toBe(EstadoCuenta.CANCELADA);
      expect(manager.save).toHaveBeenCalledWith(Cuenta, cuenta);
      expect(asignaciones.cerrarTramoVigente).toHaveBeenCalledWith(
        manager,
        TENANT,
        CUENTA,
        cuenta.cerradaEl,
      );
      expect(cuentaRepo.save).not.toHaveBeenCalled();
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });
  });

  describe('armarDetalle / responsable', () => {
    it('devuelve ID/nombre del responsable aunque el garzón esté soft-deleted', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.find.mockResolvedValue([
        {
          id: CUENTA,
          numero: 1,
          nombre: null,
          estado: EstadoCuenta.ABIERTA,
          mesaId: MESA,
          ventaId: null,
          garzonAperturaId: GARZON,
          garzonResponsableId: GARZON,
          garzonCierreId: null,
        },
      ]);
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) return Promise.resolve([]);
        if (sql.includes('FROM garzones')) {
          expect(sql).not.toMatch(/eliminado_el\s+IS\s+NULL/i);
          return Promise.resolve([{ garzon_id: GARZON, nombre: 'Ana Torres' }]);
        }
        return Promise.resolve([]);
      });

      const [detalle] = await service.listarCuentasDeMesa(TENANT, MESA);

      expect(detalle.garzonResponsableId).toBe(GARZON);
      expect(detalle.garzonResponsableNombre).toBe('Ana Torres');
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

  describe('transferirCuentaPorPin', () => {
    it('delega en CuentaAsignacionesService y devuelve CuentaDetalle con responsable', async () => {
      const cuentaTransferida = {
        id: CUENTA,
        tenantId: TENANT,
        numero: 1,
        nombre: null,
        estado: EstadoCuenta.ABIERTA,
        mesaId: MESA,
        ventaId: null,
        garzonAperturaId: GARZON,
        garzonResponsableId: 'garzon-nuevo',
        garzonCierreId: null,
      };
      asignaciones.transferirPorPin.mockResolvedValue(cuentaTransferida);
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) return Promise.resolve([]);
        if (sql.includes('FROM garzones')) {
          return Promise.resolve([
            { garzon_id: GARZON, nombre: 'Ana Torres' },
            { garzon_id: 'garzon-nuevo', nombre: 'Pedro López' },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.transferirCuentaPorPin(TENANT, CUENTA, PIN);

      expect(asignaciones.transferirPorPin).toHaveBeenCalledWith(
        TENANT,
        CUENTA,
        PIN,
      );
      expect(result.garzonResponsableId).toBe('garzon-nuevo');
      expect(result.garzonResponsableNombre).toBe('Pedro López');
    });
  });

  describe('transferirCuentaAdmin', () => {
    it('delega en CuentaAsignacionesService y devuelve CuentaDetalle con responsable', async () => {
      const cuentaTransferida = {
        id: CUENTA,
        tenantId: TENANT,
        numero: 2,
        nombre: 'Mesa VIP',
        estado: EstadoCuenta.ABIERTA,
        mesaId: MESA,
        ventaId: null,
        garzonAperturaId: GARZON,
        garzonResponsableId: 'garzon-admin',
        garzonCierreId: null,
      };
      asignaciones.transferirAdmin.mockResolvedValue(cuentaTransferida);
      dataSource.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) return Promise.resolve([]);
        if (sql.includes('FROM garzones')) {
          return Promise.resolve([
            { garzon_id: GARZON, nombre: 'Ana Torres' },
            { garzon_id: 'garzon-admin', nombre: 'Carlos Ruiz' },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.transferirCuentaAdmin(
        TENANT,
        USUARIO,
        CUENTA,
        'garzon-admin',
      );

      expect(asignaciones.transferirAdmin).toHaveBeenCalledWith(
        TENANT,
        USUARIO,
        CUENTA,
        'garzon-admin',
      );
      expect(result.garzonResponsableId).toBe('garzon-admin');
      expect(result.garzonResponsableNombre).toBe('Carlos Ruiz');
    });
  });

  describe('listarAsignacionesCuenta', () => {
    it('delega en CuentaAsignacionesService.listar', async () => {
      const historial = [
        {
          id: 'asig-1',
          garzonId: GARZON,
          garzonNombre: 'Ana Torres',
          desdeEl: new Date('2026-07-16T10:00:00Z'),
          hastaEl: null,
          motivo: 'apertura',
          origenGarzonId: null,
          origenGarzonNombre: null,
          actorUsuarioId: null,
          actorUsuarioNombre: null,
        },
      ];
      cuentaRepo.findOne.mockResolvedValue({ id: CUENTA, tenantId: TENANT });
      asignaciones.listar.mockResolvedValue(historial);

      const result = await service.listarAsignacionesCuenta(TENANT, CUENTA);

      expect(cuentaRepo.findOne).toHaveBeenCalledWith({
        where: { id: CUENTA, tenantId: TENANT },
      });
      expect(asignaciones.listar).toHaveBeenCalledWith(TENANT, CUENTA);
      expect(result).toEqual(historial);
    });

    it('lanza NotFound si la cuenta no existe o pertenece a otro tenant', async () => {
      cuentaRepo.findOne.mockResolvedValue(null);

      await expect(
        service.listarAsignacionesCuenta(TENANT, CUENTA),
      ).rejects.toThrow(NotFoundException);
      expect(asignaciones.listar).not.toHaveBeenCalled();
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
