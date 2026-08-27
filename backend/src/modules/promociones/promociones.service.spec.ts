import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Db } from '../../common/db/db.service';
import { PromocionesService } from './promociones.service';
import { Promocion } from './entities/promocion.entity';
import { PromocionScope } from './entities/promocion-scope.entity';
import { PromocionScopeItem } from './entities/promocion-scope-item.entity';
import { CreatePromocionDto } from './dto/create-promocion.dto';

const TENANT = 'tenant-uuid';
const CATEGORIA_ID = '550e8400-e29b-41d4-a716-446655449001';

function makeCreateDto(
  overrides: Partial<CreatePromocionDto> = {},
): CreatePromocionDto {
  return {
    nombre: 'Happy Hour',
    tipo: 'porcentaje',
    fechaInicio: '2026-01-01',
    fechaFin: '2026-12-31',
    valorPorcentaje: '0.2000',
    scopes: [{ tipoScope: 'venta' }],
    ...overrides,
  };
}

describe('PromocionesService', () => {
  let service: PromocionesService;
  let qbMock: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
  };
  let managerMock: {
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
  };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  let promocionRepoMock: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let scopeRepoMock: { find: jest.Mock; count: jest.Mock };
  let scopeItemRepoMock: { find: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };

    // Simula la asignación del PK generado que TypeORM hace al mutar el
    // array en `save()`: sin esto, `scopes[i].id` (usado para enlazar
    // `promocion_scope_items`) quedaría `undefined` en el mock aunque en
    // Postgres real sí llegue poblado.
    let idSeq = 0;
    const asignarId = (e: unknown) => {
      if (e && typeof e === 'object' && !(e as { id?: string }).id) {
        (e as { id: string }).id = `gen-${++idSeq}`;
      }
      return e;
    };
    managerMock = {
      create: jest.fn((_, data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((entidadOArray: unknown) => {
        if (Array.isArray(entidadOArray)) {
          entidadOArray.forEach(asignarId);
          return Promise.resolve(entidadOArray);
        }
        asignarId(entidadOArray);
        return Promise.resolve(entidadOArray);
      }),
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

    promocionRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qbMock),
    };
    scopeRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      // `validarCardinalidadDeScopesExistentes` cuenta los scopes vivos
      // cuando un PATCH cambia `tipo` sin reenviar `scopes`; default en 1
      // para que los tests que no ejercitan ese camino no lo rompan.
      count: jest.fn().mockResolvedValue(1),
    };
    scopeItemRepoMock = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromocionesService,
        { provide: Db, useValue: dbMock },
        { provide: getRepositoryToken(Promocion), useValue: promocionRepoMock },
        {
          provide: getRepositoryToken(PromocionScope),
          useValue: scopeRepoMock,
        },
        {
          provide: getRepositoryToken(PromocionScopeItem),
          useValue: scopeItemRepoMock,
        },
      ],
    }).compile();

    service = module.get<PromocionesService>(PromocionesService);
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('crea una promo porcentaje con 1 scope de categoría → persiste promo + scope', async () => {
      const dto = makeCreateDto({
        scopes: [{ tipoScope: 'categoria', categoriaId: CATEGORIA_ID }],
      });

      const res = await service.create(TENANT, dto);

      // Una escritura para la promo, otra para el array de scopes.
      expect(managerMock.save).toHaveBeenCalledTimes(2);
      expect(res.scopes).toHaveLength(1);
      expect(res.scopes[0]).toMatchObject({
        tipoScope: 'categoria',
        categoriaId: CATEGORIA_ID,
      });
    });

    it('crear sin fechaFin es 400 con el mensaje del guardarraíl heredado', async () => {
      const dto = makeCreateDto({ fechaFin: undefined as unknown as string });

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        /Una promoción necesita fecha de término/,
      );
    });

    it('nxm sin cadaN es 400', async () => {
      const dto = makeCreateDto({
        tipo: 'nxm',
        valorPorcentaje: '1.0000',
        cadaN: undefined,
      });

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('porcentaje con valorMonto es 400 (forma exacta por tipo)', async () => {
      const dto = makeCreateDto({ valorMonto: '1000.0000' });

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        /el importe va en valorPorcentaje/i,
      );
    });

    it('porcentaje con 2 scopes es 400 (admite exactamente uno)', async () => {
      const dto = makeCreateDto({
        scopes: [{ tipoScope: 'venta' }, { tipoScope: 'venta' }],
      });

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        /exactamente un scope/,
      );
    });

    it('precio_fijo con 0 slots es 400', async () => {
      const dto = makeCreateDto({
        tipo: 'precio_fijo',
        valorPorcentaje: undefined,
        valorMonto: '9990.0000',
        scopes: [],
      });

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        /al menos un scope/,
      );
    });

    it('slot categoria sin categoriaId es 400', async () => {
      const dto = makeCreateDto({ scopes: [{ tipoScope: 'categoria' }] });

      await expect(service.create(TENANT, dto)).rejects.toThrow(/categoriaId/);
    });

    it('slot items sin ítems es 400', async () => {
      const dto = makeCreateDto({ scopes: [{ tipoScope: 'items' }] });

      await expect(service.create(TENANT, dto)).rejects.toThrow(/itemId/);
    });

    it('horaInicio sin horaFin es 400', async () => {
      const dto = makeCreateDto({ horaInicio: '18:00' });

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        /horaInicio y horaFin/,
      );
    });

    it('nombre duplicado vivo en el tenant es 400', async () => {
      qbMock.getCount.mockResolvedValue(1);
      const dto = makeCreateDto({ nombre: 'Repetida' });

      await expect(service.create(TENANT, dto)).rejects.toThrow(
        /Ya existe una promoción con el nombre/,
      );
    });

    it('sin `activo` en el body queda activa por defecto', async () => {
      const dto = makeCreateDto();

      const res = await service.create(TENANT, dto);

      expect(res.activo).toBe(true);
    });

    it('con `activo: false` explícito nace pausada', async () => {
      const dto = makeCreateDto({ activo: false });

      const res = await service.create(TENANT, dto);

      expect(res.activo).toBe(false);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when promo not found', async () => {
      promocionRepoMock.findOne.mockResolvedValue(null);

      await expect(
        service.update(TENANT, 'x', { nombre: 'nuevo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('update reemplaza los scopes completos (delete-all → insert) y no deja scope_items huérfanos', async () => {
      const existente = {
        id: 'promo-1',
        tenantId: TENANT,
        nombre: 'Vieja',
        tipo: 'porcentaje',
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        horaInicio: null,
        horaFin: null,
        diasSemana: null,
        canal: null,
        valorPorcentaje: '0.1000',
        cadaN: null,
        valorMonto: null,
      };
      promocionRepoMock.findOne.mockResolvedValue(existente);
      // El scope viejo es `tipo_scope='items'` con un ítem asociado: si el
      // reemplazo no soft-deletea la tabla puente, ese ítem queda huérfano
      // y VIVO — invisible desde la promo (que ya apunta a los scopes
      // nuevos) pero ocupando el índice/la fila para siempre.
      const scopeViejo = {
        id: 'scope-viejo-1',
        promocionId: 'promo-1',
        tipoScope: 'items',
      };
      scopeRepoMock.find.mockResolvedValue([scopeViejo]);
      scopeItemRepoMock.find.mockResolvedValue([
        { scopeId: 'scope-viejo-1', itemId: 'item-viejo-1' },
      ]);

      await service.update(TENANT, 'promo-1', {
        scopes: [{ tipoScope: 'venta' }],
      });

      expect(managerMock.softDelete).toHaveBeenCalledWith(PromocionScope, {
        promocionId: 'promo-1',
      });
      const llamadaScopeItems = managerMock.update.mock.calls.find(
        ([entidad]: [unknown]) => entidad === PromocionScopeItem,
      ) as [unknown, { scopeId: { value: string[] } }, Record<string, unknown>];
      expect(llamadaScopeItems).toBeDefined();
      const [, criterio, patch] = llamadaScopeItems;
      expect(criterio.scopeId.value).toEqual(['scope-viejo-1']);
      expect(patch).toEqual({ eliminadoEl: expect.any(Date) });
      // save: la promo actualizada + el array de scopes nuevos
      expect(managerMock.save).toHaveBeenCalledTimes(2);
    });

    it('cambiar `tipo` sin reenviar `scopes` revalida la cardinalidad de los ya guardados', async () => {
      // Combo `precio_fijo` con 3 slots. Un PATCH que lo pasa a `porcentaje`
      // sin tocar `scopes` dejaría 3 scopes vivos en un tipo que `create()`
      // nunca deja pasar con más de uno.
      const existente = {
        id: 'promo-combo',
        tenantId: TENANT,
        nombre: 'Combo',
        tipo: 'precio_fijo',
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        horaInicio: null,
        horaFin: null,
        diasSemana: null,
        canal: null,
        valorPorcentaje: null,
        cadaN: null,
        valorMonto: '9990.0000',
      };
      promocionRepoMock.findOne.mockResolvedValue(existente);
      scopeRepoMock.count.mockResolvedValue(3);

      await expect(
        service.update(TENANT, 'promo-combo', {
          tipo: 'porcentaje',
          valorPorcentaje: '0.2000',
          valorMonto: null,
        }),
      ).rejects.toThrow(/exactamente un scope/);
    });

    it('cambiar `tipo` sin reenviar `scopes` pasa si la cardinalidad ya cierra', async () => {
      const existente = {
        id: 'promo-1slot',
        tenantId: TENANT,
        nombre: 'Un slot',
        tipo: 'precio_fijo',
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        horaInicio: null,
        horaFin: null,
        diasSemana: null,
        canal: null,
        valorPorcentaje: null,
        cadaN: null,
        valorMonto: '9990.0000',
      };
      promocionRepoMock.findOne.mockResolvedValue(existente);
      scopeRepoMock.count.mockResolvedValue(1);

      await expect(
        service.update(TENANT, 'promo-1slot', {
          tipo: 'porcentaje',
          valorPorcentaje: '0.2000',
          valorMonto: null,
        }),
      ).resolves.toBeDefined();
    });

    it('PATCH { activo: false } pausa la promo sin tocar nada más', async () => {
      const existente = {
        id: 'promo-pausa',
        tenantId: TENANT,
        nombre: 'Pausable',
        tipo: 'porcentaje',
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        horaInicio: null,
        horaFin: null,
        diasSemana: null,
        canal: null,
        valorPorcentaje: '0.1000',
        cadaN: null,
        valorMonto: null,
        activo: true,
      };
      promocionRepoMock.findOne.mockResolvedValue(existente);

      const res = await service.update(TENANT, 'promo-pausa', {
        activo: false,
      });

      expect(res.activo).toBe(false);
      expect(managerMock.softDelete).not.toHaveBeenCalled();
    });

    it('PATCH { activo: true } reactiva una promo pausada', async () => {
      const existente = {
        id: 'promo-reactivar',
        tenantId: TENANT,
        nombre: 'Pausada',
        tipo: 'porcentaje',
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        horaInicio: null,
        horaFin: null,
        diasSemana: null,
        canal: null,
        valorPorcentaje: '0.1000',
        cadaN: null,
        valorMonto: null,
        activo: false,
      };
      promocionRepoMock.findOne.mockResolvedValue(existente);

      const res = await service.update(TENANT, 'promo-reactivar', {
        activo: true,
      });

      expect(res.activo).toBe(true);
    });

    it('un PATCH que no toca `scopes` no reemplaza los hijos', async () => {
      const existente = {
        id: 'promo-2',
        tenantId: TENANT,
        nombre: 'Vieja',
        tipo: 'porcentaje',
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        horaInicio: null,
        horaFin: null,
        diasSemana: null,
        canal: null,
        valorPorcentaje: '0.1000',
        cadaN: null,
        valorMonto: null,
      };
      promocionRepoMock.findOne.mockResolvedValue(existente);

      await service.update(TENANT, 'promo-2', {
        descripcion: 'Nueva descripción',
      });

      expect(managerMock.softDelete).not.toHaveBeenCalled();
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws NotFoundException when promo not found', async () => {
      promocionRepoMock.findOne.mockResolvedValue(null);

      await expect(service.remove(TENANT, 'x')).rejects.toThrow(
        NotFoundException,
      );
      expect(promocionRepoMock.update).not.toHaveBeenCalled();
    });

    it('remove() es soft delete y no toca los hijos', async () => {
      promocionRepoMock.findOne.mockResolvedValue({
        id: 'promo-1',
        tenantId: TENANT,
      });

      await service.remove(TENANT, 'promo-1');

      expect(promocionRepoMock.update).toHaveBeenCalledWith(
        { id: 'promo-1', tenantId: TENANT },
        { eliminadoEl: expect.any(Date) },
      );
      expect(managerMock.softDelete).not.toHaveBeenCalled();
      expect(managerMock.update).not.toHaveBeenCalled();
    });
  });

  // ─── cargarVigentes ───────────────────────────────────────────────────────

  describe('cargarVigentes', () => {
    /** Una fila cruda del `LEFT JOIN`, con los defaults de una promo simple. */
    const fila = (over: Record<string, unknown> = {}) => ({
      promocion_id: 'promo-1',
      nombre: 'Happy Hour',
      tipo: 'porcentaje',
      valor_porcentaje: '0.2000',
      cada_n: null,
      valor_monto: null,
      fecha_inicio: '2026-01-01',
      fecha_fin: '2026-12-31',
      hora_inicio: '18:00',
      hora_fin: '20:00',
      dias_semana: [1, 2],
      canal: null,
      scope_id: 'scope-1',
      slot: 0,
      tipo_scope: 'venta',
      categoria_id: null,
      cantidad: 1,
      item_id: null,
      ...over,
    });

    it('arma el PromoElegible completo desde las filas del JOIN', async () => {
      dataSourceMock.query.mockResolvedValue([fila()]);

      const promos = await service.cargarVigentes(TENANT, '2026-06-15');

      expect(promos).toEqual([
        {
          id: 'promo-1',
          nombre: 'Happy Hour',
          tipo: 'porcentaje',
          valorPorcentaje: '0.2000',
          cadaN: null,
          valorMonto: null,
          ventana: {
            fechaInicio: '2026-01-01',
            fechaFin: '2026-12-31',
            horaInicio: '18:00',
            horaFin: '20:00',
            diasSemana: [1, 2],
            canal: null,
          },
          scopes: [
            {
              slot: 0,
              tipoScope: 'venta',
              categoriaId: null,
              cantidad: 1,
              itemIds: [],
            },
          ],
        },
      ]);
    });

    // El `LEFT JOIN` desnormaliza: un combo de 2 slots con 2 ítems en el
    // primero llega como 3 filas de la misma promo. El ensamblado tiene que
    // colapsarlas sin duplicar ni el scope ni la promo.
    it('colapsa las filas repetidas del JOIN en scopes e itemIds', async () => {
      dataSourceMock.query.mockResolvedValue([
        fila({
          promocion_id: 'promo-combo',
          tipo: 'precio_fijo',
          valor_porcentaje: null,
          valor_monto: '9990.0000',
          scope_id: 'sc-a',
          slot: 0,
          tipo_scope: 'items',
          cantidad: 1,
          item_id: 'item-pizza',
        }),
        fila({
          promocion_id: 'promo-combo',
          tipo: 'precio_fijo',
          valor_porcentaje: null,
          valor_monto: '9990.0000',
          scope_id: 'sc-a',
          slot: 0,
          tipo_scope: 'items',
          cantidad: 1,
          item_id: 'item-pizza-xl',
        }),
        fila({
          promocion_id: 'promo-combo',
          tipo: 'precio_fijo',
          valor_porcentaje: null,
          valor_monto: '9990.0000',
          scope_id: 'sc-b',
          slot: 1,
          tipo_scope: 'categoria',
          categoria_id: CATEGORIA_ID,
          cantidad: 2,
          item_id: null,
        }),
      ]);

      const promos = await service.cargarVigentes(TENANT, '2026-06-15');

      expect(promos).toHaveLength(1);
      expect(promos[0].scopes).toEqual([
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['item-pizza', 'item-pizza-xl'],
        },
        {
          slot: 1,
          tipoScope: 'categoria',
          categoriaId: CATEGORIA_ID,
          cantidad: 2,
          itemIds: [],
        },
      ]);
    });

    // Una promo sin scopes vivos no puede llegar por catálogo (`validarScopes`
    // exige al menos uno), pero el `LEFT JOIN` la devolvería con las columnas
    // del scope en NULL si alguien borrara el scope por SQL. Sin este guard,
    // el evaluador armaría un scope fantasma con `tipoScope: null`.
    it('descarta la promo cuyo LEFT JOIN no trajo ningún scope vivo', async () => {
      dataSourceMock.query.mockResolvedValue([
        fila({ scope_id: null, slot: null, tipo_scope: null, cantidad: null }),
      ]);

      expect(await service.cargarVigentes(TENANT, '2026-06-15')).toEqual([]);
    });

    // El filtro real lo cubre el e2e (acá el mock devuelve lo que se le pida);
    // lo que se prueba es la FORMA del SQL: que las tres condiciones estén y
    // que la fecha entre por parámetro, nunca interpolada.
    it('filtra por tenant, vivas, activas y en fecha — en UNA sola query', async () => {
      dataSourceMock.query.mockResolvedValue([]);

      await service.cargarVigentes(TENANT, '2026-06-15');

      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
      const [sql, params] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('p.activo = true');
      expect(sql).toContain('p.fecha_inicio <= $2::date');
      expect(sql).toContain('p.fecha_fin >= $2::date');
      // Las tres tablas del JOIN filtran borrado.
      expect(sql.match(/eliminado_el IS NULL/g)).toHaveLength(3);
      expect(params).toEqual([TENANT, '2026-06-15']);
    });
  });

  // ─── DTO: decoradores que un test de service no ejerce ─────────────────────
  //
  // `horaFin`/`diasSemana` se validan con class-validator puro (`@Matches`,
  // `@Max`), que SÍ corre en unit sin pasar por el `ValidationPipe` de Nest —
  // a diferencia de `@EsMontoCobrado` (item 11 del brief), que depende de
  // `EscalaMonedaPipe` y por eso su cobertura real es del e2e (memoria "tests
  // de DTO no ejercen el pipe").

  describe('CreatePromocionDto — decoradores', () => {
    it('rechaza horaFin con un formato que no es HH:mm', async () => {
      const dto = plainToInstance(CreatePromocionDto, {
        ...makeCreateDto(),
        horaInicio: '18:00',
        horaFin: '18:00:00',
      });

      const errores = await validate(dto);

      expect(errores.some((e) => e.property === 'horaFin')).toBe(true);
    });

    it('rechaza diasSemana con un valor fuera de 1..7', async () => {
      const dto = plainToInstance(CreatePromocionDto, {
        ...makeCreateDto(),
        diasSemana: [1, 8],
      });

      const errores = await validate(dto);

      expect(errores.some((e) => e.property === 'diasSemana')).toBe(true);
    });
  });
});
