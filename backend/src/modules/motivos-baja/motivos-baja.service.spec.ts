import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { MotivosBajaService } from './motivos-baja.service';
import { MotivoBaja } from './entities/motivo-baja.entity';
import { TipoMotivoBaja } from './tipo-motivo-baja.enum';

const TENANT = 'tenant-uuid';
const MOTIVO = 'motivo-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('MotivosBajaService', () => {
  let service: MotivosBajaService;
  let queryMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MotivosBajaService,
        { provide: getRepositoryToken(MotivoBaja), useValue: {} },
        {
          provide: Db,
          useValue: {
            query: queryMock,
            transaccion: (fn: (m: unknown) => unknown) => fn(undefined),
            sinTransaccion: (fn: () => unknown) => fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MotivosBajaService>(MotivosBajaService);
  });

  // Tercera y última forma de escritura de la red de colisión de nombre: SQL
  // crudo. `descuentos` cubre la de transacción y `turnos` la de `repo.save()`.
  // La semántica del helper vive en `nombre-sugerido.util.spec.ts`.
  describe('colisión de nombre perdida por carrera', () => {
    const err23505 = () =>
      Object.assign(new Error('duplicate key'), { code: '23505' });

    /** Los nombres con los que se consultó la unicidad, en orden: el del
     *  pre-chequeo y el de la revalidación. Leerlos así y no con
     *  `toHaveBeenCalledWith` es a propósito — el pre-chequeo satisface esa
     *  aserción solo y deja pasar un mutante que revalide otro nombre. */
    const nombresConsultados = () =>
      queryMock.mock.calls
        .filter(([sql]) => String(sql).includes('lower(nombre) = lower($2)'))
        .map(([, params]) => (params as string[])[1]);

    it('create traduce el 23505 al 400, revalidando el nombre trimeado', async () => {
      queryMock
        .mockResolvedValueOnce([]) // pre-chequeo: libre
        .mockRejectedValueOnce(err23505()) // INSERT: perdió la carrera
        .mockResolvedValueOnce([{ '?column?': 1 }]); // revalidación: tomado

      const promesa = service.create(TENANT, {
        nombre: '  Rotura  ',
        tipo: TipoMotivoBaja.MERMA,
      });
      await expect(promesa).rejects.toThrow(BadRequestException);
      await expect(promesa).rejects.toThrow(/Ya existe un motivo de baja/);
      expect(nombresConsultados()).toEqual(['Rotura', 'Rotura']);
    });

    it('update traduce el 23505 revalidando el nombre nuevo, no otro', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'Vieja',
            activo: true,
            es_fijo: false,
          },
        ]) // findOneOrFail
        .mockResolvedValueOnce([]) // pre-chequeo: libre
        .mockRejectedValueOnce(err23505()) // UPDATE: perdió la carrera
        .mockResolvedValueOnce([{ '?column?': 1 }]); // revalidación: tomado

      const promesa = service.update(TENANT, MOTIVO, { nombre: '  Rotura  ' });
      await expect(promesa).rejects.toThrow(/Ya existe un motivo de baja/);
      expect(nombresConsultados()).toEqual(['Rotura', 'Rotura']);
    });

    it('update no revalida si el PATCH no tocaba el nombre', async () => {
      // Sin nombre en el dto, un 23505 no puede ser colisión de nombre: se
      // relanza tal cual en vez de disfrazarlo.
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ]) // findOneOrFail
        .mockRejectedValueOnce(err23505()); // UPDATE

      await expect(
        service.update(TENANT, MOTIVO, { activo: false }),
      ).rejects.toThrow('duplicate key');
      expect(nombresConsultados()).toEqual([]);
    });
  });

  describe('create', () => {
    it('inserta con es_fijo=false y nombre trim', async () => {
      queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Rotura',
          activo: true,
          es_fijo: false,
          tipo: 'merma',
        },
      ]);

      const result = await service.create(TENANT, {
        nombre: '  Rotura  ',
        tipo: TipoMotivoBaja.MERMA,
      });

      expect(queryMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('es_fijo'),
        [TENANT, 'Rotura', true, 'merma'],
      );
      expect(result).toEqual({
        id: MOTIVO,
        nombre: 'Rotura',
        activo: true,
        esFijo: false,
        tipo: 'merma',
        enUso: false,
      });
    });

    it('rechaza nombre duplicado (case-insensitive)', async () => {
      queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(
        service.create(TENANT, {
          nombre: 'vencimiento',
          tipo: TipoMotivoBaja.MERMA,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(queryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('rechaza modificar motivo fijo del sistema', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: true,
        },
      ]);

      await expect(
        service.update(TENANT, MOTIVO, { nombre: 'Otro' }),
      ).rejects.toThrow('No se puede modificar un motivo fijo del sistema');
    });
  });

  describe('remove', () => {
    it('rechaza eliminar motivo fijo del sistema', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: true,
        },
      ]);

      await expect(service.remove(TENANT, USUARIO_ID, MOTIVO)).rejects.toThrow(
        'No se puede eliminar un motivo fijo del sistema',
      );
    });

    it('rechaza eliminar motivo en uso en movimientos', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ existe: true }]);

      await expect(service.remove(TENANT, USUARIO_ID, MOTIVO)).rejects.toThrow(
        'No se puede eliminar: el motivo está en uso en movimientos de merma',
      );
    });

    it('hace soft delete si no hay uso', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ existe: false }])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, USUARIO_ID, MOTIVO);

      expect(queryMock).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('eliminado_el = NOW()'),
        [MOTIVO, TENANT, USUARIO_ID],
      );
    });

    it('remove() registra quién borró en la misma sentencia', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ existe: false }])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, USUARIO_ID, MOTIVO);

      const sql = queryMock.mock.calls.at(-1)![0] as string;
      expect(sql).toMatch(/eliminado_por\s*=\s*\$/);
      expect(sql).toMatch(/eliminado_el\s*=\s*NOW\(\)/);
    });
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el motivo RE-ACTIVADO (eliminadoEl null) tras el UPDATE', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: false,
          eliminado_el: null,
          eliminado_por: USUARIO_ID,
        },
      ]);

      const restaurada = await service.restaurar(TENANT, MOTIVO);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringMatching(/eliminado_el\s*=\s*NULL/),
        [MOTIVO, TENANT, null],
      );
      expect(restaurada).toEqual({
        id: MOTIVO,
        nombre: 'Vencimiento',
        activo: true,
        esFijo: false,
        eliminadoEl: null,
        eliminadoPor: USUARIO_ID,
      });
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(service.restaurar(TENANT, MOTIVO)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('restaurar() con el nombre ya ocupado devuelve 400 y no toca ninguna fila', async () => {
      // El índice único es parcial (WHERE eliminado_el IS NULL): mientras el
      // motivo estaba borrado nadie chocaba con él, pero al revivirlo vuelve
      // a competir por el nombre.
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      // El `catch` pregunta dos cosas más: el nombre guardado de la fila (el
      // `UPDATE … RETURNING` no la lee antes de escribir) y los nombres vivos
      // que compiten, para calcular la sugerencia.
      queryMock.mockResolvedValueOnce([{ nombre: 'Vencimiento' }]);
      queryMock.mockResolvedValueOnce([{ nombre: 'Vencimiento' }]);

      await expect(service.restaurar(TENANT, MOTIVO)).rejects.toThrow(
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
      queryMock.mockResolvedValueOnce([{ nombre: 'Vencimiento' }]);
      queryMock.mockResolvedValueOnce([
        { nombre: 'Vencimiento' },
        { nombre: 'Vencimiento 2' },
      ]);

      await expect(service.restaurar(TENANT, MOTIVO)).rejects.toMatchObject({
        response: {
          message:
            // Concordancia femenina: este spec fijaba antes "un causa de
            // merma activo" —el template del helper armaba "un … activo"
            // fijo— y pasaba en verde, o sea que el test estaba certificando
            // el bug. Ahora la frase nominal la arma quien llama.
            'Ya existe un motivo de baja activo con el nombre "Vencimiento".',
          nombreSugerido: 'Vencimiento 3',
        },
      });
    });

    // Esta tabla indexa por `lower(nombre)` (medido con `pg_indexes`), así que
    // la sugerencia tiene que saltear un tomado que solo difiere en
    // mayúsculas: si devolviera "Vencimiento 2" habiendo un "vencimiento 2"
    // vivo, el usuario confirmaría el modal y recibiría el mismo 400.
    it('la sugerencia respeta que el índice es case-insensitive', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      queryMock.mockResolvedValueOnce([{ nombre: 'Vencimiento' }]);
      queryMock.mockResolvedValueOnce([
        { nombre: 'vencimiento' },
        { nombre: 'VENCIMIENTO 2' },
      ]);

      await expect(service.restaurar(TENANT, MOTIVO)).rejects.toMatchObject({
        response: { nombreSugerido: 'Vencimiento 3' },
      });
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('connection lost'), { code: '57P01' }),
      );

      await expect(service.restaurar(TENANT, MOTIVO)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no trae la columna eliminado_el ni hace JOIN con usuarios', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Rotura',
          activo: true,
          es_fijo: false,
        },
      ]);

      const result = await service.findAll(TENANT);

      const sql = queryMock.mock.calls[0][0] as string;
      expect(sql).not.toContain('LEFT JOIN usuarios');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(result[0].eliminadoPorNombre).toBeUndefined();
    });

    it('con el flag trae eliminados con el nombre de quien borró, resuelto por JOIN', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: false,
          eliminado_el: new Date(),
          eliminado_por: USUARIO_ID,
          eliminado_por_nombre: 'admin.paris',
        },
      ]);

      const result = await service.findAll(TENANT, false, true);

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
        '(mb.eliminado_el IS NULL OR mb.eliminado_por IS NOT NULL)',
      );
      expect(result[0]).toMatchObject({
        id: MOTIVO,
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });

  describe('tipo', () => {
    it('create inserta el tipo que manda el DTO', async () => {
      queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Se quemó',
          activo: true,
          es_fijo: false,
          tipo: 'merma',
        },
      ]);
      const result = await service.create(TENANT, {
        nombre: 'Se quemó',
        tipo: TipoMotivoBaja.MERMA,
      });
      expect(queryMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('tipo'),
        [TENANT, 'Se quemó', true, 'merma'],
      );
      expect(result).toMatchObject({ tipo: 'merma', enUso: false });
    });

    it('update cambia el tipo de un motivo sin uso', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'merma',
          },
        ]) // findOneOrFail
        .mockResolvedValueOnce([{ en_uso: false }]) // uso
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'cortesia',
            en_uso: false,
          },
        ]); // UPDATE … RETURNING
      const result = await service.update(TENANT, MOTIVO, {
        tipo: TipoMotivoBaja.CORTESIA,
      });
      expect(result.tipo).toBe('cortesia');
    });

    it('update rechaza cambiar el tipo de un motivo con movimientos', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'merma',
          },
        ])
        .mockResolvedValueOnce([{ en_uso: true }]);
      await expect(
        service.update(TENANT, MOTIVO, { tipo: TipoMotivoBaja.NO_ELABORADO }),
      ).rejects.toThrow('No se puede cambiar el tipo: el motivo ya se usó');
      expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it('update con el mismo tipo no hace la consulta aparte de uso', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'merma',
          },
        ]) // findOneOrFail
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'merma',
            en_uso: true,
          },
        ]); // UPDATE … RETURNING
      const result = await service.update(TENANT, MOTIVO, {
        tipo: TipoMotivoBaja.MERMA,
      });
      // Dos consultas: la lectura y el UPDATE. Sin nombre en el body no corre el
      // chequeo de nombre único, y sin cambio de tipo no corre la de uso.
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(result.enUso).toBe(true);
    });

    it('findAll trae enUso en la MISMA consulta y filtra por tipo', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Deterioro',
          activo: true,
          es_fijo: true,
          tipo: 'merma',
          en_uso: true,
        },
      ]);
      const result = await service.findAll(
        TENANT,
        true,
        false,
        TipoMotivoBaja.MERMA,
      );
      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM movimientos_inventario/);
      expect(sql).toMatch(/AND mb\.tipo = \$2/);
      expect(params).toEqual([TENANT, 'merma']);
      expect(result[0]).toMatchObject({ tipo: 'merma', enUso: true });
    });
  });

  /**
   * Ronda de fixes 1 (domain Minor 4, promovido): la spec de la parte 1
   * (`docs/superpowers/specs/2026-09-15-motivos-de-baja-con-tipo-design.md`
   * § 4.3) dice que la parte 2 le suma las anulaciones a "en uso". Un mock no
   * puede distinguir "hay movimiento" de "hay anulación" — el `EXISTS`
   * envuelve las dos ramas del `UNION ALL` en una sola fila booleana—, así
   * que lo que SÍ puede probar un unitario es que la consulta de cada uno de
   * los seis sitios referencia la tabla nueva, en la MISMA sentencia (nunca
   * una consulta aparte). El comportamiento real —anular con un motivo
   * propio y comprobar que borrarlo/cambiarle el tipo rechaza— lo prueba el
   * e2e (`motivos-baja-en-uso-por-anulacion.e2e-spec.ts`).
   */
  describe('en uso también cuenta las anulaciones de plato (ronda de fixes 1)', () => {
    it('remove(): la consulta de uso incluye cuenta_linea_anulaciones en la MISMA sentencia', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ existe: false }])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, USUARIO_ID, MOTIVO);

      const [sql, params] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('cuenta_linea_anulaciones');
      expect(sql).toMatch(/UNION ALL/);
      expect(params).toEqual([MOTIVO]);
    });

    it('update(): el guard de cambio de tipo incluye cuenta_linea_anulaciones en la MISMA sentencia', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'merma',
          },
        ])
        .mockResolvedValueOnce([{ en_uso: false }])
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'cortesia',
            en_uso: false,
          },
        ]);

      await service.update(TENANT, MOTIVO, { tipo: TipoMotivoBaja.CORTESIA });

      const [sql] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('cuenta_linea_anulaciones');
      expect(sql).toMatch(/UNION ALL/);
    });

    it('update(): el RETURNING de en_uso incluye cuenta_linea_anulaciones', async () => {
      // `activo` no dispara ni el chequeo de nombre único ni el guard de tipo:
      // la 2ª query es directo el UPDATE … RETURNING que interesa acá.
      queryMock
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: true,
            es_fijo: false,
            tipo: 'merma',
          },
        ])
        .mockResolvedValueOnce([
          {
            motivo_baja_id: MOTIVO,
            nombre: 'X',
            activo: false,
            es_fijo: false,
            tipo: 'merma',
            en_uso: true,
          },
        ]);

      await service.update(TENANT, MOTIVO, { activo: false });

      const [sql] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('cuenta_linea_anulaciones');
      expect(sql).toMatch(/UNION ALL/);
    });

    it('restaurar(): el RETURNING de en_uso incluye cuenta_linea_anulaciones', async () => {
      queryMock.mockResolvedValueOnce([
        {
          motivo_baja_id: MOTIVO,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: false,
          en_uso: true,
          eliminado_el: null,
          eliminado_por: USUARIO_ID,
        },
      ]);

      await service.restaurar(TENANT, MOTIVO);

      const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('cuenta_linea_anulaciones');
      expect(sql).toMatch(/UNION ALL/);
    });

    it('findAll() (listado normal): en_uso incluye cuenta_linea_anulaciones', async () => {
      queryMock.mockResolvedValueOnce([]);

      await service.findAll(TENANT);

      const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('cuenta_linea_anulaciones');
      expect(sql).toMatch(/UNION ALL/);
    });

    it('findAll() (papelera): en_uso incluye cuenta_linea_anulaciones', async () => {
      queryMock.mockResolvedValueOnce([]);

      await service.findAll(TENANT, false, true);

      const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('cuenta_linea_anulaciones');
      expect(sql).toMatch(/UNION ALL/);
    });
  });
});
