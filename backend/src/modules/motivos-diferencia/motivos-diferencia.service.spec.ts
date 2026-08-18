import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { MotivosDiferenciaService } from './motivos-diferencia.service';

const TENANT = 't1';
const USUARIO_ID = 'u1';
const MOTIVO_ID = 'm1';

describe('MotivosDiferenciaService', () => {
  let service: MotivosDiferenciaService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn();
    const mod = await Test.createTestingModule({
      providers: [
        MotivosDiferenciaService,
        {
          provide: Db,
          useValue: {
            query,
            transaccion: (fn: (m: unknown) => unknown) => fn(undefined),
            sinTransaccion: (fn: () => unknown) => fn(),
          },
        },
      ],
    }).compile();
    service = mod.get(MotivosDiferenciaService);
  });

  it('findAll con soloActivas filtra activo=true', async () => {
    query.mockResolvedValueOnce([]);
    await service.findAll(TENANT, true);
    expect(query.mock.calls[0][0]).toContain('AND activo = true');
    expect(query.mock.calls[0][0]).toContain('eliminado_el IS NULL');
  });

  it('create inserta con es_fijo=false y requiere_comentario del DTO', async () => {
    query.mockResolvedValueOnce([]); // assertNombreUnico
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'x',
        activo: true,
        requiere_comentario: true,
        es_fijo: false,
      },
    ]);
    const res = await service.create(TENANT, {
      nombre: 'x',
      requiereComentario: true,
    });
    expect(res).toMatchObject({
      id: 'm1',
      requiereComentario: true,
      esFijo: false,
    });
    expect(query.mock.calls[1][0]).toContain(
      'INSERT INTO motivo_diferencia_caja',
    );
  });

  it('update de un motivo fijo BLOQUEA nombre', async () => {
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: true,
        requiere_comentario: true,
        es_fijo: true,
      },
    ]); // findOneOrFail
    await expect(
      service.update(TENANT, 'm1', { nombre: 'nuevo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update de un motivo fijo PERMITE activo y requiere_comentario', async () => {
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: true,
        requiere_comentario: true,
        es_fijo: true,
      },
    ]); // findOneOrFail
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: false,
        requiere_comentario: false,
        es_fijo: true,
      },
    ]); // UPDATE RETURNING
    const res = await service.update(TENANT, 'm1', {
      activo: false,
      requiereComentario: false,
    });
    expect(res.activo).toBe(false);
    expect(res.requiereComentario).toBe(false);
  });

  it('remove de un motivo fijo BLOQUEA', async () => {
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: true,
        requiere_comentario: true,
        es_fijo: true,
      },
    ]); // findOneOrFail
    await expect(
      service.remove(TENANT, USUARIO_ID, 'm1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remove() registra quién borró en la misma sentencia', async () => {
    query
      .mockResolvedValueOnce([
        {
          motivo_diferencia_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          requiere_comentario: false,
          es_fijo: false,
        },
      ]) // findOneOrFail
      .mockResolvedValueOnce([]); // UPDATE

    await service.remove(TENANT, USUARIO_ID, MOTIVO_ID);

    const sql = query.mock.calls.at(-1)![0] as string;
    expect(sql).toMatch(/eliminado_por\s*=\s*\$/);
    expect(sql).toMatch(/eliminado_el\s*=\s*NOW\(\)/);
    expect(query.mock.calls.at(-1)![1]).toEqual([
      MOTIVO_ID,
      TENANT,
      USUARIO_ID,
    ]);
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el motivo RE-ACTIVADO (eliminadoEl null) tras el UPDATE', async () => {
      query.mockResolvedValueOnce([
        {
          motivo_diferencia_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          requiere_comentario: false,
          es_fijo: false,
          eliminado_el: null,
          eliminado_por: USUARIO_ID,
        },
      ]);

      const restaurado = await service.restaurar(TENANT, MOTIVO_ID);

      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/eliminado_el\s*=\s*NULL/),
        [MOTIVO_ID, TENANT, null],
      );
      expect(restaurado).toMatchObject({
        id: MOTIVO_ID,
        nombre: 'Robo',
        eliminadoEl: null,
        eliminadoPor: USUARIO_ID,
      });
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      query.mockResolvedValueOnce([]);

      await expect(service.restaurar(TENANT, MOTIVO_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('restaurar() con el nombre ya ocupado devuelve 400 y no toca ninguna fila', async () => {
      query.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      // El `catch` pregunta dos cosas más: el nombre guardado de la fila (el
      // `UPDATE … RETURNING` no la lee antes de escribir) y los nombres vivos
      // que compiten, para calcular la sugerencia.
      query.mockResolvedValueOnce([{ nombre: 'Faltante' }]);
      query.mockResolvedValueOnce([{ nombre: 'Faltante' }]);

      await expect(service.restaurar(TENANT, MOTIVO_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    // El 400 no puede ser solo un "no se pudo": la pantalla precarga
    // `nombreSugerido` en el campo del modal. Se calcula DENTRO del catch —no
    // antes del UPDATE— porque con índice único el catch hace falta igual
    // (otra transacción puede tomar el nombre entre consultar y escribir), así
    // que pre-consultar sería una query extra en TODOS los restaurar sin poder
    // sacar este bloque.
    it('el 400 de colisión trae un nombre libre ya calculado', async () => {
      query.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      query.mockResolvedValueOnce([{ nombre: 'Faltante' }]);
      query.mockResolvedValueOnce([
        { nombre: 'Faltante' },
        { nombre: 'Faltante 2' },
      ]);

      await expect(service.restaurar(TENANT, MOTIVO_ID)).rejects.toMatchObject({
        response: {
          message: 'Ya existe un motivo activo con el nombre "Faltante".',
          nombreSugerido: 'Faltante 3',
        },
      });
    });

    // Esta tabla indexa por `lower(nombre)` (medido con `pg_indexes`), así que
    // la sugerencia tiene que saltear un tomado que solo difiere en
    // mayúsculas: devolver "Faltante 2" habiendo un "faltante 2" vivo
    // haría que el usuario confirme el modal y reciba el mismo 400.
    it('la sugerencia respeta que el índice es case-insensitive', async () => {
      query.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      query.mockResolvedValueOnce([{ nombre: 'Faltante' }]);
      query.mockResolvedValueOnce([
        { nombre: 'faltante' },
        { nombre: 'FALTANTE 2' },
      ]);

      await expect(service.restaurar(TENANT, MOTIVO_ID)).rejects.toMatchObject({
        response: { nombreSugerido: 'Faltante 3' },
      });
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      query.mockRejectedValueOnce(
        Object.assign(new Error('connection lost'), { code: '57P01' }),
      );

      await expect(service.restaurar(TENANT, MOTIVO_ID)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no trae eliminado_el ni hace JOIN con usuarios', async () => {
      query.mockResolvedValueOnce([
        {
          motivo_diferencia_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          requiere_comentario: false,
          es_fijo: false,
        },
      ]);

      const result = await service.findAll(TENANT);

      const sql = query.mock.calls[0][0] as string;
      expect(sql).not.toContain('LEFT JOIN usuarios');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(result[0].eliminadoPorNombre).toBeUndefined();
    });

    it('con el flag trae eliminados con el nombre de quien borró, resuelto por JOIN', async () => {
      query.mockResolvedValueOnce([
        {
          motivo_diferencia_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          requiere_comentario: false,
          es_fijo: false,
          eliminado_el: new Date(),
          eliminado_por: USUARIO_ID,
          eliminado_por_nombre: 'admin.paris',
        },
      ]);

      const result = await service.findAll(TENANT, false, true);

      // Una sola query: si el nombre saliera con una consulta por fila
      // (N+1), esta aserción de una sola llamada lo delataría.
      expect(query).toHaveBeenCalledTimes(1);
      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain('LEFT JOIN usuarios');
      // Sin esta aserción el test no probaba nada de lo que su nombre dice:
      // borrando el filtro del SQL la suite unitaria seguía 100% verde y el
      // agujero solo aparecía al levantar Postgres. Se asserta la CLÁUSULA
      // exacta con su alias, no un `eliminado_por` suelto: una subcadena
      // ancha puede matchear otra parte del mismo template (el `SELECT`, o un
      // comentario `--` si algún día se agrega uno) y volver a no probar nada.
      expect(sql).toContain(
        '(m.eliminado_el IS NULL OR m.eliminado_por IS NOT NULL)',
      );
      expect(result[0]).toMatchObject({
        id: MOTIVO_ID,
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });

  it('create desenvuelve el shape [rows, rowCount] de RETURNING', async () => {
    query.mockResolvedValueOnce([]); // assertNombreUnico
    query.mockResolvedValueOnce([
      [
        {
          motivo_diferencia_id: 'm1',
          nombre: 'x',
          activo: true,
          requiere_comentario: false,
          es_fijo: false,
        },
      ],
      1,
    ]); // INSERT ... RETURNING → [rows, rowCount]
    const res = await service.create(TENANT, { nombre: 'x' });
    expect(res).toMatchObject({ id: 'm1', nombre: 'x' });
  });

  it('update desenvuelve el shape [rows, rowCount] de RETURNING', async () => {
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'x',
        activo: true,
        requiere_comentario: false,
        es_fijo: false,
      },
    ]); // findOneOrFail
    query.mockResolvedValueOnce([
      [
        {
          motivo_diferencia_id: 'm1',
          nombre: 'x',
          activo: false,
          requiere_comentario: false,
          es_fijo: false,
        },
      ],
      1,
    ]); // UPDATE ... RETURNING → [rows, rowCount]
    const res = await service.update(TENANT, 'm1', { activo: false });
    expect(res).toMatchObject({ id: 'm1', activo: false });
  });
});
