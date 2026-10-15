import { Logger } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { certificadoDePrueba } from './__fixtures__/credenciales-prueba';
import {
  type PedidoRecibido,
  partesMultipart,
  respuestaXml,
  SiiFalso,
  TOKEN_FALSO,
} from './__fixtures__/sii-falso';
import { type CertificadoLeido, leerCertificado } from './firma';
import {
  type RespuestaSii,
  SiiBoletaCliente,
  TOKEN_VIGENCIA_MS,
} from './sii-boleta.cliente';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

// Cuatro prefijos distintos en el mismo falso: cada URL de configuración tiene el suyo.
const PREFIJOS = {
  SII_BOLETA_API_CERTIFICACION: '/cert-api',
  SII_BOLETA_ENVIO_CERTIFICACION: '/cert-envio',
  SII_BOLETA_API_PRODUCCION: '/prod-api',
  SII_BOLETA_ENVIO_PRODUCCION: '/prod-envio',
} as const;

const certPem = (b64: string) =>
  `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;

/** Verifica la firma del `getToken` recibido con la llave de NUESTRO certificado. */
const firmaVerifica = (xml: string, cert: CertificadoLeido) => {
  const sig = new SignedXml({
    publicCert: certPem(cert.certificadoB64),
    getCertFromKeyInfo: () => null,
  });
  sig.loadSignature(
    new DOMParser()
      .parseFromString(xml, 'text/xml')
      .getElementsByTagNameNS(DSIG, 'Signature')[0],
  );
  return sig.checkSignature(xml);
};

const cuerpoTexto = (p: PedidoRecibido) => p.cuerpo.toString('utf8');

describe('SiiBoletaCliente', () => {
  const { pfx, clave } = certificadoDePrueba({ rut: '11111111-1' });
  const cert = leerCertificado(pfx, clave);
  const otro = certificadoDePrueba({ rut: '22222222-2' });
  const certOtro = leerCertificado(otro.pfx, otro.clave);

  const RUT_EMISOR = '76543210-3';
  const SOBRE = '<EnvioBOLETA>boleta de prueba</EnvioBOLETA>';

  let falso: SiiFalso;
  let ahoraMs: number;
  let cliente: SiiBoletaCliente;

  const armarCliente = () => {
    const config = {
      get: (k: keyof typeof PREFIJOS) =>
        PREFIJOS[k] ? `${falso.url}${PREFIJOS[k]}` : undefined,
    } as unknown as ConfigService;
    return new SiiBoletaCliente(config, () => ahoraMs);
  };

  beforeAll(async () => {
    falso = await SiiFalso.iniciar();
  });
  afterAll(() => falso.cerrar());
  beforeEach(() => {
    falso.reiniciar();
    ahoraMs = 1_800_000_000_000;
    cliente = armarCliente();
  });
  afterEach(() => jest.restoreAllMocks());

  const enviar = (
    c = cliente,
    cr = cert,
    amb: 'certificacion' | 'produccion' = 'certificacion',
  ) => c.enviar(amb, cr, RUT_EMISOR, SOBRE);

  const okDatos = <T>(r: RespuestaSii<T>): T => {
    if (r.tipo !== 'ok')
      throw new Error(`se esperaba ok, vino ${JSON.stringify(r)}`);
    return r.datos;
  };

  describe('token', () => {
    it('el primer envío pide semilla y token; el segundo reusa el token', async () => {
      okDatos(await enviar());
      okDatos(await enviar());
      expect(falso.pedidosDe('semilla')).toHaveLength(1);
      expect(falso.pedidosDe('token')).toHaveLength(1);
      expect(falso.pedidosDe('envio')).toHaveLength(2);
    });

    it('el cuerpo del token es el getToken firmado con la semilla que dio el SII', async () => {
      falso.responder(
        'semilla',
        respuestaXml('<SEMILLA>987654321098</SEMILLA>'),
      );
      okDatos(await enviar());

      const [pedido] = falso.pedidosDe('token');
      const xml = cuerpoTexto(pedido);
      expect(pedido.headers['content-type']).toBe('application/xml');
      expect(xml).toContain('<Semilla>987654321098</Semilla>');
      expect(
        xml.startsWith(
          '<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item>',
        ),
      ).toBe(true);
      expect(firmaVerifica(xml, cert)).toBe(true);
      // Alterar la semilla rompe la firma: el test no verifica cualquier cosa.
      expect(
        firmaVerifica(xml.replace('987654321098', '987654321099'), cert),
      ).toBe(false);
    });

    it('lee la semilla y el token con cualquier prefijo de namespace', async () => {
      falso.responder(
        'semilla',
        respuestaXml('<ns2:SEMILLA>111222333444</ns2:SEMILLA>'),
      );
      falso.responder('token', respuestaXml('<x:TOKEN>TOKENXYZ</x:TOKEN>'));
      okDatos(await enviar());
      expect(cuerpoTexto(falso.pedidosDe('token')[0])).toContain(
        '<Semilla>111222333444</Semilla>',
      );
      expect(falso.pedidosDe('envio')[0].headers.cookie).toBe('TOKEN=TOKENXYZ');
    });

    it('el envío lleva el token en la cookie y el User-Agent del OpenAPI', async () => {
      okDatos(await enviar());
      const [p] = falso.pedidosDe('envio');
      expect(p.headers.cookie).toBe(`TOKEN=${TOKEN_FALSO}`);
      expect(p.headers['user-agent']).toBe(
        'Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)',
      );
    });

    it('el token vence a los 50 minutos sin uso', async () => {
      okDatos(await enviar());
      ahoraMs += TOKEN_VIGENCIA_MS - 1;
      okDatos(await enviar());
      expect(falso.pedidosDe('token')).toHaveLength(1);

      // El uso anterior renovó la hora: se cuenta desde ahí.
      ahoraMs += TOKEN_VIGENCIA_MS;
      okDatos(await enviar());
      expect(falso.pedidosDe('token')).toHaveLength(2);
    });

    it('cada uso exitoso renueva el vencimiento', async () => {
      okDatos(await enviar());
      for (let i = 0; i < 3; i++) {
        ahoraMs += TOKEN_VIGENCIA_MS - 1;
        okDatos(await enviar());
      }
      expect(falso.pedidosDe('token')).toHaveLength(1);
    });

    it('el token es por certificado y por ambiente', async () => {
      okDatos(await enviar());
      okDatos(await enviar(cliente, certOtro));
      expect(falso.pedidosDe('token')).toHaveLength(2);
      okDatos(await enviar(cliente, cert, 'produccion'));
      expect(falso.pedidosDe('token')).toHaveLength(3);
      okDatos(await enviar(cliente, cert));
      expect(falso.pedidosDe('token')).toHaveLength(3);
    });

    it('dos envíos a la vez comparten un solo pedido de token', async () => {
      const [a, b] = await Promise.all([enviar(), enviar()]);
      okDatos(a);
      okDatos(b);
      expect(falso.pedidosDe('token')).toHaveLength(1);
    });

    it('un 401 borra el token, pide otro y reintenta', async () => {
      falso.responder('envio', { status: 401 });
      falso.responder(
        'token',
        respuestaXml('<TOKEN>PRIMERO</TOKEN>'),
        respuestaXml('<TOKEN>SEGUNDO</TOKEN>'),
      );

      expect(okDatos(await enviar()).trackid).toBe('1014');
      const envios = falso.pedidosDe('envio');
      expect(envios).toHaveLength(2);
      expect(envios[0].headers.cookie).toBe('TOKEN=PRIMERO');
      expect(envios[1].headers.cookie).toBe('TOKEN=SEGUNDO');
      expect(falso.pedidosDe('token')).toHaveLength(2);
    });

    it('dos 401 seguidos dan no_autorizado, y el token malo no queda guardado', async () => {
      falso.responder('envio', { status: 401 }, { status: 401 });
      expect(await enviar()).toEqual({ tipo: 'no_autorizado' });
      expect(falso.pedidosDe('envio')).toHaveLength(2);

      okDatos(await enviar());
      expect(falso.pedidosDe('token')).toHaveLength(3);
    });

    it('un 401 al pedir el token es no_autorizado', async () => {
      falso.responder('token', { status: 401 });
      expect(await enviar()).toEqual({ tipo: 'no_autorizado' });
      expect(falso.pedidosDe('envio')).toHaveLength(0);
    });

    it('un ESTADO distinto de 00 en la semilla es transitorio con la glosa', async () => {
      falso.responder('semilla', respuestaXml('', '10', 'Error interno'));
      const r = await enviar();
      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect((r as { mensaje: string }).mensaje).toContain('Error interno');
      expect(falso.pedidosDe('token')).toHaveLength(0);
    });

    it('una semilla o un token que no vienen en la respuesta son transitorio', async () => {
      falso.responder('semilla', respuestaXml(''));
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });

      falso.responder('token', respuestaXml('<TOKEN></TOKEN>'));
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
      expect(falso.pedidosDe('envio')).toHaveLength(0);
    });

    it('un 500 al pedir la semilla es transitorio', async () => {
      falso.responder('semilla', { status: 500 });
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
    });
  });

  describe('enviar', () => {
    it('el archivo llega en latin1: la Ñ es 0xD1, no 0xC3 0x91', async () => {
      const sobre = '<RznSoc>PEÑA Y CÍA</RznSoc>';
      okDatos(await cliente.enviar('certificacion', cert, RUT_EMISOR, sobre));

      const archivo = partesMultipart(falso.pedidosDe('envio')[0]).archivo;
      expect(archivo.nombreArchivo).toBe('envio.xml');
      expect(archivo.contenido.equals(Buffer.from(sobre, 'latin1'))).toBe(true);
      expect(archivo.contenido.includes(0xd1)).toBe(true);
      expect(archivo.contenido.includes(0xc3)).toBe(false);
    });

    it('rutSender y dvSender son los del certificado; rutCompany y dvCompany, los del emisor', async () => {
      okDatos(await cliente.enviar('certificacion', cert, '1000005-K', SOBRE));
      const campos = partesMultipart(falso.pedidosDe('envio')[0]);
      const texto = (n: string) => campos[n].contenido.toString('latin1');
      expect(texto('rutSender')).toBe('11111111');
      expect(texto('dvSender')).toBe('1');
      expect(texto('rutCompany')).toBe('1000005');
      expect(texto('dvCompany')).toBe('K');
    });

    it('devuelve el trackid como texto y el estado del SII', async () => {
      falso.responder('envio', {
        headers: { 'content-type': 'application/json' },
        cuerpo: JSON.stringify({ trackid: 123456789012345, estado: 'REC' }),
      });
      expect(okDatos(await enviar())).toEqual({
        trackid: '123456789012345',
        estado: 'REC',
      });
    });

    it('un 200 sin trackid es transitorio', async () => {
      falso.responder('envio', { cuerpo: '{"estado":"REC"}' });
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
      falso.responder('envio', { cuerpo: 'no es json' });
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
    });

    it('X-Retry-After en un 200 se devuelve en ms; sin el header, null', async () => {
      falso.responder('envio', {
        headers: { 'X-Retry-After': '23' },
        cuerpo: '{"trackid":7,"estado":"REC"}',
      });
      const conEspera = await enviar();
      expect(conEspera).toMatchObject({ tipo: 'ok', reintentarEnMs: 23_000 });
      const sinEspera = await enviar();
      expect(sinEspera).toMatchObject({ tipo: 'ok', reintentarEnMs: null });
    });

    it('X-Retry-After sobre 1 hora se topea a 1 hora; uno no numérico o negativo se ignora', async () => {
      for (const [valor, esperado] of [
        ['999999', 3_600_000],
        ['abc', null],
        ['-5', null],
        ['', null],
      ] as const) {
        falso.responder('envio', {
          headers: { 'X-Retry-After': valor },
          cuerpo: '{"trackid":7,"estado":"REC"}',
        });
        expect(await enviar()).toMatchObject({
          tipo: 'ok',
          reintentarEnMs: esperado,
        });
      }
    });

    it('un trackid que no son hasta 15 dígitos no es ok: es transitorio con mensaje fijo', async () => {
      for (const trackid of [
        'abc',
        '1234567890123456',
        '12 3',
        '-4',
        '1e3',
        1.5,
      ]) {
        falso.responder('envio', {
          cuerpo: JSON.stringify({ trackid, estado: 'REC' }),
        });
        expect(await enviar()).toEqual({
          tipo: 'transitorio',
          mensaje: 'El SII respondió sin un número de envío válido',
        });
      }
    });

    it('un 400 es peticion_invalida con el texto del SII', async () => {
      falso.responder('envio', {
        status: 400,
        cuerpo: 'Sobre mal formado en línea 3',
      });
      expect(await enviar()).toEqual({
        tipo: 'peticion_invalida',
        mensaje: 'Sobre mal formado en línea 3',
      });
    });

    it('un 400 sin cuerpo trae un mensaje igual', async () => {
      falso.responder('envio', { status: 400 });
      const r = await enviar();
      expect(r).toMatchObject({ tipo: 'peticion_invalida' });
      expect((r as { mensaje: string }).mensaje).not.toBe('');
    });

    it('un 500 es transitorio', async () => {
      falso.responder('envio', { status: 500, cuerpo: 'boom' });
      const r = await enviar();
      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect((r as { mensaje: string }).mensaje).toContain('500');
    });

    it('un 404 es no_encontrado', async () => {
      falso.responder('envio', { status: 404 });
      expect(await enviar()).toEqual({ tipo: 'no_encontrado' });
    });

    it('el pedido tiene un timeout de 20 s; si vence, es transitorio', async () => {
      okDatos(await enviar()); // deja el token cacheado
      const real = AbortSignal.timeout.bind(AbortSignal);
      const espia = jest
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation(() => real(100));
      falso.responder('envio', { demoraMs: 2_000 });

      const r = await enviar();

      expect(espia).toHaveBeenCalledWith(20_000);
      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect((r as { mensaje: string }).mensaje).toContain('a tiempo');
    });

    it('con la red caída es transitorio', async () => {
      const falsoCaido = await SiiFalso.iniciar();
      const url = falsoCaido.url;
      await falsoCaido.cerrar();
      const config = {
        get: () => `${url}/x`,
      } as unknown as ConfigService;
      const r = await new SiiBoletaCliente(config, () => ahoraMs).enviar(
        'certificacion',
        cert,
        RUT_EMISOR,
        SOBRE,
      );
      expect(r).toMatchObject({ tipo: 'transitorio' });
    });

    it('ni el token ni la llave aparecen en ningún resultado de error', async () => {
      const resultados = [
        await (async () => {
          falso.responder('envio', { status: 500, cuerpo: 'boom' });
          return enviar();
        })(),
        await (async () => {
          falso.responder('envio', { status: 400, cuerpo: 'mal' });
          return enviar();
        })(),
        await (async () => {
          falso.responder('envio', { status: 405 });
          return enviar();
        })(),
        await enviar(), // pausado
      ];
      const texto = JSON.stringify(resultados);
      expect(resultados.every((r) => r.tipo !== 'ok')).toBe(true);
      expect(texto).not.toContain(TOKEN_FALSO);
      expect(texto).not.toContain(cert.llavePrivadaPem.slice(40, 80));
    });
  });

  describe('consultarEnvio', () => {
    it('pide /boleta.electronica.envio/{rut}-{dv}-{trackid} al servidor de consulta con la cookie', async () => {
      falso.responder('consulta', {
        cuerpo: JSON.stringify({
          estado: 'RPR',
          detalle_rep_rech: [{ tipo: 39, folio: 42, estado: 'RPR' }],
        }),
      });
      const r = await cliente.consultarEnvio(
        'certificacion',
        cert,
        RUT_EMISOR,
        '8800123',
      );

      expect(okDatos(r)).toEqual({
        estado: 'RPR',
        detalle_rep_rech: [{ tipo: 39, folio: 42, estado: 'RPR' }],
      });
      const [p] = falso.pedidosDe('consulta');
      expect(p.metodo).toBe('GET');
      expect(p.ruta).toBe(
        '/cert-api/boleta.electronica.envio/76543210-3-8800123',
      );
      expect(p.headers.cookie).toBe(`TOKEN=${TOKEN_FALSO}`);
    });

    it('un 404 es no_encontrado', async () => {
      falso.responder('consulta', { status: 404 });
      expect(
        await cliente.consultarEnvio('certificacion', cert, RUT_EMISOR, '55'),
      ).toEqual({ tipo: 'no_encontrado' });
    });

    it('un 401 reintenta con token nuevo', async () => {
      falso.responder('consulta', { status: 401 });
      okDatos(
        await cliente.consultarEnvio('certificacion', cert, RUT_EMISOR, '55'),
      );
      expect(falso.pedidosDe('token')).toHaveLength(2);
      expect(falso.pedidosDe('consulta')).toHaveLength(2);
    });

    it('X-Retry-After de la consulta se devuelve en ms', async () => {
      falso.responder('consulta', {
        headers: { 'X-Retry-After': '600' },
        cuerpo: '{"estado":"PRD"}',
      });
      const r = await cliente.consultarEnvio(
        'certificacion',
        cert,
        RUT_EMISOR,
        '55',
      );
      expect(r).toMatchObject({ tipo: 'ok', reintentarEnMs: 600_000 });
    });

    it('un cuerpo sin estado es transitorio', async () => {
      falso.responder('consulta', { cuerpo: '{"trackid":55}' });
      expect(
        await cliente.consultarEnvio('certificacion', cert, RUT_EMISOR, '55'),
      ).toMatchObject({ tipo: 'transitorio' });
    });
  });

  describe('límite de pedidos del SII', () => {
    it('un 405 pausa hasta X-RateLimit-Reset, es transitorio y el siguiente pedido no sale', async () => {
      falso.responder('envio', {
        status: 405,
        headers: { 'X-RateLimit-Reset': '37' },
      });
      expect(cliente.pausadoHasta()).toBe(0);

      const r = await enviar();

      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 37_000);
      const pedidosAntes = falso.pedidos.length;
      const pausado = await enviar();
      expect(pausado).toMatchObject({ tipo: 'transitorio' });
      expect(falso.pedidos).toHaveLength(pedidosAntes);
      // Tampoco las consultas.
      expect(
        await cliente.consultarEnvio('certificacion', cert, RUT_EMISOR, '55'),
      ).toMatchObject({ tipo: 'transitorio' });
      expect(falso.pedidos).toHaveLength(pedidosAntes);
    });

    it('un 405 sin X-RateLimit-Reset pausa 60 s', async () => {
      falso.responder('envio', { status: 405 });
      await enviar();
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 60_000);
    });

    it('pasada la pausa vuelve a llamar al SII', async () => {
      falso.responder('envio', {
        status: 405,
        headers: { 'X-RateLimit-Reset': '37' },
      });
      await enviar();
      ahoraMs += 36_999;
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
      expect(falso.pedidosDe('envio')).toHaveLength(1);

      ahoraMs += 1;
      okDatos(await enviar());
      expect(falso.pedidosDe('envio')).toHaveLength(2);
    });

    it('X-RateLimit-Remaining 0 pausa pero devuelve el resultado', async () => {
      falso.responder('envio', {
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '120' },
        cuerpo: '{"trackid":9,"estado":"REC"}',
      });

      const r = await enviar();

      expect(okDatos(r).trackid).toBe('9');
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 120_000);
      const antes = falso.pedidos.length;
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
      expect(falso.pedidos).toHaveLength(antes);
    });

    it('con Remaining mayor que 0 no pausa', async () => {
      falso.responder('envio', {
        headers: { 'X-RateLimit-Remaining': '17', 'X-RateLimit-Reset': '120' },
        cuerpo: '{"trackid":9,"estado":"REC"}',
      });
      okDatos(await enviar());
      expect(cliente.pausadoHasta()).toBe(0);
    });

    it('un 405 al pedir el token también pausa', async () => {
      falso.responder('semilla', {
        status: 405,
        headers: { 'X-RateLimit-Reset': '5' },
      });
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 5_000);
    });
  });

  describe('endurecimiento', () => {
    const mensajeDe = (r: RespuestaSii<unknown>) =>
      (r as { mensaje: string }).mensaje;

    it('X-RateLimit-Reset enorme en segundos se topea a 1 hora', async () => {
      falso.responder('envio', {
        status: 405,
        headers: { 'X-RateLimit-Reset': '900000' },
      });
      await enviar();
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 3_600_000);
    });

    it('X-RateLimit-Reset como epoch en el futuro es la espera hasta esa hora', async () => {
      const epoch = ahoraMs / 1000 + 120;
      falso.responder('envio', {
        status: 405,
        headers: { 'X-RateLimit-Reset': String(epoch) },
      });
      await enviar();
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 120_000);
    });

    it('un epoch lejano o ya pasado no pausa más de 1 hora', async () => {
      falso.responder('envio', {
        status: 405,
        headers: { 'X-RateLimit-Reset': '1700000000' },
      });
      await enviar();
      expect(cliente.pausadoHasta()).toBeLessThanOrEqual(ahoraMs + 3_600_000);

      cliente = armarCliente();
      falso.responder('envio', {
        status: 405,
        headers: { 'X-RateLimit-Reset': String(ahoraMs / 1000 + 9_999_999) },
      });
      await enviar();
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 3_600_000);
    });

    it('un X-RateLimit-Reset que no es un número usa 60 s', async () => {
      falso.responder('envio', {
        status: 405,
        headers: { 'X-RateLimit-Reset': 'pronto' },
      });
      await enviar();
      expect(cliente.pausadoHasta()).toBe(ahoraMs + 60_000);
    });

    it.each(['', ' ', 'cero', '-0', '0.5'])(
      'X-RateLimit-Remaining %j no pausa',
      async (valor) => {
        falso.responder('envio', {
          headers: {
            'X-RateLimit-Remaining': valor,
            'X-RateLimit-Reset': '99',
          },
          cuerpo: '{"trackid":9,"estado":"REC"}',
        });
        okDatos(await enviar());
        expect(cliente.pausadoHasta()).toBe(0);
      },
    );

    it('una llave que no firma devuelve transitorio con el mensaje del certificado', async () => {
      const aviso = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const rota = { ...cert, llavePrivadaPem: 'esto no es una llave' };

      const r = await cliente.enviar('certificacion', rota, RUT_EMISOR, SOBRE);
      expect(r).toEqual({
        tipo: 'transitorio',
        mensaje: 'El certificado digital no sirve para firmar; súbalo de nuevo',
      });
      expect(falso.pedidosDe('envio')).toHaveLength(0);

      const c = await cliente.consultarEnvio(
        'certificacion',
        rota,
        RUT_EMISOR,
        '5',
      );
      expect(c).toMatchObject({ tipo: 'transitorio' });
      expect(mensajeDe(c)).toContain('no sirve para firmar');

      // La causa queda en el log, sin la llave ni el certificado.
      expect(aviso).toHaveBeenCalledTimes(2);
      const registrado = String(aviso.mock.calls[0][0]);
      expect(registrado).toMatch(/Error: /);
      expect(registrado).not.toContain('esto no es una llave');
      expect(registrado).not.toContain(cert.certificadoB64);
    });

    it('un RUT inválido del emisor devuelve transitorio con el mensaje del RUT', async () => {
      for (const malo of ['12/34-5', '76543210-4', '', 'abc']) {
        const e = await cliente.enviar('certificacion', cert, malo, SOBRE);
        expect(e).toEqual({
          tipo: 'transitorio',
          mensaje: 'El RUT del emisor o del certificado no es válido',
        });
        const c = await cliente.consultarEnvio(
          'certificacion',
          cert,
          malo,
          '5',
        );
        expect(mensajeDe(c)).toContain('RUT');
      }
      expect(falso.pedidos).toHaveLength(0);
    });

    it('un RUT inválido en el certificado devuelve transitorio con el mensaje del RUT', async () => {
      const r = await cliente.enviar(
        'certificacion',
        { ...cert, rut: '11111111-2' },
        RUT_EMISOR,
        SOBRE,
      );
      expect(mensajeDe(r)).toContain('RUT');
      expect(falso.pedidos).toHaveLength(0);
    });

    it('un error de programación no se disfraza: tira', async () => {
      const sinConfig = { get: () => undefined } as unknown as ConfigService;
      const c = new SiiBoletaCliente(sinConfig, () => ahoraMs);
      // Un tipo que no es RUT no es dato del SII ni del certificado: es un bug del llamador.
      await expect(
        c.enviar('certificacion', cert, undefined as unknown as string, SOBRE),
      ).rejects.toThrow();
    });

    it('un redirect no se sigue y es transitorio', async () => {
      okDatos(await enviar());
      falso.responder('envio', {
        status: 302,
        headers: { Location: `${falso.url}/otro-lado` },
      });
      expect(await enviar()).toMatchObject({ tipo: 'transitorio' });
      expect(falso.pedidos.some((p) => p.ruta === '/otro-lado')).toBe(false);
    });

    it('la GLOSA del SII se recorta a 500 caracteres', async () => {
      falso.responder('semilla', respuestaXml('', '99', 'x'.repeat(5_000)));
      const r = await enviar();
      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect(mensajeDe(r).length).toBeLessThan(600);
      expect(mensajeDe(r)).toContain('x'.repeat(500));
      expect(mensajeDe(r)).not.toContain('x'.repeat(501));
    });

    it('una semilla que no son dígitos no se firma y es transitorio', async () => {
      falso.responder(
        'semilla',
        respuestaXml('<SEMILLA>1</Semilla><x>2</SEMILLA>'),
      );
      falso.responder('semilla', respuestaXml('<SEMILLA>12ab</SEMILLA>'));
      const r1 = await enviar();
      const r2 = await enviar();
      expect(r1).toMatchObject({ tipo: 'transitorio' });
      expect(r2).toMatchObject({ tipo: 'transitorio' });
      expect(mensajeDe(r2)).not.toContain('12ab');
      expect(falso.pedidosDe('token')).toHaveLength(0);
    });

    it('una respuesta con Content-Length sobre 1 MB es transitorio', async () => {
      okDatos(await enviar());
      falso.responder('envio', { cuerpo: 'a'.repeat(1_048_577) });
      const r = await enviar();
      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect(mensajeDe(r)).toContain('grande');
      expect(mensajeDe(r)).not.toContain('aaaa');
    });

    it('un Content-Length declarado sobre 1 MB se rechaza sin esperar el cuerpo', async () => {
      okDatos(await enviar());
      falso.responder('envio', {
        headers: { 'Content-Length': '2000000' },
        cuerpo: 'corto',
      });
      const r = await enviar();
      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect(mensajeDe(r)).toContain('grande');
    });

    it('una respuesta fragmentada que pasa de 1 MB es transitorio', async () => {
      okDatos(await enviar());
      falso.responder('envio', {
        fragmentado: true,
        cuerpo: 'a'.repeat(1_048_577),
      });
      const r = await enviar();
      expect(r).toMatchObject({ tipo: 'transitorio' });
      expect(mensajeDe(r)).toContain('grande');
    });

    it('una respuesta fragmentada de 1 MB justo se lee', async () => {
      okDatos(await enviar());
      falso.responder('envio', {
        fragmentado: true,
        cuerpo: `{"trackid":5,"estado":"REC","relleno":"${'a'.repeat(1_048_000)}"}`,
      });
      expect(okDatos(await enviar()).trackid).toBe('5');
    });
  });

  describe('servidores', () => {
    it('certificación y producción usan sus servidores de API y de envío', async () => {
      okDatos(await enviar(cliente, cert, 'certificacion'));
      okDatos(await enviar(cliente, cert, 'produccion'));
      okDatos(
        await cliente.consultarEnvio('certificacion', cert, RUT_EMISOR, '1'),
      );
      okDatos(
        await cliente.consultarEnvio('produccion', cert, RUT_EMISOR, '1'),
      );

      expect(falso.pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
        'GET /cert-api/boleta.electronica.semilla',
        'POST /cert-api/boleta.electronica.token',
        'POST /cert-envio/boleta.electronica.envio',
        'GET /prod-api/boleta.electronica.semilla',
        'POST /prod-api/boleta.electronica.token',
        'POST /prod-envio/boleta.electronica.envio',
        'GET /cert-api/boleta.electronica.envio/76543210-3-1',
        'GET /prod-api/boleta.electronica.envio/76543210-3-1',
      ]);
    });

    it('sin configuración valen los servidores del SII', async () => {
      const urls: string[] = [];
      jest.spyOn(globalThis, 'fetch').mockImplementation((entrada) => {
        const url = entrada as string;
        urls.push(url);
        const cuerpo = url.endsWith('semilla')
          ? '<SEMILLA>123</SEMILLA>'
          : url.endsWith('token')
            ? '<TOKEN>T</TOKEN>'
            : '{"trackid":1,"estado":"REC","estado_consulta":"EPR"}';
        return Promise.resolve(new Response(cuerpo, { status: 200 }));
      });
      const config = { get: () => undefined } as unknown as ConfigService;
      const c = new SiiBoletaCliente(config, () => ahoraMs);

      await c.enviar('certificacion', cert, RUT_EMISOR, SOBRE);
      await c.enviar('produccion', cert, RUT_EMISOR, SOBRE);
      await c.consultarEnvio('produccion', cert, RUT_EMISOR, '9');

      expect(urls).toEqual([
        'https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla',
        'https://apicert.sii.cl/recursos/v1/boleta.electronica.token',
        'https://pangal.sii.cl/recursos/v1/boleta.electronica.envio',
        'https://api.sii.cl/recursos/v1/boleta.electronica.semilla',
        'https://api.sii.cl/recursos/v1/boleta.electronica.token',
        'https://rahue.sii.cl/recursos/v1/boleta.electronica.envio',
        'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76543210-3-9',
      ]);
    });
  });
});
