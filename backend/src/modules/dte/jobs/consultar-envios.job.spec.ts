import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { type Db } from '../../../common/db/db.service';
import { type CronRunnerService } from '../../cron/cron-runner.service';
import { DteError } from '../dte.types';
import { type FoliosService } from '../folios.service';
import { ESTADOS_ENVIO_FINALES } from '../resultado-sii';
import {
  type EstadoEnvioSii,
  type RespuestaSii,
  type SiiBoletaCliente,
} from '../sii-boleta.cliente';
import {
  ConsultarEnviosJob,
  JOB_CONSULTAR_ENVIOS,
  REPITE_CONSULTA_MS,
} from './consultar-envios.job';

const ENVIO = (n: number, extra: object = {}) => ({
  envio_id: `envio-${n.toString()}`,
  tenant_id: 'tn-1',
  razon_social_id: 'rs-1',
  ambiente: 'certificacion',
  trackid: `88001${n.toString()}`,
  pasaron_24h: false,
  ...extra,
});
const BOLETA = (envio: number, folio: number, extra: object = {}) => ({
  envio_id: `envio-${envio.toString()}`,
  documento_id: `doc-${folio.toString()}`,
  caf_id: `caf-${envio.toString()}`,
  tipo: 39,
  folio,
  ...extra,
});
const CREDENCIALES = {
  certificado: { rut: '11111111-1' },
  caratula: { rutEmisor: '76555444-6' },
};

describe('ConsultarEnviosJob', () => {
  let llamadas: { sql: string; params: unknown[] }[];
  let envios: unknown[];
  let boletas: unknown[];
  let query: jest.Mock;
  let consultarEnvio: jest.Mock<Promise<RespuestaSii<EstadoEnvioSii>>>;
  let pausadoHasta: jest.Mock<number>;
  let credenciales: jest.Mock;
  let ejecutar: jest.Mock;
  let config: string | undefined;
  let hayTrabajo: boolean;
  let job: ConsultarEnviosJob;

  const con = (fragmento: string) =>
    llamadas.filter((l) => l.sql.includes(fragmento));
  const ok = (
    datos: EstadoEnvioSii,
    reintentarEnMs: number | null = null,
  ): RespuestaSii<EstadoEnvioSii> => ({ tipo: 'ok', datos, reintentarEnMs });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    llamadas = [];
    envios = [ENVIO(1)];
    boletas = [BOLETA(1, 2041), BOLETA(1, 2053), BOLETA(1, 2077)];
    hayTrabajo = true;
    config = undefined;
    query = jest.fn((sql: string, params: unknown[] = []) => {
      llamadas.push({ sql, params });
      if (sql.includes('FOR UPDATE SKIP LOCKED'))
        return Promise.resolve(envios);
      if (sql.includes('FROM dte_documentos')) return Promise.resolve(boletas);
      if (sql.includes('AS hay')) return Promise.resolve([{ hay: hayTrabajo }]);
      return Promise.resolve([[], 0]);
    });
    consultarEnvio = jest.fn().mockResolvedValue(ok({ estado: 'EPR' }));
    pausadoHasta = jest.fn().mockReturnValue(0);
    credenciales = jest.fn().mockResolvedValue(CREDENCIALES);
    ejecutar = jest.fn((_job: string, fn: () => Promise<string>) => fn());
    job = new ConsultarEnviosJob(
      { query, transaccion: (fn: () => unknown) => fn() } as unknown as Db,
      { ejecutar } as unknown as CronRunnerService,
      { credencialesParaFirmar: credenciales } as unknown as FoliosService,
      { consultarEnvio, pausadoHasta } as unknown as SiiBoletaCliente,
      { get: () => config } as unknown as ConfigService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('reserva el lote: toma hasta 20 envíos con SKIP LOCKED y mueve su consultar_desde 5 minutos', async () => {
    envios = [ENVIO(1), ENVIO(2)];
    boletas = [BOLETA(1, 2041), BOLETA(2, 2053)];

    await job.consultar();

    const [toma] = con('FOR UPDATE SKIP LOCKED');
    expect(toma.params[0]).toEqual(ESTADOS_ENVIO_FINALES);
    expect(toma.params[2]).toBe(20);
    expect(toma.sql).toContain('trackid IS NOT NULL');
    expect(toma.sql).toContain('eliminado_el IS NULL');
    const [reserva] = con('SET consultar_desde = now()');
    expect(reserva.params).toEqual([
      ['envio-1', 'envio-2'],
      REPITE_CONSULTA_MS,
    ]);
  });

  it('las boletas de todo el lote salen de una sola lectura, y el certificado se pide con el CAF de su envío', async () => {
    envios = [ENVIO(1), ENVIO(2, { razon_social_id: 'rs-2' })];
    boletas = [BOLETA(1, 2041), BOLETA(1, 2053), BOLETA(2, 2077)];

    await job.consultar(new Date('2040-01-01T00:00:00Z'));

    expect(con('FROM dte_documentos')).toHaveLength(1);
    expect(credenciales).toHaveBeenNthCalledWith(
      1,
      'tn-1',
      'caf-1',
      new Date('2040-01-01T00:00:00Z'),
    );
    expect(credenciales).toHaveBeenNthCalledWith(
      2,
      'tn-1',
      'caf-2',
      expect.any(Date),
    );
    expect(consultarEnvio).toHaveBeenCalledWith(
      'certificacion',
      CREDENCIALES.certificado,
      '76555444-6',
      '880011',
    );
  });

  it('sin envíos listos no hace nada más', async () => {
    envios = [];
    await expect(job.consultar()).resolves.toContain('Sin envíos');
    expect(con('SET consultar_desde = now()')).toHaveLength(0);
    expect(consultarEnvio).not.toHaveBeenCalled();
  });

  it('EPR: anota el envío como final y reparte las boletas en un solo UPDATE', async () => {
    consultarEnvio.mockResolvedValue(
      ok({
        estado: 'EPR',
        detalle_rep_rech: [
          { tipo: 39, folio: 2053, estado: 'RCH' },
          { tipo: 39, folio: 2077, estado: 'RPR' },
        ],
      }),
    );

    const mensaje = await job.consultar();

    expect(mensaje).toContain('1 envíos con resultado final');
    const [final] = con('consultar_desde = NULL, ultimo_error = $4');
    expect(final.params.slice(0, 2)).toEqual(['envio-1', 'EPR']);
    expect(final.params[3]).toBeNull();
    const reparto = con('unnest(');
    expect(reparto).toHaveLength(1);
    expect(reparto[0].params).toEqual([
      'envio-1',
      ['doc-2041', 'doc-2053', 'doc-2077'],
      ['aceptado', 'rechazado', 'reparos'],
      [
        null,
        JSON.stringify({ tipo: 39, folio: 2053, estado: 'RCH' }),
        JSON.stringify({ tipo: 39, folio: 2077, estado: 'RPR' }),
      ],
    ]);
    expect(reparto[0].sql).toContain("d.estado = 'enviado'");
    expect(reparto[0].sql).toContain('d.eliminado_el IS NULL');
  });

  it('RPT: el envío termina con el aviso y no se toca ninguna boleta', async () => {
    consultarEnvio.mockResolvedValue(ok({ estado: 'RPT' }));

    await job.consultar();

    const [final] = con('consultar_desde = NULL, ultimo_error = $4');
    expect(final.params[1]).toBe('RPT');
    expect(final.params[3]).toBe('El SII ya tenía este envío (RPT)');
    expect(con('unnest(')).toHaveLength(0);
  });

  it.each(['PRD', 'REC'])(
    '%s: sigue en proceso, se vuelve a consultar en 5 minutos y no toca las boletas',
    async (codigo) => {
      consultarEnvio.mockResolvedValue(ok({ estado: codigo }));

      const mensaje = await job.consultar();

      expect(mensaje).toContain('1 siguen en proceso');
      const [anota] = con('intentos_consulta = intentos_consulta + 1');
      expect(anota.sql).not.toContain('consultar_desde = NULL');
      expect(anota.params).toEqual([
        'envio-1',
        codigo,
        JSON.stringify({ estado: codigo }),
        REPITE_CONSULTA_MS,
        null,
      ]);
      expect(con('unnest(')).toHaveLength(0);
    },
  );

  it('un código del sobre desconocido: se sigue consultando cada 5 minutos y deja el aviso en ultimo_error', async () => {
    consultarEnvio.mockResolvedValue(ok({ estado: 'XYZ' }));

    const mensaje = await job.consultar();

    expect(mensaje).toContain('1 siguen en proceso');
    const [anota] = con('intentos_consulta = intentos_consulta + 1');
    expect(anota.params).toEqual([
      'envio-1',
      'XYZ',
      JSON.stringify({ estado: 'XYZ' }),
      REPITE_CONSULTA_MS,
      'El SII devolvió el código XYZ; se sigue consultando',
    ]);
    expect(con('unnest(')).toHaveLength(0);
  });

  it('si el SII pide esperar más de 5 minutos (X-Retry-After), se espera eso', async () => {
    consultarEnvio.mockResolvedValue(ok({ estado: 'PRD' }, 900_000));
    await job.consultar();
    expect(con('intentos_consulta = intentos_consulta + 1')[0].params[3]).toBe(
      900_000,
    );
  });

  it('un código de más de 3 letras se guarda cortado a 3', async () => {
    consultarEnvio.mockResolvedValue(ok({ estado: 'PRDX' }));
    await job.consultar();
    expect(con('intentos_consulta = intentos_consulta + 1')[0].params[1]).toBe(
      'PRD',
    );
  });

  it('un código desconocido que empieza como uno final (RCHX) no es final y no se guarda como RCH', async () => {
    consultarEnvio.mockResolvedValue(ok({ estado: 'RCHX' }));

    const mensaje = await job.consultar();

    expect(mensaje).toContain('1 siguen en proceso');
    expect(con('consultar_desde = NULL')).toHaveLength(0);
    expect(con('unnest(')).toHaveLength(0);
    // Guardado como RCH, la cola lo daría por terminado sin repartir nada.
    expect(
      con('intentos_consulta = intentos_consulta + 1')[0].params[1],
    ).toBeNull();
  });

  describe('las credenciales (una lectura por razón social)', () => {
    it('3 envíos de la misma razón social: se piden una sola vez', async () => {
      envios = [ENVIO(1), ENVIO(2), ENVIO(3)];
      boletas = [BOLETA(1, 2041), BOLETA(2, 2053), BOLETA(3, 2077)];

      await job.consultar();

      expect(credenciales).toHaveBeenCalledTimes(1);
      expect(consultarEnvio).toHaveBeenCalledTimes(3);
    });

    it('dos razones sociales: se piden dos veces', async () => {
      envios = [ENVIO(1), ENVIO(2, { razon_social_id: 'rs-2' }), ENVIO(3)];
      boletas = [BOLETA(1, 2041), BOLETA(2, 2053), BOLETA(3, 2077)];

      await job.consultar();

      expect(credenciales).toHaveBeenCalledTimes(2);
    });

    it('el mismo tenant y razón social en otro ambiente no comparte credenciales', async () => {
      envios = [ENVIO(1), ENVIO(2, { ambiente: 'produccion' })];
      boletas = [BOLETA(1, 2041), BOLETA(2, 2053)];

      await job.consultar();

      expect(credenciales).toHaveBeenCalledTimes(2);
    });

    it('un DteError se lee una vez y se anota en cada envío de esa razón social', async () => {
      envios = [ENVIO(1), ENVIO(2), ENVIO(3)];
      boletas = [BOLETA(1, 2041), BOLETA(2, 2053), BOLETA(3, 2077)];
      credenciales.mockRejectedValue(
        new DteError(
          'CERTIFICADO_VENCIDO',
          'El certificado digital está vencido',
        ),
      );

      const mensaje = await job.consultar();

      expect(credenciales).toHaveBeenCalledTimes(1);
      expect(consultarEnvio).not.toHaveBeenCalled();
      expect(mensaje).toContain('3 con error');
      expect(
        con('SET ultimo_error = $2, consultar_desde').map((l) => l.params[0]),
      ).toEqual(['envio-1', 'envio-2', 'envio-3']);
    });
  });

  describe('lo que no se pudo repartir queda a la vista en el envío', () => {
    it('una entrada con un código desconocido: la boleta no cambia y el envío lleva el aviso', async () => {
      consultarEnvio.mockResolvedValue(
        ok({
          estado: 'EPR',
          detalle_rep_rech: [
            { tipo: 39, folio: 2053, estado: 'XYZ' },
            { tipo: 39, folio: 2077, estado: 'RCH' },
          ],
        }),
      );

      await job.consultar();

      const [final] = con('consultar_desde = NULL, ultimo_error = $4');
      expect(final.params[3]).toContain('código desconocido (XYZ)');
      expect(final.params[3]).toContain('folio 2053');
      // Solo la que tiene su RCH se reparte: la 2053 no cambia y la 2041 no se acepta por
      // silencio.
      const reparto = con('unnest(')[0];
      expect(reparto.params[1]).toEqual(['doc-2077']);
      expect(reparto.params[2]).toEqual(['rechazado']);
    });

    it('una entrada RCH que no calza con ninguna boleta: el envío lleva el aviso', async () => {
      consultarEnvio.mockResolvedValue(
        ok({
          estado: 'EPR',
          detalle_rep_rech: [
            { tipo: 39, folio: 9999, estado: 'RCH' },
            { tipo: 39, folio: 2077, estado: 'RPR' },
          ],
        }),
      );

      await job.consultar();

      const [final] = con('consultar_desde = NULL, ultimo_error = $4');
      expect(final.params[3]).toContain('RCH');
      expect(final.params[3]).toContain('folio 9999');
      // Con una entrada que no se pudo ubicar, las boletas sin entrada propia no se aceptan.
      const reparto = con('unnest(')[0];
      expect(reparto.params[1]).toEqual(['doc-2077']);
      expect(reparto.params[2]).toEqual(['reparos']);
    });

    it('detalle_rep_rech que no es una lista: nada se reparte y el envío lleva el aviso', async () => {
      consultarEnvio.mockResolvedValue(
        ok({
          estado: 'EPR',
          detalle_rep_rech: { folio: 2053, estado: 'RCH' } as never,
        }),
      );

      await job.consultar();

      const [final] = con('consultar_desde = NULL, ultimo_error = $4');
      expect(final.params[3]).toContain('formato que no se entiende');
      expect(con('unnest(')).toHaveLength(0);
    });
  });

  describe('no_encontrado (404)', () => {
    it('antes de las 24 h: se vuelve a consultar en 5 minutos', async () => {
      consultarEnvio.mockResolvedValue({ tipo: 'no_encontrado' });

      await job.consultar();

      const [anota] = con('SET ultimo_error = $2, consultar_desde');
      expect(anota.params[0]).toBe('envio-1');
      expect(anota.params[2]).toBe(REPITE_CONSULTA_MS);
    });

    it('pasadas las 24 h: queda con el error y sale de la consulta', async () => {
      envios = [ENVIO(1, { pasaron_24h: true })];
      consultarEnvio.mockResolvedValue({ tipo: 'no_encontrado' });

      await job.consultar();

      const [anota] = con('SET ultimo_error = $2, consultar_desde');
      expect(anota.params).toEqual([
        'envio-1',
        'El SII no encuentra el envío',
        null,
      ]);
      expect(con('unnest(')).toHaveLength(0);
    });
  });

  it.each([
    [
      'transitorio',
      { tipo: 'transitorio' as const, mensaje: 'El SII cayó' },
      'El SII cayó',
    ],
    [
      'peticion_invalida',
      { tipo: 'peticion_invalida' as const, mensaje: 'Pedido mal formado' },
      'Pedido mal formado',
    ],
    [
      'no_autorizado',
      { tipo: 'no_autorizado' as const },
      'El SII no aceptó la autenticación del certificado; se reintenta',
    ],
  ])(
    '%s: anota el error y reintenta en 5 minutos, sin tocar las boletas',
    async (_n, respuesta, texto) => {
      consultarEnvio.mockResolvedValue(respuesta);

      const mensaje = await job.consultar();

      expect(mensaje).toContain('1 con error');
      expect(con('SET ultimo_error = $2, consultar_desde')[0].params).toEqual([
        'envio-1',
        texto,
        REPITE_CONSULTA_MS,
      ]);
      expect(con('unnest(')).toHaveLength(0);
      expect(con('intentos_consulta = intentos_consulta + 1')).toHaveLength(0);
    },
  );

  it('un DteError del certificado: anota el error, reintenta en 5 minutos y no llama al SII', async () => {
    credenciales.mockRejectedValue(
      new DteError(
        'CERTIFICADO_VENCIDO',
        'El certificado digital está vencido',
      ),
    );

    await job.consultar();

    expect(consultarEnvio).not.toHaveBeenCalled();
    expect(con('SET ultimo_error = $2, consultar_desde')[0].params).toEqual([
      'envio-1',
      'El certificado digital está vencido',
      REPITE_CONSULTA_MS,
    ]);
  });

  it('un envío sin boletas vivas queda con el error y fuera de la consulta', async () => {
    boletas = [];

    await job.consultar();

    expect(credenciales).not.toHaveBeenCalled();
    expect(con('SET ultimo_error = $2, consultar_desde')[0].params).toEqual([
      'envio-1',
      'El envío no tiene boletas vivas que consultar',
      null,
    ]);
  });

  it('un error de programación se propaga, sin anotar, y los demás envíos siguen', async () => {
    envios = [ENVIO(1), ENVIO(2, { razon_social_id: 'rs-2' })];
    boletas = [BOLETA(1, 2041), BOLETA(2, 2053)];
    credenciales.mockRejectedValueOnce(new TypeError('se rompió'));

    await expect(job.consultar()).rejects.toThrow('se rompió');

    expect(consultarEnvio).toHaveBeenCalledTimes(1);
    expect(con('SET ultimo_error = $2, consultar_desde')).toHaveLength(0);
    expect(con('consultar_desde = NULL, ultimo_error = $4')).toHaveLength(1);
  });

  describe('pausa por límite del SII', () => {
    it('pausado antes de empezar: no reserva ni consulta', async () => {
      pausadoHasta.mockReturnValue(Date.now() + 60_000);

      const mensaje = await job.consultar();

      expect(mensaje).toContain('espaciar');
      expect(query).not.toHaveBeenCalled();
      expect(consultarEnvio).not.toHaveBeenCalled();
    });

    it('si el SII pide espaciar a mitad del lote, no consulta los que faltan', async () => {
      envios = [ENVIO(1), ENVIO(2)];
      boletas = [BOLETA(1, 2041), BOLETA(2, 2053)];
      consultarEnvio.mockImplementation(() => {
        pausadoHasta.mockReturnValue(Date.now() + 60_000);
        return Promise.resolve(ok({ estado: 'PRD' }));
      });

      const mensaje = await job.consultar();

      expect(consultarEnvio).toHaveBeenCalledTimes(1);
      expect(mensaje).toContain('espaciar');
    });
  });

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
        JOB_CONSULTAR_ENVIOS,
        expect.any(Function),
      );
      expect(con('AS hay')[0].params).toEqual([ESTADOS_ENVIO_FINALES]);
    });

    it('si la consulta falla no tira: lo registra y espera al próximo tick', async () => {
      query.mockRejectedValueOnce(new Error('sin conexión'));
      await expect(job.tick()).resolves.toBeUndefined();
      expect(ejecutar).not.toHaveBeenCalled();
    });
  });
});
