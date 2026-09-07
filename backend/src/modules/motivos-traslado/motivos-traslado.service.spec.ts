import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { MotivosTrasladoService } from './motivos-traslado.service';
import { MotivoTraslado } from './entities/motivo-traslado.entity';

const TENANT_ID = 'tenant-uuid';
const MOTIVO_ID = 'motivo-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('MotivosTrasladoService', () => {
  let service: MotivosTrasladoService;
  let queryMock: jest.Mock;

  beforeEach(async () => {
    // Un solo mock de `query` para el pool y para el manager de la
    // transacción: lo que importa acá es el ORDEN de las sentencias, y
    // separarlos en dos mocks lo escondería.
    queryMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MotivosTrasladoService,
        {
          provide: getRepositoryToken(MotivoTraslado),
          useValue: {},
        },
        {
          provide: Db,
          useValue: {
            query: queryMock,
            transaccion: (cb: (m: { query: jest.Mock }) => unknown) =>
              cb({ query: queryMock }),
          },
        },
      ],
    }).compile();

    service = module.get<MotivosTrasladoService>(MotivosTrasladoService);
  });

  it('rechaza un nombre duplicado en el mismo tenant', async () => {
    queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(
      service.create(TENANT_ID, { nombre: 'Traslado interno' }),
    ).rejects.toThrow(
      'Ya existe un motivo de traslado con el nombre "Traslado interno"',
    );
  });

  it('rechaza modificar un motivo fijo del sistema', async () => {
    queryMock.mockResolvedValueOnce([
      {
        motivo_traslado_id: MOTIVO_ID,
        nombre: 'Traslado interno',
        activo: true,
        es_fijo: true,
      },
    ]);

    await expect(
      service.update(TENANT_ID, MOTIVO_ID, { nombre: 'Otro nombre' }),
    ).rejects.toThrow('No se puede modificar un motivo fijo del sistema');
  });

  it('rechaza eliminar un motivo fijo del sistema', async () => {
    queryMock.mockResolvedValueOnce([
      {
        motivo_traslado_id: MOTIVO_ID,
        nombre: 'Traslado interno',
        activo: true,
        es_fijo: true,
      },
    ]);

    await expect(
      service.remove(TENANT_ID, USUARIO_ID, MOTIVO_ID),
    ).rejects.toThrow('No se puede eliminar un motivo fijo del sistema');
  });

  it('remove() registra quién borró en la misma sentencia', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          motivo_traslado_id: MOTIVO_ID,
          nombre: 'Consignación',
          activo: true,
          es_fijo: false,
        },
      ])
      .mockResolvedValueOnce([{ existe: false }]) // ¿en uso?
      .mockResolvedValueOnce([]); // UPDATE

    await service.remove(TENANT_ID, USUARIO_ID, MOTIVO_ID);

    const sql = queryMock.mock.calls.at(-1)![0] as string;
    expect(sql).toMatch(/eliminado_por\s*=\s*\$/);
    expect(sql).toMatch(/eliminado_el\s*=\s*NOW\(\)/);
    expect(queryMock.mock.calls.at(-1)![1]).toEqual([
      MOTIVO_ID,
      TENANT_ID,
      USUARIO_ID,
    ]);
    // Tres queries: encontrar (con lock) + "¿en uso?" + escribir.
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('remove() no borra un motivo que un traslado ya registrado referencia', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          motivo_traslado_id: MOTIVO_ID,
          nombre: 'Consignación',
          activo: true,
          es_fijo: false,
        },
      ])
      .mockResolvedValueOnce([{ existe: true }]);

    await expect(
      service.remove(TENANT_ID, USUARIO_ID, MOTIVO_ID),
    ).rejects.toThrow(/en uso en traslados/);

    // Y no llegó a escribir: el borrado se frena, no se deshace.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('remove() LOCKEA la fila antes de preguntar si está en uso', async () => {
    // El par del `FOR SHARE` de `assertMotivoActivo`: sin el lock, el EXISTS
    // no ve el `INSERT INTO traslados` todavía sin commitear y el motivo se
    // borra igual, colgado de un documento ya emitido. El orden es la regla,
    // así que se afirma el orden.
    queryMock
      .mockResolvedValueOnce([
        {
          motivo_traslado_id: MOTIVO_ID,
          nombre: 'Consignación',
          activo: true,
          es_fijo: false,
        },
      ])
      .mockResolvedValueOnce([{ existe: false }])
      .mockResolvedValueOnce([]);

    await service.remove(TENANT_ID, USUARIO_ID, MOTIVO_ID);

    const sqls = queryMock.mock.calls.map((c) => c[0] as string);
    expect(sqls[0]).toMatch(/FOR UPDATE/);
    expect(sqls[1]).toMatch(/EXISTS[\s\S]*FROM traslados/);
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el motivo RE-ACTIVADO (eliminadoEl null) tras el UPDATE', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_traslado_id: MOTIVO_ID,
          nombre: 'Consignación',
          activo: true,
          es_fijo: false,
          eliminado_el: null,
          eliminado_por: USUARIO_ID,
        },
      ]);

      const restaurado = await service.restaurar(TENANT_ID, MOTIVO_ID);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringMatching(/eliminado_el\s*=\s*NULL/),
        [MOTIVO_ID, TENANT_ID, null],
      );
      expect(restaurado).toMatchObject({
        id: MOTIVO_ID,
        nombre: 'Consignación',
        eliminadoEl: null,
        eliminadoPor: USUARIO_ID,
      });
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(service.restaurar(TENANT_ID, MOTIVO_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('restaurar() con el nombre ya ocupado devuelve 400 y no toca ninguna fila', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      // El `catch` pregunta dos cosas más: el nombre guardado de la fila (el
      // `UPDATE … RETURNING` no la lee antes de escribir) y los nombres vivos
      // que compiten, para calcular la sugerencia.
      queryMock.mockResolvedValueOnce([{ nombre: 'Consignación' }]);
      queryMock.mockResolvedValueOnce([{ nombre: 'Consignación' }]);

      await expect(service.restaurar(TENANT_ID, MOTIVO_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('el 400 de colisión trae un nombre libre ya calculado', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      queryMock.mockResolvedValueOnce([{ nombre: 'Consignación' }]);
      queryMock.mockResolvedValueOnce([
        { nombre: 'Consignación' },
        { nombre: 'Consignación 2' },
      ]);

      await expect(
        service.restaurar(TENANT_ID, MOTIVO_ID),
      ).rejects.toMatchObject({
        response: {
          message:
            'Ya existe un motivo de traslado activo con el nombre "Consignación".',
          nombreSugerido: 'Consignación 3',
        },
      });
    });

    // Esta tabla indexa por `lower(nombre)`, así que la sugerencia tiene que
    // saltear un tomado que solo difiere en mayúsculas: devolver "Consignación
    // 2" habiendo un "consignación 2" vivo haría que el usuario confirme el
    // modal y reciba el mismo 400.
    it('la sugerencia respeta que el índice es case-insensitive', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      queryMock.mockResolvedValueOnce([{ nombre: 'Consignación' }]);
      queryMock.mockResolvedValueOnce([
        { nombre: 'consignación' },
        { nombre: 'CONSIGNACIÓN 2' },
      ]);

      await expect(
        service.restaurar(TENANT_ID, MOTIVO_ID),
      ).rejects.toMatchObject({
        response: { nombreSugerido: 'Consignación 3' },
      });
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('connection lost'), { code: '57P01' }),
      );

      await expect(service.restaurar(TENANT_ID, MOTIVO_ID)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no trae eliminado_el ni hace JOIN con usuarios', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_traslado_id: MOTIVO_ID,
          nombre: 'Traslado interno',
          activo: true,
          es_fijo: true,
        },
      ]);

      const result = await service.findAll(TENANT_ID);

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).not.toContain('LEFT JOIN usuarios');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(result[0].eliminadoPorNombre).toBeUndefined();
    });

    it('con el flag trae eliminados con el nombre de quien borró, resuelto por JOIN', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_traslado_id: MOTIVO_ID,
          nombre: 'Consignación',
          activo: true,
          es_fijo: false,
          eliminado_el: new Date(),
          eliminado_por: USUARIO_ID,
          eliminado_por_nombre: 'admin.paris',
        },
      ]);

      const result = await service.findAll(TENANT_ID, false, true);

      // Una sola query: si el nombre saliera con una consulta por fila
      // (N+1), esta aserción de una sola llamada lo delataría.
      expect(queryMock).toHaveBeenCalledTimes(1);
      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).toContain('LEFT JOIN usuarios');
      // Se asserta la CLÁUSULA exacta con su alias, no un `eliminado_por`
      // suelto: una subcadena ancha puede matchear otra parte del mismo
      // template y volver a no probar nada.
      expect(sql).toContain(
        '(m.eliminado_el IS NULL OR m.eliminado_por IS NOT NULL)',
      );
      expect(result[0]).toMatchObject({
        id: MOTIVO_ID,
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });

  it('assertMotivoActivo rechaza un motivo inactivo o de otro tenant', async () => {
    const runner = { query: jest.fn().mockResolvedValueOnce([]) };

    await expect(
      service.assertMotivoActivo(runner, TENANT_ID, MOTIVO_ID),
    ).rejects.toThrow('Motivo de traslado no válido o inactivo');
  });

  it('assertMotivoActivo toma FOR SHARE: es el par del FOR UPDATE de remove()', async () => {
    const runner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { motivo_traslado_id: MOTIVO_ID, nombre: 'Consignación' },
        ]),
    };

    await service.assertMotivoActivo(runner, TENANT_ID, MOTIVO_ID);

    // Sin el lock, un `DELETE` del motivo se cuela entre esta validación y el
    // `INSERT INTO traslados`, y el documento nace colgando de un motivo
    // borrado. El `FOR SHARE` va DENTRO de la misma sentencia que valida.
    const sql = String(runner.query.mock.calls[0][0]);
    expect(sql).toMatch(/activo = true[\s\S]*FOR SHARE/);
  });

  it('findAll con soloActivas filtra los inactivos', async () => {
    queryMock.mockResolvedValueOnce([]);

    await service.findAll(TENANT_ID, true);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain('AND activo = true');
  });
});
