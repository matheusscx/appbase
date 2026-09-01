import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { DescuentosService } from './descuentos.service';
import { Descuento } from './entities/descuento.entity';
import { DescuentoTramo } from './entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from './entities/descuento-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CondicionTipo, NivelRegla } from '../../common/enums/reglas.enums';

const TENANT = 'tenant-uuid';
const USUARIO_ID = 'usuario-uuid';

function makeTipo(codigo: string, clase: string = 'descuento') {
  return { id: `tipo-${codigo}`, codigo, clase, nombre: `Tipo ${codigo}` };
}

describe('DescuentosService', () => {
  let service: DescuentosService;
  let qbMock: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
    select: jest.Mock;
    leftJoin: jest.Mock;
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
    query: jest.Mock;
  };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  let descuentoRepoMock: {
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
      select: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
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
      query: jest.fn().mockResolvedValue([]),
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

    descuentoRepoMock = {
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
        DescuentosService,
        { provide: Db, useValue: dbMock },
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

  describe('create — colisión de nombre perdida por carrera', () => {
    // El pre-chequeo de nombre y la escritura son dos sentencias: entre medio
    // otra transacción puede tomar el nombre. El índice único lo rechaza con
    // 23505 y hasta ahora nadie lo traducía, así que quien perdía la carrera
    // veía un 500 en vez del mismo 400 que ve todo el mundo.
    const err23505 = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });

    // El pre-chequeo y la revalidación pasan por la MISMA query, así que
    // `toHaveBeenCalledWith(nombre)` lo satisface el pre-chequeo solo y no
    // mira la revalidación (medido: un mutante que revalide un literal fijo
    // pasaba igual). Hay que leer los dos nombres, en orden.
    const nombresConsultados = () =>
      qbMock.andWhere.mock.calls
        .filter(([sql]) => sql === 'LOWER(d.nombre) = LOWER(:nombre)')
        .map(([, params]) => (params as { nombre: string }).nombre);

    /** Mismo motivo que arriba: el `excludeId` del pre-chequeo tapaba al de la
     *  revalidación (medido: pasarle otro id sobrevivía). */
    const exceptoIdsConsultados = () =>
      qbMock.andWhere.mock.calls
        .filter(([sql]) => String(sql).includes('descuento_id'))
        .map(([, params]) => (params as { excludeId: string }).excludeId);

    it('traduce el 23505 al mismo 400 que da el pre-chequeo', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      // Libre al pre-consultar, tomado al revalidar: esa es la carrera.
      qbMock.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      dataSourceMock.transaction.mockRejectedValueOnce(err23505);

      // La misma promesa se afirma dos veces a propósito: `toThrow(regex)` NO
      // verifica la clase y `toThrow(Clase)` no verifica el mensaje. Repetir la
      // llamada en cambio consumiría otro `mockRejectedValueOnce`.
      const promesa = service.create(TENANT, {
        nombre: 'Black Friday',
        tipoReglaId: 'tipo-directo',
        valorPorcentaje: '0.10',
        modo: 'porcentaje',
      });
      await expect(promesa).rejects.toThrow(BadRequestException);
      await expect(promesa).rejects.toThrow(
        /Ya existe un descuento con el nombre/,
      );
      // Pre-chequeo y revalidación, los dos con el nombre que se quiso escribir.
      expect(nombresConsultados()).toEqual(['Black Friday', 'Black Friday']);
    });

    it('update revalida el nombre del dto excluyéndose a sí mismo', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-1',
        tenantId: TENANT,
        nombre: 'Viejo',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      qbMock.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      dataSourceMock.transaction.mockRejectedValueOnce(err23505);

      const promesa = service.update(TENANT, 'd-1', {
        nombre: 'Black Friday',
        valorPorcentaje: '0.10',
      });
      await expect(promesa).rejects.toThrow(BadRequestException);
      await expect(promesa).rejects.toThrow(
        /Ya existe un descuento con el nombre/,
      );
      expect(nombresConsultados()).toEqual(['Black Friday', 'Black Friday']);
      expect(exceptoIdsConsultados()).toEqual(['d-1', 'd-1']);
    });

    it('relanza el 23505 si al revalidar el nombre está libre', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      // El competidor abortó, o el 23505 vino de OTRO índice único: disfrazarlo
      // de "nombre repetido" sería mentir sobre la causa.
      qbMock.getCount.mockResolvedValue(0);
      dataSourceMock.transaction.mockRejectedValueOnce(err23505);

      await expect(
        service.create(TENANT, {
          nombre: 'Black Friday',
          tipoReglaId: 'tipo-directo',
          valorPorcentaje: '0.10',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow('duplicate key');
    });

    it('no toca los errores que no son 23505', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      // Libre al pre-consultar (si no, corta antes de escribir) y TOMADO al
      // revalidar: ese orden es lo que le da filo. Con el nombre libre en las
      // dos, el test pasaba con o sin el guard de `code !== '23505'`, porque
      // igual salía el error original. Así, si el guard desaparece, sale un
      // 400 y el test falla.
      qbMock.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      dataSourceMock.transaction.mockRejectedValueOnce(new Error('db caída'));

      await expect(
        service.create(TENANT, {
          nombre: 'Black Friday',
          tipoReglaId: 'tipo-directo',
          valorPorcentaje: '0.10',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow('db caída');
    });
  });

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
        valorPorcentaje: '0.10',
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
          valorPorcentaje: '0.10',
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
        valorPorcentaje: '0.05',
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
          valorPorcentaje: '0.05',
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
          valorPorcentaje: '0.10',
        }),
      ).rejects.toThrow('mayor a 0');
    });

    it('creates por_mayor with tramos', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await service.create(TENANT, {
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        tramos: [
          { minimoCantidad: '10', valorPorcentaje: '0.10' },
          { minimoCantidad: '100', valorPorcentaje: '0.15' },
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

    // El `valor` de un tramo no se validaba: `validarValor` solo corría para
    // los tipos de valor único. Un tramo `porcentaje` con `50` entraba con 201
    // y producía un descuento del 5000% (medido contra la API, 2026-08-02).
    it('rechaza un tramo en porcentaje con valor >= 1', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'porcentaje',
          // El typo natural de quien piensa "50%".
          tramos: [{ minimoCantidad: '10', valorPorcentaje: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
    });

    it('rechaza un tramo con valor negativo', async () => {
      // ⚠️ Este test se llamaba "valor 0 o negativo" y **solo probaba el
      // negativo**. Desde el 2026-08-24 el 0 va para el otro lado —un tramo
      // puede valer cero— así que el título mentía en las dos mitades: la que
      // no probaba y, después, la que dejó de ser cierta.
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'porcentaje',
          tramos: [
            { minimoCantidad: '10', valorPorcentaje: '0.10' },
            { minimoCantidad: '100', valorPorcentaje: '-0.05' },
          ],
        }),
      ).rejects.toThrow(/mayor o igual a 0/);
    });

    it('y acepta el tramo en 0: es el escalón que deja de descontar', async () => {
      // Por el camino del service, que es donde `validarMontosDeRegla` se
      // invoca de verdad: el unit de la función sola no prueba que este tipo
      // llegue a llamarla con los tramos del DTO.
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'porcentaje',
          tramos: [
            { minimoCantidad: '10', valorPorcentaje: '0.10' },
            { minimoCantidad: '100', valorPorcentaje: '0' },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('un tramo de 5000 en monto fijo sí es válido', async () => {
      // El mismo número que se rechaza como porcentaje. Lo que decide ya no es
      // el modo leyendo un valor ambiguo: es la COLUMNA en la que vino.
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor fijo',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'monto_fijo',
          tramos: [{ minimoCantidad: '10', valorMonto: '5000' }],
        }),
      ).resolves.toBeDefined();
    });

    it('creates por_monto_venta with tramos and optional dates', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_monto_venta'));
      await service.create(TENANT, {
        nombre: 'Por monto',
        tipoReglaId: 'tipo-por_monto_venta',
        tramos: [{ minimoMonto: '500', valorPorcentaje: '0.10' }],
        modo: 'porcentaje',
        fechaInicio: '2024-01-01',
        fechaFin: '2024-12-31',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(2);
    });

    // `promocional` se eliminó (2026-08-23): su caso —un descuento con
    // vigencia— lo cubre ahora `directo` con fechas OPCIONALES. Este test
    // reemplaza a "creates promocional with fechaInicio and fechaFin":
    // conserva las mismas fechas del body, sobre el tipo que las hereda.
    it('creates directo with fechaInicio and fechaFin', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      await service.create(TENANT, {
        nombre: 'Promo navidad',
        tipoReglaId: 'tipo-directo',
        valorPorcentaje: '0.20',
        modo: 'porcentaje',
        fechaInicio: '2024-12-01',
        fechaFin: '2024-12-31',
      });
      // No children → save called once
      expect(managerMock.save).toHaveBeenCalledTimes(1);
    });

    it('rejects duplicate nombre', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      qbMock.getCount.mockResolvedValue(1);
      await expect(
        service.create(TENANT, {
          nombre: 'Existing',
          tipoReglaId: 'tipo-por_mayor',
          tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.10' }],
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  /**
   * Gemelo exacto del bloque de `recargo_metodo_pago` en
   * `recargos.service.spec.ts`. Los dos códigos se mueven juntos, siempre:
   * habilitar escalones en uno solo deja la mitad del bug, con el agravante
   * de que la mitad arreglada hace que nadie vuelva a mirar.
   */
  describe('metodo_pago elige forma: valor único o escalones', () => {
    it('crea uno por escalones, sin valor único', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      await service.create(TENANT, {
        nombre: 'Efectivo por tramos',
        tipoReglaId: 'tipo-metodo_pago',
        metodoPagoIds: ['mp-1'],
        modo: 'porcentaje',
        tramos: [
          { minimoMonto: '0', valorPorcentaje: '0.03' },
          { minimoMonto: '100000', valorPorcentaje: '0.05' },
        ],
      });
      expect(managerMock.save).toHaveBeenCalled();
    });

    it('rechaza las dos formas juntas', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      await expect(
        service.create(TENANT, {
          nombre: 'Efectivo ambiguo',
          tipoReglaId: 'tipo-metodo_pago',
          metodoPagoIds: ['mp-1'],
          modo: 'porcentaje',
          valorPorcentaje: '0.03',
          tramos: [{ minimoMonto: '0', valorPorcentaje: '0.02' }],
        }),
      ).rejects.toThrow(/una sola forma/);
    });

    it('rechaza ninguna de las dos', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      await expect(
        service.create(TENANT, {
          nombre: 'Efectivo mudo',
          tipoReglaId: 'tipo-metodo_pago',
          metodoPagoIds: ['mp-1'],
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(/tiene que expresar su importe/);
    });

    it('sus escalones miden monto de venta, no cantidad', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      await expect(
        service.create(TENANT, {
          nombre: 'Efectivo por unidades',
          tipoReglaId: 'tipo-metodo_pago',
          metodoPagoIds: ['mp-1'],
          modo: 'porcentaje',
          tramos: [{ minimoCantidad: '3', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/minimoMonto/);
    });

    it('un PATCH que agrega escalones sin apagar el valor único es 400', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-mp',
        tenantId: TENANT,
        nombre: 'Efectivo',
        tipoReglaId: 'tipo-metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.03',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      metodoPagoRepoMock.count.mockResolvedValue(1);

      await expect(
        service.update(TENANT, 'd-mp', {
          tramos: [{ minimoMonto: '0', valorPorcentaje: '0.02' }],
        }),
      ).rejects.toThrow(/una sola forma/);
    });

    it('un PATCH puede volver de escalones a valor único con tramos: []', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-mp2',
        tenantId: TENANT,
        nombre: 'Efectivo',
        tipoReglaId: 'tipo-metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      metodoPagoRepoMock.count.mockResolvedValue(1);

      await expect(
        service.update(TENANT, 'd-mp2', {
          tramos: [],
          valorPorcentaje: '0.03',
        }),
      ).resolves.toBeDefined();
    });

    it('pero vaciar los escalones sin poner valor único es 400', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-mp3',
        tenantId: TENANT,
        nombre: 'Efectivo',
        tipoReglaId: 'tipo-metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('metodo_pago'));
      metodoPagoRepoMock.count.mockResolvedValue(1);

      await expect(
        service.update(TENANT, 'd-mp3', { tramos: [] }),
      ).rejects.toThrow(/tiene que expresar su importe/);
    });
  });

  /**
   * El hermano del describe de arriba: los tipos que **no** eligen forma.
   * `directo` cobra un valor único y `por_mayor` cobra por escalones —
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
    it('directo con valor único Y escalones es 400', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      await expect(
        service.create(TENANT, {
          nombre: 'Directo ambiguo',
          tipoReglaId: 'tipo-directo',
          modo: 'porcentaje',
          valorPorcentaje: '0.50',
          tramos: [{ minimoMonto: '100', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/no admite escalones/);
    });

    it('y un PATCH que se los agrega también', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-unico',
        tenantId: TENANT,
        nombre: 'Directo',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.20',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd-unico', {
          tramos: [{ minimoMonto: '100', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/no admite escalones/);
    });

    it('por_mayor con escalones Y valor plano es 400', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor ambiguo',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'porcentaje',
          valorPorcentaje: '0.50',
          tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.03' }],
        }),
      ).rejects.toThrow(/no admite un valor único/);
    });

    // Los escalones guardados se leen de la BD: sin eso, `tramosFinales` queda
    // vacío y gana el 400 de "requiere al menos un tramo", que es otro chequeo
    // y taparía a éste.
    it('y un PATCH que le agrega el valor plano también', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-tramos',
        tenantId: TENANT,
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      tramoRepoMock.find.mockResolvedValue([
        { minimoCantidad: '10', valorPorcentaje: '0.10' },
      ]);

      await expect(
        service.update(TENANT, 'd-tramos', { valorPorcentaje: '0.50' }),
      ).rejects.toThrow(/no admite un valor único/);
    });

    // La salida del estado prohibido. Sin esto el guardia de arriba no tiene
    // puerta: al cambiar de tipo los escalones del tipo viejo quedan vivos en
    // la BD —`update` solo reemplaza hijos que vengan en el DTO— y el `PATCH`
    // choca contra el guardia sin forma de limpiarlos. Mandar `tramos: []` es
    // esa forma, y hasta el 2026-08-26 rebotaba con *"requiere al menos un
    // tramo"* sobre un tipo que no admite ninguno.
    it('y `tramos: []` es la salida: limpia los huérfanos del tipo viejo', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-cambio',
        tenantId: TENANT,
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      tramoRepoMock.find.mockResolvedValue([
        { minimoCantidad: '10', valorPorcentaje: '0.10' },
      ]);

      await expect(
        service.update(TENANT, 'd-cambio', {
          tipoReglaId: 'tipo-directo',
          valorPorcentaje: '0.25',
          tramos: [],
        }),
      ).resolves.toBeDefined();
    });

    // Ancla del otro lado: el tipo que EXIGE escalones sigue rechazando el
    // vaciado. Sin esto, la condición podría invertirse del todo y nadie se
    // enteraría.
    it('pero el tipo que exige escalones sigue rechazando `tramos: []`', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-exige',
        tenantId: TENANT,
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));

      await expect(
        service.update(TENANT, 'd-exige', { tramos: [] }),
      ).rejects.toThrow(/al menos un tramo/);
    });

    // La dirección ESPEJO del par de arriba, que la primera versión de este
    // frente dejó rota: de valor único a un tipo POR ESCALONES. Acá el huérfano
    // es el valor persistido, que `importeResultante` lee cuando el PATCH no
    // manda la columna.
    it('cambiar a un tipo por escalones sin apagar el valor es 400', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-espejo',
        tenantId: TENANT,
        nombre: 'Directo',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.20',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));

      await expect(
        service.update(TENANT, 'd-espejo', {
          tipoReglaId: 'tipo-por_mayor',
          tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.10' }],
        }),
      ).rejects.toThrow(/no admite un valor único/);
    });

    it('y apagando esa columna en el mismo body sí pasa', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-espejo2',
        tenantId: TENANT,
        nombre: 'Directo',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.20',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));

      await expect(
        service.update(TENANT, 'd-espejo2', {
          tipoReglaId: 'tipo-por_mayor',
          valorPorcentaje: null,
          tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.10' }],
        }),
      ).resolves.toBeDefined();
    });
  });

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
        tramos: [{ minimoCantidad: '20', valorPorcentaje: '0.15' }],
        modo: 'porcentaje',
      });

      expect(managerMock.softDelete).toHaveBeenCalledWith(DescuentoTramo, {
        descuentoId: 'd-1',
      });
    });

    // Los tres de acá abajo son la misma falla vista de tres lados: validar
    // MIRANDO EL CAMPO QUE LLEGÓ en vez del estado que queda. El modo con el
    // que se interpreta un monto puede no venir en el `PATCH`.
    it('un PATCH de valor sobre una regla monto_fijo no lo lee como porcentaje', async () => {
      // Rechazaba con 400 "el porcentaje debe ser < 1" una edición legítima,
      // porque asumía `porcentaje` cuando el DTO no reenviaba el modo.
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-fijo',
        tenantId: TENANT,
        nombre: 'Cupón',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
        modo: 'monto_fijo',
        valorMonto: '1000',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd-fijo', { valorMonto: '5000' }),
      ).resolves.toBeDefined();
    });

    it('cambiar de modo con su importe APAGA la columna abandonada', async () => {
      // Es la acción más común del drawer: editar y pasar de monto fijo a
      // porcentaje. Si la columna vieja no se apaga, la fila queda con las dos
      // llenas y el CHECK de tabla la rechaza: 500 en vez de guardar.
      // Sin este test, borrar el apagado deja el gate ENTERO en verde.
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-fijo-a-pct',
        tenantId: TENANT,
        nombre: 'Mil pesos',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
        modo: 'monto_fijo',
        valorMonto: '1000',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      const res = await service.update(TENANT, 'd-fijo-a-pct', {
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
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-pct',
        tenantId: TENANT,
        nombre: 'Diez por ciento',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.10',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd-pct', { valorMonto: '5000' }),
      ).rejects.toThrow(/el importe va en valorPorcentaje/);
    });

    it('lo dice igual cuando el PATCH apaga de paso la columna correcta', async () => {
      // El mismo error, con una vuelta de tuerca: el cliente manda las DOS
      // columnas —la buena en `null`, la equivocada con el número—, que es lo
      // que arma quien serializa el formulario entero. `importeResultante`
      // toma ese `null` al pie de la letra, así que la fila resultante queda
      // sin importe y el chequeo de "requerido" se dispara ANTES de que nadie
      // mire el `5000` que sí vino. Respuesta: *"El valor es requerido"* a
      // quien mandó un valor. El único arreglo es el orden.
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-pct-2',
        tenantId: TENANT,
        nombre: 'Diez por ciento',
        tipoReglaId: 'tipo-directo',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: '0.10',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd-pct-2', {
          valorPorcentaje: null,
          valorMonto: '5000',
        }),
      ).rejects.toThrow(/el importe va en valorPorcentaje/);
    });

    it('un PATCH que solo cambia el modo revalida los tramos ya guardados', async () => {
      // Antes, un tramo de 5000 legítimo como monto fijo pasaba a leerse como
      // 500.000% al cambiar el modo. Con las columnas partidas ya no puede:
      // el 5000 vive en `valorMonto` y el modo nuevo lo deja fuera de juego,
      // así que el PATCH FALLA en vez de reinterpretar. Sigue haciendo falta
      // leer los tramos guardados —el PATCH no los trae— porque son ellos los
      // que delatan que la regla no puede quedar como se pide.
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-tramos',
        tenantId: TENANT,
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'monto_fijo',
        valorMonto: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      tramoRepoMock.find.mockResolvedValue([
        { minimoCantidad: '10', valorMonto: '5000' },
      ]);

      await expect(
        service.update(TENANT, 'd-tramos', { modo: 'porcentaje' }),
      ).rejects.toThrow(/hay un tramo con su importe en valorMonto/);
    });

    it('rechaza un tramo en porcentaje con valor >= 1 también en el PATCH', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-tramos-2',
        tenantId: TENANT,
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'porcentaje',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));

      await expect(
        service.update(TENANT, 'd-tramos-2', {
          tramos: [{ minimoCantidad: '10', valorPorcentaje: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
    });

    it('revives the soft-stamped row instead of inserting a new one', async () => {
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
        valorPorcentaje: '0.10',
        modo: 'porcentaje',
      });

      expect(managerMock.update).toHaveBeenCalledWith(
        DescuentoMetodoPago,
        { descuentoId: 'd-2' },
        expect.objectContaining({ eliminadoEl: expect.any(Date) }),
      );
      // Apagar y volver a prender. Lo que NO puede hacer es insertar una fila
      // nueva: la puente tiene PK compuesta, así que el método que ya estuvo en
      // la lista tiene una fila apagada esperando, y `save()` la dejaba muerta
      // (ver el comentario del service). La prueba de conducta contra Postgres
      // real vive en `test/reglas-valor.e2e-spec.ts`; acá solo se fija que el
      // camino sea el que revive.
      const [sql, params] = managerMock.query.mock.calls.at(-1) as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(
        /ON CONFLICT \(descuento_id, metodo_pago_id\)\s+DO UPDATE SET eliminado_el = NULL/,
      );
      expect(params).toEqual(['d-2', 'mp-3']);
    });

    it('does not touch children when not in dto (partial update)', async () => {
      const existing = {
        id: 'd-3',
        tenantId: TENANT,
        nombre: 'Desc',
        tipoReglaId: 'tipo-metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
        // Una fila `metodo_pago` VÁLIDA tiene valor y al menos un método: sin
        // esto la fixture representa un estado que el sistema ya no permite, y
        // el PATCH parcial falla por la fixture, no por lo que prueba.
        valorPorcentaje: '0.10',
      };
      descuentoRepoMock.findOne.mockResolvedValue(existing);
      metodoPagoRepoMock.count.mockResolvedValue(1);
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
      await expect(service.remove(TENANT, USUARIO_ID, 'x')).rejects.toThrow(
        NotFoundException,
      );
      expect(descuentoRepoMock.update).not.toHaveBeenCalled();
    });

    it('remove() registra quién borró y cuándo, en una sola escritura', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
      });
      await service.remove(TENANT, USUARIO_ID, 'd1');
      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(descuentoRepoMock.update).toHaveBeenCalledWith(
        { id: 'd1', tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  // ─── restaurar ──────────────────────────────────────────────────────────

  describe('restaurar', () => {
    it('restaurar() devuelve el descuento RE-CONSULTADO tras el restore', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Desc (en la papelera)',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      descuentoRepoMock.findOneOrFail.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Desc',
        eliminadoEl: null,
      });

      const restaurado = await service.restaurar(TENANT, 'd1');

      expect(descuentoRepoMock.update).toHaveBeenCalledWith(
        { id: 'd1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
      expect(descuentoRepoMock.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 'd1', tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('Desc');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      descuentoRepoMock.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, 'd1')).rejects.toThrow(
        NotFoundException,
      );
      expect(descuentoRepoMock.update).not.toHaveBeenCalled();
    });

    it('restaurar() un descuento vivo (no eliminado) es 404', async () => {
      descuentoRepoMock.findOne.mockResolvedValueOnce({
        id: 'd1',
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, 'd1')).rejects.toThrow(
        NotFoundException,
      );
      expect(descuentoRepoMock.update).not.toHaveBeenCalled();
    });

    // `uq_descuentos_tenant_nombre_vivo` es parcial (WHERE eliminado_el IS
    // NULL): mientras el descuento estaba borrado, otro pudo tomar su nombre.
    // El UPDATE que lo revive vuelve a hacerlo competir y Postgres responde
    // 23505 (unique_violation). Sin traducirlo, el usuario recibe un 500.
    it('restaurar() con el nombre ya ocupado por un descuento vivo es 400, no 500', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      descuentoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      // Los nombres vivos que compiten, que es lo que lee `errorDeColision`.
      qbMock.getRawMany.mockResolvedValueOnce([
        { nombre: 'Black Friday' },
        { nombre: 'Black Friday 2' },
      ]);

      await expect(service.restaurar(TENANT, 'd1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // No debe intentar releer la fila si el restore falló.
      expect(descuentoRepoMock.findOneOrFail).not.toHaveBeenCalled();
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      descuentoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      );

      await expect(service.restaurar(TENANT, 'd1')).rejects.toThrow(
        'deadlock detected',
      );
    });

    // El 400 no puede ser solo un "no se pudo": la pantalla precarga
    // `nombreSugerido` en el campo del modal, así que si el backend deja de
    // mandarlo el usuario vuelve a quedar adivinando qué nombre está libre.
    it('el 400 de colisión trae un nombre libre ya calculado, salteando los tomados', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      descuentoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      qbMock.getRawMany.mockResolvedValueOnce([
        { nombre: 'Black Friday' },
        { nombre: 'Black Friday 2' },
        { nombre: 'Black Friday 3' },
      ]);

      await expect(service.restaurar(TENANT, 'd1')).rejects.toMatchObject({
        response: {
          message:
            'Ya existe un descuento activo con el nombre "Black Friday".',
          nombreSugerido: 'Black Friday 4',
        },
      });
    });

    // La sugerencia tiene que ignorar mayúsculas porque el índice es sobre
    // `lower(nombre)`: si propusiera "Black Friday 2" teniendo vivo un "black
    // friday 2", el usuario confirmaría el modal y recibiría el mismo 400.
    it('la sugerencia saltea los tomados sin importar mayúsculas', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      descuentoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      qbMock.getRawMany.mockResolvedValueOnce([
        { nombre: 'BLACK FRIDAY' },
        { nombre: 'black friday 2' },
      ]);

      await expect(service.restaurar(TENANT, 'd1')).rejects.toMatchObject({
        response: { nombreSugerido: 'Black Friday 3' },
      });
    });

    it('con `nombreNuevo` libre, restaura Y renombra en la misma escritura', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      descuentoRepoMock.findOneOrFail.mockResolvedValue({ id: 'd1' });

      await service.restaurar(TENANT, 'd1', 'Black Friday 2');

      // Una sola escritura con las tres columnas: revivir y renombrar en dos
      // sentencias podría dejar la fila viva con el nombre que colisiona.
      expect(descuentoRepoMock.update).toHaveBeenCalledWith(
        { id: 'd1', tenantId: TENANT },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          nombre: 'Black Friday 2',
        },
      );
    });

    it('sin `nombreNuevo` no toca el nombre (comportamiento de siempre)', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      descuentoRepoMock.findOneOrFail.mockResolvedValue({ id: 'd1' });

      await service.restaurar(TENANT, 'd1');

      expect(descuentoRepoMock.update).toHaveBeenCalledWith(
        { id: 'd1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
    });
  });

  // ─── findAll con incluirEliminados ────────────────────────────────────────

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados', async () => {
      await service.findAll(TENANT);

      expect(descuentoRepoMock.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ withDeleted: true }),
      );
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const descuentoEliminado = {
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Desc',
        tipoReglaId: 'tipo-x',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      };
      qbMock.getRawAndEntities.mockResolvedValue({
        entities: [descuentoEliminado],
        raw: [{ d_eliminado_por_nombre: 'admin.paris' }],
      });

      const result = await service.findAll(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      // Sin esta aserción el test no probaba nada de lo que su nombre dice:
      // borrando el `.andWhere(...)` del service la suite unitaria seguía
      // 100% verde y el agujero solo aparecía al levantar Postgres.
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(d.eliminado_el IS NULL OR d.eliminado_por IS NOT NULL)',
      );
      // Y el ORDEN, que `toHaveBeenCalledWith` no mira: `where()` resetea
      // `expressionMap.wheres`, así que un `andWhere` que quede arriba se
      // descarta entero y el listado se queda sin filtro.
      expect(qbMock.andWhere.mock.invocationCallOrder[0]).toBeGreaterThan(
        qbMock.where.mock.invocationCallOrder[0],
      );
      expect(result[0]).toMatchObject({
        id: 'd1',
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

    it('adds excludeId condition when provided', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Nombre', 'some-id');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('descuento_id'),
        expect.objectContaining({ excludeId: 'some-id' }),
      );
    });

    // Decisión del owner (2026-08-01): la unicidad de nombre es
    // case-insensitive en los 8 recursos que la tienen (docs/PRODUCTO.md). Este
    // endpoint es público —la pantalla lo consulta mientras el usuario tipea—,
    // así que si comparara exacto diría "libre" y el guardado moriría con el
    // 23505 de `uq_descuentos_tenant_nombre_vivo`, que es sobre `lower(nombre)`.
    it('compara el nombre ignorando mayúsculas, igual que el índice', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Black Friday');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'LOWER(d.nombre) = LOWER(:nombre)',
        { nombre: 'Black Friday' },
      );
    });
  });

  // ─── Todo descuento tiene que decir cuánto descuenta ───────────────────────
  // Decisión del owner (2026-08-01): "los descuentos tienen que tener valor,
  // no se me ocurre para qué puede servir uno sin valor". Se cerraron las DOS
  // puertas al mismo estado, las dos verificadas contra la API real antes de
  // tocar nada:
  //   1. `create()` no exigía valor a `directo` — el tipo de propósito general.
  //   2. `update()` dejaba VACIARLO por PATCH, en cualquier tipo: un
  //      `{ "valor": null }` respondía 200 y dejaba una promoción sin monto.
  describe('todo descuento expresa su monto', () => {
    it('rechaza crear un `directo` sin valor', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.create(TENANT, {
          nombre: 'Directo sin importe',
          tipoReglaId: 'tipo-directo',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('acepta crear un `directo` CON valor (ancla positiva)', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await service.create(TENANT, {
        nombre: 'Directo 10%',
        tipoReglaId: 'tipo-directo',
        modo: 'porcentaje',
        valorPorcentaje: '0.10',
      });

      expect(managerMock.save).toHaveBeenCalled();
    });

    // Las dos puertas que faltaban, encontradas en la revisión y reproducidas
    // en vivo contra la API (las dos devolvían 200). No alcanzaba con mirar el
    // campo que llega: cambiar el TIPO cambia qué campos hacen falta, así que
    // se valida el estado con el que la fila queda.
    it('cambiar el tipo a uno que exige valor, sin mandarlo, es 400', async () => {
      // Un `por_mayor` guarda el monto en tramos y tiene `valor` nulo.
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Por tramos',
        tipoReglaId: 'tipo-por_mayor',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd1', { tipoReglaId: 'tipo-directo' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cambiar el tipo a uno por tramos, sin mandarlos, es 400', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Directo',
        tipoReglaId: 'tipo-directo',
        valorPorcentaje: '0.10',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      tramoRepoMock.count.mockResolvedValue(0);

      await expect(
        service.update(TENANT, 'd1', { tipoReglaId: 'tipo-por_mayor' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cambiar el tipo MANDANDO lo que el nuevo tipo exige sí funciona (ancla positiva)', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Por tramos',
        tipoReglaId: 'tipo-por_mayor',
        valorPorcentaje: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd1', {
          tipoReglaId: 'tipo-directo',
          valorPorcentaje: '0.10',
        }),
      ).resolves.toBeDefined();
    });

    it('rechaza vaciar el valor por PATCH', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd1', { valorPorcentaje: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('un PATCH que no toca el valor sigue funcionando (ancla positiva)', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd1', { nombre: 'Promo renombrada' }),
      ).resolves.toBeDefined();
    });
  });

  // ─── obtenerUso ─────────────────────────────────────────────────────────

  describe('obtenerUso', () => {
    it('lanza NotFound si el descuento no pertenece al tenant', async () => {
      descuentoRepoMock.findOne.mockResolvedValue(null);

      await expect(service.obtenerUso(TENANT, 'd1')).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSourceMock.query).not.toHaveBeenCalled();
    });

    it('devuelve los ítems que usan el descuento', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo fija',
      });
      dataSourceMock.query.mockResolvedValue([
        { id: 'item-1', nombre: 'Café' },
        { id: 'item-2', nombre: 'Torta' },
      ]);

      const result = await service.obtenerUso(TENANT, 'd1');

      expect(dataSourceMock.query).toHaveBeenCalledWith(
        expect.stringContaining('item_descuentos'),
        ['d1', TENANT],
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
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Con uno borrado',
      });
      dataSourceMock.query.mockResolvedValue([
        { id: 'item-1', nombre: 'Café', eliminado: false },
        { id: 'item-2', nombre: 'Torta vieja', eliminado: true },
      ]);

      const result = await service.obtenerUso(TENANT, 'd1');

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
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Cualquiera',
      });
      dataSourceMock.query.mockResolvedValue([]);

      await service.obtenerUso(TENANT, 'd1');

      const [sql] = dataSourceMock.query.mock.calls.at(-1) as [string];
      expect(sql).toContain('item_descuentos');
      expect(sql).not.toContain('i.eliminado_el IS NULL');
      expect(sql).toContain('(i.eliminado_el IS NOT NULL) AS eliminado');
    });

    it('devuelve lista vacía cuando nadie usa el descuento', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Sin uso',
      });
      dataSourceMock.query.mockResolvedValue([]);

      const result = await service.obtenerUso(TENANT, 'd1');

      expect(result).toEqual({ items: [] });
    });
  });

  // ─── Nivel de la regla (línea vs venta) ─────────────────────────────────

  describe('nivel', () => {
    it('sin `nivel` en el DTO guarda `linea`: la API vieja no lo mandaba y todo lo que existe es de línea', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await service.create(TENANT, {
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        valorPorcentaje: '0.10',
        modo: 'porcentaje',
      });

      const [[, data]] = managerMock.create.mock.calls as Array<
        [unknown, { nivel: NivelRegla }]
      >;
      expect(data.nivel).toBe(NivelRegla.LINEA);
    });

    it('`nivel: venta` en el DTO se persiste', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await service.create(TENANT, {
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
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
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Compra grande',
        nivel: NivelRegla.VENTA,
      });
      dataSourceMock.query.mockResolvedValue([]);

      await expect(service.obtenerUso(TENANT, 'd1')).resolves.toEqual({
        nivel: NivelRegla.VENTA,
        items: [],
      });
    });

    it('pasar a nivel venta con ítems asociados es 400, y no escribe', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '1' }]);

      await expect(
        service.update(TENANT, 'd1', { nivel: NivelRegla.VENTA }),
      ).rejects.toThrow(BadRequestException);
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    /**
     * Las dos mitades del arreglo de la carrera, cada una con su mutante:
     * sacar el `FOR UPDATE` (queda el `COUNT` solo) y volver a llamar al guard
     * afuera de `db.transaccion` (queda el lock, pero se suelta al instante).
     * Ninguna de las dos rompe nada visible sin estos tests — el guard sigue
     * contestando lo mismo en cualquier corrida sin concurrencia.
     */
    it('el guard toma el `FOR UPDATE` de la fila de la regla ANTES de contar', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '0' }]);

      await service.update(TENANT, 'd1', { nivel: NivelRegla.VENTA });

      const sqls = dataSourceMock.query.mock.calls.map(
        (c) => (c as [string])[0],
      );
      const iLock = sqls.findIndex((q) => q.includes('FOR UPDATE'));
      const iCount = sqls.findIndex((q) => q.includes('COUNT(*)'));
      expect(iLock).toBeGreaterThanOrEqual(0);
      expect(iCount).toBeGreaterThanOrEqual(0);
      expect(iLock).toBeLessThan(iCount);
      // Sobre la fila de la regla, no sobre la tabla puente: lockear
      // `item_descuentos` no serializa contra el cambio de nivel.
      expect(sqls[iLock]).toContain('FROM descuentos');
      expect(sqls[iLock]).toContain('descuento_id = $1');
    });

    it('el guard corre DENTRO de la transacción del update', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '0' }]);

      await service.update(TENANT, 'd1', { nivel: NivelRegla.VENTA });

      // Un lock tomado afuera de la transacción se suelta al terminar su
      // statement: el orden de invocación es lo único que distingue el arreglo
      // de la versión que no arregla nada.
      const abrio = dataSourceMock.transaction.mock.invocationCallOrder[0];
      const primerQuery = dataSourceMock.query.mock.invocationCallOrder[0];
      expect(abrio).toBeLessThan(primerQuery);
    });

    it('pasar a nivel venta SIN ítems asociados pasa (ancla positiva)', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '0' }]);

      await expect(
        service.update(TENANT, 'd1', { nivel: NivelRegla.VENTA }),
      ).resolves.toBeDefined();
    });

    it('el guard cuenta también los ítems en la papelera: el soft delete no toca la tabla puente', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));
      dataSourceMock.query.mockResolvedValue([{ cnt: '1' }]);

      await expect(
        service.update(TENANT, 'd1', { nivel: NivelRegla.VENTA }),
      ).rejects.toThrow(BadRequestException);

      // Reusar `obtenerUso` acá dejaba pasar el cambio con el ítem en la
      // papelera, y al restaurarlo el ítem quedaba invendible. El testigo es el
      // SQL: si vuelve a filtrar el borrado, esta aserción cae.
      const llamadas = dataSourceMock.query.mock.calls as [string, unknown[]][];
      const [sql] = llamadas[llamadas.length - 1];
      expect(sql).toContain('item_descuentos');
      expect(sql).not.toContain('eliminado_el');
    });

    it('un PATCH que no toca el nivel no consulta los ítems: el guard no le cobra una query a todo el resto', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-directo',
        nivel: NivelRegla.LINEA,
        valorPorcentaje: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await service.update(TENANT, 'd1', { nombre: 'Promo renombrada' });

      expect(dataSourceMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining('item_descuentos'),
        expect.anything(),
      );
    });
  });
});
