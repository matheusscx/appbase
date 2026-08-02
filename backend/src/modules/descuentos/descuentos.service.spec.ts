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
  };
  let dataSourceMock: { transaction: jest.Mock };
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
    };

    dataSourceMock = {
      transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
        cb(managerMock),
      ),
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
          tramos: [{ minimo: '10', valor: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
    });

    it('rechaza un tramo con valor 0 o negativo', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'porcentaje',
          tramos: [
            { minimo: '10', valor: '0.10' },
            { minimo: '100', valor: '-0.05' },
          ],
        }),
      ).rejects.toThrow(/mayor a 0/);
    });

    it('un tramo de 5000 en monto fijo sí es válido', async () => {
      // El mismo número que se rechaza como porcentaje: lo que decide es el
      // modo, no el número.
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      await expect(
        service.create(TENANT, {
          nombre: 'Por mayor fijo',
          tipoReglaId: 'tipo-por_mayor',
          modo: 'monto_fijo',
          tramos: [{ minimo: '10', valor: '5000' }],
        }),
      ).resolves.toBeDefined();
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
        valor: '1000',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd-fijo', { valor: '5000' }),
      ).resolves.toBeDefined();
    });

    it('un PATCH que solo cambia el modo revalida los tramos ya guardados', async () => {
      // Tramos de 5000 legítimos como monto fijo pasan a ser 500.000% si el
      // modo cambia. El PATCH no trae tramos: hay que leerlos.
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-tramos',
        tenantId: TENANT,
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'monto_fijo',
        valor: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));
      tramoRepoMock.find.mockResolvedValue([{ minimo: '10', valor: '5000' }]);

      await expect(
        service.update(TENANT, 'd-tramos', { modo: 'porcentaje' }),
      ).rejects.toThrow(/decimal/);
    });

    it('rechaza un tramo en porcentaje con valor >= 1 también en el PATCH', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd-tramos-2',
        tenantId: TENANT,
        nombre: 'Por mayor',
        tipoReglaId: 'tipo-por_mayor',
        condicionValor: null,
        modo: 'porcentaje',
        valor: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('por_mayor'));

      await expect(
        service.update(TENANT, 'd-tramos-2', {
          tramos: [{ minimo: '10', valor: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
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
        // Una fila `metodo_pago` VÁLIDA tiene valor y al menos un método: sin
        // esto la fixture representa un estado que el sistema ya no permite, y
        // el PATCH parcial falla por la fixture, no por lo que prueba.
        valor: '0.10',
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
        valor: '0.10',
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
        valor: null,
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
        valor: '0.10',
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
        valor: null,
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('directo'));

      await expect(
        service.update(TENANT, 'd1', {
          tipoReglaId: 'tipo-directo',
          valor: '0.10',
        }),
      ).resolves.toBeDefined();
    });

    it('rechaza vaciar el valor por PATCH', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-promocional',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('promocional'));

      await expect(
        service.update(TENANT, 'd1', { valor: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('un PATCH que no toca el valor sigue funcionando (ancla positiva)', async () => {
      descuentoRepoMock.findOne.mockResolvedValue({
        id: 'd1',
        tenantId: TENANT,
        nombre: 'Promo',
        tipoReglaId: 'tipo-promocional',
        valor: '0.15',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('promocional'));

      await expect(
        service.update(TENANT, 'd1', { nombre: 'Promo renombrada' }),
      ).resolves.toBeDefined();
    });
  });
});
