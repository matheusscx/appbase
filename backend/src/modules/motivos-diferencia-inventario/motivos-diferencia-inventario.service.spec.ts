import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { MotivosDiferenciaInventarioService } from './motivos-diferencia-inventario.service';
import { MotivoDiferenciaInventario } from './entities/motivo-diferencia-inventario.entity';

const TENANT_ID = 'tenant-uuid';
const MOTIVO_ID = 'motivo-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('MotivosDiferenciaInventarioService', () => {
  let service: MotivosDiferenciaInventarioService;
  let queryMock: jest.Mock;
  const dataSource = { query: undefined as unknown as jest.Mock };

  beforeEach(async () => {
    queryMock = jest.fn();
    dataSource.query = queryMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MotivosDiferenciaInventarioService,
        {
          provide: getRepositoryToken(MotivoDiferenciaInventario),
          useValue: {},
        },
        {
          provide: Db,
          // `update` y `remove` corren en transacción (lockean la fila del
          // motivo); el manager comparte el mismo queryMock para que el orden
          // de respuestas siga siendo el de las llamadas.
          useValue: {
            query: queryMock,
            transaccion: (cb: (m: { query: jest.Mock }) => unknown) =>
              cb({ query: queryMock }),
            sinTransaccion: (fn: () => unknown) => fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MotivosDiferenciaInventarioService>(
      MotivosDiferenciaInventarioService,
    );
  });

  it('rechaza un nombre duplicado en el mismo tenant', async () => {
    queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(service.create(TENANT_ID, { nombre: 'Robo' })).rejects.toThrow(
      'Ya existe un motivo de diferencia con el nombre "Robo"',
    );
  });

  it('rechaza modificar un motivo fijo del sistema', async () => {
    queryMock.mockResolvedValueOnce([
      {
        motivo_diferencia_inventario_id: MOTIVO_ID,
        nombre: 'Robo',
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
        motivo_diferencia_inventario_id: MOTIVO_ID,
        nombre: 'Robo',
        activo: true,
        es_fijo: true,
      },
    ]);

    await expect(
      service.remove(TENANT_ID, USUARIO_ID, MOTIVO_ID),
    ).rejects.toThrow('No se puede eliminar un motivo fijo del sistema');
  });

  it('rechaza eliminar un motivo en uso en movimientos', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          motivo_diferencia_inventario_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          es_fijo: false,
        },
      ])
      .mockResolvedValueOnce([{ existe: true }]);

    await expect(
      service.remove(TENANT_ID, USUARIO_ID, MOTIVO_ID),
    ).rejects.toThrow(
      'No se puede eliminar: el motivo está en uso en movimientos o recuentos de inventario',
    );
  });

  // Que el UNION cubra de verdad los tres orígenes solo lo puede probar la BD
  // real: está en recuentos.e2e-spec.ts ("rechaza eliminar la causa mientras
  // un recuento en borrador la referencia"). Acá se prueba lo que el mock no
  // decide: que la fila se lea bloqueada, que el chequeo sea UNA query y que
  // un motivo en uso no se borre.
  it('lee el motivo bloqueado, chequea el uso en una sola query y no borra si está en uso', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          motivo_diferencia_inventario_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          es_fijo: false,
        },
      ])
      .mockResolvedValueOnce([{ existe: true }]);

    await expect(
      service.remove(TENANT_ID, USUARIO_ID, MOTIVO_ID),
    ).rejects.toThrow(
      'No se puede eliminar: el motivo está en uso en movimientos o recuentos de inventario',
    );

    expect(queryMock.mock.calls[0][0] as string).toContain('FOR UPDATE');
    const usoQuery = queryMock.mock.calls[1][0] as string;
    expect(usoQuery).toContain('movimientos_inventario');
    expect(usoQuery).toContain('recuento_inventario_linea');
    expect(usoQuery).toContain('motivo_diferencia_default_id');

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(
      queryMock.mock.calls.some((c) =>
        String(c[0]).includes('eliminado_el = NOW()'),
      ),
    ).toBe(false);
  });

  it('remove() registra quién borró en la misma sentencia', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          motivo_diferencia_inventario_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          es_fijo: false,
        },
      ])
      .mockResolvedValueOnce([{ existe: false }])
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
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el motivo RE-ACTIVADO (eliminadoEl null) tras el UPDATE', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_diferencia_inventario_id: MOTIVO_ID,
          nombre: 'Robo',
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
        nombre: 'Robo',
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
      queryMock.mockResolvedValueOnce([{ nombre: 'Faltante' }]);
      queryMock.mockResolvedValueOnce([{ nombre: 'Faltante' }]);

      await expect(service.restaurar(TENANT_ID, MOTIVO_ID)).rejects.toThrow(
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
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      queryMock.mockResolvedValueOnce([{ nombre: 'Faltante' }]);
      queryMock.mockResolvedValueOnce([
        { nombre: 'Faltante' },
        { nombre: 'Faltante 2' },
      ]);

      await expect(
        service.restaurar(TENANT_ID, MOTIVO_ID),
      ).rejects.toMatchObject({
        response: {
          message:
            'Ya existe un motivo de diferencia activo con el nombre "Faltante".',
          nombreSugerido: 'Faltante 3',
        },
      });
    });

    // Esta tabla indexa por `lower(nombre)` (medido con `pg_indexes`), así que
    // la sugerencia tiene que saltear un tomado que solo difiere en
    // mayúsculas: devolver "Faltante 2" habiendo un "faltante 2" vivo
    // haría que el usuario confirme el modal y reciba el mismo 400.
    it('la sugerencia respeta que el índice es case-insensitive', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      queryMock.mockResolvedValueOnce([{ nombre: 'Faltante' }]);
      queryMock.mockResolvedValueOnce([
        { nombre: 'faltante' },
        { nombre: 'FALTANTE 2' },
      ]);

      await expect(
        service.restaurar(TENANT_ID, MOTIVO_ID),
      ).rejects.toMatchObject({
        response: { nombreSugerido: 'Faltante 3' },
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
          motivo_diferencia_inventario_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          es_fijo: false,
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
          motivo_diferencia_inventario_id: MOTIVO_ID,
          nombre: 'Robo',
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

  it('assertMotivoActivo rechaza un motivo inactivo o de otro tenant', async () => {
    const runner = { query: jest.fn().mockResolvedValueOnce([]) };

    await expect(
      service.assertMotivoActivo(runner, TENANT_ID, MOTIVO_ID),
    ).rejects.toThrow('Motivo de diferencia no válido o inactivo');
  });

  it('findAll con soloActivas filtra los inactivos', async () => {
    queryMock.mockResolvedValueOnce([]);

    await service.findAll(TENANT_ID, true);
    const sql = String(dataSource.query.mock.calls[0][0]);
    expect(sql).toContain('AND activo = true');
  });
});
