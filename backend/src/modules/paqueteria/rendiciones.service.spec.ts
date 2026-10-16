import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RendicionesService } from './rendiciones.service';
import type { TotalesHoja } from './paqueteria.types';

const TENANT = 't1';
const REPARTIDOR = 'r1';

const totales = (extra: Partial<TotalesHoja> = {}): TotalesHoja => ({
  asignados: 3,
  enRuta: 0,
  entregados: 2,
  cobroDestino: 1,
  montoCobradoDestino: '0.3000',
  montoCobradoEfectivo: '0.2000',
  montoCobradoTransferencia: '0.1000',
  montoPagoRepartidor: '0.1000',
  montoTotalGeneral: '0.5000',
  netoARendir: '0.2000',
  ...extra,
});

describe('RendicionesService', () => {
  const db = {
    query: jest.fn(),
    transaccion: jest.fn((cb: () => unknown) => cb()),
  };
  const repartidores = { exigirExistente: jest.fn() };
  const hojas = {
    exigirRendibles: jest.fn(),
    congelar: jest.fn(),
    filasDeRendicion: jest.fn(),
  };
  const entregas = { listar: jest.fn(), deRendicion: jest.fn() };
  const service = new RendicionesService(
    db as never,
    repartidores as never,
    hojas as never,
    entregas as never,
  );
  const detalle = jest.spyOn(service, 'detalle');

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
    repartidores.exigirExistente
      .mockReset()
      .mockResolvedValue({ nombre: 'Juan' });
    hojas.exigirRendibles.mockReset().mockResolvedValue([
      { id: 'h1', fecha: '2026-10-13', totales: totales() },
      { id: 'h2', fecha: '2026-10-14', totales: totales() },
    ]);
    hojas.congelar.mockReset().mockResolvedValue(undefined);
    entregas.listar.mockReset().mockResolvedValue([]);
    detalle.mockReset().mockResolvedValue({ id: 'rend1' } as never);
  });

  describe('rendir', () => {
    const rendir = () =>
      service.rendir(
        TENANT,
        { repartidorId: REPARTIDOR, hojaIds: ['h1', 'h2'] },
        'u1',
      );
    const escribe: Respuesta[] = [
      [/^\s*INSERT INTO rendiciones/, [{ rendicion_id: 'rend1' }]],
      [/^\s*UPDATE entregas_repartidor/, [{ monto: '0.1' }, { monto: '0.2' }]],
    ];

    it('toma al repartidor FOR SHARE, después las hojas FOR UPDATE, y recién ahí escribe', async () => {
      const orden: string[] = [];
      repartidores.exigirExistente.mockImplementation(() => {
        orden.push('repartidor');
        return Promise.resolve({});
      });
      hojas.exigirRendibles.mockImplementation(() => {
        orden.push('hojas');
        return Promise.resolve([
          { id: 'h1', fecha: '2026-10-13', totales: totales() },
        ]);
      });
      db.query.mockImplementation((sql: string) => {
        orden.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        return Promise.resolve(
          /INSERT INTO rendiciones/.test(sql)
            ? [{ rendicion_id: 'rend1' }]
            : [],
        );
      });
      await rendir();
      expect(repartidores.exigirExistente).toHaveBeenCalledWith(
        TENANT,
        REPARTIDOR,
        { bloquear: true },
      );
      expect(hojas.exigirRendibles).toHaveBeenCalledWith(
        TENANT,
        REPARTIDOR,
        ['h1', 'h2'],
        { bloquear: true },
      );
      expect(orden.slice(0, 3)).toEqual(['repartidor', 'hojas', 'INSERT INTO']);
    });

    it('congela cada hoja con SUS totales y la rendición nueva, con el usuario del token', async () => {
      responder(...escribe);
      await rendir();
      expect(hojas.congelar).toHaveBeenCalledTimes(2);
      expect(hojas.congelar).toHaveBeenNthCalledWith(
        1,
        TENANT,
        'h1',
        'u1',
        totales(),
        'rend1',
      );
      expect(hojas.congelar).toHaveBeenNthCalledWith(
        2,
        TENANT,
        'h2',
        'u1',
        totales(),
        'rend1',
      );
    });

    it('suma las hojas y lo devuelto por el UPDATE de entregas con Decimal (0.1 + 0.2 sin error de coma flotante)', async () => {
      responder(...escribe);
      await rendir();
      const insert = db.query.mock.calls.find((c) =>
        /INSERT INTO rendiciones/.test(c[0] as string),
      )!;
      // entregados, cobrado, efectivo, transferencia, pago, a cuenta, saldo
      expect(insert[1]).toEqual([
        TENANT,
        REPARTIDOR,
        'u1',
        4,
        '0.6000',
        '0.4000',
        '0.2000',
        '0.2000',
        '0.0000',
        '0.4000',
      ]);
      const final = db.query.mock.calls.find((c) =>
        /UPDATE rendiciones/.test(c[0] as string),
      )!;
      // saldo = cobrado 0.6 − pago 0.2 − a cuenta (0.1 + 0.2)
      expect(final[1]).toEqual(['rend1', TENANT, '0.3000', '0.1000']);
    });

    it('las entregas se reclaman con UN UPDATE … rendicion_id IS NULL … RETURNING monto', async () => {
      responder(...escribe);
      await rendir();
      const reclamos = sqls().filter((x) =>
        /UPDATE entregas_repartidor/.test(x),
      );
      expect(reclamos).toHaveLength(1);
      expect(reclamos[0]).toMatch(
        /rendicion_id IS NULL AND eliminado_el IS NULL\s+RETURNING monto/,
      );
    });

    it('si las hojas no son rendibles: el error corta sin escribir nada', async () => {
      hojas.exigirRendibles.mockRejectedValue(
        new BadRequestException('La hoja del 13-10 ya está rendida.'),
      );
      await expect(rendir()).rejects.toThrow(/ya está rendida/);
      expect(db.query).not.toHaveBeenCalled();
      expect(hojas.congelar).not.toHaveBeenCalled();
    });

    it('un repartidor que no es del tenant: 404 antes de mirar las hojas', async () => {
      repartidores.exigirExistente.mockRejectedValue(
        new NotFoundException('Repartidor no encontrado'),
      );
      await expect(rendir()).rejects.toBeInstanceOf(NotFoundException);
      expect(hojas.exigirRendibles).not.toHaveBeenCalled();
    });
  });

  describe('previa', () => {
    it('no escribe ni bloquea, y da los mismos totales que rendir con las mismas hojas y entregas', async () => {
      entregas.listar.mockResolvedValue([
        { monto: '0.1000' },
        { monto: '0.2000' },
      ]);
      db.query.mockResolvedValue([]);
      const previa = await service.previa(TENANT, REPARTIDOR, ['h1', 'h2']);
      expect(repartidores.exigirExistente).toHaveBeenCalledWith(
        TENANT,
        REPARTIDOR,
      );
      expect(hojas.exigirRendibles).toHaveBeenCalledWith(TENANT, REPARTIDOR, [
        'h1',
        'h2',
      ]);
      expect(sqls().some((x) => /INSERT|UPDATE/.test(x))).toBe(false);
      expect(previa).toMatchObject({ id: null, rendidaEl: null });
      expect(previa.totales).toEqual({
        entregados: 4,
        montoCobradoDestino: '0.6000',
        montoCobradoEfectivo: '0.4000',
        montoCobradoTransferencia: '0.2000',
        montoPagoRepartidor: '0.2000',
        montoEntregadoACuenta: '0.3000',
        saldo: '0.1000',
      });
      expect(previa.dias.map((d) => d.hojaId)).toEqual(['h1', 'h2']);
    });
  });

  describe('detalle', () => {
    it('una rendición que no es del tenant: 404', async () => {
      detalle.mockRestore();
      db.query.mockResolvedValue([]);
      await expect(service.detalle(TENANT, 'nada')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
