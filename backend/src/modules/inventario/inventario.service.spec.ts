// backend/src/modules/inventario/inventario.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { type EntityManager } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { InventarioService } from './inventario.service';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import { CatalogService } from '../catalog/catalog.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';

const TENANT = 'tenant-uuid';
const ITEM_ID = 'item-uuid';
const USER_ID = 'user-uuid';
const UNIDAD_1 = 'unidad-uuid-1';
const UNIDAD_2 = 'unidad-uuid-2';
const LOTE_ID = 'lote-uuid-1';
const MOTIVO_BAJA_ID = 'motivo-baja-uuid';
const MOTIVO_DIFERENCIA_ID = 'motivo-diferencia-uuid';
const CUENTA_LINEA_ANULACION_ID = 'cuenta-linea-anulacion-uuid';
const UBICACION_ID = 'ubicacion-local-uuid';

describe('InventarioService', () => {
  let service: InventarioService;
  let managerMock: { query: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let catalogService: { convertirUnidad: jest.Mock };
  let ubicacionesService: {
    localDe: jest.Mock;
    bloquearContraBorrado: jest.Mock;
  };

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    dataSource = { query: jest.fn(), transaction: jest.fn() };
    catalogService = { convertirUnidad: jest.fn() };
    ubicacionesService = {
      localDe: jest.fn().mockResolvedValue(UBICACION_ID),
      bloquearContraBorrado: jest.fn().mockResolvedValue(undefined),
    };
    // Delega en `dataSource.*` en el momento de la llamada: varios tests de
    // `registrarAjusteCosto` reasignan `dataSource.transaction` DESPUÉS de
    // compilar el módulo, y `Db.transaccion` tiene que ver ese reemplazo.
    const dbMock = {
      transaccion: (work: (m: unknown) => unknown) =>
        dataSource.transaction(work),
      query: (sql: string, params?: unknown[]) => dataSource.query(sql, params),
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventarioService,
        { provide: getRepositoryToken(MovimientoInventario), useValue: {} },
        { provide: Db, useValue: dbMock },
        { provide: CatalogService, useValue: catalogService },
        { provide: UbicacionesService, useValue: ubicacionesService },
      ],
    }).compile();

    service = module.get<InventarioService>(InventarioService);
  });

  // ---------------------------------------------------------------------------
  // El chokepoint acota por tenant contra el padre
  //
  // `item_producto` no tiene `tenant_id` (es extensión de `items` con PK
  // compartida), así que el único acote posible es el JOIN al padre. Estos tests
  // no prueban un bug alcanzable: los 16 llamadores de `registrarMovimiento`
  // validan el ítem contra el tenant antes de llamar, así que hoy es **defensa en
  // profundidad**. Lo que fijan es que siga estando el día que aparezca el
  // llamador 17.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // La ubicación, contra su borrado
  //
  // `UbicacionesService.remove` toma `FOR UPDATE` sobre la ubicación antes de
  // contar su saldo; este `FOR SHARE` es la otra mitad del par. Va ANTES del
  // lock de `item_producto`: el mismo orden que el traslado (§15).
  // Red de la carrera: `test/ajuste-borrado-ubicacion-concurrente.e2e-spec.ts`.
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — lock sobre la ubicación', () => {
    const params = {
      tenantId: TENANT,
      itemId: ITEM_ID,
      ubicacionId: UBICACION_ID,
      tipo: 'entrada' as const,
      motivo: 'compra',
      cantidad: '5',
      usuarioId: USER_ID,
    };

    it('bloquea la ubicación del movimiento ANTES del lock de item_producto', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce([{ stock: '10' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        params,
      );

      expect(ubicacionesService.bloquearContraBorrado).toHaveBeenCalledWith(
        managerMock,
        TENANT,
        UBICACION_ID,
      );
      const ordenLockUbicacion =
        ubicacionesService.bloquearContraBorrado.mock.invocationCallOrder[0];
      const ordenLockItem = managerMock.query.mock.invocationCallOrder[0];
      expect(ordenLockUbicacion).toBeLessThan(ordenLockItem);
      expect(managerMock.query.mock.calls[0][0]).toContain('FOR UPDATE OF ip');
    });

    it('si la ubicación ya está borrada, no toca item_producto ni escribe nada', async () => {
      ubicacionesService.bloquearContraBorrado.mockRejectedValueOnce(
        new NotFoundException('Ubicación no encontrada'),
      );

      await expect(
        service.registrarMovimiento(
          managerMock as unknown as EntityManager,
          params,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(managerMock.query).not.toHaveBeenCalled();
    });
  });

  describe('registrarMovimiento — acote por tenant en el lock', () => {
    function lockQuery(): [string, unknown[]] {
      return managerMock.query.mock.calls[0] as [string, unknown[]];
    }

    it('el SELECT del lock recibe el tenant como parámetro, no solo el item', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        },
      );

      // La aserción fuerte es por VALOR de los parámetros: sacar el
      // `AND i.tenant_id = $2` deja el array sin TENANT y esto falla por su
      // propia comparación, no por un match de texto sobre el SQL.
      // Sin `UBICACION_ID`: el statement del lock ya no lee el saldo, así que
      // no necesita la ubicación. Esa la lleva el statement de abajo.
      const [sql, params] = lockQuery();
      expect(params).toEqual([ITEM_ID, TENANT]);
      expect(sql).toContain('i.tenant_id = $2');
    });

    it('lockea solo `item_producto`, no la fila de `items` que usa para acotar', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        },
      );

      // `FOR UPDATE` a secas lockearía también `items`: huella de locks nueva en
      // el camino más caliente del sistema, que es donde la auditoría del
      // 2026-08-15 encontró deadlocks por orden de bloqueo. El `OF ip` no es
      // estilo.
      //
      // Anclado al final y no `toContain`: la regresión que este test dice
      // prevenir es volver a lockear `items`, y eso se escribe
      // `FOR UPDATE OF ip, i` — que **contiene** `FOR UPDATE OF ip` y satisfaría
      // un `toContain`. Un test cuyo nombre promete lo que su aserción no puede
      // sostener es peor que no tenerlo.
      const [sql] = lockQuery();
      expect(sql.trimEnd()).toMatch(/FOR UPDATE OF ip$/);
    });
  });

  // ---------------------------------------------------------------------------
  // stock_ubicacion (`docs/features/bodegas-y-traslados.md`,
  // «Entity & Database»): único dueño del saldo.
  // `item_producto.stock` se borró — el chokepoint escribe acá y solo acá.
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — stock_ubicacion (único dueño del saldo)', () => {
    it('escribe el saldo en stock_ubicacion', async () => {
      // El fixture usa 7 y 3 —no 1 y 1— a propósito: con factores iguales, un
      // mutante que sume donde debe restar sobrevive.
      managerMock.query
        .mockResolvedValueOnce([
          {
            modo_inventario: 'cantidad',
            costo_actual: '100',
            item_nombre: 'Carne',
            item_eliminado_el: null,
          },
        ])
        .mockResolvedValueOnce([{ stock: '7' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-stock-ubicacion' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '3',
          usuarioId: USER_ID,
        },
      );

      const upserts = managerMock.query.mock.calls
        .map((c) => c[0] as string)
        .filter((sql) => /INSERT INTO stock_ubicacion/.test(sql));
      expect(upserts).toHaveLength(1);
      // El parámetro, no el SQL: un `toContain` sobre el texto matchea también
      // el comentario de la consulta.
      const params = managerMock.query.mock.calls.find((c) =>
        /INSERT INTO stock_ubicacion/.test(c[0] as string),
      )![1] as string[];
      expect(params).toEqual(
        expect.arrayContaining(['4', ITEM_ID, UBICACION_ID]),
      );
    });

    it('rechaza un movimiento sin ubicacionId', async () => {
      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: '',
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(/ubicaci/i);

      // El guard corta ANTES del lock: ni siquiera llega a leer item_producto.
      expect(managerMock.query).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Modo 'cantidad' (comportamiento original)
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo cantidad', () => {
    it('entrada: suma al stock y registra el movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'cantidad' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]); // INSERT movimiento

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        },
      );

      expect(res).toEqual({
        movimientoId: 'mov-1',
        stockAnterior: '10',
        stockResultante: '15',
        cantidadMovida: '5',
        costoActualPrevio: null,
        costoActual: null,
      });
      // La 3ª llamada es el upsert de stock_ubicacion con el nuevo saldo
      // (1ª el lock, 2ª el saldo)
      expect(managerMock.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO stock_ubicacion'),
        expect.arrayContaining(['15', ITEM_ID, UBICACION_ID]),
      );
    });

    it('salida: resta del stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-2' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '4',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        },
      );

      expect(res.stockResultante).toBe('6');
    });

    it('salida con stock insuficiente lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce([{ stock: '3' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '5',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('item sin fila item_producto lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // Ítem eliminado: solo lo que deshace algo, o lo que ya ocurrió de verdad
  //
  // Como los tests del acote por tenant de más arriba, esto es **defensa en
  // profundidad y no un bug alcanzable hoy**: se midió caller por caller y los
  // caminos que no son anulación/devolución/merma-por-anulación ya filtran
  // `eliminado_el IS NULL` aguas arriba —`items.ajustarStock` y
  // `create`/`update`, `inventario.registrarAjusteCosto` y `mermas.registrar`
  // cortan con 404; `recuentos.aplicar` descarta la línea; las recetas y
  // combos excluyen al ingrediente borrado de la expansión—. Lo que fijan
  // estos tests es la regla en el chokepoint, para el llamador que se agregue
  // mañana sin ese filtro.
  //
  // `merma` es la excepción con matices (spec `anular-plato-despachado` §4.3):
  // la allowlist la acepta sobre un eliminado porque
  // `ItemsService.consumirLineaAnulada` la necesita —el plato ya salió de
  // cocina—, pero `mermas.registrar`, el único otro llamador con este motivo,
  // sigue rechazando por su cuenta antes de llegar acá (404, ver su propio
  // service). Por eso ya no está en el `it.each` de motivos rechazados de
  // más abajo: tiene su propio test de aceptación, junto a `anulacion` y
  // `devolucion`.
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — ítem eliminado', () => {
    const BORRADO_EL = new Date('2026-08-16T10:00:00Z');

    /** Fila del statement del lock. El saldo ya no sale de acá: va aparte,
     * ver `saldoRow()`. */
    function lockRowEliminado() {
      return [
        {
          modo_inventario: 'cantidad',
          costo_actual: '100',
          item_nombre: 'Queso mantecoso',
          item_eliminado_el: BORRADO_EL,
        },
      ];
    }

    /** Fila del statement APARTE que lee el saldo, ya bajo el lock. */
    function saldoRow() {
      return [{ stock: '10' }];
    }

    it.each(['compra', 'recuento', 'ajuste_manual', 'venta'])(
      "rechaza el motivo '%s' sobre un ítem eliminado",
      async (motivo) => {
        managerMock.query.mockResolvedValueOnce(lockRowEliminado());

        await expect(
          service.registrarMovimiento(managerMock as unknown as EntityManager, {
            tenantId: TENANT,
            itemId: ITEM_ID,
            ubicacionId: UBICACION_ID,
            tipo: 'entrada',
            motivo,
            cantidad: '5',
            usuarioId: USER_ID,
            motivoDiferenciaId:
              motivo === 'recuento' ? MOTIVO_DIFERENCIA_ID : undefined,
          }),
        ).rejects.toThrow(BadRequestException);

        // No llegó a mover stock ni a insertar en el kardex: el guard corta
        // justo después del lock.
        expect(managerMock.query).toHaveBeenCalledTimes(1);
      },
    );

    it('el rechazo nombra el producto y dice que está eliminado, no el genérico del acote por tenant', async () => {
      managerMock.query.mockResolvedValueOnce(lockRowEliminado());

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(/Queso mantecoso.*eliminado/s);

      // El genérico existe para que un id de otro tenant sea indistinguible de
      // uno inexistente. Reusarlo acá mandaría a buscar un problema de permisos
      // donde hay un producto discontinuado.
      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.not.toThrow('El item no tiene control de stock');
    });

    it.each(['anulacion', 'devolucion'])(
      "acepta el motivo '%s' sobre un ítem eliminado: la venta existió y hay que poder cerrarla",
      async (motivo) => {
        managerMock.query
          .mockResolvedValueOnce(lockRowEliminado())
          .mockResolvedValueOnce(saldoRow()) // SELECT saldo, ya bajo el lock
          .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
          .mockResolvedValueOnce([{ movimiento_id: 'mov-repo' }]); // INSERT kardex

        const res = await service.registrarMovimiento(
          managerMock as unknown as EntityManager,
          {
            tenantId: TENANT,
            itemId: ITEM_ID,
            ubicacionId: UBICACION_ID,
            tipo: 'entrada',
            motivo,
            cantidad: '2',
            usuarioId: USER_ID,
          },
        );

        expect(res.stockResultante).toBe('12');
      },
    );

    it('acepta el motivo merma sobre un ítem eliminado: el plato ya salió de cocina y hay que poder anularlo', async () => {
      managerMock.query
        .mockResolvedValueOnce(lockRowEliminado())
        .mockResolvedValueOnce(saldoRow()) // SELECT saldo, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-merma-borrado' }]); // INSERT kardex

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        },
      );

      expect(res.stockResultante).toBe('8');
    });

    it('un ítem vivo no cambia: el guard solo mira `eliminado_el`', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          {
            modo_inventario: 'cantidad',
            costo_actual: null,
            item_nombre: 'Queso mantecoso',
            item_eliminado_el: null,
          },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ok' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('15');
    });
  });

  // ---------------------------------------------------------------------------
  // Modo 'serie'
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo serie', () => {
    it('entrada serie: inserta unidades, recalcula stock y registra movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '0' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([]) // SELECT series ya vivas del producto: ninguna
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }]) // INSERT unidad 1
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_2 }]) // INSERT unidad 2
        .mockResolvedValueOnce([{ cnt: '2' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined) // INSERT detalle 1
        .mockResolvedValueOnce(undefined); // INSERT detalle 2

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '2',
          usuarioId: USER_ID,
          series: [
            { serie: 'IMEI-001', condicion: 'nuevo' },
            { serie: 'IMEI-002', condicion: 'nuevo' },
          ],
        },
      );

      expect(res.stockResultante).toBe('2');
      expect(res.movimientoId).toBe('mov-s1');
    });

    /**
     * La serie es única por producto vivo (`uq_unidad_item_serie`). Estos dos
     * casos fijan el 400 y su mensaje; que el índice exista en la base y que los
     * cuatro caminos de la API lo respeten lo miden `test/esquema.e2e-spec.ts`,
     * `test/serie-unica-por-producto.e2e-spec.ts` y `test/compras.e2e-spec.ts`.
     */
    it('entrada serie: rechaza la serie que el producto ya tiene viva, y la nombra', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }])
        .mockResolvedValueOnce([{ stock: '1' }])
        .mockResolvedValueOnce([{ serie: 'IMEI-001' }]); // la serie ya está viva

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '2',
          usuarioId: USER_ID,
          series: [{ serie: 'IMEI-001' }, { serie: 'IMEI-002' }],
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Este producto ya tiene una unidad con la serie: IMEI-001',
        ),
      );

      // UNA consulta para las N series, y con la clave EXACTA del índice
      // —`item_id` + `serie`, sin `tenant_id`—: un guard que mirara una columna
      // de más dejaría pasar filas que el índice sí rechaza, y el 400 volvería a
      // ser el 500 que este chequeo existe para evitar.
      const [sql, params] = managerMock.query.mock.calls[2] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('serie = ANY($2)');
      expect(sql).toContain('item_id = $1');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(sql).not.toContain('tenant_id');
      expect(params).toEqual([ITEM_ID, ['IMEI-001', 'IMEI-002']]);
    });

    it('entrada serie: rechaza dos veces la misma serie en la misma tanda, sin consultar', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }])
        .mockResolvedValueOnce([{ stock: '0' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '2',
          usuarioId: USER_ID,
          series: [{ serie: 'IMEI-007' }, { serie: 'IMEI-007' }],
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Estas series vienen repetidas en la misma entrada: IMEI-007',
        ),
      );

      // Las dos filas todavía no existen, así que ningún índice puede verlas: es
      // un chequeo en memoria y no gasta la consulta.
      expect(managerMock.query).toHaveBeenCalledTimes(2);
    });

    it('entrada serie: lanza BadRequest si cantidad != series.length', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }])
        .mockResolvedValueOnce([{ stock: '0' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '3',
          usuarioId: USER_ID,
          series: [{ serie: 'IMEI-001' }, { serie: 'IMEI-002' }], // solo 2, pero cantidad=3
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida serie: cambia estado de unidades y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '2' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([
          {
            estado: 'disponible',
            item_id: ITEM_ID,
            tenant_id: TENANT,
            ubicacion_id: UBICACION_ID,
            serie: 'IMEI-001',
          },
        ]) // SELECT unidad
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s2' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          motivoBajaId: MOTIVO_BAJA_ID,
        },
      );

      expect(res.stockResultante).toBe('1');
    });

    it('salida serie sin unidadIds: auto-selecciona FIFO las unidades disponibles', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '2' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }]) // SELECT FIFO unidades
        .mockResolvedValueOnce([
          {
            estado: 'disponible',
            item_id: ITEM_ID,
            tenant_id: TENANT,
            ubicacion_id: UBICACION_ID,
            serie: 'IMEI-001',
          },
        ]) // SELECT unidad (validación)
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s3' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('1');
      // La 3ª query es el SELECT FIFO con ORDER BY creado_el ASC
      // (1ª el lock, 2ª el saldo). Por VALOR exacto de los parámetros —no
      // `arrayContaining`— para que un mutante que borre el filtro de
      // ubicación (la auto-selección tomaría una unidad de cualquier lado,
      // no solo de `params.ubicacionId`) falle acá.
      expect(managerMock.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('ORDER BY u.creado_el ASC'),
        [ITEM_ID, TENANT, UBICACION_ID, '1'],
      );
      const [fifoSql] = managerMock.query.mock.calls[2] as [string, unknown[]];
      expect(fifoSql).toMatch(/u\.ubicacion_id\s*=\s*\$3/);
    });

    it('salida serie sin unidadIds: lanza BadRequest si no hay suficientes disponibles', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '0' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([]); // SELECT FIFO unidades (0 disponibles)

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida serie: lanza BadRequest si unidad no está disponible', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }])
        .mockResolvedValueOnce([{ stock: '1' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([
          {
            estado: 'vendido',
            item_id: ITEM_ID,
            tenant_id: TENANT,
            ubicacion_id: UBICACION_ID,
            serie: 'IMEI-001',
          },
        ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida serie: lanza BadRequest si la unidad no pertenece al tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '1' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([
          // La unidad existe y está disponible, pero es de otro tenant: el
          // `unidadId` llega del body del cliente, así que este `if` es la
          // única defensa contra pedir la baja de una unidad ajena.
          {
            estado: 'disponible',
            item_id: ITEM_ID,
            tenant_id: 'otro-tenant-uuid',
          },
        ])
        // El resto de la cadena queda mockeada por si la validación de
        // pertenencia desaparece: así el test rojo lo dice la propia
        // aserción `rejects.toThrow` (nunca lanzó) y no un TypeError de un
        // mock incompleto más adelante en el flujo.
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-tenant-mutant' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(`Unidad ${UNIDAD_1} no pertenece al tenant`),
      );
    });

    it('salida serie: lanza BadRequest si la unidad no pertenece al item', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '1' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([
          // Mismo tenant, pero la unidad es de otro ítem.
          {
            estado: 'disponible',
            item_id: 'otro-item-uuid',
            tenant_id: TENANT,
          },
        ])
        // Igual que arriba: cadena completa para que un mutante que borre
        // esta validación falle por la propia aserción, no por un
        // TypeError río abajo.
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-item-mutant' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(`Unidad ${UNIDAD_1} no pertenece al item`),
      );
    });

    // -------------------------------------------------------------------------
    // Frente de bodegas y traslados: item_unidad.ubicacion_id — cada unidad
    // serializada sabe dónde está.
    // -------------------------------------------------------------------------
    const BODEGA_ID = 'ubicacion-bodega-uuid';

    it('la unidad nace en la ubicación del movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '0' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([]) // SELECT series ya vivas del producto: ninguna
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }]) // INSERT unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-bodega' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: BODEGA_ID,
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '1',
          usuarioId: USER_ID,
          series: [{ serie: 'IMEI-BODEGA' }],
        },
      );

      // Por VALOR de los parámetros, no por texto del SQL: el INSERT tiene
      // que llevar la ubicación del movimiento, no la del local por default.
      const insertUnidad = managerMock.query.mock.calls.find((c) =>
        /INSERT INTO item_unidad/.test(c[0] as string),
      )!;
      expect(insertUnidad[0]).toMatch(/ubicacion_id/);
      expect(insertUnidad[1]).toEqual(expect.arrayContaining([BODEGA_ID]));
    });

    it('una salida serie solo consume unidades de esa ubicación: 400 si el unidadId pedido está en otra', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '1' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([
          // La unidad existe, es del tenant y del item — pero está en la
          // bodega, y la salida se pide contra el local (UBICACION_ID).
          {
            estado: 'disponible',
            item_id: ITEM_ID,
            tenant_id: TENANT,
            ubicacion_id: BODEGA_ID,
            serie: 'IMEI-BODEGA',
          },
        ])
        .mockResolvedValueOnce([
          { ubicacion_id: BODEGA_ID, nombre: 'Bodega Subsuelo' },
          { ubicacion_id: UBICACION_ID, nombre: 'Local' },
        ]); // SELECT nombre de ambas ubicaciones, para el mensaje

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID, // el local
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'La unidad IMEI-BODEGA está en Bodega Subsuelo, no en Local',
        ),
      );
    });

    it('stock_ubicacion se recalcula contando solo las unidades de ESA ubicación', async () => {
      // El fixture entra 3 series al local. El COUNT que recalcula el saldo
      // tiene que filtrar por ubicación además de item+tenant: sin el
      // filtro, 3 en el local + 2 que hubiera en la bodega (fuera de este
      // test, cubierto por el e2e con datos reales) se mezclarían en un solo
      // número. Acá se fija la FORMA del filtro —SQL y parámetros exactos—,
      // no el resultado: con manager mockeado el COUNT no cuenta de verdad,
      // así que lo que discrimina un mutante que borra `AND ubicacion_id =
      // $3` es el propio texto/parámetros de la query, no el valor devuelto.
      // La prueba de comportamiento real (3 vs 2, saldo local = 3) vive en
      // `test/inventario-serie-ubicacion.e2e-spec.ts`.
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'serie' }])
        .mockResolvedValueOnce([{ stock: '0' }])
        .mockResolvedValueOnce([]) // SELECT series ya vivas del producto: ninguna
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }])
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_2 }])
        .mockResolvedValueOnce([{ unidad_id: 'unidad-uuid-3' }])
        .mockResolvedValueOnce([{ cnt: '3' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-recalculo' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '3',
          usuarioId: USER_ID,
          series: [
            { serie: 'IMEI-1' },
            { serie: 'IMEI-2' },
            { serie: 'IMEI-3' },
          ],
        },
      );

      const countCall = managerMock.query.mock.calls.find((c) =>
        /SELECT COUNT\(\*\) AS cnt FROM item_unidad/.test(c[0] as string),
      )!;
      expect(countCall[0]).toMatch(/ubicacion_id\s*=\s*\$3/);
      expect(countCall[1]).toEqual([ITEM_ID, TENANT, UBICACION_ID]);
    });
  });

  // ---------------------------------------------------------------------------
  // Modo 'lote'
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo lote', () => {
    it('entrada lote: crea lote nuevo y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '0' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([]) // SELECT lote existente (no existe)
        .mockResolvedValueOnce([{ lote_id: LOTE_ID }]) // INSERT lote
        .mockResolvedValueOnce([]) // SELECT saldo previo en esta ubicación (ninguno)
        .mockResolvedValueOnce(undefined) // INSERT/UPSERT lote_ubicacion
        .mockResolvedValueOnce([{ total: '50' }]) // SUM lote_ubicacion
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '50',
          usuarioId: USER_ID,
          lote: { codigoLote: 'LOTE-001', fechaVencimiento: '2027-01-01' },
        },
      );

      expect(res.stockResultante).toBe('50');
      const upsertCall = managerMock.query.mock.calls[5] as [string, unknown[]];
      expect(upsertCall[0]).toMatch(/INSERT INTO lote_ubicacion/);
      expect(upsertCall[1]).toEqual([LOTE_ID, UBICACION_ID, '50']);
    });

    // Discrimina el bug de "sumar sobre el saldo total del lote" en vez de
    // "sumar sobre el saldo de ESTA ubicación": el lote ya tenía 8 EN OTRA
    // ubicación (no reflejado acá porque la query que lee el saldo previo
    // está acotada por `ubicacion_id`) y esta entrada agrega 10 acá. Si el
    // código sumara sobre el total del lote, la ubicación quedaría en 18; el
    // valor correcto es 10 (0 previo en ESTA ubicación + 10).
    it('entrada lote: el saldo previo se lee de ESTA ubicación, no del total del lote', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }])
        .mockResolvedValueOnce([{ stock: '0' }])
        .mockResolvedValueOnce([{ lote_id: LOTE_ID }]) // lote existente
        .mockResolvedValueOnce(undefined) // UPDATE cantidad_inicial
        .mockResolvedValueOnce([]) // saldo previo EN ESTA ubicación: nada, aunque el lote tenga 8 en la bodega
        .mockResolvedValueOnce(undefined) // INSERT/UPSERT lote_ubicacion
        .mockResolvedValueOnce([{ total: '10' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l-existente' }])
        .mockResolvedValueOnce(undefined);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '10',
          usuarioId: USER_ID,
          lote: { codigoLote: 'LOTE-001' },
        },
      );

      expect(res.stockResultante).toBe('10');
      const saldoPrevioCall = managerMock.query.mock.calls[4] as [
        string,
        unknown[],
      ];
      expect(saldoPrevioCall[0]).toMatch(/ubicacion_id\s*=\s*\$2/);
      expect(saldoPrevioCall[1]).toEqual([LOTE_ID, UBICACION_ID]);
      const upsertCall = managerMock.query.mock.calls[5] as [string, unknown[]];
      expect(upsertCall[1]).toEqual([LOTE_ID, UBICACION_ID, '10']);
    });

    it('salida lote: descuenta del lote y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '50' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ tenant_id: TENANT, codigo_lote: 'LOTE-001' }]) // SELECT lote FOR UPDATE
        .mockResolvedValueOnce([{ cantidad: '50' }]) // SELECT saldo en esta ubicación
        .mockResolvedValueOnce(undefined) // INSERT/UPSERT lote_ubicacion
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l2' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        },
      );

      expect(res.stockResultante).toBe('40');
    });

    // Fixture asimétrico (5 en la bodega, 8 pedidos) a propósito: con
    // cantidades iguales un mutante que sumara el saldo del lote en TODAS
    // las ubicaciones (en vez de acotarlo a `ubicacionId`) sobreviviría —acá
    // el mock solo devuelve el saldo de ESTA ubicación, así que "8 pedidos >
    // 5 disponibles acá" es la única cuenta que el código puede hacer.
    it('salida lote (loteId): no saca más de lo que el lote tiene EN ESTA UBICACIÓN, aunque tenga más en otra', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }])
        .mockResolvedValueOnce([{ stock: '5' }])
        .mockResolvedValueOnce([
          { tenant_id: TENANT, codigo_lote: 'LOTE-BODEGA' },
        ])
        .mockResolvedValueOnce([{ cantidad: '5' }]); // saldo EN ESTA ubicación: 5, aunque el lote tenga más en otra

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '8',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Stock insuficiente del lote LOTE-BODEGA en esta ubicación (disponible: 5)',
        ),
      );

      const saldoCall = managerMock.query.mock.calls[3] as [string, unknown[]];
      expect(saldoCall[0]).toMatch(/FROM lote_ubicacion/);
      expect(saldoCall[0]).toMatch(/ubicacion_id\s*=\s*\$2/);
      expect(saldoCall[1]).toEqual([LOTE_ID, UBICACION_ID]);
    });

    it('salida lote sin loteId: auto-selecciona FIFO el lote más antiguo', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '50' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ lote_id: LOTE_ID, codigo_lote: 'LOTE-001' }]) // SELECT lotes FIFO FOR UPDATE
        .mockResolvedValueOnce([{ lote_id: LOTE_ID, cantidad: '50' }]) // saldos en esta ubicación
        .mockResolvedValueOnce(undefined) // INSERT/UPSERT lote_ubicacion
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l3' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '10',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('40');
      expect(managerMock.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('ORDER BY creado_el ASC'),
        expect.arrayContaining([ITEM_ID, TENANT]),
      );
    });

    // Fixture asimétrico (lote-A sin saldo acá, lote-B con 20 acá) para que
    // un mutante que ignorase el filtro por ubicación —y arrastrara lote-A
    // igual, como si su saldo en la OTRA ubicación contara acá— sobreviva
    // distinguible: el total correcto es 20 (solo lote-B), no más.
    it('salida lote sin loteId: excluye lotes sin saldo en esta ubicación aunque tengan saldo en otra', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }])
        .mockResolvedValueOnce([{ stock: '20' }])
        .mockResolvedValueOnce([
          { lote_id: 'lote-a', codigo_lote: 'LOTE-A' },
          { lote_id: 'lote-b', codigo_lote: 'LOTE-B' },
        ]) // ambos lockeados: son del mismo item
        // Solo lote-b tiene fila con saldo > 0 en esta ubicación: lote-a
        // existe (tiene saldo en la bodega, fuera de este mock) pero no
        // aparece acá.
        .mockResolvedValueOnce([{ lote_id: 'lote-b', cantidad: '20' }])
        .mockResolvedValueOnce(undefined) // INSERT/UPSERT lote_ubicacion (solo lote-b)
        .mockResolvedValueOnce([{ total: '5' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-fifo-excl' }])
        .mockResolvedValueOnce(undefined);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '15',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('5');
      // La lectura de saldos por ubicación consulta LOS DOS lotes lockeados
      // (lote-a incluido)... pero acotada por `ubicacion_id` EN EL PROPIO
      // SQL: sin ese filtro en el texto de la query, un mutante que lo
      // borrara no lo notaría este mock (los valores devueltos son los que
      // el test le dicta), así que la forma del SQL se afirma directo.
      const saldosCall = managerMock.query.mock.calls[3] as [string, unknown[]];
      expect(saldosCall[0]).toMatch(/ubicacion_id\s*=\s*\$1/);
      expect(saldosCall[1]).toEqual([UBICACION_ID, ['lote-a', 'lote-b']]);
      // ...pero el único UPSERT de consumo es sobre lote-b: lote-a, sin
      // saldo acá, no se toca.
      const upsertCalls = managerMock.query.mock.calls.filter((c) =>
        /INSERT INTO lote_ubicacion/.test(c[0] as string),
      );
      expect(upsertCalls).toHaveLength(1);
      expect((upsertCalls[0] as [string, unknown[]])[1]).toEqual([
        'lote-b',
        UBICACION_ID,
        '5',
      ]);
    });

    it('salida lote sin loteId: lanza BadRequest si el stock total es insuficiente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '5' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ lote_id: LOTE_ID, codigo_lote: 'LOTE-001' }])
        .mockResolvedValueOnce([{ lote_id: LOTE_ID, cantidad: '5' }]); // saldo en esta ubicación (5 < 10)

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '10',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida lote: lanza BadRequest si lote insuficiente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }])
        .mockResolvedValueOnce([{ stock: '5' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ tenant_id: TENANT, codigo_lote: 'LOTE-001' }])
        .mockResolvedValueOnce([{ cantidad: '5' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida lote: lanza BadRequest si el lote no pertenece al tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '50' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([
          // El lote existe con disponibilidad suficiente, pero es de otro
          // tenant: `loteId` llega del body del cliente, así que este `if` es
          // la única defensa contra descontar el lote de otro tenant.
          { tenant_id: 'otro-tenant-uuid', codigo_lote: 'LOTE-001' },
        ])
        // Cadena completa por si la validación de pertenencia desaparece: el
        // rojo lo tiene que dar la propia aserción `rejects.toThrow`, no un
        // TypeError de un mock incompleto más adelante en el flujo.
        .mockResolvedValueOnce([{ cantidad: '50' }]) // SELECT saldo en esta ubicación
        .mockResolvedValueOnce(undefined) // INSERT/UPSERT lote_ubicacion
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-lote-tenant-mutant' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('El lote no pertenece al tenant'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Motivo de baja
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — motivo baja', () => {
    it('motivo merma sin motivoBajaId lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '2',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('La merma requiere un motivo de baja'),
      );
    });

    it('motivo distinto de merma con motivoBajaId lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'ajuste_manual',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('motivo_baja_id solo aplica a merma'),
      );
    });

    it('motivo merma con motivoBajaId incluye motivo_baja_id en el INSERT', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-m1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        },
      );

      const insertCall = managerMock.query.mock.calls[3];
      expect(insertCall[0]).toContain('motivo_baja_id');
      expect(insertCall[1]).toContain(MOTIVO_BAJA_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // cuenta_linea_anulacion_id: trazabilidad hacia la anulación que generó el
  // consumo (parte 3). Solo se escribe cuando la merma vino de anular un plato
  // ya despachado; nada la produce todavía, así que acá solo se prueba el
  // transporte del id.
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — cuenta_linea_anulacion_id', () => {
    it('motivo distinto de merma con cuentaLineaAnulacionId lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '2',
          usuarioId: USER_ID,
          cuentaLineaAnulacionId: CUENTA_LINEA_ANULACION_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'cuenta_linea_anulacion_id solo aplica a merma',
        ),
      );
    });

    it('motivo merma con motivoBajaId y cuentaLineaAnulacionId lleva el id en su posición en el INSERT', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-cla1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
          cuentaLineaAnulacionId: CUENTA_LINEA_ANULACION_ID,
        },
      );

      const insertCall = managerMock.query.mock.calls[3] as [string, unknown[]];
      const columnas = insertCall[0]
        .match(/\(([^)]+)\)\s*VALUES/)![1]
        .split(',')
        .map((c) => c.trim());
      const idx = columnas.indexOf('cuenta_linea_anulacion_id');
      expect(idx).toBeGreaterThan(-1);
      expect(insertCall[1][idx]).toBe(CUENTA_LINEA_ANULACION_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // permiteSalidaParcial: la anulación de un plato despachado (parte 2, ronda
  // de fixes 1, owner) descuenta lo que hay en vez de abortar. Solo aplica en
  // modo `cantidad` — es el único modo donde "la mitad de lo pedido" tiene
  // sentido.
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — permiteSalidaParcial', () => {
    it('motivo distinto de merma con permiteSalidaParcial lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '2',
          usuarioId: USER_ID,
          permiteSalidaParcial: true,
        }),
      ).rejects.toThrow(
        new BadRequestException('permiteSalidaParcial solo aplica a merma'),
      );
    });

    it('permiteSalidaParcial en una entrada lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'merma',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
          permiteSalidaParcial: true,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'permiteSalidaParcial solo aplica a una salida',
        ),
      );
    });

    it('sin permiteSalidaParcial, stock insuficiente sigue lanzando (comportamiento por defecto sin cambios)', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '1' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '5',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('Stock insuficiente para la salida'),
      );
    });

    it('con permiteSalidaParcial y disponible 0, lanza sin escribir nada (ni INSERT de kardex, ni upsert de stock)', async () => {
      // Ronda de fixes 2, Important I-A: con `stockAnterior = 0` no hay "lo
      // que hay" que mover — clampar igual a 0 escribiría una merma de
      // cantidad 0 (viola "la cantidad debe ser mayor a cero", más arriba en
      // este mismo chokepoint) y un upsert de stock a 0 que no cambió nada.
      // Es el caso más común de una anulación sin stock, así que tiene que
      // comportarse como serie/lote: lanzar, y que `moverConsumoOSaltear` lo
      // trate como un salteo completo con aviso.
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '0' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '5',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
          permiteSalidaParcial: true,
        }),
      ).rejects.toThrow(
        new BadRequestException('Stock insuficiente para la salida'),
      );

      // Ni el upsert de stock_ubicacion ni el INSERT del kardex: se cortó en
      // el `throw`, antes de la primera escritura. Solo las dos lecturas de
      // arriba (lock + saldo).
      expect(managerMock.query).toHaveBeenCalledTimes(2);
    });

    it('con permiteSalidaParcial, descuenta lo que hay, deja el stock en 0 (nunca negativo) y devuelve cantidadMovida', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '1' }]) // disponible: 1, pedido: 5
        .mockResolvedValueOnce(undefined) // INSERT/UPDATE stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-parcial' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '5',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
          permiteSalidaParcial: true,
        },
      );

      expect(res.cantidadMovida).toBe('1');
      expect(res.stockResultante).toBe('0');

      // No hay lectura de stock nueva: sigue siendo UNA sola (la de arriba,
      // ya bajo el lock) antes del upsert — reusa `stockAnterior`.
      expect(managerMock.query).toHaveBeenCalledTimes(4);

      // El upsert de stock_ubicacion escribe 0, no un negativo.
      const upsertCall = managerMock.query.mock.calls[2] as [string, unknown[]];
      expect(upsertCall[1]).toEqual([ITEM_ID, UBICACION_ID, '0']);

      // El kardex registra lo que de verdad se movió (1), no lo pedido (5):
      // si guardara 5, la fila diría "salieron 5" con un stock_resultante que
      // solo bajó 1 desde stock_anterior 1 — un kardex que no cierra con su
      // propio saldo.
      const insertCall = managerMock.query.mock.calls[3] as [string, unknown[]];
      const columnas = insertCall[0]
        .match(/\(([^)]+)\)\s*VALUES/)![1]
        .split(',')
        .map((c) => c.trim());
      const idxCantidad = columnas.indexOf('cantidad');
      expect(insertCall[1][idxCantidad]).toBe('1');
    });

    it('con permiteSalidaParcial pero stock suficiente, se comporta como una salida normal', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-completo' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '3',
          usuarioId: USER_ID,
          motivoBajaId: MOTIVO_BAJA_ID,
          permiteSalidaParcial: true,
        },
      );

      expect(res.cantidadMovida).toBe('3');
      expect(res.stockResultante).toBe('7');
    });
  });

  // ---------------------------------------------------------------------------
  // Causa de diferencia (recuento)
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — motivo_diferencia_id', () => {
    it('motivo recuento sin motivoDiferenciaId lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'recuento',
          cantidad: '2',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'El recuento requiere una causa de diferencia tipificada',
        ),
      );
    });

    it('motivo distinto de recuento con motivoDiferenciaId lanza BadRequest', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'ajuste_manual',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoDiferenciaId: MOTIVO_DIFERENCIA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('motivo_diferencia_id solo aplica a recuento'),
      );
    });

    it('motivo recuento con motivoDiferenciaId incluye motivo_diferencia_id en el INSERT', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-r1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'recuento',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoDiferenciaId: MOTIVO_DIFERENCIA_ID,
        },
      );

      const insertCall = managerMock.query.mock.calls[3];
      expect(insertCall[0]).toContain('motivo_diferencia_id');
      expect(insertCall[1]).toContain(MOTIVO_DIFERENCIA_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // Costo (congelación en kardex)
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — costo', () => {
    it('entrada con costoUnitario y motivo compra: congela el costo y actualiza costo_actual', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ]) // SELECT FOR UPDATE
        // La ubicación del movimiento está vacía y el producto tiene 10 en
        // otra: el promedio pondera con el total, no con el saldo de acá.
        .mockResolvedValueOnce([{ stock: '0' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ item_id: ITEM_ID, stock: '10' }]) // SELECT stock total del producto
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-c1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
          costoUnitario: '4500',
        },
      );

      // El INSERT del movimiento (5ª llamada) congela lo PAGADO en el kardex: 4500
      const insertCall = managerMock.query.mock.calls[4];
      expect(insertCall[0]).toContain('costo_unitario');
      expect(insertCall[1]).toContain('4500');
      // La 6ª llamada actualiza costo_actual con el promedio ponderado (CPP), no
      // con el costo de compra crudo: (10×4000 + 5×4500) / 15 = 4166.6667.
      // '4500' era el bug dos veces: antes del CPP (último costo) y, después,
      // ponderando con el saldo de la ubicación (0 → rama "sin stock previo").
      expect(managerMock.query).toHaveBeenNthCalledWith(
        6,
        expect.stringContaining('costo_actual'),
        ['4166.6667', ITEM_ID],
      );
    });

    it('entrada ajuste_manual con costoUnitario: congela en kardex sin pisar costo_actual', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-c1b' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'ajuste_manual',
          cantidad: '5',
          usuarioId: USER_ID,
          costoUnitario: '4500',
        },
      );

      const insertCall = managerMock.query.mock.calls[3];
      expect(insertCall[1]).toContain('4500');
      expect(managerMock.query).toHaveBeenCalledTimes(4); // sin UPDATE costo_actual
    });

    it.each([['anulacion'], ['devolucion']])(
      'entrada %s con costoUnitario: recalcula el promedio incluyendo la unidad que vuelve',
      async (motivo) => {
        // Decisión del owner (2026-08-15): la mercadería que vuelve reingresa
        // al costo con el que SALIÓ, y el promedio se recalcula incluyéndola.
        // Antes solo `compra` recalculaba, así que el CPP quedaba intacto y el
        // inventario se valorizaba con unidades que nadie compró.
        managerMock.query
          .mockResolvedValueOnce([
            {
              modo_inventario: 'cantidad',
              costo_actual: '57.1429',
            },
          ])
          // 4 en la ubicación que repone, 14 en todo el producto.
          .mockResolvedValueOnce([{ stock: '4' }]) // SELECT saldo: statement aparte, ya bajo el lock
          .mockResolvedValueOnce([{ item_id: ITEM_ID, stock: '14' }]) // SELECT stock total del producto
          .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
          .mockResolvedValueOnce([{ movimiento_id: 'mov-rev' }])
          .mockResolvedValueOnce(undefined);

        await service.registrarMovimiento(
          managerMock as unknown as EntityManager,
          {
            tenantId: TENANT,
            itemId: ITEM_ID,
            ubicacionId: UBICACION_ID,
            tipo: 'entrada',
            motivo,
            cantidad: '1',
            usuarioId: USER_ID,
            costoUnitario: '50',
          },
        );

        // El kardex congela el costo real de la reposición, no el CPP vigente.
        expect(managerMock.query.mock.calls[4][1]).toContain('50');
        // (14 × 57,1429 + 1 × 50) / 15 = 56,6667. Con el saldo de la
        // ubicación (4) daba 55,7143.
        expect(managerMock.query).toHaveBeenNthCalledWith(
          6,
          expect.stringContaining('costo_actual'),
          ['56.6667', ITEM_ID],
        );
      },
    );

    it('entrada por anulación SIN costoUnitario no toca el promedio', async () => {
      // La salida original puede no tener costo congelado (un producto que
      // nunca tuvo costo). Ahí no hay nada que promediar: se repone la
      // cantidad y el CPP queda como estaba, en vez de inventar un número.
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '57.1429' },
        ])
        .mockResolvedValueOnce([{ stock: '14' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-rev2' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'anulacion',
          cantidad: '1',
          usuarioId: USER_ID,
        },
      );

      expect(managerMock.query).toHaveBeenCalledTimes(4); // sin UPDATE costo_actual
    });

    it('rechaza costoUnitario negativo', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
          costoUnitario: '-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('entrada con costoUnitario 0: lo acepta y lo promedia como costo real', async () => {
      // Decisión del owner (2026-08-29): mercadería de donación o muestra
      // cuesta 0 de verdad. Hasta entonces este mismo caso tiraba 400 ("El
      // costo unitario debe ser mayor a 0") y el 0 no era alcanzable por API.
      // El 0 entra al promedio como cualquier otro costo — que es la
      // diferencia con NO mandar costoUnitario, que deja el CPP intacto (test
      // 'entrada por anulación SIN costoUnitario' de arriba).
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ item_id: ITEM_ID, stock: '10' }]) // SELECT stock total del producto
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-donacion' }])
        .mockResolvedValueOnce(undefined);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
          costoUnitario: '0',
        },
      );

      // (10 × 4000 + 5 × 0) / 15 = 2666,6667.
      expect(managerMock.query).toHaveBeenNthCalledWith(
        6,
        expect.stringContaining('costo_actual'),
        ['2666.6667', ITEM_ID],
      );
    });

    it('el ajuste de costo con 0 NO se rechaza acá: este guard solo mira el signo', async () => {
      // Se intentó prohibir el 0 por motivo (`ajuste_costo`) y rompía un camino
      // legítimo: `ItemsService.update` reconvierte el costo al cambiar
      // `unidad_medida` con ESTE mismo motivo, así que un producto donado (costo
      // 0) no podía corregir su unidad. Lo que hay que atajar no es el motivo
      // sino el costo positivo que colapsa a 0 al convertirse, y eso se valida
      // donde está el valor de antes (`assertCostoNoColapsaACero`).
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-unidad' }])
        .mockResolvedValueOnce(undefined);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'ajuste',
          motivo: 'ajuste_costo',
          cantidad: '0',
          usuarioId: USER_ID,
          costoUnitario: '0.0000',
        },
      );

      expect(managerMock.query).toHaveBeenLastCalledWith(
        expect.stringContaining('costo_actual'),
        ['0.0000', ITEM_ID],
      );
    });

    it('salida sin costoUnitario: congela el costo_actual vigente y no lo modifica', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4200' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-c2' }]); // INSERT movimiento

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '3',
          usuarioId: USER_ID,
        },
      );

      // El INSERT congeló el costo vigente (4200) y no hubo UPDATE de costo_actual
      const insertCall = managerMock.query.mock.calls[3];
      expect(insertCall[1]).toContain('4200');
      expect(managerMock.query).toHaveBeenCalledTimes(4);
    });
  });

  // Compras (spec compras-recepcion § 3.4): la línea de compra en el kardex y
  // el ajuste de valor que deja "rehacer la cuenta".
  describe('registrarMovimiento — compras', () => {
    const LINEA = 'linea-uuid';

    it('la entrada compra lleva su línea en el kardex', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: null },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '0' }]) // SELECT saldo
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l1' }]); // INSERT movimiento

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '20',
          usuarioId: USER_ID,
          compraLineaId: LINEA,
        },
      );

      const insert = managerMock.query.mock.calls[3] as [string, unknown[]];
      expect(insert[0]).toContain('compra_linea_id');
      expect(insert[1][17]).toBe(LINEA);
    });

    it('correccion_compra pisa el costo, deja el anterior y no mueve stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '1000.0000' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '17' }]) // SELECT saldo
        .mockResolvedValueOnce([{ movimiento_id: 'mov-corr' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'ajuste',
          motivo: 'correccion_compra',
          cantidad: '0',
          usuarioId: USER_ID,
          costoUnitario: '1400',
          compraLineaId: LINEA,
        },
      );

      const insert = managerMock.query.mock.calls[2] as [string, unknown[]];
      // cantidad 0, stock anterior = resultante (no hubo movimiento de stock)
      expect(insert[1][5]).toBe('0');
      expect(insert[1][6]).toBe(insert[1][7]);
      // costo_anterior: el que había
      expect(insert[1][12]).toBe('1000.0000');
      expect(insert[1][17]).toBe(LINEA);
      expect(managerMock.query).toHaveBeenLastCalledWith(
        expect.stringContaining('costo_actual'),
        ['1400.0000', ITEM_ID],
      );
      // Sin UPSERT de stock_ubicacion: son cuatro consultas y ninguna lo toca.
      expect(managerMock.query).toHaveBeenCalledTimes(4);
      expect(
        managerMock.query.mock.calls.some(([sql]) =>
          /INSERT INTO stock_ubicacion/.test(sql as string),
        ),
      ).toBe(false);
    });

    it('correccion_compra sin costo deja el producto sin costo y congela null (owner, anular la única compra con costo)', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '1500.0000' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '5' }]) // SELECT saldo
        .mockResolvedValueOnce([{ movimiento_id: 'mov-sin-costo' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      const r = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'ajuste',
          motivo: 'correccion_compra',
          cantidad: '0',
          usuarioId: USER_ID,
          costoUnitario: null,
          compraLineaId: LINEA,
        },
      );

      const insert = managerMock.query.mock.calls[2] as [string, unknown[]];
      expect(insert[1][11]).toBeNull(); // costo_unitario: no el que borra
      expect(insert[1][12]).toBe('1500.0000'); // costo_anterior
      expect(managerMock.query).toHaveBeenLastCalledWith(
        expect.stringContaining('costo_actual'),
        [null, ITEM_ID],
      );
      expect(r.costoActual).toBeNull();
    });

    it('correccion_compra sin línea es 400', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '1000.0000' },
        ])
        .mockResolvedValueOnce([{ stock: '17' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'ajuste',
          motivo: 'correccion_compra',
          cantidad: '0',
          usuarioId: USER_ID,
          costoUnitario: '1400',
        }),
      ).rejects.toThrow(
        'La corrección de compra requiere la línea que la respalda',
      );
    });

    it('una línea de compra colgada de otro motivo es 400', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '1000.0000' },
        ])
        .mockResolvedValueOnce([{ stock: '17' }]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
          compraLineaId: LINEA,
        }),
      ).rejects.toThrow(
        'compra_linea_id solo aplica a compra y a correccion_compra',
      );
    });
  });

  describe('registrarMovimiento — costo_informado', () => {
    // Sin costo, `costo_unitario` congela el CPP vigente: esta columna es la
    // única que dice si el movimiento trajo el suyo (spec compras § 3.4).
    it.each([
      ['con costo', '1200', true],
      ['sin costo', undefined, false],
    ])('una entrada compra %s lo deja escrito', async (_, costo, esperado) => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '1000.0000' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '5' }]); // SELECT saldo
      if (costo) {
        managerMock.query.mockResolvedValueOnce([
          { item_id: ITEM_ID, stock: '5' },
        ]); // SELECT stock total
      }
      managerMock.query
        .mockResolvedValueOnce(undefined) // INSERT stock_ubicacion
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ci' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '10',
          usuarioId: USER_ID,
          costoUnitario: costo,
        },
      );

      const insert = managerMock.query.mock.calls.find(([sql]) =>
        /INSERT INTO movimientos_inventario/.test(sql as string),
      ) as [string, unknown[]];
      expect(insert[0]).toContain('costo_informado');
      expect(insert[1][18]).toBe(esperado);
    });
  });

  // ---------------------------------------------------------------------------
  // Rehacer la cuenta (spec compras-recepcion § 4.3)
  //
  // Los números son los de la spec (tomate) y los de la tabla del plan. Cada
  // caso está armado para que la regla que prueba cambie el resultado: si la
  // regla se saltara, el número sería otro.
  // ---------------------------------------------------------------------------
  describe('recalcularCostoDesdeCompra', () => {
    const COMPRA = 'compra-uuid';
    const LINEA = 'linea-uuid';
    const BODEGA = 'bodega-uuid';

    interface Mov {
      tipo: string;
      motivo: string;
      cantidad: string;
      stock_anterior: string;
      stock_resultante: string;
      costo_unitario: string | null;
      costo_informado: boolean;
      compra_linea_id: string | null;
      es_entrada_de_linea: boolean | null;
      cantidad_base: string | null;
      costo_unitario_base: string | null;
      compra_estado: string | null;
    }

    /** La entrada original de una línea: cuenta con lo que la línea vale HOY. */
    function entradaDeLinea(
      antes: number,
      cantidadBase: string,
      costoBase: string | null,
      o: Partial<Mov> = {},
    ): Mov {
      return {
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: cantidadBase,
        stock_anterior: String(antes),
        stock_resultante: String(antes + Number(cantidadBase)),
        costo_unitario: null,
        costo_informado: costoBase != null,
        compra_linea_id: LINEA,
        es_entrada_de_linea: true,
        cantidad_base: cantidadBase,
        costo_unitario_base: costoBase,
        compra_estado: 'confirmada',
        ...o,
      };
    }

    function mov(
      tipo: 'entrada' | 'salida' | 'ajuste',
      motivo: string,
      antes: number,
      cantidad: number,
      o: Partial<Mov> = {},
    ): Mov {
      const signo = tipo === 'salida' ? -1 : tipo === 'entrada' ? 1 : 0;
      return {
        tipo,
        motivo,
        cantidad: String(cantidad),
        stock_anterior: String(antes),
        stock_resultante: String(antes + signo * cantidad),
        costo_unitario: null,
        costo_informado: false,
        compra_linea_id: null,
        es_entrada_de_linea: null,
        cantidad_base: null,
        costo_unitario_base: null,
        compra_estado: null,
        ...o,
      };
    }

    /**
     * Las consultas en orden: compra, producto (lock), punto de partida,
     * recorrido y, si el costo cambia, las cuatro de `registrarMovimiento`.
     */
    function prepararCuenta(p: {
      costoActual: string | null;
      partida: { stock: string; costo: string | null };
      movimientos: Mov[];
      ubicacionViva?: boolean;
    }) {
      managerMock.query
        .mockResolvedValueOnce([
          { ubicacion_id: BODEGA, ubicacion_viva: p.ubicacionViva ?? true },
        ])
        .mockResolvedValueOnce([{ costo_actual: p.costoActual }])
        .mockResolvedValueOnce([
          {
            compra_linea_id: LINEA,
            stock_total_anterior: p.partida.stock,
            costo_producto_anterior: p.partida.costo,
            secuencia: '100',
          },
        ])
        .mockResolvedValueOnce(p.movimientos)
        // `registrarMovimiento` de la corrección, si la hay:
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: p.costoActual },
        ])
        .mockResolvedValueOnce([{ stock: '0' }])
        .mockResolvedValueOnce([{ movimiento_id: 'mov-correccion' }])
        .mockResolvedValueOnce(undefined);
    }

    function recalcular() {
      return service.recalcularCostoDesdeCompra(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          compraId: COMPRA,
          usuarioId: USER_ID,
          comentario: 'Precio completado',
        },
      );
    }

    /** El INSERT de la `correccion_compra`, si se escribió. */
    function correccion() {
      return managerMock.query.mock.calls.find(([sql]) =>
        /INSERT INTO movimientos_inventario/.test(sql as string),
      ) as [string, unknown[]] | undefined;
    }

    it('tomate: 5 kg a $1.000, entran 20 sin precio, se venden 8 y se completan a $1.500 → $1.400', async () => {
      prepararCuenta({
        costoActual: '1000.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500'),
          mov('salida', 'venta', 25, 8, { costo_unitario: '1000.0000' }),
        ],
      });

      const r = await recalcular();

      expect(r).toEqual({
        costoAnterior: '1000.0000',
        costoNuevo: '1400.0000',
        movimientoId: 'mov-correccion',
      });
      const insert = correccion()!;
      expect(insert[1][4]).toBe('correccion_compra');
      expect(insert[1][17]).toBe(LINEA);
      // Lo vendido queda como estaba: ningún movimiento pasado se reescribe.
      expect(
        managerMock.query.mock.calls.some(([sql]) =>
          /UPDATE movimientos_inventario/.test(sql as string),
        ),
      ).toBe(false);
    });

    it('con 10 kg a $1.200 el martes, después de la venta → $1.326', async () => {
      prepararCuenta({
        costoActual: '1074.0741',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500'),
          mov('salida', 'venta', 25, 8),
          entradaDeLinea(17, '10', '1200', { compra_linea_id: 'linea-martes' }),
        ],
      });

      // (17 × 1.400 + 10 × 1.200) / 27. Sumar la diferencia daba $1.474.
      expect((await recalcular()).costoNuevo).toBe('1325.9259');
    });

    it('owner: 10 kg que entraron SIN costo por el ajuste de stock no mueven el promedio → $1.400, no $1.285,71', async () => {
      prepararCuenta({
        costoActual: '1000.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          // La línea entró sin precio y hoy tiene $1.500.
          entradaDeLinea(5, '20', '1500'),
          // Sin costo, el kardex congeló el CPP de ese momento: $1.000.
          mov('entrada', 'compra', 25, 10, {
            costo_unitario: '1000.0000',
            costo_informado: false,
          }),
        ],
      });

      expect((await recalcular()).costoNuevo).toBe('1400.0000');
    });

    it('una entrada compra del atajo CON costo promedia con su costo congelado', async () => {
      prepararCuenta({
        costoActual: '1285.7143',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500'),
          mov('entrada', 'compra', 25, 10, {
            costo_unitario: '2000.0000',
            costo_informado: true,
          }),
        ],
      });

      // (25 × 1.400 + 10 × 2.000) / 35
      expect((await recalcular()).costoNuevo).toBe('1571.4286');
    });

    it('un ajuste_costo en medio reinicia al suyo', async () => {
      prepararCuenta({
        costoActual: '900.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500'),
          mov('ajuste', 'ajuste_costo', 25, 0, { costo_unitario: '900.0000' }),
          mov('salida', 'venta', 25, 8),
        ],
      });

      const r = await recalcular();

      // Igual al vigente: no hay corrección que escribir.
      expect(r).toEqual({
        costoAnterior: '900.0000',
        costoNuevo: '900.0000',
        movimientoId: null,
      });
      expect(correccion()).toBeUndefined();
    });

    it('la cantidad sube de 10 a 12: la línea cuenta 12 en su lugar original y la diferencia no vuelve a entrar', async () => {
      prepararCuenta({
        costoActual: '1000.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          // Entró con 10; la línea hoy dice 12.
          {
            ...entradaDeLinea(5, '12', '1500'),
            cantidad: '10',
            stock_resultante: '15',
          },
          mov('salida', 'venta', 15, 8),
          // La diferencia, colgada de la misma línea.
          mov('entrada', 'compra', 7, 2, {
            compra_linea_id: LINEA,
            es_entrada_de_linea: false,
            cantidad_base: '12',
            costo_unitario_base: '1500',
            compra_estado: 'confirmada',
            costo_unitario: '1500.0000',
            costo_informado: true,
          }),
        ],
      });

      // (5 × 1.000 + 12 × 1.500) / 17. Contar 10 y después los 2 daba $1.370,37.
      expect((await recalcular()).costoNuevo).toBe('1352.9412');
    });

    it('anular la única compra con costo de un producto que no tenía lo deja sin costo', async () => {
      prepararCuenta({
        costoActual: '1500.0000',
        partida: { stock: '5', costo: null },
        movimientos: [
          entradaDeLinea(5, '20', '1500', { compra_estado: 'anulada' }),
          mov('salida', 'compra', 25, 20, {
            compra_linea_id: LINEA,
            es_entrada_de_linea: false,
            cantidad_base: '20',
            costo_unitario_base: '1500',
            compra_estado: 'anulada',
          }),
        ],
      });

      const r = await recalcular();

      expect(r).toEqual({
        costoAnterior: '1500.0000',
        costoNuevo: null,
        movimientoId: 'mov-correccion',
      });
      expect(managerMock.query).toHaveBeenLastCalledWith(
        expect.stringContaining('costo_actual'),
        [null, ITEM_ID],
      );
    });

    it('una compra anulada cuenta como si no hubiera existido', async () => {
      prepararCuenta({
        costoActual: '1400.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500', { compra_estado: 'anulada' }),
          mov('salida', 'venta', 25, 3),
          mov('salida', 'compra', 22, 20, {
            compra_linea_id: LINEA,
            es_entrada_de_linea: false,
            cantidad_base: '20',
            costo_unitario_base: '1500',
            compra_estado: 'anulada',
          }),
        ],
      });

      expect((await recalcular()).costoNuevo).toBe('1000.0000');
    });

    it('el stock pasa por cero: la entrada siguiente reinicia el costo', async () => {
      prepararCuenta({
        costoActual: '2000.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500'),
          mov('salida', 'venta', 25, 25),
          mov('entrada', 'compra', 0, 10, {
            costo_unitario: '2000.0000',
            costo_informado: true,
          }),
        ],
      });

      // Sin la venta en la cuenta daría (25 × 1.400 + 10 × 2.000) / 35 = 1.571,43.
      expect((await recalcular()).costoNuevo).toBe('2000.0000');
      expect(correccion()).toBeUndefined();
    });

    it('dos compras corregidas del mismo producto no se pisan: la otra entra con el costo de su línea, no el de su movimiento', async () => {
      prepararCuenta({
        costoActual: '1000.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500'),
          // La otra compra entró a $1.200 y ya se corrigió a $1.300.
          entradaDeLinea(25, '10', '1300', {
            compra_linea_id: 'linea-otra',
            costo_unitario: '1200.0000',
          }),
        ],
      });

      // (25 × 1.400 + 10 × 1.300) / 35. Con el $1.200 del movimiento: 1.342,86.
      expect((await recalcular()).costoNuevo).toBe('1371.4286');
    });

    it('una correccion_compra anterior se salta: es un resultado, no un hecho', async () => {
      prepararCuenta({
        costoActual: '1300.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [
          entradaDeLinea(5, '20', '1500'),
          mov('ajuste', 'correccion_compra', 25, 0, {
            costo_unitario: '1300.0000',
            compra_linea_id: LINEA,
            es_entrada_de_linea: false,
          }),
        ],
      });

      expect((await recalcular()).costoNuevo).toBe('1400.0000');
    });

    it('recorre por secuencia, desde la entrada de la compra', async () => {
      prepararCuenta({
        costoActual: '1400.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [entradaDeLinea(5, '20', '1500')],
      });

      await recalcular();

      const [sql, params] = managerMock.query.mock.calls[3] as [
        string,
        unknown[],
      ];
      // `creado_el` es la hora en que EMPEZÓ la transacción: no es el orden
      // de aplicación. Acotado a la cláusula, no al comentario.
      expect(sql.trim()).toMatch(/ORDER BY m\.secuencia$/);
      expect(sql).toMatch(/m\.secuencia >= \$3/);
      expect(params).toEqual([TENANT, ITEM_ID, '100']);
    });

    it('bloquea la ubicación antes que el producto', async () => {
      prepararCuenta({
        costoActual: '1400.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [entradaDeLinea(5, '20', '1500')],
      });

      await recalcular();

      const lockUbicacion =
        ubicacionesService.bloquearContraBorrado.mock.invocationCallOrder[0];
      const lockProducto = managerMock.query.mock.invocationCallOrder[1];
      expect(managerMock.query.mock.calls[1][0]).toContain('FOR UPDATE OF ip');
      expect(lockUbicacion).toBeLessThan(lockProducto);
      expect(ubicacionesService.bloquearContraBorrado).toHaveBeenCalledWith(
        managerMock,
        TENANT,
        BODEGA,
      );
    });

    it('si la bodega de la compra se borró, la corrección va al local', async () => {
      prepararCuenta({
        costoActual: '1000.0000',
        partida: { stock: '5', costo: '1000.0000' },
        movimientos: [entradaDeLinea(5, '20', '1500')],
        ubicacionViva: false,
      });

      await recalcular();

      expect(ubicacionesService.localDe).toHaveBeenCalledWith(TENANT);
      expect(ubicacionesService.bloquearContraBorrado).not.toHaveBeenCalledWith(
        expect.anything(),
        TENANT,
        BODEGA,
      );
      expect(correccion()![1][2]).toBe(UBICACION_ID);
    });

    it('una compra sin entrada de ese producto es 400', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ ubicacion_id: BODEGA, ubicacion_viva: true }])
        .mockResolvedValueOnce([{ costo_actual: '1000.0000' }])
        .mockResolvedValueOnce([]);

      await expect(recalcular()).rejects.toThrow(
        'La compra no tiene una entrada de ese producto',
      );
    });

    it('una compra de otro tenant o inexistente es 404', async () => {
      managerMock.query.mockResolvedValueOnce([]);

      await expect(recalcular()).rejects.toThrow(NotFoundException);
      expect(ubicacionesService.bloquearContraBorrado).not.toHaveBeenCalled();
    });
  });

  describe('stockTotalPorProducto', () => {
    it('suma por producto, y un producto sin filas vale 0', async () => {
      managerMock.query.mockResolvedValueOnce([
        { item_id: 'a', stock: '12.5000' },
      ]);
      const total = await service.stockTotalPorProducto(
        managerMock as unknown as EntityManager,
        TENANT,
        ['a', 'b'],
      );
      expect(total.get('a')).toBe('12.5000');
      expect(total.get('b')).toBe('0');
      // Una sola consulta para todos, filtrando ubicaciones eliminadas.
      expect(managerMock.query).toHaveBeenCalledTimes(1);
      const [sql, params] = managerMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('u.eliminado_el IS NULL');
      // Acota por tenant por su cuenta, a través de la ubicación: un id ajeno
      // colado en el lote suma cero.
      expect(sql).toMatch(/AND u\.tenant_id = \$2/);
      expect(params).toEqual([['a', 'b'], TENANT]);
    });
  });

  // ---------------------------------------------------------------------------
  // Costo promedio ponderado (CPP)
  // ---------------------------------------------------------------------------
  describe('costo promedio ponderado (CPP)', () => {
    it('promedia el costo previo con el de compra según las cantidades', () => {
      // 10 unidades a 100 + 10 unidades a 200 → 150
      const resultado = (service as any).calcularCostoPromedio(
        new Decimal('10'),
        '100',
        new Decimal('10'),
        '200',
      );
      expect(resultado).toBe('150.0000');
    });

    it('sin stock previo, el costo de compra manda', () => {
      const resultado = (service as any).calcularCostoPromedio(
        new Decimal('0'),
        '999',
        new Decimal('5'),
        '200',
      );
      expect(resultado).toBe('200.0000');
    });

    it('sin costo previo, el costo de compra manda', () => {
      const resultado = (service as any).calcularCostoPromedio(
        new Decimal('10'),
        null,
        new Decimal('5'),
        '200',
      );
      expect(resultado).toBe('200.0000');
    });

    it('pondera por cantidad, no promedia los precios', () => {
      // 1 a 100 + 9 a 200 → 190, no 150
      const resultado = (service as any).calcularCostoPromedio(
        new Decimal('1'),
        '100',
        new Decimal('9'),
        '200',
      );
      expect(resultado).toBe('190.0000');
    });

    it('redondea a 4 decimales', () => {
      // (3×10 + 1×20) / 4 = 12.5 ; con divisiones no exactas no debe explotar
      const resultado = (service as any).calcularCostoPromedio(
        new Decimal('3'),
        '10',
        new Decimal('1'),
        '20',
      );
      expect(resultado).toBe('12.5000');
    });
  });

  // ---------------------------------------------------------------------------
  // Ajuste de costo (no mueve cantidad, mueve valor)
  // ---------------------------------------------------------------------------
  describe('ajuste de costo', () => {
    it('registra el movimiento sin mover stock y guarda el costo anterior', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '100' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ac1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          usuarioId: USER_ID,
          tipo: 'ajuste',
          motivo: 'ajuste_costo',
          cantidad: '0',
          costoUnitario: '250',
          comentario: 'Corrección de costo inicial mal tipeado',
        },
      );

      expect(res.stockAnterior).toBe('10');
      expect(res.stockResultante).toBe('10');

      const insert = managerMock.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('INSERT INTO movimientos_inventario'),
      );
      expect(insert).toBeDefined();
      // costo_anterior = 100 (el vigente), costo_unitario = 250 (el nuevo)
      expect(insert![1]).toEqual(expect.arrayContaining(['100', '250']));

      // No debe haber UPDATE de stock
      const updateStock = managerMock.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('SET stock ='),
      );
      expect(updateStock).toBeUndefined();

      // Sí debe haber UPDATE de costo_actual con el valor nuevo
      const updateCosto = managerMock.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('SET costo_actual ='),
      );
      expect(updateCosto![1][0]).toBe('250.0000');
    });

    it('rechaza el ajuste de costo con cantidad distinta de cero', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '100' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          usuarioId: USER_ID,
          tipo: 'ajuste',
          motivo: 'ajuste_costo',
          cantidad: '3',
          costoUnitario: '250',
        }),
      ).rejects.toThrow('El ajuste de costo no mueve cantidad');
    });

    it('rechaza el ajuste de costo sin costoUnitario', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '100' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          usuarioId: USER_ID,
          tipo: 'ajuste',
          motivo: 'ajuste_costo',
          cantidad: '0',
        }),
      ).rejects.toThrow('El ajuste de costo requiere el costo nuevo');
    });

    it('sigue rechazando cantidad cero en los demás motivos', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '100' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]); // SELECT saldo: statement aparte, ya bajo el lock

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          ubicacionId: UBICACION_ID,
          usuarioId: USER_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '0',
        }),
      ).rejects.toThrow('La cantidad debe ser mayor a cero');
    });
  });

  // ---------------------------------------------------------------------------
  // registrarAjusteCosto — la respuesta usa el costo leído dentro del lock
  // ---------------------------------------------------------------------------
  describe('registrarAjusteCosto', () => {
    it('responde con el costoAnterior leído dentro del FOR UPDATE, no el del pre-check', async () => {
      dataSource.transaction = jest.fn(
        (cb: (m: typeof managerMock) => unknown) => cb(managerMock),
      );

      managerMock.query
        // Pre-check (fuera del lock): ve un costo desactualizado, como si una
        // compra concurrente hubiera cambiado el promedio justo después.
        .mockResolvedValueOnce([{ tipo: 'producto', costo_actual: '100' }])
        // SELECT ... FOR UPDATE dentro de registrarMovimiento: el valor real.
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '150' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ac2' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      const res = await service.registrarAjusteCosto(TENANT, USER_ID, {
        itemId: ITEM_ID,
        costoNuevo: '300',
        comentario: 'Corrección de costo',
      });

      expect(res.costoAnterior).toBe('150');
      expect(res.costoNuevo).toBe('300.0000');
    });

    it('rechaza un costo que solo difiere más allá del 4º decimal', async () => {
      dataSource.transaction = jest.fn(
        (cb: (m: typeof managerMock) => unknown) => cb(managerMock),
      );

      managerMock.query.mockResolvedValueOnce([
        { tipo: 'producto', costo_actual: '5000.0000' },
      ]);

      // costo_actual es NUMERIC(18,4): esto se persistiría como 5000.0000,
      // idéntico al vigente, dejando un ajuste sin cambio en el kardex.
      await expect(
        service.registrarAjusteCosto(TENANT, USER_ID, {
          itemId: ITEM_ID,
          costoNuevo: '5000.00004',
          comentario: 'Corrección de costo',
        }),
      ).rejects.toThrow('El costo nuevo es igual al vigente');
      expect(managerMock.query).toHaveBeenCalledTimes(1);
    });

    it('convierte el costo cuando se ingresa en una unidad distinta de la base', async () => {
      // Producto en gramos; la persona carga el costo por kilo.
      // 1 kg = 1000 g ⇒ 5050/kg debe persistirse como 5.0500/g.
      dataSource.transaction = jest.fn(
        (cb: (m: typeof managerMock) => unknown) => cb(managerMock),
      );
      catalogService.convertirUnidad.mockResolvedValueOnce('1000');

      managerMock.query
        .mockResolvedValueOnce([
          { tipo: 'producto', costo_actual: '4.0000', unidad_medida: 'g' },
        ])
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4.0000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ac3' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      const res = await service.registrarAjusteCosto(TENANT, USER_ID, {
        itemId: ITEM_ID,
        costoNuevo: '5050',
        unidadCodigo: 'kg',
        comentario: 'Ajuste por unidad',
      });

      expect(res.costoNuevo).toBe('5.0500');
      // Conversión de TASA: cuánto vale UNA unidad elegida en unidades base.
      expect(catalogService.convertirUnidad).toHaveBeenCalledWith(
        '1',
        'kg',
        'g',
      );
      // El costo que entra al kardex es el ya convertido, no el tipeado.
      const insert = managerMock.query.mock.calls[3] as [string, unknown[]];
      expect(insert[1]).toContain('5.0500');
    });

    it('rechaza el costo positivo que se pierde al convertirlo a la unidad base', async () => {
      // 0,0001/kg en un producto por gramo son 0,0000001/g, y la conversión
      // cuantiza a 4 decimales ⇒ '0.0000'. El DTO no lo ve (lo tipeado es
      // positivo) y `registrarMovimiento` tampoco (desde que el 0 es legítimo,
      // solo mira el signo): el único que tiene los dos valores es este.
      dataSource.transaction = jest.fn(
        (cb: (m: typeof managerMock) => unknown) => cb(managerMock),
      );
      catalogService.convertirUnidad.mockResolvedValueOnce('1000');

      managerMock.query.mockResolvedValueOnce([
        { tipo: 'producto', costo_actual: '4.0000', unidad_medida: 'g' },
      ]);

      await expect(
        service.registrarAjusteCosto(TENANT, USER_ID, {
          itemId: ITEM_ID,
          costoNuevo: '0.0001',
          unidadCodigo: 'kg',
          comentario: 'Costo que no cabe en la escala',
        }),
      ).rejects.toThrow(BadRequestException);

      // Cortó antes de abrir el movimiento: solo corrió el pre-check.
      expect(managerMock.query).toHaveBeenCalledTimes(1);
    });

    it('sin unidadCodigo el costo se interpreta en unidad base, como hasta hoy', async () => {
      dataSource.transaction = jest.fn(
        (cb: (m: typeof managerMock) => unknown) => cb(managerMock),
      );

      managerMock.query
        .mockResolvedValueOnce([
          { tipo: 'producto', costo_actual: '4.0000', unidad_medida: 'g' },
        ])
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', costo_actual: '4.0000' },
        ])
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT saldo: statement aparte, ya bajo el lock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ac4' }])
        .mockResolvedValueOnce(undefined);

      const res = await service.registrarAjusteCosto(TENANT, USER_ID, {
        itemId: ITEM_ID,
        costoNuevo: '7',
        comentario: 'Ajuste sin unidad',
      });

      expect(res.costoNuevo).toBe('7.0000');
      expect(catalogService.convertirUnidad).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // findMovimientos
  // ---------------------------------------------------------------------------
  describe('findMovimientos', () => {
    it('mapea filas snake_case a camelCase y filtra por item con paginación', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            movimiento_id: 'mov-1',
            item_id: ITEM_ID,
            item_nombre: 'Smartphone',
            tipo: 'entrada',
            motivo: 'compra',
            cantidad: '5.0000',
            stock_anterior: '10.0000',
            stock_resultante: '15.0000',
            usuario_id: USER_ID,
            usuario_nombre: 'Admin',
            comentario: null,
            creado_el: new Date('2026-06-23T10:00:00Z'),
          },
        ]);

      const res = await service.findMovimientos(TENANT, {
        itemId: ITEM_ID,
        page: 1,
        pageSize: 15,
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0]).toMatchObject({
        id: 'mov-1',
        itemId: ITEM_ID,
        itemNombre: 'Smartphone',
        tipo: 'entrada',
        motivo: 'compra',
        stockResultante: '15.0000',
        usuarioNombre: 'Admin',
      });
      expect(res.meta).toMatchObject({
        page: 1,
        pageSize: 15,
        total: 1,
        totalPages: 1,
      });
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        expect.arrayContaining([TENANT, ITEM_ID]),
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $3 OFFSET $4'),
        expect.arrayContaining([TENANT, ITEM_ID, 15, 0]),
      );
    });

    it('findMovimientos filtra por ubicacionId y expone ubicacionId/ubicacionNombre en cada fila', async () => {
      // UBICACION_BODEGA_ID ≠ TENANT/ITEM_ID a propósito: si `buildMovimientosFilters`
      // usara la posición de parámetro equivocada, `arrayContaining` seguiría
      // pasando por casualidad si los valores coincidieran — con un id propio
      // no hay ambigüedad.
      const UBICACION_BODEGA_ID = 'ubicacion-bodega-uuid';
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            movimiento_id: 'mov-1',
            item_id: ITEM_ID,
            item_nombre: 'Smartphone',
            tipo: 'salida',
            motivo: 'merma',
            cantidad: '1.0000',
            stock_anterior: '20.0000',
            stock_resultante: '19.0000',
            usuario_id: USER_ID,
            usuario_nombre: 'Admin',
            comentario: null,
            creado_el: new Date('2026-06-23T10:00:00Z'),
            ubicacion_id: UBICACION_BODEGA_ID,
            ubicacion_nombre: 'Bodega centro',
          },
        ]);

      const res = await service.findMovimientos(TENANT, {
        ubicacionId: UBICACION_BODEGA_ID,
        page: 1,
        pageSize: 15,
      });

      expect(res.data[0]).toMatchObject({
        ubicacionId: UBICACION_BODEGA_ID,
        ubicacionNombre: 'Bodega centro',
      });
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('mv.ubicacion_id = $2'),
        expect.arrayContaining([TENANT, UBICACION_BODEGA_ID]),
      );
    });

    it('findMovimientos expone unidadMedida del producto', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            movimiento_id: 'mov-1',
            item_id: ITEM_ID,
            item_nombre: 'Harina',
            tipo: 'entrada',
            motivo: 'compra',
            cantidad: '5.0000',
            stock_anterior: '10.0000',
            stock_resultante: '15.0000',
            usuario_id: USER_ID,
            usuario_nombre: 'Admin',
            comentario: null,
            creado_el: new Date('2026-06-23T10:00:00Z'),
            unidad_medida: 'kg',
          },
        ]);

      const res = await service.findMovimientos(TENANT, {});

      expect(res.data[0].unidadMedida).toBe('kg');
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('unidad_medida'),
        expect.any(Array),
      );
    });

    it('findMovimientos expone costoUnitario', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }]) // COUNT
        .mockResolvedValueOnce([
          {
            movimiento_id: 'mov-1',
            item_id: ITEM_ID,
            item_nombre: 'Carne molida',
            tipo: 'salida',
            motivo: 'venta',
            cantidad: '1',
            stock_anterior: '10',
            stock_resultante: '9',
            usuario_id: USER_ID,
            usuario_nombre: 'Cajero',
            comentario: null,
            creado_el: new Date('2026-07-14T00:00:00Z'),
            costo_unitario: '4200',
          },
        ]); // list

      const res = await service.findMovimientos(TENANT, {});

      expect(res.data[0].costoUnitario).toBe('4200');
    });

    it('findMovimientos expone motivo y costoPerdido en merma', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            movimiento_id: 'mov-m1',
            item_id: ITEM_ID,
            item_nombre: 'Lechuga',
            tipo: 'salida',
            motivo: 'merma',
            cantidad: '3.5000',
            stock_anterior: '10.0000',
            stock_resultante: '6.5000',
            usuario_id: USER_ID,
            usuario_nombre: 'Admin',
            comentario: null,
            creado_el: new Date('2026-07-15T00:00:00Z'),
            costo_unitario: '1200.5000',
            motivo_baja_id: MOTIVO_BAJA_ID,
            motivo_baja_nombre: 'Vencimiento',
          },
        ]);

      const res = await service.findMovimientos(TENANT, {});

      expect(res.data[0]).toMatchObject({
        motivoBajaId: MOTIVO_BAJA_ID,
        motivoBajaNombre: 'Vencimiento',
        costoPerdido: '4201.7500',
      });
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('motivo_baja_id'),
        expect.any(Array),
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('motivo_baja'),
        expect.any(Array),
      );
    });
  });
});
