import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import type {
  PaqueteConfiguracionRespuesta,
  PaqueteFila,
  RepartidorFila,
} from '../src/modules/paqueteria/paqueteria.types';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' }; // no es admin del tenant

interface TokenResponse {
  access_token: string;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
  tenantId: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('Paquetería — configuración y repartidores (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenSegundoTenant: string;
  const creados: string[] = [];

  const llamar = (
    metodo: 'get' | 'post' | 'put' | 'patch' | 'delete',
    ruta: string,
    token = tokenAdmin,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [metodo](ruta)
      .set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`, que el e2e no ejecuta.
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    tokenAdmin = await login(
      app,
      ADMIN_PARIS.email,
      ADMIN_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenVendedor = await login(
      app,
      VENDEDOR_PARIS.email,
      VENDEDOR_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenSegundoTenant = await loginSegundoTenant(app);
  });

  afterAll(async () => {
    // El `close` va en un `finally` y la aserción DESPUÉS (molde: `cajones.e2e-spec.ts`).
    const fallos: string[] = [];
    try {
      for (const id of creados) {
        const res = await llamar('delete', `/api/repartidores/${id}`);
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE repartidor ${id} → ${res.status}`);
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('el vendedor (no admin) recibe 403 en las rutas del módulo', async () => {
    for (const [metodo, ruta] of [
      ['get', '/api/paquetes/configuracion'],
      ['put', '/api/paquetes/configuracion'],
      ['get', '/api/repartidores'],
      ['post', '/api/repartidores'],
      ['get', '/api/paquetes'],
      ['post', '/api/paquetes'],
    ] as const) {
      const res = await llamar(metodo, ruta, tokenVendedor, {});
      expect(res.status).toBe(403);
    }
  });

  describe('configuración', () => {
    // Estado único del tenant Paris: este describe lo deja siempre en 10000 / 5000
    // (los valores del seed), así ningún otro spec ve otra cosa.
    it('PUT guarda y GET lo devuelve; un monto con decimales en CLP es 400', async () => {
      const ok = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        configurada: true,
        precioEnvioDefecto: '10000.0000',
        pagoRepartidorDefecto: '5000.0000',
      });

      const leida = await llamar('get', '/api/paquetes/configuracion');
      expect(leida.status).toBe(200);
      expect(leida.body as PaqueteConfiguracionRespuesta).toMatchObject({
        configurada: true,
        precioEnvioDefecto: '10000.0000',
      });

      const malo = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000.5',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(malo.status).toBe(400);
    });

    it('PUT sin uno de los campos, o con un monto negativo: 400', async () => {
      const falta = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000',
        },
      );
      expect(falta.status).toBe(400);
      const negativo = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '-1',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(negativo.status).toBe(400);
    });

    it('cada tenant tiene la suya: el segundo no ve los montos de Paris', async () => {
      const paris = await llamar('get', '/api/paquetes/configuracion');
      expect(paris.status).toBe(200);
      expect((paris.body as PaqueteConfiguracionRespuesta).configurada).toBe(
        true,
      );

      const ajena = await llamar(
        'get',
        '/api/paquetes/configuracion',
        tokenSegundoTenant,
      );
      expect(ajena.status).toBe(200);
      expect(ajena.body).not.toEqual(paris.body);
    });
  });

  describe('repartidores', () => {
    it('alta y desactivar; el listado lo sigue mostrando, inactivo', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
        telefono: '+56911112222',
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);
      expect(r.body).toMatchObject({ activo: true, telefono: '+56911112222' });

      const off = await llamar('patch', `/api/repartidores/${id}`, tokenAdmin, {
        activo: false,
      });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ id, activo: false });

      const lista = await llamar('get', '/api/repartidores');
      expect(lista.status).toBe(200);
      expect(
        (lista.body as RepartidorFila[]).find((x) => x.id === id),
      ).toMatchObject({
        activo: false,
      });
    });

    it('PATCH con telefono null lo borra; sin la clave lo deja', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
        telefono: '+56933334444',
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);

      const renombre = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenAdmin,
        {
          nombre: `E2E renombrado ${Date.now()}`,
        },
      );
      expect(renombre.status).toBe(200);
      expect(renombre.body).toMatchObject({ telefono: '+56933334444' });

      const sinTel = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenAdmin,
        {
          telefono: null,
        },
      );
      expect(sinTel.status).toBe(200);
      expect(sinTel.body).toMatchObject({ telefono: null });
    });

    it.each([['nombre'], ['activo']])(
      'PATCH con %s null: 400 y el repartidor queda igual',
      async (campo) => {
        const nombre = `E2E ${Date.now()}`;
        const r = await llamar('post', '/api/repartidores', tokenAdmin, {
          nombre,
        });
        expect(r.status).toBe(201);
        const id = (r.body as RepartidorFila).id;
        creados.push(id);

        const res = await llamar(
          'patch',
          `/api/repartidores/${id}`,
          tokenAdmin,
          {
            [campo]: null,
          },
        );
        expect(res.status).toBe(400);

        const lista = await llamar('get', '/api/repartidores');
        expect(lista.status).toBe(200);
        expect(
          (lista.body as RepartidorFila[]).find((x) => x.id === id),
        ).toMatchObject({ nombre, activo: true });
      },
    );

    it('nombre vacío al crear: 400', async () => {
      const res = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: '',
      });
      expect(res.status).toBe(400);
    });

    it('eliminar: sale del listado (soft delete) y un segundo DELETE es 404', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;

      const del = await llamar('delete', `/api/repartidores/${id}`);
      expect(del.status).toBe(200);

      const lista = await llamar('get', '/api/repartidores');
      expect(lista.status).toBe(200);
      expect((lista.body as RepartidorFila[]).some((x) => x.id === id)).toBe(
        false,
      );

      const otra = await llamar('delete', `/api/repartidores/${id}`);
      expect(otra.status).toBe(404);
    });

    it('aislamiento: el repartidor de un tenant no existe para el otro (404) ni aparece en su listado', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);

      const ajeno = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenSegundoTenant,
        {
          nombre: 'x',
        },
      );
      expect(ajeno.status).toBe(404);
      const ajenoDel = await llamar(
        'delete',
        `/api/repartidores/${id}`,
        tokenSegundoTenant,
      );
      expect(ajenoDel.status).toBe(404);

      const lista = await llamar(
        'get',
        '/api/repartidores',
        tokenSegundoTenant,
      );
      expect(lista.status).toBe(200);
      expect((lista.body as RepartidorFila[]).some((x) => x.id === id)).toBe(
        false,
      );
    });

    it('id con forma no UUID: 400, no 500', async () => {
      const res = await llamar(
        'patch',
        '/api/repartidores/no-es-uuid',
        tokenAdmin,
        {
          nombre: 'x',
        },
      );
      expect(res.status).toBe(400);
    });
  });

  describe('paquetes', () => {
    const marca = Date.now();
    const paquetes: string[] = [];
    const terceros: string[] = [];
    let n = 0;
    const codigoNuevo = () => `E2E-${marca}-${++n}`;
    const lista = (qs: string, token = tokenAdmin) =>
      llamar('get', `/api/paquetes?${qs}`, token);
    const crear = async (cuerpo: object, token = tokenAdmin) => {
      const res = await llamar('post', '/api/paquetes', token, cuerpo);
      if (res.status === 201) {
        paquetes.push((res.body as PaqueteFila).id);
      }
      return res;
    };

    // No depende de otro describe: deja la configuración en los valores del seed (10000 / 5000).
    beforeAll(async () => {
      const res = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(res.status).toBe(200);
    });

    afterAll(async () => {
      const fallos: string[] = [];
      for (const id of paquetes) {
        const res = await llamar('delete', `/api/paquetes/${id}`);
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE paquete ${id} -> ${res.status}`);
        }
      }
      for (const id of terceros) {
        const res = await llamar('delete', `/api/terceros/${id}`);
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE tercero ${id} -> ${res.status}`);
        }
      }
      expect(fallos).toEqual([]);
    });

    it('alta con solo el código: nace con los defaults de la configuración y disponible', async () => {
      const res = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        precioEnvio: '10000.0000',
        pagoRepartidor: '5000.0000',
        estado: 'disponible',
        bloqueado: false,
        hojaRutaId: null,
        repartidorNombre: null,
        remitenteNombre: null,
        cobroEnDestino: false,
      });
    });

    it('alta con montos propios: no copia los defaults', async () => {
      const res = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: true,
        precioEnvio: '8000',
        pagoRepartidor: '4000',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        precioEnvio: '8000.0000',
        pagoRepartidor: '4000.0000',
        cobroEnDestino: true,
      });
    });

    it('el QR en JSON se guarda por su id y q lo encuentra, pegado o por el código', async () => {
      const codigo = `E2E-${marca}-qr`;
      const res = await crear({
        codigo: `{"id":"${codigo}"}`,
        cobroEnDestino: false,
      });
      expect(res.status).toBe(201);
      expect((res.body as PaqueteFila).codigo).toBe(codigo);

      for (const q of [codigo, `{"id":"${codigo}"}`, codigo.toLowerCase()]) {
        const l = await lista(`q=${encodeURIComponent(q)}`);
        expect(l.status).toBe(200);
        const data = (l.body as { data: PaqueteFila[] }).data;
        expect(data.map((p) => p.codigo)).toEqual([codigo]);
      }
    });

    it('el mismo código dos veces: 409; borrado el primero, el código se puede reusar', async () => {
      const codigo = codigoNuevo();
      const uno = await crear({ codigo, cobroEnDestino: false });
      expect(uno.status).toBe(201);
      const dos = await crear({ codigo: ` ${codigo} `, cobroEnDestino: false });
      expect(dos.status).toBe(409);

      const del = await llamar(
        'delete',
        `/api/paquetes/${(uno.body as PaqueteFila).id}`,
      );
      expect(del.status).toBe(200);
      const tres = await crear({ codigo, cobroEnDestino: false });
      expect(tres.status).toBe(201);
    });

    it('el código del mismo valor en el otro tenant no choca', async () => {
      const codigo = codigoNuevo();
      const mio = await crear({ codigo, cobroEnDestino: false });
      expect(mio.status).toBe(201);
      // Montos propios: este test no deja configurado al segundo tenant.
      const ajeno = await crear(
        {
          codigo,
          cobroEnDestino: false,
          precioEnvio: '1000',
          pagoRepartidor: '500',
        },
        tokenSegundoTenant,
      );
      expect(ajeno.status).toBe(201);
      // El del segundo tenant se limpia con SU token: la lista de arriba es de Paris.
      const del = await llamar(
        'delete',
        `/api/paquetes/${(ajeno.body as PaqueteFila).id}`,
        tokenSegundoTenant,
      );
      expect(del.status).toBe(200);
      paquetes.splice(paquetes.indexOf((ajeno.body as PaqueteFila).id), 1);
    });

    it('porCompletar lo lista; tras completar la dirección y el destinatario ya no', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const antes = await lista('porCompletar=true&pageSize=100');
      expect(antes.status).toBe(200);
      expect(
        (antes.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(true);

      const parcial = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        direccion: 'Av. Siempreviva 742',
      });
      expect(parcial.status).toBe(200);
      expect(parcial.body).toMatchObject({ direccion: 'Av. Siempreviva 742' });
      const sigue = await lista('porCompletar=true&pageSize=100');
      expect(sigue.status).toBe(200);
      expect(
        (sigue.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(true);

      const completo = await llamar(
        'patch',
        `/api/paquetes/${id}`,
        tokenAdmin,
        {
          destinatarioNombre: 'Ana Pérez',
        },
      );
      expect(completo.status).toBe(200);
      const despues = await lista('porCompletar=true&pageSize=100');
      expect(despues.status).toBe(200);
      expect(
        (despues.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
    });

    it('los filtros estado y cobroEnDestino reparten el listado', async () => {
      const cobra = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: true,
      });
      expect(cobra.status).toBe(201);
      const id = (cobra.body as PaqueteFila).id;
      const si = await lista(
        'cobroEnDestino=true&estado=disponible&pageSize=100',
      );
      expect(si.status).toBe(200);
      expect(
        (si.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(true);
      const no = await lista('cobroEnDestino=false&pageSize=100');
      expect(no.status).toBe(200);
      expect(
        (no.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
      const enRuta = await lista('estado=en_ruta&pageSize=100');
      expect(enRuta.status).toBe(200);
      expect(
        (enRuta.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
    });

    it('filtros con valor inválido: 400', async () => {
      for (const qs of [
        'estado=perdido',
        'cobroEnDestino=quizas',
        'porCompletar=false',
      ]) {
        const res = await lista(qs);
        expect(res.status).toBe(400);
      }
    });

    it('PATCH con un monto con decimales en CLP: 400', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const res = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        precioEnvio: '10000.5',
      });
      expect(res.status).toBe(400);
      const alta = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        pagoRepartidor: '4999.5',
      });
      expect(alta.status).toBe(400);
    });

    it.each([
      ['cobroEnDestino'],
      ['precioEnvio'],
      ['pagoRepartidor'],
      ['codigo'],
    ])('PATCH con %s null: 400 y el paquete queda igual', async (campo) => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const original = r.body as PaqueteFila;
      const res = await llamar(
        'patch',
        `/api/paquetes/${original.id}`,
        tokenAdmin,
        {
          [campo]: null,
        },
      );
      expect(res.status).toBe(400);
      const l = await lista(`q=${encodeURIComponent(original.codigo)}`);
      expect(l.status).toBe(200);
      expect((l.body as { data: PaqueteFila[] }).data).toEqual([original]);
    });

    it('PATCH con un campo opcional null lo vacía; sin la clave lo deja', async () => {
      const r = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        direccion: 'Calle 1',
        comuna: 'Ñuñoa',
      });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const res = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        direccion: null,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ direccion: null, comuna: 'Ñuñoa' });
    });

    it('PATCH del código a uno que ya existe: 409', async () => {
      const a = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(a.status).toBe(201);
      const b = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(b.status).toBe(201);
      const res = await llamar(
        'patch',
        `/api/paquetes/${(b.body as PaqueteFila).id}`,
        tokenAdmin,
        {
          codigo: (a.body as PaqueteFila).codigo,
        },
      );
      expect(res.status).toBe(409);
    });

    it('el remitente: uno del tenant se muestra; uno ajeno es 404 (alta y edición)', async () => {
      const propio = await llamar('post', '/api/terceros', tokenAdmin, {
        tipo: 'empresa',
        nombre: `E2E remitente ${marca}`,
      });
      expect(propio.status).toBe(201);
      const propioId = (propio.body as { id: string }).id;
      terceros.push(propioId);
      const ajeno = await llamar('post', '/api/terceros', tokenSegundoTenant, {
        tipo: 'empresa',
        nombre: `E2E ajeno ${marca}`,
      });
      expect(ajeno.status).toBe(201);
      const ajenoId = (ajeno.body as { id: string }).id;

      const ok = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        remitenteTerceroId: propioId,
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        remitenteTerceroId: propioId,
        remitenteNombre: `E2E remitente ${marca}`,
      });

      const alta = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        remitenteTerceroId: ajenoId,
      });
      expect(alta.status).toBe(404);
      const patch = await llamar(
        'patch',
        `/api/paquetes/${(ok.body as PaqueteFila).id}`,
        tokenAdmin,
        {
          remitenteTerceroId: ajenoId,
        },
      );
      expect(patch.status).toBe(404);

      const quitar = await llamar(
        'patch',
        `/api/paquetes/${(ok.body as PaqueteFila).id}`,
        tokenAdmin,
        {
          remitenteTerceroId: null,
        },
      );
      expect(quitar.status).toBe(200);
      expect(quitar.body).toMatchObject({
        remitenteTerceroId: null,
        remitenteNombre: null,
      });

      await llamar('delete', `/api/terceros/${ajenoId}`, tokenSegundoTenant);
    });

    it('aislamiento: el paquete de un tenant es 404 para el otro en PATCH y DELETE, y no aparece en su listado', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const patch = await llamar(
        'patch',
        `/api/paquetes/${id}`,
        tokenSegundoTenant,
        {
          direccion: 'x',
        },
      );
      expect(patch.status).toBe(404);
      const del = await llamar(
        'delete',
        `/api/paquetes/${id}`,
        tokenSegundoTenant,
      );
      expect(del.status).toBe(404);
      const l = await lista('pageSize=100', tokenSegundoTenant);
      expect(l.status).toBe(200);
      expect(
        (l.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
    });

    it('DELETE de uno que nunca salió: 200, desaparece del listado y un segundo DELETE es 404', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const del = await llamar('delete', `/api/paquetes/${id}`);
      expect(del.status).toBe(200);
      const l = await lista('pageSize=100');
      expect(l.status).toBe(200);
      expect(
        (l.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
      const otra = await llamar('delete', `/api/paquetes/${id}`);
      expect(otra.status).toBe(404);
      const editar = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        nota: 'x',
      });
      expect(editar.status).toBe(404);
    });

    it('id con forma no UUID: 400, no 500; y /paquetes/configuracion sigue siendo la configuración', async () => {
      const res = await llamar(
        'patch',
        '/api/paquetes/no-es-uuid',
        tokenAdmin,
        { nota: 'x' },
      );
      expect(res.status).toBe(400);
      const config = await llamar('get', '/api/paquetes/configuracion');
      expect(config.status).toBe(200);
      expect(config.body).toHaveProperty('configurada');
    });

    it('alta sin código o con cobroEnDestino ausente: 400', async () => {
      expect((await crear({ cobroEnDestino: false })).status).toBe(400);
      expect((await crear({ codigo: codigoNuevo() })).status).toBe(400);
      expect(
        (await crear({ codigo: '   ', cobroEnDestino: false })).status,
      ).toBe(400);
    });
  });
});
