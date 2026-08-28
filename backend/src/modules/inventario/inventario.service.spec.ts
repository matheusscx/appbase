// backend/src/modules/inventario/inventario.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { type EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { InventarioService } from './inventario.service';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import { CatalogService } from '../catalog/catalog.service';

const TENANT = 'tenant-uuid';
const ITEM_ID = 'item-uuid';
const USER_ID = 'user-uuid';
const UNIDAD_1 = 'unidad-uuid-1';
const UNIDAD_2 = 'unidad-uuid-2';
const LOTE_ID = 'lote-uuid-1';
const CAUSA_MERMA_ID = 'causa-merma-uuid';
const MOTIVO_DIFERENCIA_ID = 'motivo-diferencia-uuid';

describe('InventarioService', () => {
  let service: InventarioService;
  let managerMock: { query: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let catalogService: { convertirUnidad: jest.Mock };

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    dataSource = { query: jest.fn(), transaction: jest.fn() };
    catalogService = { convertirUnidad: jest.fn() };
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
  describe('registrarMovimiento — acote por tenant en el lock', () => {
    function lockQuery(): [string, unknown[]] {
      return managerMock.query.mock.calls[0] as [string, unknown[]];
    }

    it('el SELECT del lock recibe el tenant como parámetro, no solo el item', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10', modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        },
      );

      // La aserción fuerte es por VALOR de los parámetros: sacar el
      // `AND i.tenant_id = $2` deja el array en `[ITEM_ID]` y esto falla por su
      // propia comparación, no por un match de texto sobre el SQL.
      const [sql, params] = lockQuery();
      expect(params).toEqual([ITEM_ID, TENANT]);
      expect(sql).toContain('i.tenant_id = $2');
    });

    it('lockea solo `item_producto`, no la fila de `items` que usa para acotar', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10', modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
  // Modo 'cantidad' (comportamiento original)
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo cantidad', () => {
    it('entrada: suma al stock y registra el movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10', modo_inventario: 'cantidad' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE item_producto
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]); // INSERT movimiento

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
        costoActualPrevio: null,
        costoActual: null,
      });
      // La 2ª llamada es UPDATE item_producto con el nuevo saldo
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE item_producto'),
        ['15', ITEM_ID],
      );
    });

    it('salida: resta del stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10', modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-2' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '4',
          usuarioId: USER_ID,
          causaMermaId: CAUSA_MERMA_ID,
        },
      );

      expect(res.stockResultante).toBe('6');
    });

    it('salida con stock insuficiente lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '3', modo_inventario: 'cantidad' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '5',
          usuarioId: USER_ID,
          causaMermaId: CAUSA_MERMA_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('item sin fila item_producto lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // Ítem eliminado: solo lo que deshace algo
  //
  // Como los tests del acote por tenant de más arriba, esto es **defensa en
  // profundidad y no un bug alcanzable hoy**: se midió caller por caller y los
  // seis caminos que no son anulación/devolución ya filtran `eliminado_el IS
  // NULL` aguas arriba —`items.ajustarStock` y `create`/`update`,
  // `inventario.registrarAjusteCosto` y `mermas.registrar` cortan con 404;
  // `recuentos.aplicar` descarta la línea; las recetas y combos excluyen al
  // ingrediente borrado de la expansión—. Lo que fijan estos tests es la regla
  // en el chokepoint, para el llamador que se agregue mañana sin ese filtro.
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — ítem eliminado', () => {
    const BORRADO_EL = new Date('2026-08-16T10:00:00Z');

    function lockRowEliminado() {
      return [
        {
          stock: '10',
          modo_inventario: 'cantidad',
          costo_actual: '100',
          item_nombre: 'Queso mantecoso',
          item_eliminado_el: BORRADO_EL,
        },
      ];
    }

    it.each(['compra', 'merma', 'recuento', 'ajuste_manual', 'venta'])(
      "rechaza el motivo '%s' sobre un ítem eliminado",
      async (motivo) => {
        managerMock.query.mockResolvedValueOnce(lockRowEliminado());

        await expect(
          service.registrarMovimiento(managerMock as unknown as EntityManager, {
            tenantId: TENANT,
            itemId: ITEM_ID,
            tipo: 'entrada',
            motivo,
            cantidad: '5',
            usuarioId: USER_ID,
            causaMermaId: motivo === 'merma' ? CAUSA_MERMA_ID : undefined,
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
          .mockResolvedValueOnce(undefined) // UPDATE item_producto
          .mockResolvedValueOnce([{ movimiento_id: 'mov-repo' }]); // INSERT kardex

        const res = await service.registrarMovimiento(
          managerMock as unknown as EntityManager,
          {
            tenantId: TENANT,
            itemId: ITEM_ID,
            tipo: 'entrada',
            motivo,
            cantidad: '2',
            usuarioId: USER_ID,
          },
        );

        expect(res.stockResultante).toBe('12');
      },
    );

    it('un ítem vivo no cambia: el guard solo mira `eliminado_el`', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          {
            stock: '10',
            modo_inventario: 'cantidad',
            costo_actual: null,
            item_nombre: 'Queso mantecoso',
            item_eliminado_el: null,
          },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ok' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
        .mockResolvedValueOnce([{ stock: '0', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }]) // INSERT unidad 1
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_2 }]) // INSERT unidad 2
        .mockResolvedValueOnce([{ cnt: '2' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined) // INSERT detalle 1
        .mockResolvedValueOnce(undefined); // INSERT detalle 2

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
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

    it('entrada serie: lanza BadRequest si cantidad != series.length', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '0', modo_inventario: 'serie' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
        .mockResolvedValueOnce([{ stock: '2', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { estado: 'disponible', item_id: ITEM_ID, tenant_id: TENANT },
        ]) // SELECT unidad
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s2' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          causaMermaId: CAUSA_MERMA_ID,
        },
      );

      expect(res.stockResultante).toBe('1');
    });

    it('salida serie sin unidadIds: auto-selecciona FIFO las unidades disponibles', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '2', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }]) // SELECT FIFO unidades
        .mockResolvedValueOnce([
          { estado: 'disponible', item_id: ITEM_ID, tenant_id: TENANT },
        ]) // SELECT unidad (validación)
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s3' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('1');
      // La 2ª query es el SELECT FIFO con ORDER BY creado_el ASC
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ORDER BY u.creado_el ASC'),
        expect.arrayContaining([ITEM_ID, TENANT]),
      );
    });

    it('salida serie sin unidadIds: lanza BadRequest si no hay suficientes disponibles', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '0', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([]); // SELECT FIFO unidades (0 disponibles)

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida serie: lanza BadRequest si unidad no está disponible', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '1', modo_inventario: 'serie' }])
        .mockResolvedValueOnce([
          { estado: 'vendido', item_id: ITEM_ID, tenant_id: TENANT },
        ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          causaMermaId: CAUSA_MERMA_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida serie: lanza BadRequest si la unidad no pertenece al tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '1', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
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
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-tenant-mutant' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          causaMermaId: CAUSA_MERMA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(`Unidad ${UNIDAD_1} no pertenece al tenant`),
      );
    });

    it('salida serie: lanza BadRequest si la unidad no pertenece al item', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '1', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
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
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-item-mutant' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
          causaMermaId: CAUSA_MERMA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(`Unidad ${UNIDAD_1} no pertenece al item`),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Modo 'lote'
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo lote', () => {
    it('entrada lote: crea lote nuevo y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '0', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([]) // SELECT lote existente (no existe)
        .mockResolvedValueOnce([{ lote_id: LOTE_ID }]) // INSERT lote
        .mockResolvedValueOnce([{ total: '50' }]) // SUM cantidad_disponible
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '50',
          usuarioId: USER_ID,
          lote: { codigoLote: 'LOTE-001', fechaVencimiento: '2027-01-01' },
        },
      );

      expect(res.stockResultante).toBe('50');
    });

    it('salida lote: descuenta del lote y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '50', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { cantidad_disponible: '50', tenant_id: TENANT },
        ]) // SELECT lote FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE lote
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l2' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
          causaMermaId: CAUSA_MERMA_ID,
        },
      );

      expect(res.stockResultante).toBe('40');
    });

    it('salida lote sin loteId: auto-selecciona FIFO el lote más antiguo', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '50', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { lote_id: LOTE_ID, cantidad_disponible: '50' },
        ]) // SELECT lotes FIFO FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE lote
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l3' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '10',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('40');
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ORDER BY creado_el ASC'),
        expect.arrayContaining([ITEM_ID, TENANT]),
      );
    });

    it('salida lote sin loteId: lanza BadRequest si el stock total es insuficiente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '5', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { lote_id: LOTE_ID, cantidad_disponible: '5' },
        ]); // SELECT lotes FIFO (total 5 < 10)

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '10',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida lote: lanza BadRequest si lote insuficiente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '5', modo_inventario: 'lote' }])
        .mockResolvedValueOnce([
          { cantidad_disponible: '5', tenant_id: TENANT },
        ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
          causaMermaId: CAUSA_MERMA_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida lote: lanza BadRequest si el lote no pertenece al tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '50', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          // El lote existe con disponibilidad suficiente, pero es de otro
          // tenant: `loteId` llega del body del cliente, así que este `if` es
          // la única defensa contra descontar el lote de otro tenant.
          { cantidad_disponible: '50', tenant_id: 'otro-tenant-uuid' },
        ])
        // Cadena completa por si la validación de pertenencia desaparece: el
        // rojo lo tiene que dar la propia aserción `rejects.toThrow`, no un
        // TypeError de un mock incompleto más adelante en el flujo.
        .mockResolvedValueOnce(undefined) // UPDATE lote
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-lote-tenant-mutant' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
          causaMermaId: CAUSA_MERMA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('El lote no pertenece al tenant'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Causa de merma
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — causa merma', () => {
    it('motivo merma sin causaMermaId lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '2',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('La merma requiere una causa tipificada'),
      );
    });

    it('motivo distinto de merma con causaMermaId lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'ajuste_manual',
          cantidad: '2',
          usuarioId: USER_ID,
          causaMermaId: CAUSA_MERMA_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException('causa_merma_id solo aplica a merma'),
      );
    });

    it('motivo merma con causaMermaId incluye causa_merma_id en el INSERT', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-m1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '2',
          usuarioId: USER_ID,
          causaMermaId: CAUSA_MERMA_ID,
        },
      );

      const insertCall = managerMock.query.mock.calls[2];
      expect(insertCall[0]).toContain('causa_merma_id');
      expect(insertCall[1]).toContain(CAUSA_MERMA_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // Causa de diferencia (recuento)
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — motivo_diferencia_id', () => {
    it('motivo recuento sin motivoDiferenciaId lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-r1' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'recuento',
          cantidad: '2',
          usuarioId: USER_ID,
          motivoDiferenciaId: MOTIVO_DIFERENCIA_ID,
        },
      );

      const insertCall = managerMock.query.mock.calls[2];
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
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE item_producto stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-c1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
          costoUnitario: '4500',
        },
      );

      // El INSERT del movimiento (3ª llamada) congela lo PAGADO en el kardex: 4500
      const insertCall = managerMock.query.mock.calls[2];
      expect(insertCall[0]).toContain('costo_unitario');
      expect(insertCall[1]).toContain('4500');
      // La 4ª llamada actualiza costo_actual con el promedio ponderado (CPP), no
      // con el costo de compra crudo: (10×4000 + 5×4500) / 15 = 4166.6667.
      // Antes del CPP este valor era '4500' (último costo) — ese era el bug.
      expect(managerMock.query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('costo_actual'),
        ['4166.6667', ITEM_ID],
      );
    });

    it('entrada ajuste_manual con costoUnitario: congela en kardex sin pisar costo_actual', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-c1b' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'ajuste_manual',
          cantidad: '5',
          usuarioId: USER_ID,
          costoUnitario: '4500',
        },
      );

      const insertCall = managerMock.query.mock.calls[2];
      expect(insertCall[1]).toContain('4500');
      expect(managerMock.query).toHaveBeenCalledTimes(3); // sin UPDATE costo_actual
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
              stock: '14',
              modo_inventario: 'cantidad',
              costo_actual: '57.1429',
            },
          ])
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce([{ movimiento_id: 'mov-rev' }])
          .mockResolvedValueOnce(undefined);

        await service.registrarMovimiento(
          managerMock as unknown as EntityManager,
          {
            tenantId: TENANT,
            itemId: ITEM_ID,
            tipo: 'entrada',
            motivo,
            cantidad: '1',
            usuarioId: USER_ID,
            costoUnitario: '50',
          },
        );

        // El kardex congela el costo real de la reposición, no el CPP vigente.
        expect(managerMock.query.mock.calls[2][1]).toContain('50');
        // (14 × 57,1429 + 1 × 50) / 15 = 56,6667.
        expect(managerMock.query).toHaveBeenNthCalledWith(
          4,
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
          { stock: '14', modo_inventario: 'cantidad', costo_actual: '57.1429' },
        ])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-rev2' }]);

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'anulacion',
          cantidad: '1',
          usuarioId: USER_ID,
        },
      );

      expect(managerMock.query).toHaveBeenCalledTimes(3); // sin UPDATE costo_actual
    });

    it('rechaza costoUnitario <= 0', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '4000' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
          costoUnitario: '0',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida sin costoUnitario: congela el costo_actual vigente y no lo modifica', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '4200' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-c2' }]); // INSERT movimiento

      await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '3',
          usuarioId: USER_ID,
        },
      );

      // El INSERT congeló el costo vigente (4200) y no hubo UPDATE de costo_actual
      const insertCall = managerMock.query.mock.calls[2];
      expect(insertCall[1]).toContain('4200');
      expect(managerMock.query).toHaveBeenCalledTimes(3);
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
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '100' },
        ]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ movimiento_id: 'mov-ac1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // UPDATE costo_actual

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '100' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          usuarioId: USER_ID,
          tipo: 'ajuste',
          motivo: 'ajuste_costo',
          cantidad: '3',
          costoUnitario: '250',
        }),
      ).rejects.toThrow('El ajuste de costo no mueve cantidad');
    });

    it('rechaza el ajuste de costo sin costoUnitario', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '100' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          usuarioId: USER_ID,
          tipo: 'ajuste',
          motivo: 'ajuste_costo',
          cantidad: '0',
        }),
      ).rejects.toThrow('El ajuste de costo requiere el costo nuevo');
    });

    it('sigue rechazando cantidad cero en los demás motivos', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '10', modo_inventario: 'cantidad', costo_actual: '100' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
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
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '150' },
        ])
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
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '4.0000' },
        ])
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
      const insert = managerMock.query.mock.calls[2] as [string, unknown[]];
      expect(insert[1]).toContain('5.0500');
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
          { stock: '10', modo_inventario: 'cantidad', costo_actual: '4.0000' },
        ])
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

    it('findMovimientos expone causa y costoPerdido en merma', async () => {
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
            causa_merma_id: CAUSA_MERMA_ID,
            causa_nombre: 'Vencimiento',
          },
        ]);

      const res = await service.findMovimientos(TENANT, {});

      expect(res.data[0]).toMatchObject({
        causaMermaId: CAUSA_MERMA_ID,
        causaNombre: 'Vencimiento',
        costoPerdido: '4201.7500',
      });
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('causa_merma_id'),
        expect.any(Array),
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('causas_merma'),
        expect.any(Array),
      );
    });
  });
});
