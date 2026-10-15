import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { type Db } from '../../../common/db/db.service';
import { type CronRunnerService } from '../../cron/cron-runner.service';
import { DteError } from '../dte.types';
import { type FoliosService } from '../folios.service';
import {
  type RespuestaSii,
  type ResultadoEnvio,
  type SiiBoletaCliente,
} from '../sii-boleta.cliente';
import {
  ESPERA_CONSULTA_MS,
  EnviarBoletasJob,
  espera,
  JOB_ENVIAR_BOLETAS,
} from './enviar-boletas.job';

const revisar = jest.fn();
jest.mock('../esquema-sii', () => ({
  revisarSobreBoleta: (...a: unknown[]) => revisar(...a),
}));

jest.mock('../envio-boleta', () => ({
  armarEnvioBoleta: jest.fn(() => '<EnvioBOLETA/>'),
}));

const GRUPO = {
  razon_social_id: 'rs-1',
  tenant_id: 'tn-1',
  ambiente: 'certificacion',
};
const fila = (n: number) => ({
  documento_id: `doc-${n.toString()}`,
  caf_id: 'caf-1',
  xml: `<DTE>${n.toString()}</DTE>`,
  folio: 4000 + n,
  tipo: 39,
  rut_emisor: '76555444-6',
});
const CREDENCIALES = {
  certificado: { rut: '11111111-1' },
  caratula: { rutEmisor: '76555444-6' },
};

describe('espera', () => {
  it('30 s, 1, 2 y 5 minutos, y después 10 minutos sin tope', () => {
    expect([1, 2, 3, 4, 5, 6, 40].map(espera)).toEqual([
      30_000, 60_000, 120_000, 300_000, 600_000, 600_000, 600_000,
    ]);
  });
});

describe('EnviarBoletasJob', () => {
  let llamadas: { sql: string; params: unknown[] }[];
  let grupos: unknown[];
  let lote: unknown[];
  let query: jest.Mock;
  let enviar: jest.Mock<Promise<RespuestaSii<ResultadoEnvio>>>;
  let pausadoHasta: jest.Mock<number>;
  let credenciales: jest.Mock;
  let ejecutar: jest.Mock;
  let config: string | undefined;
  let hayTrabajo: boolean;
  let job: EnviarBoletasJob;

  /** Las llamadas a `db.query` cuyo SQL contiene el fragmento. */
  const con = (fragmento: string) =>
    llamadas.filter((l) => l.sql.includes(fragmento));

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    revisar.mockReset();
    revisar.mockResolvedValue({ valido: true });
    llamadas = [];
    grupos = [GRUPO];
    lote = [fila(1), fila(2), fila(3)];
    hayTrabajo = true;
    config = undefined;
    // pg: UPDATE/INSERT … RETURNING llegan como [filas, cuántas]; un SELECT llega como filas.
    query = jest.fn((sql: string, params: unknown[] = []) => {
      llamadas.push({ sql, params });
      if (sql.includes('WITH vencidos')) return Promise.resolve([[], 0]);
      if (sql.includes('ORDER BY mas_antigua')) return Promise.resolve(grupos);
      if (sql.includes('FOR UPDATE SKIP LOCKED')) return Promise.resolve(lote);
      if (sql.includes('INSERT INTO dte_envios'))
        return Promise.resolve([[{ envio_id: 'envio-1' }], 1]);
      if (sql.includes('AS hay')) return Promise.resolve([{ hay: hayTrabajo }]);
      return Promise.resolve([[], 0]);
    });
    enviar = jest.fn().mockResolvedValue({
      tipo: 'ok',
      datos: { trackid: '1014', estado: 'REC' },
      reintentarEnMs: null,
    });
    pausadoHasta = jest.fn().mockReturnValue(0);
    credenciales = jest.fn().mockResolvedValue(CREDENCIALES);
    ejecutar = jest.fn((_job: string, fn: () => Promise<string>) => fn());
    job = new EnviarBoletasJob(
      {
        query,
        transaccion: (fn: () => unknown) => fn(),
      } as unknown as Db,
      { ejecutar } as unknown as CronRunnerService,
      { credencialesParaFirmar: credenciales } as unknown as FoliosService,
      { enviar, pausadoHasta } as unknown as SiiBoletaCliente,
      { get: () => config } as unknown as ConfigService,
    );
  });

  it('ok: el envío queda con el trackid y la consulta a +10 min, y las boletas no se tocan', async () => {
    const mensaje = await job.enviarLotes();

    expect(mensaje).toContain('1 sobres enviados');
    const [anota] = con('trackid = $2::bigint');
    expect(anota.params).toEqual([
      'envio-1',
      '1014',
      'REC',
      ESPERA_CONSULTA_MS,
      null,
    ]);
    // Una sola escritura sobre las boletas: reservarlas. Ni devueltas ni rechazadas.
    expect(con('intentos = intentos + 1')).toHaveLength(0);
    expect(con("estado = 'rechazado'")).toHaveLength(0);
    expect(con("SET estado = 'enviado'")).toHaveLength(1);
  });

  it('ok: un estado final del POST no se guarda: queda sin código y con el motivo, para consultarlo igual', async () => {
    enviar.mockResolvedValue({
      tipo: 'ok',
      datos: { trackid: '1014', estado: 'EPR' },
      reintentarEnMs: null,
    });
    await job.enviarLotes();
    expect(con('trackid = $2::bigint')[0].params).toEqual([
      'envio-1',
      '1014',
      null,
      ESPERA_CONSULTA_MS,
      'El SII respondió el envío con el código EPR; se consulta igual',
    ]);
  });

  it('ok: un estado desconocido del POST tampoco se guarda y el código del aviso se recorta a 20', async () => {
    enviar.mockResolvedValue({
      tipo: 'ok',
      datos: { trackid: '1014', estado: 'Z'.repeat(40) },
      reintentarEnMs: null,
    });
    await job.enviarLotes();
    const params = con('trackid = $2::bigint')[0].params;
    expect(params[2]).toBeNull();
    expect(params[4]).toBe(
      `El SII respondió el envío con el código ${'Z'.repeat(20)}; se consulta igual`,
    );
  });

  it('ok: un POST sin estado queda sin código y sin aviso (no hay código que mostrar)', async () => {
    enviar.mockResolvedValue({
      tipo: 'ok',
      datos: { trackid: '1014', estado: '' },
      reintentarEnMs: null,
    });
    await job.enviarLotes();
    const params = con('trackid = $2::bigint')[0].params;
    expect(params[2]).toBeNull();
    expect(params[4]).toBeNull();
  });

  it.each(['REC', 'SOK', 'FOK', 'CRT', 'PRD'])(
    'ok: el estado %s del POST, que sigue en proceso, se guarda sin aviso',
    async (estado) => {
      enviar.mockResolvedValue({
        tipo: 'ok',
        datos: { trackid: '1014', estado },
        reintentarEnMs: null,
      });
      await job.enviarLotes();
      const params = con('trackid = $2::bigint')[0].params;
      expect(params[2]).toBe(estado);
      expect(params[4]).toBeNull();
    },
  );

  it('ok: si el SII pide esperar más de 10 minutos, se espera eso', async () => {
    enviar.mockResolvedValue({
      tipo: 'ok',
      datos: { trackid: '1014', estado: 'REC' },
      reintentarEnMs: 900_000,
    });
    await job.enviarLotes();
    expect(con('trackid = $2::bigint')[0].params[3]).toBe(900_000);
  });

  it('transitorio: da de baja el sobre y devuelve todas las boletas en una sola escritura', async () => {
    enviar.mockResolvedValue({ tipo: 'transitorio', mensaje: 'El SII cayó' });

    const mensaje = await job.enviarLotes();

    expect(mensaje).toContain('3 boletas devueltas');
    const [baja] = con('reservado_hasta = NULL, eliminado_el = now()');
    expect(baja.sql).toContain('UPDATE dte_envios');
    expect(baja.params).toEqual(['envio-1', 'El SII cayó']);
    const devueltas = con('intentos = intentos + 1');
    expect(devueltas).toHaveLength(1);
    expect(devueltas[0].params).toEqual([
      'envio-1',
      ['doc-1', 'doc-2', 'doc-3'],
      'El SII cayó',
      [30_000, 60_000, 120_000, 300_000],
      600_000,
    ]);
    expect(con("estado = 'rechazado'")).toHaveLength(0);
  });

  it.each([
    ['no_autorizado', { tipo: 'no_autorizado' as const }],
    ['no_encontrado', { tipo: 'no_encontrado' as const }],
  ])('%s: es un reintento, nunca un rechazo', async (_n, respuesta) => {
    enviar.mockResolvedValue(respuesta);
    await job.enviarLotes();
    expect(con('intentos = intentos + 1')).toHaveLength(1);
    expect(con("estado = 'rechazado'")).toHaveLength(0);
  });

  it('peticion_invalida: rechaza las boletas con el origen "envio", sin devolverlas', async () => {
    enviar.mockResolvedValue({
      tipo: 'peticion_invalida',
      mensaje: 'Sobre mal formado',
    });

    const mensaje = await job.enviarLotes();

    expect(mensaje).toContain('3 rechazadas');
    const rechazo = con("estado = 'rechazado'");
    expect(rechazo).toHaveLength(1);
    expect(rechazo[0].params).toEqual([
      'envio-1',
      ['doc-1', 'doc-2', 'doc-3'],
      JSON.stringify({ origen: 'envio', mensaje: 'Sobre mal formado' }),
      'Sobre mal formado',
    ]);
    expect(con('intentos = intentos + 1')).toHaveLength(0);
    // El sobre queda vivo con el error: el SII sí lo vio.
    expect(con('reservado_hasta = NULL, eliminado_el = now()')).toHaveLength(0);
    expect(con('WHERE envio_id = $1').map((l) => l.params)).toContainEqual([
      'envio-1',
      'Sobre mal formado',
    ]);
  });

  it('un DteError de las credenciales devuelve las boletas y no llama al SII', async () => {
    credenciales.mockRejectedValue(
      new DteError(
        'CERTIFICADO_VENCIDO',
        'El certificado digital está vencido',
      ),
    );

    await job.enviarLotes();

    expect(enviar).not.toHaveBeenCalled();
    expect(con('intentos = intentos + 1')[0].params[2]).toBe(
      'El certificado digital está vencido',
    );
    expect(con("estado = 'rechazado'")).toHaveLength(0);
  });

  it('un error de programación se propaga, sin anotar nada, y las otras razones sociales siguen', async () => {
    grupos = [GRUPO, { ...GRUPO, razon_social_id: 'rs-2' }];
    credenciales.mockRejectedValueOnce(new TypeError('se rompió'));

    await expect(job.enviarLotes()).rejects.toThrow('se rompió');

    // La primera quedó reservada y sin anotar (vence sola); la segunda se mandó.
    expect(con('intentos = intentos + 1')).toHaveLength(0);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(con('trackid = $2::bigint')).toHaveLength(1);
  });

  describe('validación del sobre contra el esquema', () => {
    const REEMPLAZO = 'unnest($2::uuid[], $4::jsonb[])';
    const SIN_ESPERA = 'proximo_intento_el = now(), actualizado_el';
    const BAJA = 'eliminado_el = now(), actualizado_el';

    it('una boleta que no cumple el esquema queda rechazada sola; las otras vuelven sin espera y el SII no se llama', async () => {
      revisar.mockResolvedValue({
        valido: false,
        errores: ['sobre'],
        invalidos: [{ tipo: 39, folio: 4002, errores: ['Basura'] }],
      });

      const mensaje = await job.enviarLotes();

      expect(enviar).not.toHaveBeenCalled();
      expect(mensaje).toContain('1 rechazadas');
      expect(mensaje).toContain('2 boletas devueltas');
      const [rech] = con(REEMPLAZO);
      expect(rech.params[0]).toBe('envio-1');
      expect(rech.params[1]).toEqual(['doc-2']);
      expect(rech.params[2]).toBe(
        'La boleta no cumple el esquema del SII; no se envió',
      );
      expect((rech.params[3] as string[]).map((j) => JSON.parse(j))).toEqual([
        { origen: 'esquema', errores: ['Basura'] },
      ]);
      const [dev] = con(SIN_ESPERA);
      expect(dev.params).toEqual(['envio-1', ['doc-1', 'doc-3']]);
      expect(dev.sql).not.toContain('intentos');
      expect(dev.sql).not.toContain('ultimo_error');
      const bajas = con(BAJA);
      expect(bajas).toHaveLength(1); // el envío, dado de baja
      expect(bajas[0].params).toEqual([
        'envio-1',
        'Una boleta no cumple el esquema del SII; el sobre no se envió',
      ]);
      expect(con('trackid = $2::bigint')).toHaveLength(0);
    });

    it('si ninguna boleta falla sola, el error es del sobre: todas rechazadas y nada vuelve a la cola', async () => {
      revisar.mockResolvedValue({
        valido: false,
        errores: ['carátula'],
        invalidos: [],
      });

      const mensaje = await job.enviarLotes();

      expect(enviar).not.toHaveBeenCalled();
      expect(mensaje).toContain('3 rechazadas');
      expect(mensaje).toContain('0 boletas devueltas');
      const [rech] = con(REEMPLAZO);
      expect(rech.params[1]).toEqual(['doc-1', 'doc-2', 'doc-3']);
      expect((rech.params[3] as string[]).map((j) => JSON.parse(j))).toEqual(
        Array(3).fill({ origen: 'esquema', errores: ['carátula'] }),
      );
      expect(con(SIN_ESPERA)).toEqual([]);
      expect(con(BAJA)).toHaveLength(1);
    });

    it('un inválido que no calza con ninguna fila del lote no se puede señalar: todas rechazadas y nada vuelve', async () => {
      revisar.mockResolvedValue({
        valido: false,
        errores: ['sobre'],
        invalidos: [{ tipo: 39, folio: 9999, errores: ['x'] }],
      });

      const mensaje = await job.enviarLotes();

      expect(enviar).not.toHaveBeenCalled();
      expect(mensaje).toContain('3 rechazadas');
      const [rech] = con(REEMPLAZO);
      expect(rech.params[1]).toEqual(['doc-1', 'doc-2', 'doc-3']);
      expect((rech.params[3] as string[]).map((j) => JSON.parse(j))).toEqual(
        Array(3).fill({ origen: 'esquema', errores: ['sobre'] }),
      );
      expect(con(SIN_ESPERA)).toEqual([]);
    });

    it('el envío se da de baja primero y las boletas después: el mismo orden de bloqueo que devolver()', async () => {
      revisar.mockResolvedValue({
        valido: false,
        errores: ['sobre'],
        invalidos: [{ tipo: 39, folio: 4002, errores: ['Basura'] }],
      });

      await job.enviarLotes();

      const orden = (fragmento: string) =>
        llamadas.findIndex((l) => l.sql.includes(fragmento));
      const baja = orden(BAJA);
      const rechazo = orden(REEMPLAZO);
      const devolucion = orden(SIN_ESPERA);
      expect(baja).toBeGreaterThan(-1);
      expect(baja).toBeLessThan(rechazo);
      expect(rechazo).toBeLessThan(devolucion);
    });

    it('la clave es (tipo, folio): con el mismo folio en una 39 y una 41, solo se rechaza la inválida', async () => {
      lote = [
        fila(2),
        { ...fila(2), documento_id: 'doc-41', tipo: 41 },
        fila(3),
      ];
      revisar.mockResolvedValue({
        valido: false,
        errores: ['sobre'],
        invalidos: [{ tipo: 41, folio: 4002, errores: ['Basura'] }],
      });

      await job.enviarLotes();

      expect(con(REEMPLAZO)[0].params[1]).toEqual(['doc-41']);
      expect(con(SIN_ESPERA)[0].params[1]).toEqual(['doc-2', 'doc-3']);
    });

    it('un inválido reconocido y otro que no calza: no se puede señalar a todos, así que todas se rechazan', async () => {
      revisar.mockResolvedValue({
        valido: false,
        errores: ['sobre'],
        invalidos: [
          { tipo: 39, folio: 4002, errores: ['Basura'] },
          { tipo: 39, folio: 9999, errores: ['x'] },
        ],
      });

      await job.enviarLotes();

      const [rech] = con(REEMPLAZO);
      expect(rech.params[1]).toEqual(['doc-1', 'doc-2', 'doc-3']);
      expect((rech.params[3] as string[]).map((j) => JSON.parse(j))).toEqual(
        Array(3).fill({ origen: 'esquema', errores: ['sobre'] }),
      );
      expect(con(SIN_ESPERA)).toEqual([]);
    });

    it('un fallo del validador (no un resultado) se propaga y no envía', async () => {
      revisar.mockRejectedValue(new Error('wasm'));

      await expect(job.enviarLotes()).rejects.toThrow('wasm');

      expect(enviar).not.toHaveBeenCalled();
      expect(con(REEMPLAZO)).toHaveLength(0);
    });

    it('un sobre válido sigue como siempre: se envía', async () => {
      await job.enviarLotes();
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(con(REEMPLAZO)).toHaveLength(0);
    });
  });

  it('el lote se toma con el tenant del grupo', async () => {
    await job.enviarLotes();
    expect(con('FOR UPDATE SKIP LOCKED')[0].params).toEqual([
      'rs-1',
      'certificacion',
      50,
      'tn-1',
    ]);
  });

  it('sin filas que reservar sigue con la próxima razón social', async () => {
    lote = [];
    await job.enviarLotes();
    expect(con('INSERT INTO dte_envios')).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('pausado por el SII: corta antes de reservar', async () => {
    pausadoHasta.mockReturnValue(Date.now() + 60_000);

    const mensaje = await job.enviarLotes();

    expect(con('FOR UPDATE SKIP LOCKED')).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
    expect(mensaje).toContain('espaciar');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('tick', () => {
    it('apagado por DTE_COLA_AUTOMATICA=false: no mira la cola ni llama al runner', async () => {
      config = 'false';
      await job.tick();
      expect(query).not.toHaveBeenCalled();
      expect(ejecutar).not.toHaveBeenCalled();
    });

    it('pausado por el SII: no mira la cola', async () => {
      pausadoHasta.mockReturnValue(Date.now() + 60_000);
      await job.tick();
      expect(query).not.toHaveBeenCalled();
    });

    it('sin trabajo no entra al runner', async () => {
      hayTrabajo = false;
      await job.tick();
      expect(ejecutar).not.toHaveBeenCalled();
    });

    it('con trabajo entra al runner con el nombre estable del job', async () => {
      await job.tick();
      expect(ejecutar).toHaveBeenCalledWith(
        JOB_ENVIAR_BOLETAS,
        expect.any(Function),
      );
    });

    it('si la consulta falla no tira: lo registra y espera al próximo tick', async () => {
      query.mockRejectedValueOnce(new Error('sin conexión'));
      await expect(job.tick()).resolves.toBeUndefined();
      expect(ejecutar).not.toHaveBeenCalled();
    });
  });
});
