import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { RecargosService } from './recargos.service';
import { Recargo } from './entities/recargo.entity';
import { RecargoTramo } from './entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './entities/recargo-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CondicionTipo, NivelRegla } from '../../common/enums/reglas.enums';

const TENANT = 'tenant-uuid';
const USUARIO_ID = 'usuario-uuid';

function makeTipo(codigo: string, clase: string = 'recargo') {
  return { id: `tipo-${codigo}`, codigo, clase, nombre: `Tipo ${codigo}` };
}

describe('RecargosService', () => {
  let service: RecargosService;
  let qbMock: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
    leftJoin: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    withDeleted: jest.Mock;
    orderBy: jest.Mock;
    getRawAndEntities: jest.Mock;
    getRawMany: jest.Mock;
  };
  let managerMock: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
  };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  let recargoRepoMock: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let tipoReglaRepoMock: { findOne: jest.Mock; find: jest.Mock };
  let tramoRepoMock: { find: jest.Mock; count: jest.Mock };
  let metodoPagoRepoMock: { find: jest.Mock; count: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
      getRawMany: jest.fn().mockResolvedValue([]),
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
      query: jest.fn().mockResolvedValue([]),
    };
    const dbMock = {
      transaccion: dataSourceMock.transaction,
      query: dataSourceMock.query,
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    recargoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qbMock),
    };

    tipoReglaRepoMock = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    tramoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      // `validarEstadoResultante` cuenta tramos/métodos cuando el PATCH no los
      // trae: sin esto, cualquier test que cambie de tipo explota con TypeError.
      count: jest.fn().mockResolvedValue(0),
    };
    metodoPagoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      // `validarEstadoResultante` cuenta tramos/métodos cuando el PATCH no los
      // trae: sin esto, cualquier test que cambie de tipo explota con TypeError.
      count: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecargosService,
        { provide: Db, useValue: dbMock },
        { provide: getRepositoryToken(Recargo), useValue: recargoRepoMock },
        { provide: getRepositoryToken(TipoRegla), useValue: tipoReglaRepoMock },
        {
          provide: getRepositoryToken(RecargoTramo),
          useValue: tramoRepoMock,
        },
        {
          provide: getRepositoryToken(RecargoMetodoPago),
          useValue: metodoPagoRepoMock,
        },
      ],
    }).compile();

    service = module.get<RecargosService>(RecargosService);
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects when tipoRegla does not exist', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.create(TENANT, { nombre: 'X', tipoReglaId: 'tr-x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when tipo clase is not recargo', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('pronto_pago', 'descuento'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'X',
          tipoReglaId: 'tipo-pronto_pago',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates general recargo with modo and valor', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await service.create(TENANT, {
        nombre: 'Recargo general',
        tipoReglaId: 'tipo-general',
        valorPorcentaje: '0.05',
        modo: 'porcentaje',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(1);
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({
        condicionTipo: CondicionTipo.NINGUNA,
        condicionValor: null,
      });
    });

    it('rechaza un tramo en porcentaje con valor >= 1', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await expect(
        service.create(TENANT, {
          nombre: 'Recargo con tramo',
          tipoReglaId: 'tipo-general',
          valorPorcentaje: '0.05',
          modo: 'porcentaje',
          tramos: [{ minimoMonto: '10', valorPorcentaje: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
    });

    it('rejects general without valor', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await expect(
        service.create(TENANT, {
          nombre: 'General sin valor',
          tipoReglaId: 'tipo-general',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('crea un recargo por monto de venta con tramos y sin valor único', async () => {
      // El tipo nuevo (2026-08-22) expresa su magnitud con tramos, igual que
      // `por_monto_venta` del lado de los descuentos: pedirle además un `valor`
      // sería pedir dos veces lo mismo.
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );
      await service.create(TENANT, {
        nombre: 'Recargo por pedido chico',
        tipoReglaId: 'tipo-monto',
        modo: 'monto_fijo',
        tramos: [
          { minimoMonto: '0', valorMonto: '2000' },
          { minimoMonto: '20000', valorMonto: '500' },
        ],
      });
      expect(managerMock.save).toHaveBeenCalled();
    });

    it('rechaza un recargo por monto de venta sin tramos', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Sin tramos',
          tipoReglaId: 'tipo-monto',
          modo: 'monto_fijo',
          valorMonto: '2000',
        }),
      ).rejects.toThrow(/al menos un tramo/);
    });

    it('creates mora with diasVencimiento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await service.create(TENANT, {
        nombre: 'Mora',
        tipoReglaId: 'tipo-mora',
        diasVencimiento: 30,
        valorPorcentaje: '0.05',
        modo: 'porcentaje',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '30',
      });
    });

    it('rejects mora without diasVencimiento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await expect(
        service.create(TENANT, {
          nombre: 'Mora sin dias',
          tipoReglaId: 'tipo-mora',
          valorPorcentaje: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects mora with diasVencimiento out of range (> 365)', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await expect(
        service.create(TENANT, {
          nombre: 'Mora fuera rango',
          tipoReglaId: 'tipo-mora',
          diasVencimiento: 400,
          valorPorcentaje: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates recargo_metodo_pago with metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await service.create(TENANT, {
        nombre: 'Recargo MP',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        metodoPagoIds: ['mp-1'],
        valorPorcentaje: '0.03',
        modo: 'porcentaje',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(2);
      const [, metodoArgs] = managerMock.save.mock.calls as Array<[unknown[]]>;
      expect(metodoArgs[0]).toHaveLength(1);
    });

    it('rejects recargo_metodo_pago without metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Recargo MP',
          tipoReglaId: 'tipo-recargo_metodo_pago',
          valorPorcentaje: '0.03',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates interes_simple and forces modo=porcentaje', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('interes_simple'));
      await service.create(TENANT, {
        nombre: 'Interés simple',
        tipoReglaId: 'tipo-interes_simple',
        valorPorcentaje: '0.02',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({ modo: 'porcentaje' });
    });

    it('creates interes_compuesto and forces modo=porcentaje', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('interes_compuesto'),
      );
      await service.create(TENANT, {
        nombre: 'Interés compuesto',
        tipoReglaId: 'tipo-interes_compuesto',
        valorPorcentaje: '0.02',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({ modo: 'porcentaje' });
    });

    it('rejects duplicate nombre', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      qbMock.getCount.mockResolvedValue(1);
      await expect(
        service.create(TENANT, {
          nombre: 'Existing',
          tipoReglaId: 'tipo-general',
          valorPorcentaje: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  /**
   * `recargo_metodo_pago` es el primer tipo que admite las DOS formas de
   * cobrar y tiene que elegir una (decisión del owner, 2026-08-25): el método
   * de pago es la CONDICIÓN de la regla, no su forma de importe.
   */
  describe('recargo_metodo_pago elige forma: valor único o escalones', () => {
    it('crea uno por escalones, sin valor único', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await service.create(TENANT, {
        nombre: 'Tarjeta por tramos',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        metodoPagoIds: ['mp-1'],
        modo: 'porcentaje',
        tramos: [
          { minimoMonto: '0', valorPorcentaje: '0.03' },
          { minimoMonto: '100000', valorPorcentaje: '0.015' },
        ],
      });
      expect(managerMock.save).toHaveBeenCalled();
    });

    it('rechaza las dos formas juntas', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Tarjeta ambigua',
          tipoReglaId: 'tipo-recargo_metodo_pago',
          metodoPagoIds: ['mp-1'],
          modo: 'porcentaje',
          valorPorcentaje: '0.03',
          tramos: [{ minimoMonto: '0', valorPorcentaje: '0.02' }],
        }),
      ).rejects.toThrow(/una sola forma/);
    });

    it('rechaza ninguna de las dos', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Tarjeta muda',
          tipoReglaId: 'tipo-recargo_metodo_pago',
          metodoPagoIds: ['mp-1'],
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(/tiene que expresar su importe/);
    });

    it('sus escalones miden monto de venta, no cantidad', async () => {
      // Sin `admiteTramos`, el código que llega a `validarMinimosDeTramos`
      // sería `null` y un umbral "desde 3 unidades" entraría con 201.
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Tarjeta por unidades',
          tipoReglaId: 'tipo-recargo_metodo_pago',
          metodoPagoIds: ['mp-1'],
          modo: 'porcentaje',
          tramos: [{ minimoCantidad: '3', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/minimoMonto/);
    });

    it('un PATCH que agrega escalones sin apagar el valor único es 400', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-mp',
        tenantId: TENANT,
        nombre: 'Tarjeta',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.03',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      metodoPagoRepoMock.count.mockResolvedValue(1);

      await expect(
        service.update(TENANT, 'r-mp', {
          tramos: [{ minimoMonto: '0', valorPorcentaje: '0.02' }],
        }),
      ).rejects.toThrow(/una sola forma/);
    });

    it('un PATCH puede volver de escalones a valor único con tramos: []', async () => {
      // La vuelta del interruptor. `tramos: []` es 400 para los demás tipos
      // —"requiere al menos un tramo"—, y sin la excepción esta mitad del
      // interruptor no tendría vuelta.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-mp2',
        tenantId: TENANT,
        nombre: 'Tarjeta',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      metodoPagoRepoMock.count.mockResolvedValue(1);

      await expect(
        service.update(TENANT, 'r-mp2', {
          tramos: [],
          valorPorcentaje: '0.03',
        }),
      ).resolves.toBeDefined();
    });

    it('pero vaciar los escalones sin poner valor único es 400', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-mp3',
        tenantId: TENANT,
        nombre: 'Tarjeta',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      metodoPagoRepoMock.count.mockResolvedValue(1);

      await expect(
        service.update(TENANT, 'r-mp3', { tramos: [] }),
      ).rejects.toThrow(/tiene que expresar su importe/);
    });
  });

  /**
   * El hermano del describe de arriba: los tipos que **no** eligen forma.
   * `general` cobra un valor único y `recargo_por_monto_venta` cobra por escalones —
   * mandarle a cada uno la forma que no le toca entraba con **201** hasta el
   * 2026-08-26, medido con una sonda sobre este mismo harness antes de tocar
   * nada.
   *
   * Lo que lo hacía dañino es el motor, que no se tocó: `evaluarRegla`
   * ramifica por `tramos.length > 0` **antes** de mirar el valor plano, así
   * que la fila con las dos formas llenas cobraba una y dejaba la otra muerta
   * sin avisar. El owner decidió CERRAR el 2026-08-25, sabiendo que la
   * simétrica —método de pago— se había abierto ese mismo día.
   */
  describe('los tipos que no eligen forma de importe', () => {
    it('general con valor único Y escalones es 400', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await expect(
        service.create(TENANT, {
          nombre: 'General ambiguo',
          tipoReglaId: 'tipo-general',
          modo: 'porcentaje',
          valorPorcentaje: '0.50',
          tramos: [{ minimoMonto: '100', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/no admite escalones/);
    });

    it('y un PATCH que se los agrega también', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-unico',
        tenantId: TENANT,
        nombre: 'General',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.20',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await expect(
        service.update(TENANT, 'r-unico', {
          tramos: [{ minimoMonto: '100', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/no admite escalones/);
    });

    it('recargo_por_monto_venta con escalones Y valor plano es 400', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Por monto de venta ambiguo',
          tipoReglaId: 'tipo-recargo_por_monto_venta',
          modo: 'porcentaje',
          valorPorcentaje: '0.50',
          tramos: [{ minimoMonto: '500', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/no admite un valor único/);
    });

    // Los escalones guardados se leen de la BD: sin eso, `tramosFinales` queda
    // vacío y gana el 400 de "requiere al menos un tramo", que es otro chequeo
    // y taparía a éste.
    it('y un PATCH que le agrega el valor plano también', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-tramos',
        tenantId: TENANT,
        nombre: 'Por monto de venta',
        tipoReglaId: 'tipo-recargo_por_monto_venta',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );
      tramoRepoMock.find.mockResolvedValue([
        { minimoMonto: '500', valorPorcentaje: '0.10' },
      ]);

      await expect(
        service.update(TENANT, 'r-tramos', { valorPorcentaje: '0.50' }),
      ).rejects.toThrow(/no admite un valor único/);
    });

    // La salida del estado prohibido. Sin esto el guardia de arriba no tiene
    // puerta: al cambiar de tipo los escalones del tipo viejo quedan vivos en
    // la BD —`update` solo reemplaza hijos que vengan en el DTO— y el `PATCH`
    // choca contra el guardia sin forma de limpiarlos. Mandar `tramos: []` es
    // esa forma, y hasta el 2026-08-26 rebotaba con *"requiere al menos un
    // tramo"* sobre un tipo que no admite ninguno.
    it('y `tramos: []` es la salida: limpia los huérfanos del tipo viejo', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-cambio',
        tenantId: TENANT,
        nombre: 'Por monto de venta',
        tipoReglaId: 'tipo-recargo_por_monto_venta',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      tramoRepoMock.find.mockResolvedValue([
        { minimoMonto: '500', valorPorcentaje: '0.10' },
      ]);

      await expect(
        service.update(TENANT, 'r-cambio', {
          tipoReglaId: 'tipo-general',
          valorPorcentaje: '0.25',
          tramos: [],
        }),
      ).resolves.toBeDefined();
    });

    // Ancla del otro lado: el tipo que EXIGE escalones sigue rechazando el
    // vaciado. Sin esto, la condición podría invertirse del todo y nadie se
    // enteraría.
    it('pero el tipo que exige escalones sigue rechazando `tramos: []`', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-exige',
        tenantId: TENANT,
        nombre: 'Por monto de venta',
        tipoReglaId: 'tipo-recargo_por_monto_venta',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );

      await expect(
        service.update(TENANT, 'r-exige', { tramos: [] }),
      ).rejects.toThrow(/al menos un tramo/);
    });

    // La dirección ESPEJO del par de arriba, que la primera versión de este
    // frente dejó rota: de valor único a un tipo POR ESCALONES. Acá el huérfano
    // es el valor persistido, que `importeResultante` lee cuando el PATCH no
    // manda la columna.
    it('cambiar a un tipo por escalones sin apagar el valor es 400', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-espejo',
        tenantId: TENANT,
        nombre: 'General',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.20',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );

      await expect(
        service.update(TENANT, 'r-espejo', {
          tipoReglaId: 'tipo-recargo_por_monto_venta',
          tramos: [{ minimoMonto: '500', valorPorcentaje: '0.10' }],
        }),
      ).rejects.toThrow(/no admite un valor único/);
    });

    it('y apagando esa columna en el mismo body sí pasa', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-espejo2',
        tenantId: TENANT,
        nombre: 'General',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.20',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );

      await expect(
        service.update(TENANT, 'r-espejo2', {
          tipoReglaId: 'tipo-recargo_por_monto_venta',
          valorPorcentaje: null,
          tramos: [{ minimoMonto: '500', valorPorcentaje: '0.10' }],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    it('throws NotFoundException when recargo not found', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.update(TENANT, 'x', { nombre: 'nuevo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('un PATCH de valor sobre una regla monto_fijo no lo lee como porcentaje', async () => {
      // Gemelo del de descuentos: rechazaba con 400 una edición legítima por
      // asumir `porcentaje` cuando el DTO no reenviaba el modo.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-fijo',
        tenantId: TENANT,
        nombre: 'Servicio',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'monto_fijo',
        valorMonto: '1000',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await expect(
        service.update(TENANT, 'r-fijo', { valorMonto: '5000' }),
      ).resolves.toBeDefined();
    });

    it('cambiar de modo con su importe APAGA la columna abandonada', async () => {
      // Es la acción más común del drawer: editar y pasar de monto fijo a
      // porcentaje. Si la columna vieja no se apaga, la fila queda con las dos
      // llenas y el CHECK de tabla la rechaza: 500 en vez de guardar.
      // Sin este test, borrar el apagado deja el gate ENTERO en verde.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-fijo-a-pct',
        tenantId: TENANT,
        nombre: 'Mil pesos',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'monto_fijo',
        valorMonto: '1000',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      const res = await service.update(TENANT, 'r-fijo-a-pct', {
        modo: 'porcentaje',
        valorPorcentaje: '0.15',
      });

      expect(res).toMatchObject({
        modo: 'porcentaje',
        valorPorcentaje: '0.15',
        valorMonto: null,
      });
    });

    it('rechaza un PATCH que manda la columna que no corresponde al modo', async () => {
      // El 400 tiene que salir en el borde y decir cuál columna corresponde.
      // Descartarla en silencio guardaría algo distinto de lo que se tecleó.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-pct',
        tenantId: TENANT,
        nombre: 'Diez por ciento',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.10',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await expect(
        service.update(TENANT, 'r-pct', { valorMonto: '5000' }),
      ).rejects.toThrow(/el importe va en valorPorcentaje/);
    });

    it('lo dice igual cuando el PATCH apaga de paso la columna correcta', async () => {
      // Gemelo del de descuentos: mandar las DOS columnas —la buena en `null`,
      // la equivocada con el número— deja la fila resultante sin importe, y el
      // chequeo de "requerido" contestaba antes de que nadie mirara el `5000`
      // que sí vino.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-pct-2',
        tenantId: TENANT,
        nombre: 'Diez por ciento',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.10',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await expect(
        service.update(TENANT, 'r-pct-2', {
          valorPorcentaje: null,
          valorMonto: '5000',
        }),
      ).rejects.toThrow(/el importe va en valorPorcentaje/);
    });

    it('valida los tramos aunque ningún tipo de recargo los pida', async () => {
      // La plomería de tramos es alcanzable por API y el motor los evalúa
      // mirando `tramos.length` antes que el código del tipo.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-tramos',
        tenantId: TENANT,
        nombre: 'Rec tramos',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.10',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await expect(
        service.update(TENANT, 'r-tramos', {
          tramos: [{ minimoMonto: '10', valorPorcentaje: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
    });

    it('rechaza cambiar el tipo a por-monto-de-venta si la regla no tiene tramos', async () => {
      // El PATCH no trae tramos: los que valen son los que la fila YA tiene.
      // Sin esto, un cambio de `tipoReglaId` deja una regla del tipo que se
      // expresa por tramos sin ningún tramo, y el motor no le cobra nada.
      // (Un `tramos: []` explícito ya lo rechazaba la plomería vieja para
      // cualquier tipo, así que ese caso NO discrimina esta regla.)
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-general',
        tenantId: TENANT,
        nombre: 'Era general',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'monto_fijo',
        valorMonto: '3000',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_por_monto_venta'),
      );
      tramoRepoMock.find.mockResolvedValue([]);

      await expect(
        service.update(TENANT, 'r-general', { tipoReglaId: 'tipo-monto' }),
      ).rejects.toThrow(/al menos un tramo/);
    });

    it('replaces metodoPagoIds on update via soft-stamp', async () => {
      const existing = {
        id: 'r-1',
        tenantId: TENANT,
        nombre: 'Rec MP',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
      };
      recargoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );

      await service.update(TENANT, 'r-1', {
        tipoReglaId: 'tipo-recargo_metodo_pago',
        metodoPagoIds: ['mp-5'],
        valorPorcentaje: '0.03',
        modo: 'porcentaje',
      });

      expect(managerMock.update).toHaveBeenCalledWith(
        RecargoMetodoPago,
        { recargoId: 'r-1' },
        expect.objectContaining({ eliminadoEl: expect.any(Date) }),
      );
      const typedCalls = managerMock.save.mock.calls as Array<[unknown[]]>;
      const lastCallArgs = typedCalls[typedCalls.length - 1];
      expect(lastCallArgs[0]).toHaveLength(1);
    });

    it('does not touch children when not in dto (partial update)', async () => {
      const existing = {
        id: 'r-2',
        tenantId: TENANT,
        nombre: 'Rec',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        // Un recargo `general` VÁLIDO tiene valorPorcentaje: sin esto la fixture
        // representa un estado que el sistema ya no permite.
        valorPorcentaje: '0.05',
      };
      recargoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await service.update(TENANT, 'r-2', { activo: false });

      expect(managerMock.softDelete).not.toHaveBeenCalled();
      expect(managerMock.update).not.toHaveBeenCalled();
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws NotFoundException when recargo not found', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, USUARIO_ID, 'x')).rejects.toThrow(
        NotFoundException,
      );
      expect(recargoRepoMock.update).not.toHaveBeenCalled();
    });

    it('remove() registra quién borró y cuándo, en una sola escritura', async () => {
      recargoRepoMock.findOne.mockResolvedValue({ id: 'r1', tenantId: TENANT });
      await service.remove(TENANT, USUARIO_ID, 'r1');
      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  // ─── restaurar ──────────────────────────────────────────────────────────

  describe('restaurar', () => {
    it('restaurar() devuelve el recargo RE-CONSULTADO tras el restore', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Rec (en la papelera)',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.findOneOrFail.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Rec',
        eliminadoEl: null,
      });

      const restaurado = await service.restaurar(TENANT, 'r1');

      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
      expect(recargoRepoMock.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 'r1', tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('Rec');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      recargoRepoMock.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, 'r1')).rejects.toThrow(
        NotFoundException,
      );
      expect(recargoRepoMock.update).not.toHaveBeenCalled();
    });

    it('restaurar() un recargo vivo (no eliminado) es 404', async () => {
      recargoRepoMock.findOne.mockResolvedValueOnce({
        id: 'r1',
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, 'r1')).rejects.toThrow(
        NotFoundException,
      );
      expect(recargoRepoMock.update).not.toHaveBeenCalled();
    });

    // `uq_recargos_tenant_nombre_vivo` es parcial (WHERE eliminado_el IS NULL):
    // mientras el recargo estaba borrado, otro pudo tomar su nombre. El UPDATE
    // que lo revive vuelve a hacerlo competir y Postgres responde 23505. Sin
    // traducirlo, el usuario recibe un 500.
    it('restaurar() con el nombre ya ocupado por un recargo vivo es 400, no 500', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );

      await expect(service.restaurar(TENANT, 'r1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // No debe intentar releer la fila si el restore falló.
      expect(recargoRepoMock.findOneOrFail).not.toHaveBeenCalled();
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      );

      await expect(service.restaurar(TENANT, 'r1')).rejects.toThrow(
        'deadlock detected',
      );
    });

    // El 400 no puede ser solo un "no se pudo": la pantalla precarga
    // `nombreSugerido` en el campo del modal, así que si el backend deja de
    // mandarlo el usuario vuelve a quedar adivinando qué nombre está libre.
    it('el 400 de colisión trae un nombre libre ya calculado, salteando los tomados', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      qbMock.getRawMany.mockResolvedValueOnce([
        { nombre: 'Recargo finde' },
        { nombre: 'Recargo finde 2' },
      ]);

      await expect(service.restaurar(TENANT, 'r1')).rejects.toMatchObject({
        response: {
          message: 'Ya existe un recargo activo con el nombre "Recargo finde".',
          nombreSugerido: 'Recargo finde 3',
        },
      });
    });

    // La sugerencia tiene que ignorar mayúsculas porque el índice es sobre
    // `lower(nombre)`: si propusiera un nombre que la base considera tomado, el
    // usuario confirmaría el modal y recibiría el mismo 400.
    it('la sugerencia saltea los tomados sin importar mayúsculas', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      qbMock.getRawMany.mockResolvedValueOnce([
        { nombre: 'RECARGO FINDE' },
        { nombre: 'recargo finde 2' },
      ]);

      await expect(service.restaurar(TENANT, 'r1')).rejects.toMatchObject({
        response: { nombreSugerido: 'Recargo finde 3' },
      });
    });

    it('con `nombreNuevo` libre, restaura Y renombra en la misma escritura', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.findOneOrFail.mockResolvedValue({ id: 'r1' });

      await service.restaurar(TENANT, 'r1', 'Recargo finde 2');

      // Una sola escritura con las tres columnas: revivir y renombrar en dos
      // sentencias podría dejar la fila viva con el nombre que colisiona.
      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          nombre: 'Recargo finde 2',
        },
      );
    });

    it('sin `nombreNuevo` no toca el nombre (comportamiento de siempre)', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.findOneOrFail.mockResolvedValue({ id: 'r1' });

      await service.restaurar(TENANT, 'r1');

      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
    });
  });

  // ─── findAll con incluirEliminados ────────────────────────────────────────

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados', async () => {
      await service.findAll(TENANT);

      expect(recargoRepoMock.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ withDeleted: true }),
      );
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const recargoEliminado = {
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Rec',
        tipoReglaId: 'tipo-x',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      };
      qbMock.getRawAndEntities.mockResolvedValue({
        entities: [recargoEliminado],
        raw: [{ r_eliminado_por_nombre: 'admin.paris' }],
      });

      const result = await service.findAll(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      // Sin esta aserción el test no probaba nada de lo que su nombre dice:
      // borrando el `.andWhere(...)` del service la suite unitaria seguía
      // 100% verde y el agujero solo aparecía al levantar Postgres.
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(r.eliminado_el IS NULL OR r.eliminado_por IS NOT NULL)',
      );
      // Y el ORDEN, que `toHaveBeenCalledWith` no mira: `where()` resetea
      // `expressionMap.wheres`, así que un `andWhere` que quede arriba se
      // descarta entero y el listado se queda sin filtro.
      expect(qbMock.andWhere.mock.invocationCallOrder[0]).toBeGreaterThan(
        qbMock.where.mock.invocationCallOrder[0],
      );
      expect(result[0]).toMatchObject({
        id: 'r1',
        eliminadoPorNombre: 'admin.paris',
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

    // Ver descuentos.service.spec.ts: mismo motivo. Este endpoint es público y
    // si comparara exacto diría "libre" donde el índice sobre `lower(nombre)`
    // va a rechazar.
    it('compara el nombre ignorando mayúsculas, igual que el índice', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Recargo finde');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'LOWER(r.nombre) = LOWER(:nombre)',
        { nombre: 'Recargo finde' },
      );
    });

    it('adds excludeId condition when provided', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Nombre', 'some-id');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('recargo_id'),
        expect.objectContaining({ excludeId: 'some-id' }),
      );
    });
  });

  // ─── Todo recargo expresa su monto ────────────────────────────────────────
  // `create()` ya exigía valor en los 5 tipos, pero `update()` dejaba vaciarlo
  // por PATCH: un `{ "valor": null }` respondía 200 y dejaba un interés sin
  // tasa — entrada directa del motor de precios. Verificado contra la API real.
  // La regla del owner era sobre descuentos; acá se aplica la que este módulo
  // YA tenía en `create()`, no una nueva.
  describe('todo recargo expresa su monto', () => {
    it('rechaza vaciar el valor por PATCH', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Interés',
        tipoReglaId: 'tipo-interes_simple',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('interes_simple'));

      await expect(
        service.update(TENANT, 'r1', { valorPorcentaje: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('un PATCH que no toca el valor sigue funcionando (ancla positiva)', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Interés',
        tipoReglaId: 'tipo-interes_simple',
        valorPorcentaje: '0.05',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('interes_simple'));

      await expect(
        service.update(TENANT, 'r1', { nombre: 'Interés renombrado' }),
      ).resolves.toBeDefined();
    });
  });

  // ─── obtenerUso ─────────────────────────────────────────────────────────

  describe('obtenerUso', () => {
    it('lanza NotFound si el recargo no pertenece al tenant', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);

      await expect(service.obtenerUso(TENANT, 'r1')).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSourceMock.query).not.toHaveBeenCalled();
    });

    it('devuelve los ítems que usan el recargo', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo tarjeta',
      });
      dataSourceMock.query.mockResolvedValue([
        { id: 'item-1', nombre: 'Café' },
        { id: 'item-2', nombre: 'Torta' },
      ]);

      const result = await service.obtenerUso(TENANT, 'r1');

      expect(dataSourceMock.query).toHaveBeenCalledWith(
        expect.stringContaining('item_recargos'),
        ['r1', TENANT],
      );
      expect(result).toEqual({
        items: [
          { id: 'item-1', nombre: 'Café' },
          { id: 'item-2', nombre: 'Torta' },
        ],
      });
    });

    /**
     * ⚠️ **Esta lectura NO filtra `eliminado_el`, y es la excepción documentada
     * al invariante de soft delete** (decisión del owner, 2026-08-25). El guard
     * de `validarCambioDeNivel` CUENTA las filas puente de los ítems en la
     * papelera —tiene que contarlas—, así que un endpoint que solo listara los
     * vivos dejaba al admin leyendo *"1 ítem todavía lo tiene"* sin forma de
     * saber cuál.
     */
    it('incluye los ítems en la papelera, marcados con `eliminado`', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Con uno borrado',
      });
      dataSourceMock.query.mockResolvedValue([
        { id: 'item-1', nombre: 'Café', eliminado: false },
        { id: 'item-2', nombre: 'Torta vieja', eliminado: true },
      ]);

      const result = await service.obtenerUso(TENANT, 'r1');

      expect(result.items).toEqual([
        { id: 'item-1', nombre: 'Café', eliminado: false },
        { id: 'item-2', nombre: 'Torta vieja', eliminado: true },
      ]);
    });

    it('su consulta no descarta los borrados', async () => {
      // El mutante que esto caza es restaurar el `AND i.eliminado_el IS NULL`
      // del JOIN, que es como estaba antes. Se afirma sobre la CLÁUSULA exacta
      // y no sobre la palabra suelta: `eliminado_el` aparece también en el
      // `SELECT` de la marca, así que un `toContain('eliminado_el')` pasaría
      // con las dos versiones.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Cualquiera',
      });
      dataSourceMock.query.mockResolvedValue([]);

      await service.obtenerUso(TENANT, 'r1');

      const [sql] = dataSourceMock.query.mock.calls.at(-1) as [string];
      expect(sql).toContain('item_recargos');
      expect(sql).not.toContain('i.eliminado_el IS NULL');
      expect(sql).toContain('(i.eliminado_el IS NOT NULL) AS eliminado');
    });

    it('devuelve lista vacía cuando nadie usa el recargo', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Sin uso',
      });
      dataSourceMock.query.mockResolvedValue([]);

      const result = await service.obtenerUso(TENANT, 'r1');

      expect(result).toEqual({ items: [] });
    });
  });

  // ─── Nivel de la regla (línea vs venta) ─────────────────────────────────

  describe('nivel', () => {
    it('sin `nivel` en el DTO guarda `linea`: la API vieja no lo mandaba y todo lo que existe es de línea', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await service.create(TENANT, {
        nombre: 'Promo',
        tipoReglaId: 'tipo-general',
        valorPorcentaje: '0.10',
        modo: 'porcentaje',
      });

      const [[, data]] = managerMock.create.mock.calls as Array<
        [unknown, { nivel: NivelRegla }]
      >;
      expect(data.nivel).toBe(NivelRegla.LINEA);
    });

    it('`nivel: venta` en el DTO se persiste', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await service.create(TENANT, {
        nombre: 'Promo',
        tipoReglaId: 'tipo-general',
        valorPorcentaje: '0.10',
        modo: 'porcentaje',
        nivel: NivelRegla.VENTA,
      });

      const [[, data]] = managerMock.create.mock.calls as Array<
        [unknown, { nivel: NivelRegla }]
      >;
      expect(data.nivel).toBe(NivelRegla.VENTA);
    });

    it('obtenerUso devuelve el nivel: sin él la pantalla no puede distinguir "0 ítems" de "no se mide en ítems"', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Compra grande',
        nivel: NivelRegla.VENTA,
      });
      dataSourceMock.query.mockResolvedValue([]);

      await expect(service.obtenerUso(TENANT, 'r1')).resolves.toEqual({
        nivel: NivelRegla.VENTA,
        items: [],
      });
    });

    it('pasar a nivel venta con ítems asociados es 400, y no escribe', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-general',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '1' }]);

      await expect(
        service.update(TENANT, 'r1', { nivel: NivelRegla.VENTA }),
      ).rejects.toThrow(BadRequestException);
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('pasar a nivel venta SIN ítems asociados pasa (ancla positiva)', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-general',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '0' }]);

      await expect(
        service.update(TENANT, 'r1', { nivel: NivelRegla.VENTA }),
      ).resolves.toBeDefined();
    });

    it('el guard cuenta también los ítems en la papelera: el soft delete no toca la tabla puente', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-general',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '1' }]);

      await expect(
        service.update(TENANT, 'r1', { nivel: NivelRegla.VENTA }),
      ).rejects.toThrow(BadRequestException);

      // Reusar `obtenerUso` acá dejaba pasar el cambio con el ítem en la
      // papelera, y al restaurarlo el ítem quedaba invendible. El testigo es el
      // SQL: si vuelve a filtrar el borrado, esta aserción cae.
      const llamadas = dataSourceMock.query.mock.calls as [string, unknown[]][];
      const [sql] = llamadas[llamadas.length - 1];
      expect(sql).toContain('item_recargos');
      expect(sql).not.toContain('eliminado_el');
    });

    it('un PATCH que no toca el nivel no consulta los ítems: el guard no le cobra una query a todo el resto', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-general',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await service.update(TENANT, 'r1', { nombre: 'Promo renombrada' });

      expect(dataSourceMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining('item_recargos'),
        expect.anything(),
      );
    });
  });
});
