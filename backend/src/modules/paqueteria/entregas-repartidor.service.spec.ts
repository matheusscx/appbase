import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntregasRepartidorService } from './entregas-repartidor.service';

const TENANT = 't1';
const REPARTIDOR = 'r1';
const ENTREGA = 'e1';

describe('EntregasRepartidorService', () => {
  const db = {
    query: jest.fn(),
    transaccion: jest.fn((cb: () => unknown) => cb()),
  };
  const repartidores = { exigirExistente: jest.fn() };
  const service = new EntregasRepartidorService(
    db as never,
    repartidores as never,
  );

  const fila = (extra: object = {}) => ({
    entrega_repartidor_id: ENTREGA,
    repartidor_id: REPARTIDOR,
    repartidor_nombre: 'Juan',
    fecha: '2026-10-13',
    monto: '40000.0000',
    medio: 'efectivo',
    nota: null,
    rendicion_id: null,
    creado_el: new Date('2026-10-13T15:00:00.000Z'),
    ...extra,
  });
  type Respuesta = [RegExp, unknown];
  const responder = (...respuestas: Respuesta[]) => {
    db.query.mockImplementation((sql: string) => {
      const hallada = respuestas.find(([patron]) => patron.test(sql));
      return Promise.resolve(hallada ? hallada[1] : []);
    });
  };
  const sqls = () => db.query.mock.calls.map((c) => c[0] as string);

  beforeEach(() => {
    db.query.mockReset();
    db.transaccion.mockClear();
    repartidores.exigirExistente.mockReset().mockResolvedValue({});
  });

  describe('crear', () => {
    it('toma al repartidor FOR SHARE (aunque esté inactivo), escribe quién la anotó y devuelve la proyección', async () => {
      responder(
        [
          /^\s*INSERT INTO entregas_repartidor/,
          [{ entrega_repartidor_id: ENTREGA }],
        ],
        [/SELECT e\.entrega_repartidor_id/, [fila()]],
      );
      const res = await service.crear(
        TENANT,
        {
          repartidorId: REPARTIDOR,
          fecha: '2026-10-13',
          monto: '40000',
          medio: 'efectivo',
        },
        'u1',
      );
      expect(repartidores.exigirExistente).toHaveBeenCalledWith(
        TENANT,
        REPARTIDOR,
        { bloquear: true },
      );
      const insert = db.query.mock.calls.find((c) =>
        /INSERT INTO entregas_repartidor/.test(c[0] as string),
      )!;
      expect(insert[1]).toEqual([
        TENANT,
        REPARTIDOR,
        '2026-10-13',
        '40000',
        'efectivo',
        null,
        'u1',
      ]);
      expect(res).toEqual({
        id: ENTREGA,
        repartidorId: REPARTIDOR,
        repartidorNombre: 'Juan',
        fecha: '2026-10-13',
        monto: '40000.0000',
        medio: 'efectivo',
        nota: null,
        rendicionId: null,
        creadoEl: '2026-10-13T15:00:00.000Z',
      });
    });

    it('un repartidor que no es del tenant: el 404 corta antes de escribir', async () => {
      repartidores.exigirExistente.mockRejectedValue(
        new NotFoundException('Repartidor no encontrado'),
      );
      await expect(
        service.crear(
          TENANT,
          {
            repartidorId: REPARTIDOR,
            fecha: '2026-10-13',
            monto: '1',
            medio: 'efectivo',
          },
          'u1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('sin campos no escribe', async () => {
      responder([/SELECT e\.entrega_repartidor_id/, [fila()]]);
      await service.actualizar(TENANT, ENTREGA, {});
      expect(sqls().some((x) => /UPDATE/.test(x))).toBe(false);
    });

    it('el candado es el WHERE del propio UPDATE (rendicion_id IS NULL), y nota null la borra', async () => {
      responder(
        [
          /^\s*UPDATE entregas_repartidor/,
          [{ entrega_repartidor_id: ENTREGA }],
        ],
        [/SELECT e\.entrega_repartidor_id/, [fila()]],
      );
      await service.actualizar(TENANT, ENTREGA, { monto: '5', nota: null });
      const update = db.query.mock.calls.find((c) =>
        /UPDATE entregas_repartidor/.test(c[0] as string),
      )!;
      expect(update[0]).toMatch(
        /rendicion_id IS NULL AND eliminado_el IS NULL/,
      );
      expect(update[0]).toMatch(/monto = \$3, nota = \$4/);
      expect(update[1]).toEqual([ENTREGA, TENANT, '5', null]);
    });

    it('0 filas y la entrega existe: ya está rendida (400)', async () => {
      responder([
        /SELECT rendicion_id FROM entregas_repartidor/,
        [{ rendicion_id: 'r' }],
      ]);
      await expect(
        service.actualizar(TENANT, ENTREGA, { monto: '5' }),
      ).rejects.toThrow(/ya está rendida/);
    });

    it('0 filas y no existe (o es de otro tenant): 404', async () => {
      responder();
      await expect(
        service.actualizar(TENANT, ENTREGA, { monto: '5' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('anular', () => {
    it('es un soft delete solo de las pendientes', async () => {
      responder([
        /^\s*UPDATE entregas_repartidor/,
        [{ entrega_repartidor_id: ENTREGA }],
      ]);
      expect(await service.anular(TENANT, ENTREGA)).toEqual({ success: true });
      const sql = sqls()[0];
      expect(sql).toMatch(/SET eliminado_el = now()/);
      expect(sql).toMatch(/rendicion_id IS NULL AND eliminado_el IS NULL/);
    });

    it('una rendida: 400', async () => {
      responder([
        /SELECT rendicion_id FROM entregas_repartidor/,
        [{ rendicion_id: 'r' }],
      ]);
      await expect(service.anular(TENANT, ENTREGA)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('listar', () => {
    it('filtra pendientes y repartidor, siempre vivas y del tenant', async () => {
      responder([/FROM entregas_repartidor e/, [fila()]]);
      await service.listar(TENANT, {
        repartidorId: REPARTIDOR,
        pendientes: true,
      });
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/e\.eliminado_el IS NULL/);
      expect(sql).toMatch(/e\.repartidor_id = \$2/);
      expect(sql).toMatch(/e\.rendicion_id IS NULL/);
      expect(params).toEqual([TENANT, REPARTIDOR]);
    });
  });
});
