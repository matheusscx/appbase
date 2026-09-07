import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { TrasladosService } from './traslados.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import { MotivosTrasladoService } from '../motivos-traslado/motivos-traslado.service';
import type { CreateTrasladoDto } from './dto/create-traslado.dto';

const TENANT = 'tenant-uuid';
const USER = 'user-uuid';
const MOTIVO = 'motivo-uuid';

// UUIDs literales y ordenados a propósito: el contrato de bloqueo es el orden
// por `item_id`, así que el spec necesita saber cuál es "el primero" sin
// depender de la suerte. `A` < `B` con `localeCompare`.
const UBIC_LOCAL = 'a0000000-0000-4000-8000-000000000001';
const UBIC_BODEGA = 'b0000000-0000-4000-8000-000000000002';
const ITEM_A = '11111111-1111-4111-8111-111111111111';
const ITEM_B = '22222222-2222-4222-8222-222222222222';
/** No está en `estado.nombres`: es el ítem que el lock NO encuentra. */
const ITEM_AJENO = '99999999-9999-4999-8999-999999999999';

interface EstadoMock {
  /** Saldo materializado por `${itemId}|${ubicacionId}`. */
  saldos: Map<string, string>;
  ubicaciones: {
    ubicacion_id: string;
    nombre: string;
    tipo: 'local' | 'bodega';
    activo: boolean;
  }[];
  nombres: Map<string, string>;
}

const dto = (over: Partial<CreateTrasladoDto> = {}): CreateTrasladoDto => ({
  origenId: UBIC_BODEGA,
  destinoId: UBIC_LOCAL,
  motivoTrasladoId: MOTIVO,
  lineas: [{ itemId: ITEM_A, cantidad: '5' }],
  ...over,
});

describe('TrasladosService', () => {
  let service: TrasladosService;
  let estado: EstadoMock;
  let transactionQueryMock: jest.Mock;
  let inventarioService: { registrarMovimiento: jest.Mock };
  let itemsService: { comprometidoPorItem: jest.Mock };
  let motivosService: { assertMotivoActivo: jest.Mock };

  /**
   * Los ítems que el statement de lock pidió, en el orden en que se los pasó.
   * Es UN solo statement con `ANY($1) ORDER BY ip.item_id`, así que lo que se
   * afirma es el array y la cláusula, no una secuencia de llamadas.
   */
  const locksTomados = (): string[] => {
    const llamada = transactionQueryMock.mock.calls.find((c) =>
      /FOR UPDATE OF ip/.test(String(c[0])),
    );
    return llamada ? ((llamada[1] as unknown[])[0] as string[]) : [];
  };

  /** Los params de `registrarMovimiento`, en orden de llamada. */
  const movimientos = (): Record<string, unknown>[] =>
    inventarioService.registrarMovimiento.mock.calls.map(
      (c) => c[1] as Record<string, unknown>,
    );

  beforeEach(async () => {
    estado = {
      saldos: new Map(),
      ubicaciones: [
        {
          ubicacion_id: UBIC_LOCAL,
          nombre: 'Local',
          tipo: 'local',
          activo: true,
        },
        {
          ubicacion_id: UBIC_BODEGA,
          nombre: 'Bodega Central',
          tipo: 'bodega',
          activo: true,
        },
      ],
      nombres: new Map([
        [ITEM_A, 'Harina'],
        [ITEM_B, 'Azúcar'],
      ]),
    };

    transactionQueryMock = jest.fn(
      (sql: string, params: unknown[] = []): unknown => {
        if (/FROM ubicaciones/.test(sql)) {
          // Mismo criterio que el de los ítems: el mock queda coherente con
          // la consulta real, y quien mata al mutante que borra la cláusula es
          // el test que la afirma.
          if (params[1] !== TENANT) return [];
          const pedidos = params[0] as string[];
          return estado.ubicaciones.filter((u) =>
            pedidos.includes(u.ubicacion_id),
          );
        }
        if (/FOR UPDATE OF ip/.test(sql)) {
          // Modela el acote por tenant. No es lo que discrimina —todas las
          // llamadas de este spec pasan el tenant correcto, y quien mata al
          // mutante que borra la cláusula es el test que la afirma— pero deja
          // el mock coherente con la consulta real.
          if (params[1] !== TENANT) return [];
          const ids = params[0] as string[];
          return ids
            .filter((i) => estado.nombres.has(i))
            .map((i) => ({ item_id: i, nombre: estado.nombres.get(i)! }));
        }
        if (/FROM stock_ubicacion/.test(sql)) {
          const ubicacionId = params[0] as string;
          const items = params[1] as string[];
          return items
            .filter((i) => estado.saldos.has(`${i}|${ubicacionId}`))
            .map((i) => ({
              item_id: i,
              stock: estado.saldos.get(`${i}|${ubicacionId}`),
            }));
        }
        if (/INSERT INTO traslados/.test(sql)) {
          return [{ traslado_id: 'traslado-1' }];
        }
        // `crear` relee su propia respuesta con `findOne` (una sola forma de
        // armarla). El mock contesta esas dos consultas a partir de lo que se
        // le pidió a `registrarMovimiento`, así que sigue siendo el servicio
        // el que decide qué se movió.
        if (/FROM traslados t/.test(sql)) {
          return [
            {
              traslado_id: 'traslado-1',
              creado_el: new Date('2026-09-07T00:00:00Z'),
              comentario: null,
              ubicacion_origen_id: UBIC_BODEGA,
              origen_nombre: 'Bodega Central',
              ubicacion_destino_id: UBIC_LOCAL,
              destino_nombre: 'Local',
              motivo_traslado_id: MOTIVO,
              motivo_nombre: 'Traslado interno',
              usuario_id: USER,
              usuario_nombre: 'Admin',
              items_movidos: 0,
            },
          ];
        }
        if (/FROM movimientos_inventario mv/.test(sql)) {
          return inventarioService.registrarMovimiento.mock.calls.map(
            (c, i) => {
              const p = c[1] as Record<string, string>;
              return {
                item_id: p.itemId,
                item_nombre: estado.nombres.get(p.itemId) ?? p.itemId,
                unidad_medida: 'kg',
                tipo: p.tipo,
                cantidad: p.cantidad,
                movimiento_id: `mov-${i + 1}`,
                stock_resultante: '0',
              };
            },
          );
        }
        throw new Error(`Query no esperada en el mock: ${sql}`);
      },
    );

    inventarioService = {
      registrarMovimiento: jest.fn().mockImplementation(() =>
        Promise.resolve({
          movimientoId: `mov-${inventarioService.registrarMovimiento.mock.calls.length}`,
          stockAnterior: '0',
          stockResultante: '0',
          costoActualPrevio: '100',
          costoActual: '100',
        }),
      ),
    };
    itemsService = {
      comprometidoPorItem: jest.fn().mockResolvedValue(new Map()),
    };
    motivosService = {
      assertMotivoActivo: jest
        .fn()
        .mockResolvedValue({ id: MOTIVO, nombre: 'Traslado interno' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrasladosService,
        {
          provide: Db,
          useValue: {
            transaccion: (cb: (m: { query: jest.Mock }) => unknown) =>
              cb({ query: transactionQueryMock }),
            query: transactionQueryMock,
          },
        },
        { provide: InventarioService, useValue: inventarioService },
        { provide: ItemsService, useValue: itemsService },
        { provide: MotivosTrasladoService, useValue: motivosService },
      ],
    }).compile();

    service = module.get<TrasladosService>(TrasladosService);
  });

  it('genera DOS movimientos de kardex, uno por ubicación, con el mismo traslado_id', async () => {
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '12');

    await service.crear(
      TENANT,
      USER,
      dto({ lineas: [{ itemId: ITEM_A, cantidad: '5' }] }),
    );

    const movs = movimientos();
    expect(movs).toHaveLength(2);
    expect(movs[0]).toMatchObject({
      tipo: 'salida',
      ubicacionId: UBIC_BODEGA,
      motivo: 'traslado',
      cantidad: '5',
    });
    expect(movs[1]).toMatchObject({
      tipo: 'entrada',
      ubicacionId: UBIC_LOCAL,
      motivo: 'traslado',
      cantidad: '5',
    });
    expect(movs[0].trasladoId).toBe('traslado-1');
    expect(movs[0].trasladoId).toBe(movs[1].trasladoId);
  });

  it('la ENTRADA no pasa costoUnitario: un traslado mueve kilos, no plata', async () => {
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '12');

    await service.crear(TENANT, USER, dto());

    // `undefined` NO alcanza como aserción: lo que importa es que la clave no
    // esté, porque `registrarMovimiento` decide por `!= null`. Si algún día
    // alguien le pasa el costo congelado, la entrada volvería a promediar el
    // costo contra sí mismo e inflaría la valorización en cada traslado.
    for (const mov of movimientos()) {
      expect('costoUnitario' in mov).toBe(false);
    }
  });

  it('rechaza origen igual a destino', async () => {
    // Con saldo de sobra a propósito: sin esto el traslado rebotaría igual por
    // "stock insuficiente" (saldo 0) y el test daría verde aunque el guard no
    // existiera — medido, el mutante que borra el guard sobrevivía.
    estado.saldos.set(`${ITEM_A}|${UBIC_LOCAL}`, '999');

    await expect(
      service.crear(
        TENANT,
        USER,
        dto({ origenId: UBIC_LOCAL, destinoId: UBIC_LOCAL }),
      ),
    ).rejects.toThrow(/origen y el destino/i);
    expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
  });

  it('sacar del LOCAL topea contra lo apartado, no contra lo físico', async () => {
    // 400 g físicos en el local, 400 g apartados por una cuenta abierta.
    estado.saldos.set(`${ITEM_A}|${UBIC_LOCAL}`, '0.4000');
    itemsService.comprometidoPorItem.mockResolvedValue(
      new Map([[ITEM_A, new Decimal('0.4')]]),
    );

    await expect(
      service.crear(
        TENANT,
        USER,
        dto({
          origenId: UBIC_LOCAL,
          destinoId: UBIC_BODEGA,
          lineas: [{ itemId: ITEM_A, cantidad: '0.4' }],
        }),
      ),
    ).rejects.toThrow(/apartad|pedid/i);
    expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
  });

  it('sacar de una BODEGA topea solo contra lo físico', async () => {
    // Mismo escenario, al revés: en una bodega no hay nada apartado porque de
    // ahí no se vende. 400 g en la bodega, 400 g apartados en el local → pasa.
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '0.4000');
    itemsService.comprometidoPorItem.mockResolvedValue(
      new Map([[ITEM_A, new Decimal('0.4')]]),
    );

    await expect(
      service.crear(
        TENANT,
        USER,
        dto({
          origenId: UBIC_BODEGA,
          destinoId: UBIC_LOCAL,
          lineas: [{ itemId: ITEM_A, cantidad: '0.4' }],
        }),
      ),
    ).resolves.toBeDefined();
    // Y ni siquiera se preguntó por lo apartado: de una bodega no se vende.
    expect(itemsService.comprometidoPorItem).not.toHaveBeenCalled();
  });

  it('toma los locks ANTES de leer el comprometido — el orden es el contrato', async () => {
    // Es el mismo contrato que fija `ItemsService.validarStockAlPedir` (y su
    // test homónimo), y acá hacía falta el propio: sin él, mover la lectura
    // arriba del statement de locks pasaba el gate entero en verde. Bajo READ
    // COMMITTED, leer lo apartado ANTES del lock hace que el traslado vea un
    // `apartado` viejo y saque del local lo que una mesa acaba de pedir —
    // `SalonesService.agregarLinea` inserta esa línea dentro de una
    // transacción que lockea estos mismos `item_producto`.
    estado.saldos.set(`${ITEM_A}|${UBIC_LOCAL}`, '50');
    let locksAlLeerComprometido = 0;
    itemsService.comprometidoPorItem.mockImplementation(() => {
      locksAlLeerComprometido = transactionQueryMock.mock.calls.filter((c) =>
        /FOR UPDATE OF ip/.test(String(c[0])),
      ).length;
      return Promise.resolve(new Map());
    });

    await service.crear(
      TENANT,
      USER,
      dto({ origenId: UBIC_LOCAL, destinoId: UBIC_BODEGA }),
    );

    // El statement de lock ya se había emitido cuando se leyó lo apartado.
    expect(locksAlLeerComprometido).toBe(1);
  });

  it('el 400 por saldo insuficiente nombra el producto, lo que falta y el LUGAR', async () => {
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '2');

    await expect(
      service.crear(
        TENANT,
        USER,
        dto({ lineas: [{ itemId: ITEM_A, cantidad: '7' }] }),
      ),
    ).rejects.toThrow(/Harina[\s\S]*5[\s\S]*Bodega Central/);
  });

  it('no traslada HACIA una ubicación desactivada, pero sí DESDE una', async () => {
    // Asimetría deliberada: si una bodega desactivada no pudiera ser origen,
    // su mercadería quedaría encerrada sin forma de sacarla.
    estado.ubicaciones[1].activo = false;
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '12');

    // Hacia la bodega apagada: 400.
    estado.saldos.set(`${ITEM_A}|${UBIC_LOCAL}`, '12');
    await expect(
      service.crear(
        TENANT,
        USER,
        dto({ origenId: UBIC_LOCAL, destinoId: UBIC_BODEGA }),
      ),
    ).rejects.toThrow(/desactivada|inactiva/i);

    // Desde la bodega apagada: pasa.
    await expect(
      service.crear(
        TENANT,
        USER,
        dto({ origenId: UBIC_BODEGA, destinoId: UBIC_LOCAL }),
      ),
    ).resolves.toBeDefined();
  });

  it('lockea UNA fila de item_producto por ítem, ordenada por itemId — no origen→destino', async () => {
    // ⚠️ Contra el texto original de la tarea, que pedía ordenar pares
    // `(itemId, ubicacionId)`: el ancla del `FOR UPDATE` es `item_producto`,
    // que tiene UNA fila por ítem sin importar cuántas ubicaciones toque el
    // traslado (`docs/patterns/backend.md` §15). Así que lo que hay que fijar
    // es que se pida una sola vez por ítem y en orden de `item_id`, no que se
    // pidan dos filas por ítem.
    estado.saldos.set(`${ITEM_A}|${UBIC_LOCAL}`, '50');
    estado.saldos.set(`${ITEM_B}|${UBIC_LOCAL}`, '50');

    await service.crear(
      TENANT,
      USER,
      dto({
        origenId: UBIC_LOCAL,
        destinoId: UBIC_BODEGA,
        // Al revés del orden de bloqueo a propósito: es lo que manda el
        // cliente, y es exactamente lo que el servicio no debe respetar.
        lineas: [
          { itemId: ITEM_B, cantidad: '3' },
          { itemId: ITEM_A, cantidad: '7' },
        ],
      }),
    );

    expect(locksTomados()).toEqual([ITEM_A, ITEM_B]);

    // Y la cláusula que de verdad fija el orden de adquisición dentro del
    // statement: el array podría llegar ordenado y el `ORDER BY` faltar, y
    // entonces Postgres lockearía en orden de plan. Medido en el stack: sin
    // `ORDER BY` el plan es un Hash Join sobre Seq Scans, o sea orden físico.
    const sql = String(
      transactionQueryMock.mock.calls.find((c) =>
        /FOR UPDATE OF ip/.test(String(c[0])),
      )![0],
    );
    expect(sql).toContain('ORDER BY ip.item_id');
    expect(sql.trimEnd()).toMatch(/FOR UPDATE OF ip$/);
  });

  it('los movimientos también salen en orden de itemId, no en el del body', async () => {
    // ⚠️ Esto NO es una defensa contra deadlock: cuando se llama a
    // `moverLinea` la transacción ya sostiene el ancla de todos los ítems (el
    // statement único de más arriba), así que el `FOR UPDATE OF ip` que vuelve
    // a pedir `registrarMovimiento` recae sobre una fila propia y se concede
    // al instante — medido en el e2e, sacar solo este `sort` no produce
    // ningún deadlock. Lo que fija es que el kardex salga en un orden
    // determinista y no en el que mandó el cliente, para que dos traslados
    // idénticos dejen filas comparables.
    estado.saldos.set(`${ITEM_A}|${UBIC_LOCAL}`, '50');
    estado.saldos.set(`${ITEM_B}|${UBIC_LOCAL}`, '50');

    await service.crear(
      TENANT,
      USER,
      dto({
        origenId: UBIC_LOCAL,
        destinoId: UBIC_BODEGA,
        lineas: [
          { itemId: ITEM_B, cantidad: '3' },
          { itemId: ITEM_A, cantidad: '7' },
        ],
      }),
    );

    expect(movimientos().map((m) => m.itemId)).toEqual([
      ITEM_A,
      ITEM_A,
      ITEM_B,
      ITEM_B,
    ]);
  });

  it('suma las líneas del mismo ítem antes de topear', async () => {
    // Dos líneas del mismo producto (dos lotes distintos, por ejemplo) no
    // pueden topear cada una por su cuenta contra el saldo entero: sumadas se
    // llevan más de lo que hay.
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '10');

    await expect(
      service.crear(
        TENANT,
        USER,
        dto({
          lineas: [
            { itemId: ITEM_A, cantidad: '6' },
            { itemId: ITEM_A, cantidad: '6' },
          ],
        }),
      ),
    ).rejects.toThrow(/Harina/);
    expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
  });

  it('valida el motivo ANTES de tomar ningún lock', async () => {
    motivosService.assertMotivoActivo.mockRejectedValueOnce(
      new BadRequestException('Motivo de traslado no válido o inactivo'),
    );

    await expect(service.crear(TENANT, USER, dto())).rejects.toThrow(
      /Motivo de traslado/,
    );
    expect(locksTomados()).toEqual([]);
  });

  it('valida las ubicaciones ANTES de tomar ningún lock', async () => {
    // La ubicación no existe para este tenant: 404 y ni un lock pedido. El
    // test anterior solo cubría el motivo, así que este camino —el que recibe
    // ids del body— no tenía red propia.
    await expect(
      service.crear(
        TENANT,
        USER,
        dto({ destinoId: 'c0000000-0000-4000-8000-000000000003' }),
      ),
    ).rejects.toThrow(/Ubicación no encontrada/);
    expect(locksTomados()).toEqual([]);
    expect(motivosService.assertMotivoActivo).not.toHaveBeenCalled();
  });

  it('un ítem que no existe (o es de otro tenant) rebota con el mensaje opaco', async () => {
    // El mensaje es deliberadamente indistinguible entre "no existe", "no es
    // producto" y "es de otro tenant": si no, la respuesta se vuelve un
    // oráculo que confirma qué ítems existen en otros tenants. Es el mismo
    // criterio del chokepoint.
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '12');

    await expect(
      service.crear(
        TENANT,
        USER,
        dto({ lineas: [{ itemId: ITEM_AJENO, cantidad: '1' }] }),
      ),
    ).rejects.toThrow(/no tiene control de stock/);
    // Sin traslado insertado: el guard corre antes del documento. Se afirma
    // el INSERT y no solo la ausencia de movimientos — el comentario nombraba
    // una propiedad que el test no medía.
    expect(
      transactionQueryMock.mock.calls.some((c) =>
        /INSERT INTO traslados/.test(String(c[0])),
      ),
    ).toBe(false);
    expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
  });

  it('los ítems se lockean ACOTADOS al tenant, no solo por id', async () => {
    // `itemId` entra por el body y esta cláusula es su única defensa
    // multi-tenant en este service. Se afirma la CLÁUSULA y no solo el efecto:
    // un mutante que la borre y siga pasando el parámetro evadiría cualquier
    // aserción sobre el resultado.
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '12');
    await service.crear(TENANT, USER, dto());

    const sql = String(
      transactionQueryMock.mock.calls.find((c) =>
        /FOR UPDATE OF ip/.test(String(c[0])),
      )![0],
    );
    expect(sql).toMatch(/i\.tenant_id = \$2/);
  });

  it('las ubicaciones se buscan ACOTADAS al tenant, no solo por id', async () => {
    // Es la única defensa multi-tenant de un endpoint que recibe `origenId` y
    // `destinoId` del body, así que se afirma la cláusula y no solo el efecto:
    // el mock de arriba modela el acote, pero un mutante que borre
    // `AND tenant_id = $2` del SQL y siga pasando el parámetro lo evadiría.
    estado.saldos.set(`${ITEM_A}|${UBIC_BODEGA}`, '12');
    await service.crear(TENANT, USER, dto());

    const sql = String(
      transactionQueryMock.mock.calls.find((c) =>
        /FROM ubicaciones/.test(String(c[0])),
      )![0],
    );
    expect(sql).toMatch(/WHERE[\s\S]*tenant_id = \$2/);
  });
});
