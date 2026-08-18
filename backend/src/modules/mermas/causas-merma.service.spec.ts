import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { CausasMermaService } from './causas-merma.service';
import { CausaMerma } from './entities/causa-merma.entity';

const TENANT = 'tenant-uuid';
const CAUSA = 'causa-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('CausasMermaService', () => {
  let service: CausasMermaService;
  let queryMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CausasMermaService,
        { provide: getRepositoryToken(CausaMerma), useValue: {} },
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

    service = module.get<CausasMermaService>(CausasMermaService);
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

      const promesa = service.create(TENANT, { nombre: '  Rotura  ' });
      await expect(promesa).rejects.toThrow(BadRequestException);
      await expect(promesa).rejects.toThrow(/Ya existe una causa de merma/);
      expect(nombresConsultados()).toEqual(['Rotura', 'Rotura']);
    });

    it('update traduce el 23505 revalidando el nombre nuevo, no otro', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            causa_merma_id: CAUSA,
            nombre: 'Vieja',
            activo: true,
            es_fijo: false,
          },
        ]) // findOneOrFail
        .mockResolvedValueOnce([]) // pre-chequeo: libre
        .mockRejectedValueOnce(err23505()) // UPDATE: perdió la carrera
        .mockResolvedValueOnce([{ '?column?': 1 }]); // revalidación: tomado

      const promesa = service.update(TENANT, CAUSA, { nombre: '  Rotura  ' });
      await expect(promesa).rejects.toThrow(/Ya existe una causa de merma/);
      expect(nombresConsultados()).toEqual(['Rotura', 'Rotura']);
    });

    it('update no revalida si el PATCH no tocaba el nombre', async () => {
      // Sin nombre en el dto, un 23505 no puede ser colisión de nombre: se
      // relanza tal cual en vez de disfrazarlo.
      queryMock
        .mockResolvedValueOnce([
          {
            causa_merma_id: CAUSA,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ]) // findOneOrFail
        .mockRejectedValueOnce(err23505()); // UPDATE

      await expect(
        service.update(TENANT, CAUSA, { activo: false }),
      ).rejects.toThrow('duplicate key');
      expect(nombresConsultados()).toEqual([]);
    });
  });

  describe('create', () => {
    it('inserta con es_fijo=false y nombre trim', async () => {
      queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          causa_merma_id: CAUSA,
          nombre: 'Rotura',
          activo: true,
          es_fijo: false,
        },
      ]);

      const result = await service.create(TENANT, { nombre: '  Rotura  ' });

      expect(queryMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('es_fijo'),
        [TENANT, 'Rotura', true],
      );
      expect(result).toEqual({
        id: CAUSA,
        nombre: 'Rotura',
        activo: true,
        esFijo: false,
      });
    });

    it('rechaza nombre duplicado (case-insensitive)', async () => {
      queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(
        service.create(TENANT, { nombre: 'vencimiento' }),
      ).rejects.toThrow(BadRequestException);
      expect(queryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('rechaza modificar causa fija del sistema', async () => {
      queryMock.mockResolvedValueOnce([
        {
          causa_merma_id: CAUSA,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: true,
        },
      ]);

      await expect(
        service.update(TENANT, CAUSA, { nombre: 'Otro' }),
      ).rejects.toThrow('No se puede modificar una causa fija del sistema');
    });
  });

  describe('remove', () => {
    it('rechaza eliminar causa fija del sistema', async () => {
      queryMock.mockResolvedValueOnce([
        {
          causa_merma_id: CAUSA,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: true,
        },
      ]);

      await expect(service.remove(TENANT, USUARIO_ID, CAUSA)).rejects.toThrow(
        'No se puede eliminar una causa fija del sistema',
      );
    });

    it('rechaza eliminar causa en uso en movimientos', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            causa_merma_id: CAUSA,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ cnt: '2' }]);

      await expect(service.remove(TENANT, USUARIO_ID, CAUSA)).rejects.toThrow(
        'No se puede eliminar: la causa está en uso en movimientos de merma',
      );
    });

    it('hace soft delete si no hay uso', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            causa_merma_id: CAUSA,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, USUARIO_ID, CAUSA);

      expect(queryMock).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('eliminado_el = NOW()'),
        [CAUSA, TENANT, USUARIO_ID],
      );
    });

    it('remove() registra quién borró en la misma sentencia', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            causa_merma_id: CAUSA,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, USUARIO_ID, CAUSA);

      const sql = queryMock.mock.calls.at(-1)![0] as string;
      expect(sql).toMatch(/eliminado_por\s*=\s*\$/);
      expect(sql).toMatch(/eliminado_el\s*=\s*NOW\(\)/);
    });
  });

  describe('restaurar', () => {
    it('restaurar() devuelve la causa RE-ACTIVADA (eliminadoEl null) tras el UPDATE', async () => {
      queryMock.mockResolvedValueOnce([
        {
          causa_merma_id: CAUSA,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: false,
          eliminado_el: null,
          eliminado_por: USUARIO_ID,
        },
      ]);

      const restaurada = await service.restaurar(TENANT, CAUSA);

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringMatching(/eliminado_el\s*=\s*NULL/),
        [CAUSA, TENANT, null],
      );
      expect(restaurada).toEqual({
        id: CAUSA,
        nombre: 'Vencimiento',
        activo: true,
        esFijo: false,
        eliminadoEl: null,
        eliminadoPor: USUARIO_ID,
      });
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(service.restaurar(TENANT, CAUSA)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('restaurar() con el nombre ya ocupado devuelve 400 y no toca ninguna fila', async () => {
      // El índice único es parcial (WHERE eliminado_el IS NULL): mientras la
      // causa estaba borrada nadie chocaba con ella, pero al revivirla vuelve
      // a competir por el nombre.
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      // El `catch` pregunta dos cosas más: el nombre guardado de la fila (el
      // `UPDATE … RETURNING` no la lee antes de escribir) y los nombres vivos
      // que compiten, para calcular la sugerencia.
      queryMock.mockResolvedValueOnce([{ nombre: 'Vencimiento' }]);
      queryMock.mockResolvedValueOnce([{ nombre: 'Vencimiento' }]);

      await expect(service.restaurar(TENANT, CAUSA)).rejects.toThrow(
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

      await expect(service.restaurar(TENANT, CAUSA)).rejects.toMatchObject({
        response: {
          message:
            // Concordancia femenina: este spec fijaba antes "un causa de
            // merma activo" —el template del helper armaba "un … activo"
            // fijo— y pasaba en verde, o sea que el test estaba certificando
            // el bug. Ahora la frase nominal la arma quien llama.
            'Ya existe una causa de merma activa con el nombre "Vencimiento".',
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

      await expect(service.restaurar(TENANT, CAUSA)).rejects.toMatchObject({
        response: { nombreSugerido: 'Vencimiento 3' },
      });
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('connection lost'), { code: '57P01' }),
      );

      await expect(service.restaurar(TENANT, CAUSA)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no trae la columna eliminado_el ni hace JOIN con usuarios', async () => {
      queryMock.mockResolvedValueOnce([
        {
          causa_merma_id: CAUSA,
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
          causa_merma_id: CAUSA,
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
        '(cm.eliminado_el IS NULL OR cm.eliminado_por IS NOT NULL)',
      );
      expect(result[0]).toMatchObject({
        id: CAUSA,
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });
});
