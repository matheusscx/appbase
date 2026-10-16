import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { HojasRutaService } from './hojas-ruta.service';
import type { HojaRutaDetalle } from './paqueteria.types';

const TENANT = 't1';
const REPARTIDOR = 'r1';
const HOJA = 'h1';
const PAQUETE = 'p1';
const FECHA = '2026-10-15';

type Respuesta = [RegExp, unknown];

describe('HojasRutaService', () => {
  const db = {
    query: jest.fn(),
    transaccion: jest.fn((cb: () => unknown) => cb()),
  };
  const repartidores = { exigirActivo: jest.fn() };
  const configuracion = { exigirDefaults: jest.fn() };
  const service = new HojasRutaService(
    db as never,
    repartidores as never,
    configuracion as never,
  );
  const detalle = jest.spyOn(service, 'detalle');
  const detalleFalso = { id: HOJA } as HojaRutaDetalle;

  /** El mock de `Db` contesta según la forma del SQL: el orden exacto de las sentencias no es lo que se prueba. */
  const responder = (...respuestas: Respuesta[]) => {
    db.query.mockImplementation((sql: string) => {
      const hallada = respuestas.find(([patron]) => patron.test(sql));
      if (!hallada) return Promise.resolve([]);
      const [, valor] = hallada;
      return Promise.resolve(typeof valor === 'function' ? valor() : valor);
    });
  };
  const sqls = () => db.query.mock.calls.map((c) => c[0] as string);

  const hojaAbierta: Respuesta = [
    /SELECT hoja_ruta_id AS id/,
    [{ id: HOJA, estado: 'abierta' }],
  ];
  const paqueteExiste: Respuesta = [
    /SELECT paquete_id FROM paquetes/,
    [{ paquete_id: PAQUETE }],
  ];
  const linea = (extra: object) => ({
    id: 'l1',
    paquete_id: PAQUETE,
    estado: 'en_ruta',
    hoja_ruta_id: 'otra',
    fecha: '2026-10-12',
    repartidor_nombre: 'Pedro',
    ...extra,
  });
  const lineasDelPaquete = (...lineas: object[]): Respuesta => [
    /FROM hoja_ruta_paquetes l\s+JOIN hojas_ruta h/,
    lineas,
  ];

  const escanear = (codigo = '461') =>
    service.escanear(TENANT, {
      repartidorId: REPARTIDOR,
      fecha: FECHA,
      codigo,
      cobroEnDestino: true,
    });

  beforeEach(() => {
    db.query.mockReset();
    db.transaccion.mockClear();
    repartidores.exigirActivo.mockReset().mockResolvedValue({});
    configuracion.exigirDefaults.mockReset().mockResolvedValue({
      precioEnvio: '10000.0000',
      pagoRepartidor: '5000.0000',
    });
    detalle.mockReset().mockResolvedValue(detalleFalso);
  });

  describe('escanear', () => {
    it('hoja rendida → 400', async () => {
      responder([
        /SELECT hoja_ruta_id AS id/,
        [{ id: HOJA, estado: 'rendida' }],
      ]);
      await expect(escanear()).rejects.toThrow(
        /ya está rendida: elegí otra fecha/,
      );
      await expect(escanear()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('repartidor inactivo → 400 (lo dice exigirActivo), y lo lee con el cerrojo', async () => {
      repartidores.exigirActivo.mockRejectedValue(
        new BadRequestException('Juan está inactivo'),
      );
      responder(hojaAbierta);
      await expect(escanear()).rejects.toThrow('Juan está inactivo');
      expect(repartidores.exigirActivo).toHaveBeenCalledWith(
        TENANT,
        REPARTIDOR,
        { bloquear: true },
      );
      expect(db.query).not.toHaveBeenCalled();
    });

    it('sin configuración y código nuevo → 400 "Configurá los valores por defecto…"', async () => {
      configuracion.exigirDefaults.mockRejectedValue(
        new BadRequestException(
          'Configurá los valores por defecto de Paquetería antes de cargar paquetes.',
        ),
      );
      responder(hojaAbierta);
      await expect(escanear()).rejects.toThrow(/Configurá los valores/);
      expect(sqls().some((s) => /INSERT INTO paquetes/.test(s))).toBe(false);
    });

    it('paquete entregado → 409 "ya se entregó el 12-10"', async () => {
      responder(
        hojaAbierta,
        paqueteExiste,
        lineasDelPaquete(linea({ estado: 'entregado' })),
      );
      const error = await escanear().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(
        'El paquete 461 ya se entregó el 12-10.',
      );
    });

    it('paquete en ruta con otro repartidor → 409 "está con Pedro"', async () => {
      responder(hojaAbierta, paqueteExiste, lineasDelPaquete(linea({})));
      const error = await escanear().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(
        'El paquete 461 está con Pedro (hoja del 12-10).',
      );
    });

    it('código nuevo: crea el paquete con el interruptor y los defaults, y lo asigna', async () => {
      responder(
        hojaAbierta,
        [/INSERT INTO paquetes/, [[{ paquete_id: PAQUETE }], 1]],
        lineasDelPaquete(),
      );
      const res = await escanear();
      expect(res).toEqual({
        resultado: 'asignado_nuevo',
        codigo: '461',
        hoja: detalleFalso,
      });
      const i = sqls().findIndex((s) => /INSERT INTO paquetes/.test(s));
      expect(db.query.mock.calls[i][1]).toEqual([
        TENANT,
        '461',
        true,
        '10000.0000',
        '5000.0000',
      ]);
      expect(sqls().some((s) => /INSERT INTO hoja_ruta_paquetes/.test(s))).toBe(
        true,
      );
    });

    it('el mismo código nuevo creado a la vez por otro: relee, sigue como existente y no lo marca nuevo', async () => {
      let busquedas = 0;
      responder(
        hojaAbierta,
        [
          /SELECT paquete_id FROM paquetes/,
          () => (++busquedas === 1 ? [] : [{ paquete_id: PAQUETE }]),
        ],
        [/INSERT INTO paquetes/, [[], 0]], // DO NOTHING: no devuelve fila
        lineasDelPaquete(),
      );
      const res = await escanear();
      expect(res.resultado).toBe('asignado');
      expect(busquedas).toBe(2);
    });

    it('lo creó otro y se borró antes de releerlo → 409, no un error de programa', async () => {
      responder(hojaAbierta, [/INSERT INTO paquetes/, [[], 0]]);
      await expect(escanear()).rejects.toBeInstanceOf(ConflictException);
    });

    it('existente y disponible: lo asigna sin tocar su cobro en destino', async () => {
      responder(hojaAbierta, paqueteExiste, lineasDelPaquete());
      const res = await escanear();
      expect(res.resultado).toBe('asignado');
      expect(sqls().some((s) => /INSERT INTO paquetes/.test(s))).toBe(false);
      expect(sqls().some((s) => /UPDATE paquetes/.test(s))).toBe(false);
    });

    it('ya en ruta en esta misma hoja → ya_escaneado y no escribe nada', async () => {
      responder(
        hojaAbierta,
        paqueteExiste,
        lineasDelPaquete(linea({ hoja_ruta_id: HOJA })),
      );
      const res = await escanear();
      expect(res.resultado).toBe('ya_escaneado');
      expect(
        sqls().some((s) =>
          /INSERT INTO hoja_ruta_paquetes|UPDATE hoja_ruta_paquetes/.test(s),
        ),
      ).toBe(false);
    });

    it('no_entregado de esta hoja → reactiva la línea, no inserta otra', async () => {
      responder(
        hojaAbierta,
        paqueteExiste,
        lineasDelPaquete(
          linea({ id: 'l9', estado: 'no_entregado', hoja_ruta_id: HOJA }),
        ),
      );
      const res = await escanear();
      expect(res.resultado).toBe('asignado');
      const i = sqls().findIndex((s) => /UPDATE hoja_ruta_paquetes/.test(s));
      expect(i).toBeGreaterThan(-1);
      expect(db.query.mock.calls[i][1]).toEqual([TENANT, ['l9']]);
      expect(sqls().some((s) => /INSERT INTO hoja_ruta_paquetes/.test(s))).toBe(
        false,
      );
    });

    it('el cerrojo del paquete lleva tenant y filtro de borrado en el mismo WHERE', async () => {
      responder(hojaAbierta, paqueteExiste, lineasDelPaquete());
      await escanear();
      const sql = sqls().find((s) =>
        /SELECT paquete_id FROM paquetes/.test(s),
      )!;
      expect(sql).toMatch(
        /tenant_id = \$1 AND codigo = \$2 AND eliminado_el IS NULL/,
      );
      expect(sql).toMatch(/FOR UPDATE/);
    });

    it('el repartidor y la hoja se bloquean antes que el paquete', async () => {
      const orden: string[] = [];
      repartidores.exigirActivo.mockImplementation(() => {
        orden.push('repartidor');
        return Promise.resolve({});
      });
      responder(
        [
          /SELECT hoja_ruta_id AS id/,
          () => {
            orden.push('hoja');
            return [{ id: HOJA, estado: 'abierta' }];
          },
        ],
        [
          /SELECT paquete_id FROM paquetes/,
          () => {
            orden.push('paquete');
            return [{ paquete_id: PAQUETE }];
          },
        ],
        lineasDelPaquete(),
      );
      await escanear();
      expect(orden).toEqual(['repartidor', 'hoja', 'paquete']);
    });
  });

  describe('asignar', () => {
    const asignar = (paqueteIds: string[]) =>
      service.asignar(TENANT, {
        repartidorId: REPARTIDOR,
        fecha: FECHA,
        paqueteIds,
      });
    const paquetes = (...codigos: string[]): Respuesta => [
      /SELECT paquete_id, codigo FROM paquetes/,
      codigos.map((c, i) => ({ paquete_id: `p${i + 1}`, codigo: c })),
    ];

    it('si uno no está disponible no asigna ninguno y nombra los códigos con su motivo', async () => {
      responder(
        hojaAbierta,
        paquetes('AAA', 'BBB', 'CCC'),
        lineasDelPaquete(
          linea({ id: 'l1', paquete_id: 'p2', estado: 'entregado' }),
          linea({ id: 'l2', paquete_id: 'p3' }),
        ),
      );
      const error = await asignar(['p1', 'p2', 'p3']).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(
        'No se asignó ninguno: BBB ya se entregó el 12-10; CCC está con Pedro (hoja del 12-10).',
      );
      expect(
        sqls().some((s) =>
          /INSERT INTO hoja_ruta_paquetes|UPDATE hoja_ruta_paquetes/.test(s),
        ),
      ).toBe(false);
    });

    it('uno que ya está en esta hoja también cuenta como no disponible', async () => {
      responder(
        hojaAbierta,
        paquetes('AAA'),
        lineasDelPaquete(linea({ paquete_id: 'p1', hoja_ruta_id: HOJA })),
      );
      await expect(asignar(['p1'])).rejects.toThrow(
        'No se asignó ninguno: AAA ya está en esta hoja.',
      );
    });

    it('un paquete que no existe (o es de otro tenant) → 404 y no escribe', async () => {
      responder(hojaAbierta, paquetes('AAA'));
      await expect(asignar(['p1', 'p2'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(sqls().some((s) => /INSERT INTO hoja_ruta_paquetes/.test(s))).toBe(
        false,
      );
    });

    it('reactiva los no_entregado de la hoja y mete el resto con un solo INSERT … unnest', async () => {
      responder(
        hojaAbierta,
        paquetes('AAA', 'BBB', 'CCC'),
        lineasDelPaquete(
          linea({
            id: 'l7',
            paquete_id: 'p2',
            estado: 'no_entregado',
            hoja_ruta_id: HOJA,
          }),
        ),
      );
      const res = await asignar(['p1', 'p2', 'p3']);
      expect(res).toBe(detalleFalso);
      const upd = sqls().findIndex((s) => /UPDATE hoja_ruta_paquetes/.test(s));
      expect(db.query.mock.calls[upd][1]).toEqual([TENANT, ['l7']]);
      const inserts = sqls().filter((s) =>
        /INSERT INTO hoja_ruta_paquetes/.test(s),
      );
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatch(/unnest\(\$3::uuid\[\]\)/);
      const i = sqls().findIndex((s) =>
        /INSERT INTO hoja_ruta_paquetes/.test(s),
      );
      expect(db.query.mock.calls[i][1]).toEqual([TENANT, HOJA, ['p1', 'p3']]);
    });

    it('bloquea las filas en orden y sin N+1: una consulta para los paquetes y una para las líneas', async () => {
      responder(hojaAbierta, paquetes('AAA', 'BBB'), lineasDelPaquete());
      await asignar(['p2', 'p1']);
      const bloqueo = sqls().find((s) =>
        /SELECT paquete_id, codigo FROM paquetes/.test(s),
      )!;
      expect(bloqueo).toMatch(/tenant_id = \$1/);
      expect(bloqueo).toMatch(/eliminado_el IS NULL/);
      expect(bloqueo).toMatch(/ORDER BY paquete_id\s+FOR UPDATE/);
      expect(
        sqls().filter((s) => /FROM hoja_ruta_paquetes l/.test(s)),
      ).toHaveLength(1);
    });
  });

  describe('detalle y totales', () => {
    const real = HojasRutaService.prototype.detalle;
    const cabecera = (extra: object = {}) => ({
      id: HOJA,
      repartidor_id: REPARTIDOR,
      repartidor_nombre: 'Juan',
      fecha: FECHA,
      estado: 'abierta',
      rendida_el: null,
      total_asignados: null,
      total_entregados: null,
      total_cobro_destino: null,
      monto_cobrado_destino: null,
      monto_pago_repartidor: null,
      monto_total_general: null,
      neto_a_rendir: null,
      ...extra,
    });

    it('404 si la hoja no es del tenant', async () => {
      responder([/FROM hojas_ruta h\s+JOIN repartidores/, []]);
      await expect(real.call(service, TENANT, HOJA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hoja abierta: totales en vivo, neto = cobrado − pago con Decimal', async () => {
      responder(
        [/FROM hojas_ruta h\s+JOIN repartidores/, [cabecera()]],
        [
          /FROM hojas_ruta h\s+LEFT JOIN/,
          [
            {
              hoja_ruta_id: HOJA,
              asignados: 3,
              en_ruta: 1,
              entregados: 2,
              cobro_destino: 1,
              monto_cobrado_destino: '0.3000',
              monto_pago_repartidor: '0.1000',
              monto_total_general: '20000.0000',
            },
          ],
        ],
      );
      const res = await real.call(service, TENANT, HOJA);
      expect(res).toMatchObject({
        asignados: 3,
        enRuta: 1,
        entregados: 2,
        // 0.3 − 0.1 con number da 0.19999999999999998
        netoARendir: '0.2000',
        montoTotalGeneral: '20000.0000',
        lineas: [],
      });
    });

    it('hoja rendida: lee lo congelado, sin recalcular', async () => {
      responder([
        /FROM hojas_ruta h\s+JOIN repartidores/,
        [
          cabecera({
            estado: 'rendida',
            rendida_el: new Date('2026-10-15T20:00:00.000Z'),
            total_asignados: 4,
            total_entregados: 3,
            total_cobro_destino: 1,
            monto_cobrado_destino: '10000.0000',
            monto_pago_repartidor: '15000.0000',
            monto_total_general: '30000.0000',
          }),
        ],
      ]);
      const res = await real.call(service, TENANT, HOJA);
      expect(res).toMatchObject({
        estado: 'rendida',
        rendidaEl: '2026-10-15T20:00:00.000Z',
        asignados: 4,
        enRuta: 0,
        netoARendir: '-5000.0000',
      });
      expect(sqls().some((s) => /LEFT JOIN/.test(s))).toBe(false);
    });

    it('totales: cada tabla unida filtra tenant y borrado', async () => {
      responder();
      await service.totales(TENANT, [HOJA]);
      const sql = sqls()[0];
      expect(sql).toMatch(/h\.tenant_id = \$1/);
      expect(sql).toMatch(/h\.eliminado_el IS NULL/);
      expect(sql).toMatch(
        /l\.tenant_id = h\.tenant_id AND l\.eliminado_el IS NULL/,
      );
      expect(sql).toMatch(
        /p\.tenant_id = h\.tenant_id AND p\.eliminado_el IS NULL/,
      );
    });
  });
});
