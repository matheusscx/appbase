import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris: Webpay Plus y Oneclick (seed)
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
const URL_EXITO = 'http://app.e2e/exito';
const URL_FRACASO = 'http://app.e2e/fracaso';

/**
 * Los retornos públicos de Webpay (`/pasarela/retorno/pago` e `/inscripcion`):
 * el comprador vuelve de Transbank por GET, por POST form o —un cliente
 * cualquiera— por POST JSON, y el desenlace lo dicen los campos que trae.
 *
 * Fija dos cosas. Primero, los desenlaces que Transbank manda de verdad, en los
 * tres formatos: aprobado (`token_ws`), abortado (`TBK_TOKEN` +
 * `TBK_ORDEN_COMPRA`, con o sin `token_ws`), timeout del formulario (solo
 * `TBK_ORDEN_COMPRA`) y el doble retorno. Hasta el 2026-10-08 el único e2e del
 * retorno era el GET con `token_ws` de la tienda.
 *
 * Segundo, que un campo que no es texto es 400 en el borde. Medido el
 * 2026-10-08: un objeto o un array llegaba al `WHERE` por `tokenProveedor`/
 * `codigoOrden`, `pg` lo serializaba a texto (`'{"a":1}'`) y no matcheaba nada,
 * así que contestaba el 404 de un token desconocido sin escribir. No era un
 * hueco: era la validación de borde que faltaba. Los campos se leen sueltos y no
 * con un DTO porque Transbank manda campos que no controlamos
 * (`validacion-global.e2e-spec.ts`).
 */
describe('Pasarela: retornos de Webpay (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let apiKey: string;

  /** Tokens que el proveedor falso recibió para confirmar, en orden. */
  const confirmados: string[] = [];
  let secuencia = 0;
  const proveedorPago = {
    iniciarPago: (_cred: unknown, p: { codigoOrden: string }) =>
      Promise.resolve({
        tokenExterno: `tok-retorno-${p.codigoOrden}`,
        urlRedireccion: 'https://webpay.falso/iniciar',
        aprobada: true,
        codigoRespuesta: null,
        request: {},
        response: {},
      }),
    confirmarPago: (_cred: unknown, token: string) => {
      confirmados.push(token);
      return Promise.resolve({
        aprobada: true,
        codigoRespuesta: '0',
        codigoAutorizacion: '1213',
        identificadorTransaccionExterno: null,
        tipoPago: 'VN',
        numeroCuotas: 0,
        montoCuota: null,
        tarjetaUltimos4: '6623',
        request: {},
        response: {},
      });
    },
  };
  const proveedorTokenizado = {
    iniciarInscripcion: () =>
      Promise.resolve({
        tokenExterno: `tok-insc-${++secuencia}-${Date.now()}`,
        urlRedireccion: 'https://webpay.falso/inscribir',
        aprobada: true,
        codigoRespuesta: null,
        request: {},
        response: {},
      }),
    confirmarInscripcion: () =>
      Promise.resolve({
        aprobada: true,
        codigoRespuesta: '0',
        codigoAutorizacion: '1213',
        identificadorExterno: 'tbk-user-e2e',
        tarjeta: { tipo: 'credito', marca: 'Visa', ultimos4: '6623' },
        request: {},
        response: {},
      }),
  };

  type Formato = 'GET' | 'POST form' | 'POST JSON';
  const FORMATOS: Formato[] = ['GET', 'POST form', 'POST JSON'];

  /** Vuelve de Webpay con `campos` en el formato pedido. */
  const volver = (
    ruta: 'pago' | 'inscripcion',
    formato: Formato,
    campos: Record<string, unknown>,
  ) => {
    const url = `/api/pasarela/retorno/${ruta}`;
    const server = app.getHttpServer();
    if (formato === 'GET') {
      // A mano y no con `.query()`: superagent escribe un array como
      // `token_ws[0]=…`, y el navegador lo manda repitiendo el parámetro.
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(campos))
        for (const x of [v].flat()) qs.append(k, String(x));
      return request(server).get(`${url}?${qs.toString()}`);
    }
    if (formato === 'POST form') {
      // También a mano: así el body es el que manda un formulario, con la
      // sintaxis `x[a]=1`/`x[]=1` que el parser extendido arma en objeto/array.
      const cuerpo = Object.entries(campos)
        .map(([k, v]) =>
          typeof v === 'string'
            ? `${k}=${encodeURIComponent(v)}`
            : Object.entries(v as object)
                .map(
                  ([i, x]) =>
                    `${k}[${Array.isArray(v) ? '' : i}]=${encodeURIComponent(String(x))}`,
                )
                .join('&'),
        )
        .join('&');
      return request(server).post(url).type('form').send(cuerpo);
    }
    return request(server).post(url).send(campos);
  };

  const crearOrden = async () => {
    const res = await request(app.getHttpServer())
      .post('/api/pasarela/api/pagos')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        monto: '1000',
        descripcion: 'retorno e2e',
        urlExito: URL_EXITO,
        urlFracaso: URL_FRACASO,
      });
    expect(res.status).toBe(201);
    const { ordenId, token } = res.body as { ordenId: string; token: string };
    // Por PK y sin `eliminado_el IS NULL`: la orden la acaba de crear el test.
    const [orden]: { codigo_orden: string }[] = await ds.query(
      `SELECT codigo_orden FROM pasarela_ordenes WHERE orden_id = $1`,
      [ordenId],
    );
    return { ordenId, token, codigoOrden: orden.codigo_orden };
  };

  const estadoDe = async (ordenId: string): Promise<string> => {
    // Sin `eliminado_el IS NULL` a propósito: se lee si el retorno escribió.
    const [fila]: { estado: string }[] = await ds.query(
      `SELECT estado FROM pasarela_ordenes WHERE orden_id = $1`,
      [ordenId],
    );
    return fila.estado;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getPagoRedirect: () => proveedorPago,
        getTokenizado: () => proveedorTokenizado,
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(ADMIN);
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(resTenant.status).toBe(200);
    const token = (resTenant.body as { access_token: string }).access_token;

    const resKey = await request(app.getHttpServer())
      .post('/api/pasarela/admin/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `retorno e2e ${Date.now()}` });
    expect(resKey.status).toBe(201);
    apiKey = (resKey.body as { apiKey: string }).apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each(FORMATOS)('los desenlaces de Transbank, por %s', (formato) => {
    it('aprobado (token_ws): confirma y redirige al éxito', async () => {
      const { ordenId, token } = await crearOrden();
      const res = await volver('pago', formato, { token_ws: token });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        `${URL_EXITO}?ordenId=${ordenId}&estado=pagada`,
      );
      expect(confirmados.filter((t) => t === token)).toHaveLength(1);
      expect(await estadoDe(ordenId)).toBe('pagada');
    });

    it('doble retorno: el segundo redirige igual y no vuelve a confirmar', async () => {
      const { ordenId, token } = await crearOrden();
      const primero = await volver('pago', formato, { token_ws: token });
      expect(primero.status).toBe(302);
      const segundo = await volver('pago', formato, { token_ws: token });
      expect(segundo.status).toBe(302);
      expect(segundo.headers.location).toBe(primero.headers.location);
      expect(confirmados.filter((t) => t === token)).toHaveLength(1);
      expect(await estadoDe(ordenId)).toBe('pagada');
    });

    it('abortado (TBK_TOKEN + TBK_ORDEN_COMPRA): no confirma y va al fracaso', async () => {
      const { ordenId, token, codigoOrden } = await crearOrden();
      const res = await volver('pago', formato, {
        TBK_TOKEN: token,
        TBK_ORDEN_COMPRA: codigoOrden,
        TBK_ID_SESION: codigoOrden,
      });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        `${URL_FRACASO}?ordenId=${ordenId}&estado=fallida`,
      );
      expect(confirmados).not.toContain(token);
      expect(await estadoDe(ordenId)).toBe('fallida');
    });

    it('abortado con token_ws también (error en el formulario): no confirma', async () => {
      const { ordenId, token, codigoOrden } = await crearOrden();
      const res = await volver('pago', formato, {
        token_ws: token,
        TBK_TOKEN: token,
        TBK_ORDEN_COMPRA: codigoOrden,
        TBK_ID_SESION: codigoOrden,
      });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        `${URL_FRACASO}?ordenId=${ordenId}&estado=fallida`,
      );
      expect(confirmados).not.toContain(token);
      expect(await estadoDe(ordenId)).toBe('fallida');
    });

    it('timeout en el formulario (solo TBK_ORDEN_COMPRA): va al fracaso', async () => {
      const { ordenId, token, codigoOrden } = await crearOrden();
      const res = await volver('pago', formato, {
        TBK_ORDEN_COMPRA: codigoOrden,
        TBK_ID_SESION: codigoOrden,
      });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        `${URL_FRACASO}?ordenId=${ordenId}&estado=fallida`,
      );
      expect(confirmados).not.toContain(token);
      expect(await estadoDe(ordenId)).toBe('fallida');
    });

    it('inscripción aprobada (TBK_TOKEN): activa y redirige a la app', async () => {
      const resInsc = await request(app.getHttpServer())
        .post('/api/pasarela/api/inscripciones')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          pagadorRef: `retorno-e2e-${Date.now()}`,
          email: 'retorno@e2e.cl',
          urlRetorno: 'http://app.e2e/tarjetas',
        });
      expect(resInsc.status).toBe(201);
      const { inscripcionId, token } = resInsc.body as {
        inscripcionId: string;
        token: string;
      };
      const res = await volver('inscripcion', formato, { TBK_TOKEN: token });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        `http://app.e2e/tarjetas?inscripcionId=${inscripcionId}&estado=activa`,
      );
    });
  });

  describe('un campo que no es texto es 400, sin tocar la orden ni llamar al proveedor', () => {
    // GET con `token_ws[a]=1` no arma un objeto (el query parser de Express 5
    // es 'simple'): llega la clave literal y el handler contesta "sin token".
    // Por GET lo que sí se arma es el array, repitiendo el parámetro.
    const BASURA: [
      Formato,
      string,
      (token: string, codigo: string) => unknown,
    ][] = [
      ['GET', 'token_ws repetido (array)', (t) => [t, t]],
      ['POST form', 'token_ws[a] (objeto)', () => ({ a: '1' })],
      ['POST form', 'token_ws[] (array)', (t) => [t]],
      ['POST JSON', 'token_ws objeto', () => ({ a: 1 })],
      ['POST JSON', 'token_ws array', (t) => [t]],
      ['POST JSON', 'token_ws número', () => 123],
    ];

    it.each(BASURA)('%s: %s', async (formato, _caso, valor) => {
      const { ordenId, token, codigoOrden } = await crearOrden();
      const res = await volver('pago', formato, {
        token_ws: valor(token, codigoOrden),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('token_ws');
      expect(confirmados).not.toContain(token);
      expect(await estadoDe(ordenId)).toBe('en_proceso');
    });

    // Los otros dos campos del pago, por `@Body` y por `@Query`: cada
    // parámetro lleva su pipe, y sacárselo a uno solo tiene que dar rojo.
    it.each([
      ['POST JSON', 'TBK_TOKEN', (t: string) => ({ a: t })],
      ['POST JSON', 'TBK_ORDEN_COMPRA', (_t: string, c: string) => [c]],
      ['GET', 'TBK_TOKEN', (t: string) => [t, t]],
      ['GET', 'TBK_ORDEN_COMPRA', (_t: string, c: string) => [c, c]],
    ] as const)(
      '%s: %s que no es texto no marca la orden fallida',
      async (formato, campo, valor) => {
        const { ordenId, token, codigoOrden } = await crearOrden();
        const res = await volver('pago', formato, {
          [campo]: valor(token, codigoOrden),
        });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain(campo);
        expect(await estadoDe(ordenId)).toBe('en_proceso');
      },
    );

    it('un texto de más de 255 caracteres es 400', async () => {
      const res = await volver('pago', 'POST JSON', {
        token_ws: 'x'.repeat(256),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('token_ws');
    });

    it.each([
      ['POST JSON', { a: 1 }],
      ['GET', ['tok-a', 'tok-b']],
    ] as const)(
      'inscripción, %s: TBK_TOKEN que no es texto es 400',
      async (formato, valor) => {
        const res = await volver('inscripcion', formato, { TBK_TOKEN: valor });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('TBK_TOKEN');
      },
    );

    it('control: un token de texto desconocido sigue siendo el 404 de hoy', async () => {
      const res = await volver('pago', 'POST JSON', {
        token_ws: 'desconocido-e2e',
      });
      expect(res.status).toBe(404);
    });
  });
});
