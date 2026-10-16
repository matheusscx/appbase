import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import type {
  HojaRutaDetalle,
  HojaRutaFila,
  PaqueteConfiguracionRespuesta,
  PaqueteFila,
  RepartidorFila,
  RespuestaEscaneo,
  ResumenPaqueteria,
} from '../src/modules/paqueteria/paqueteria.types';
import type { PaginatedResponse } from '../src/common/interfaces/paginated-response.interface';
import { fechaMenosDias } from '../src/common/utils/rango-fecha.util';
import { MOTIVOS_BAJA_FIJOS } from '../src/modules/motivos-baja/motivos-baja.defaults';
import { MOTIVOS_DIFERENCIA_DEFAULTS } from '../src/modules/motivos-diferencia/motivos-diferencia.defaults';
import { MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS } from '../src/modules/motivos-diferencia-inventario/motivos-diferencia-inventario.defaults';
import { MOTIVOS_TRASLADO_FIJOS } from '../src/modules/motivos-traslado/motivos-traslado.defaults';
import { SeederService } from '../src/modules/seeder/seeder.service';
import { correrCarrera } from './helpers/carrera';
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
      ['post', '/api/hojas-ruta/escanear'],
      ['post', '/api/hojas-ruta/asignar'],
      ['get', '/api/hojas-ruta?desde=2026-10-01&hasta=2026-10-31'],
      ['post', '/api/hojas-ruta/550e8400-e29b-41d4-a716-446655440999/rendir'],
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
  describe('escaneo y asignación', () => {
    const marca = Date.now();
    const FECHA = '2026-10-15';
    let n = 0;
    const codigoNuevo = () => `E2E-HR-${marca}-${++n}`;
    // Repartidores con hojas: no se pueden borrar, se desactivan al terminar.
    const propios: string[] = [];
    const ajenos: string[] = [];
    const paquetesAjenos: string[] = [];
    const mensajeDe = (res: { body: unknown }) =>
      (res.body as { message: string }).message;

    const nuevoRepartidor = async (token = tokenAdmin) => {
      const res = await llamar('post', '/api/repartidores', token, {
        nombre: `E2E HR ${marca}-${++n}`,
      });
      expect(res.status).toBe(201);
      const fila = res.body as RepartidorFila;
      (token === tokenAdmin ? propios : ajenos).push(fila.id);
      return fila;
    };
    const escanear = async (
      repartidorId: string,
      codigo: string,
      extra: object = {},
      token = tokenAdmin,
    ) =>
      llamar('post', '/api/hojas-ruta/escanear', token, {
        repartidorId,
        fecha: FECHA,
        codigo,
        cobroEnDestino: false,
        ...extra,
      });
    const asignar = async (
      repartidorId: string,
      paqueteIds: string[],
      extra: object = {},
    ) =>
      llamar('post', '/api/hojas-ruta/asignar', tokenAdmin, {
        repartidorId,
        fecha: FECHA,
        paqueteIds,
        ...extra,
      });
    const crearPaquete = async (cuerpo: object) => {
      const res = await llamar('post', '/api/paquetes', tokenAdmin, {
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        ...cuerpo,
      });
      expect(res.status).toBe(201);
      return res.body as PaqueteFila;
    };
    const paquetePorCodigo = async (codigo: string) => {
      const res = await llamar(
        'get',
        `/api/paquetes?q=${encodeURIComponent(codigo)}`,
      );
      expect(res.status).toBe(200);
      const [fila] = (res.body as { data: PaqueteFila[] }).data;
      return fila;
    };

    let rep: RepartidorFila;
    let otro: RepartidorFila;

    // No depende de otro describe: deja la configuración en los valores del seed (10000 / 5000).
    beforeAll(async () => {
      const res = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        { precioEnvioDefecto: '10000', pagoRepartidorDefecto: '5000' },
      );
      expect(res.status).toBe(200);
      rep = await nuevoRepartidor();
      otro = await nuevoRepartidor();
    });

    afterAll(async () => {
      const fallos: string[] = [];
      for (const id of propios) {
        const res = await llamar(
          'patch',
          `/api/repartidores/${id}`,
          tokenAdmin,
          {
            activo: false,
          },
        );
        if (![200, 404].includes(res.status)) {
          fallos.push(`PATCH repartidor ${id} -> ${res.status}`);
        }
      }
      for (const id of ajenos) {
        const res = await llamar(
          'delete',
          `/api/repartidores/${id}`,
          tokenSegundoTenant,
        );
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE repartidor ajeno ${id} -> ${res.status}`);
        }
      }
      for (const id of paquetesAjenos) {
        const res = await llamar(
          'delete',
          `/api/paquetes/${id}`,
          tokenSegundoTenant,
        );
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE paquete ajeno ${id} -> ${res.status}`);
        }
      }
      expect(fallos).toEqual([]);
    });

    it('código nuevo: asignado_nuevo, nace con el cobro en destino del interruptor y los montos de la configuración', async () => {
      const codigo = codigoNuevo();
      const res = await escanear(rep.id, codigo, { cobroEnDestino: true });
      expect(res.status).toBe(200);
      const cuerpo = res.body as RespuestaEscaneo;
      expect(cuerpo).toMatchObject({ resultado: 'asignado_nuevo', codigo });
      expect(cuerpo.hoja).toMatchObject({
        repartidorId: rep.id,
        repartidorNombre: rep.nombre,
        fecha: FECHA,
        estado: 'abierta',
        rendidaEl: null,
        enRuta: cuerpo.hoja.asignados,
        entregados: 0,
        netoARendir: '0.0000',
      });
      expect(cuerpo.hoja.lineas[0]).toMatchObject({
        codigo,
        cobroEnDestino: true,
        precioEnvio: '10000.0000',
        pagoRepartidor: '5000.0000',
        estado: 'en_ruta',
      });

      const fila = await paquetePorCodigo(codigo);
      expect(fila).toMatchObject({
        estado: 'en_ruta',
        hojaRutaId: cuerpo.hoja.id,
        repartidorNombre: rep.nombre,
        cobroEnDestino: true,
      });
    });

    it('existente y disponible con cobro_en_destino=false, escaneado con el interruptor prendido: asignado, y sigue en false', async () => {
      const paquete = await crearPaquete({ cobroEnDestino: false });
      const res = await escanear(rep.id, paquete.codigo, {
        cobroEnDestino: true,
      });
      expect(res.status).toBe(200);
      const cuerpo = res.body as RespuestaEscaneo;
      expect(cuerpo.resultado).toBe('asignado');
      expect(
        cuerpo.hoja.lineas.find((l) => l.paqueteId === paquete.id),
      ).toMatchObject({ cobroEnDestino: false, estado: 'en_ruta' });
      expect((await paquetePorCodigo(paquete.codigo)).cobroEnDestino).toBe(
        false,
      );
    });

    it('el mismo código otra vez en la misma hoja: ya_escaneado, sin línea nueva (asignados no cambia)', async () => {
      const codigo = codigoNuevo();
      const primero = await escanear(rep.id, codigo);
      expect(primero.status).toBe(200);
      const antes = (primero.body as RespuestaEscaneo).hoja;

      const segundo = await escanear(rep.id, ` ${codigo} `);
      expect(segundo.status).toBe(200);
      const cuerpo = segundo.body as RespuestaEscaneo;
      expect(cuerpo.resultado).toBe('ya_escaneado');
      expect(cuerpo.hoja.asignados).toBe(antes.asignados);
      expect(
        cuerpo.hoja.lineas.filter((l) => l.codigo === codigo),
      ).toHaveLength(1);
    });

    it('en ruta con otro repartidor: 409 que nombra al repartidor, y la hoja del segundo no queda con ese paquete', async () => {
      const codigo = codigoNuevo();
      expect((await escanear(rep.id, codigo)).status).toBe(200);

      const res = await escanear(otro.id, codigo);
      expect(res.status).toBe(409);
      expect(mensajeDe(res)).toContain(`está con ${rep.nombre}`);

      const fila = await paquetePorCodigo(codigo);
      expect(fila.repartidorNombre).toBe(rep.nombre);
    });

    it('QR en JSON: el código guardado es el id', async () => {
      const codigo = codigoNuevo();
      const res = await escanear(rep.id, `{"id":"${codigo}","sender_id":7}`);
      expect(res.status).toBe(200);
      const cuerpo = res.body as RespuestaEscaneo;
      expect(cuerpo.codigo).toBe(codigo);
      expect(cuerpo.hoja.lineas[0].codigo).toBe(codigo);
    });

    it('asignar: varios disponibles entran juntos, de a una línea cada uno', async () => {
      const dia = '2026-10-17';
      const a = await crearPaquete({});
      const b = await crearPaquete({});
      const res = await asignar(rep.id, [a.id, b.id], { fecha: dia });
      expect(res.status).toBe(200);
      const hoja = res.body as HojaRutaDetalle;
      expect(hoja).toMatchObject({ fecha: dia, asignados: 2, enRuta: 2 });
      expect(hoja.lineas.map((l) => l.paqueteId).sort()).toEqual(
        [a.id, b.id].sort(),
      );

      const otra = await asignar(rep.id, [a.id], { fecha: dia });
      expect(otra.status).toBe(400);
      expect(mensajeDe(otra)).toContain(`${a.codigo} ya está en esta hoja`);
    });

    it('asignar con uno no disponible: 400 que nombra el código y ninguno queda asignado', async () => {
      const libre = await crearPaquete({});
      const ocupado = await crearPaquete({});
      expect((await escanear(rep.id, ocupado.codigo)).status).toBe(200);

      const res = await asignar(otro.id, [libre.id, ocupado.id]);
      expect(res.status).toBe(400);
      expect(mensajeDe(res)).toContain(
        `No se asignó ninguno: ${ocupado.codigo}`,
      );
      expect(mensajeDe(res)).toContain(`está con ${rep.nombre}`);
      expect((await paquetePorCodigo(libre.codigo)).estado).toBe('disponible');
    });

    it('asignar con un paquete que no existe o es de otro tenant: 404, y ninguno queda asignado', async () => {
      const mio = await crearPaquete({});
      const ajeno = await llamar('post', '/api/paquetes', tokenSegundoTenant, {
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        precioEnvio: '1000',
        pagoRepartidor: '500',
      });
      expect(ajeno.status).toBe(201);
      const ajenoId = (ajeno.body as PaqueteFila).id;
      paquetesAjenos.push(ajenoId);

      const res = await asignar(otro.id, [mio.id, ajenoId]);
      expect(res.status).toBe(404);
      expect((await paquetePorCodigo(mio.codigo)).estado).toBe('disponible');
    });

    it('un repartidor de otro tenant, o inactivo, no recibe escaneos', async () => {
      const ajeno = await nuevoRepartidor(tokenSegundoTenant);
      expect((await escanear(ajeno.id, codigoNuevo())).status).toBe(404);

      const inactivo = await nuevoRepartidor();
      const off = await llamar(
        'patch',
        `/api/repartidores/${inactivo.id}`,
        tokenAdmin,
        { activo: false },
      );
      expect(off.status).toBe(200);
      const res = await escanear(inactivo.id, codigoNuevo());
      expect(res.status).toBe(400);
      expect(mensajeDe(res)).toContain('inactivo');
      const sinHoja = await asignar(inactivo.id, [(await crearPaquete({})).id]);
      expect(sinHoja.status).toBe(400);
    });

    it('un escaneo rechazado no deja nada escrito: ni la hoja que iba a crear', async () => {
      const nuevo = await nuevoRepartidor();
      const codigo = codigoNuevo();
      expect((await escanear(rep.id, codigo)).status).toBe(200);
      expect((await escanear(nuevo.id, codigo)).status).toBe(409);
      const ds = app.get(DataSource);
      const [{ n: hojas }] = await ds.query<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM hojas_ruta WHERE repartidor_id = $1`,
        [nuevo.id],
      );
      expect(hojas).toBe(0);
    });

    it('DELETE /repartidores/:id de uno que tiene hojas: 400 (se desactiva)', async () => {
      const conHoja = await nuevoRepartidor();
      expect((await escanear(conHoja.id, codigoNuevo())).status).toBe(200);
      const res = await llamar('delete', `/api/repartidores/${conHoja.id}`);
      expect(res.status).toBe(400);
      expect(mensajeDe(res)).toContain('tiene hojas de ruta');
    });

    it('entradas inválidas: 400, no 500', async () => {
      const base = {
        repartidorId: rep.id,
        fecha: FECHA,
        codigo: codigoNuevo(),
        cobroEnDestino: false,
      };
      for (const malo of [
        { fecha: '15-10-2026' },
        { fecha: '2026-02-31' },
        { repartidorId: 'no-es-uuid' },
        { codigo: '   ' },
        { codigo: 'x'.repeat(501) },
        { cobroEnDestino: undefined },
        { cobroEnDestino: 'si' },
      ]) {
        const res = await llamar(
          'post',
          '/api/hojas-ruta/escanear',
          tokenAdmin,
          {
            ...base,
            ...malo,
          },
        );
        expect(res.status).toBe(400);
      }
      const uno = (await crearPaquete({})).id;
      for (const paqueteIds of [
        [],
        'no-es-lista',
        ['no-es-uuid'],
        [uno, uno],
        [uno, uno.toUpperCase()],
      ]) {
        const res = await asignar(rep.id, paqueteIds as string[], {
          fecha: '2026-10-18',
        });
        expect(res.status).toBe(400);
      }
    });

    describe('carreras', () => {
      const ds = () => app.get(DataSource);

      it('el mismo código nuevo escaneado dos veces a la vez a la misma hoja: un paquete, una línea, ningún 500', async () => {
        const dia = '2026-10-19';
        const sembrado = await escanear(rep.id, codigoNuevo(), { fecha: dia });
        expect(sembrado.status).toBe(200);
        const hojaId = (sembrado.body as RespuestaEscaneo).hoja.id;

        const codigo = codigoNuevo();
        // Compuerta: la fila de la hoja. Los dos escaneos llegan a ella con el mismo repartidor
        // y la misma fecha, así que esperan ahí y se serializan.
        const { respuestas, esperando } = await correrCarrera(
          ds(),
          [
            'SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE',
            [hojaId],
          ],
          [
            async () => escanear(rep.id, codigo, { fecha: dia }),
            async () => escanear(rep.id, codigo, { fecha: dia }),
          ],
        );
        expect(esperando).toBe(2);
        expect(respuestas.map((r) => r.status)).toEqual([200, 200]);
        expect(
          respuestas.map((r) => (r.body as RespuestaEscaneo).resultado).sort(),
        ).toEqual(['asignado_nuevo', 'ya_escaneado']);

        const [{ paquetes, lineas }] = await ds().query<
          { paquetes: number; lineas: number }[]
        >(
          `SELECT COUNT(DISTINCT p.paquete_id)::int AS paquetes,
                  COUNT(l.hoja_ruta_paquete_id)::int AS lineas
             FROM paquetes p
             LEFT JOIN hoja_ruta_paquetes l ON l.paquete_id = p.paquete_id
            WHERE p.codigo = $1 AND p.eliminado_el IS NULL`,
          [codigo],
        );
        expect(paquetes).toBe(1);
        expect(lineas).toBe(1);
      });

      it('el mismo código nuevo escaneado a la vez por dos repartidores: uno lo crea y se queda con él, el otro recibe 409 (nunca un 500) y hay un solo paquete', async () => {
        const uno = await nuevoRepartidor();
        const dos = await nuevoRepartidor();
        const codigo = codigoNuevo();
        // Compuerta: las filas de los dos repartidores. Cada escaneo toma su propia hoja, así que
        // el cerrojo de la hoja no los serializa: el que decide es el índice único de `codigo`.
        const { respuestas, esperando } = await correrCarrera(
          ds(),
          [
            `SELECT 1 FROM repartidores WHERE repartidor_id = ANY($1::uuid[]) FOR UPDATE`,
            [[uno.id, dos.id]],
          ],
          [
            async () => escanear(uno.id, codigo),
            async () => escanear(dos.id, codigo),
          ],
        );
        expect(esperando).toBe(2);
        expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
        const perdedora = respuestas.find((r) => r.status === 409)!;
        expect(mensajeDe(perdedora)).toMatch(/^El paquete .* está con /);
        const ganadora = respuestas.find((r) => r.status === 200)!;
        expect(ganadora.status).toBe(200);
        expect((ganadora.body as RespuestaEscaneo).resultado).toBe(
          'asignado_nuevo',
        );

        const [{ paquetes, lineas }] = await ds().query<
          { paquetes: number; lineas: number }[]
        >(
          `SELECT COUNT(DISTINCT p.paquete_id)::int AS paquetes,
                  COUNT(l.hoja_ruta_paquete_id)::int AS lineas
             FROM paquetes p
             LEFT JOIN hoja_ruta_paquetes l ON l.paquete_id = p.paquete_id
            WHERE p.codigo = $1 AND p.eliminado_el IS NULL`,
          [codigo],
        );
        expect(paquetes).toBe(1);
        expect(lineas).toBe(1);
      });

      // Se prueban las dos llegadas, escalonadas para que el orden sea el que dice el nombre:
      // sin el cerrojo del repartidor en el escaneo, el borrado que llega primero no espera al
      // escaneo (el `SELECT` común no bloquea) y la hoja nace sobre un repartidor ya borrado.
      it.each([
        [
          'el borrado llega primero: gana, y el escaneo ya no encuentra al repartidor',
          'borrado',
          404,
          200,
        ],
        [
          'el escaneo llega primero: gana, y el borrado ve la hoja y rebota',
          'escaneo',
          200,
          400,
        ],
      ] as const)(
        'borrar un repartidor a la vez que se le escanea (%s)',
        async (_titulo, primero, esperadoEscaneo, esperadoBorrado) => {
          const destino = await nuevoRepartidor();
          const escaneo = async () => escanear(destino.id, codigoNuevo());
          const borrado = async () =>
            llamar('delete', `/api/repartidores/${destino.id}`, tokenAdmin);
          const { respuestas, esperando } = await correrCarrera(
            ds(),
            [
              `SELECT 1 FROM repartidores WHERE repartidor_id = $1 FOR UPDATE`,
              [destino.id],
            ],
            primero === 'borrado' ? [borrado, escaneo] : [escaneo, borrado],
            { escalonarMs: 300 },
          );
          expect(esperando).toBe(2);
          const estados = respuestas.map((r) => r.status);
          expect(
            primero === 'borrado'
              ? [estados[1], estados[0]]
              : [estados[0], estados[1]],
          ).toEqual([esperadoEscaneo, esperadoBorrado]);

          const [{ huerfanas }] = await ds().query<{ huerfanas: number }[]>(
            `SELECT COUNT(*)::int AS huerfanas
               FROM hojas_ruta h
               JOIN repartidores r ON r.repartidor_id = h.repartidor_id
              WHERE r.repartidor_id = $1 AND r.eliminado_el IS NOT NULL
                AND h.eliminado_el IS NULL`,
            [destino.id],
          );
          expect(huerfanas).toBe(0);
        },
      );
    });

    describe('marcar, rendir y KPIs', () => {
      const ds = () => app.get(DataSource);
      const AYER = '2026-10-14';
      const uuidAjeno = '550e8400-e29b-41d4-a716-446655440999';

      interface Spec {
        cantidad: number;
        cobroEnDestino: boolean;
        precioEnvio: string;
        pagoRepartidor: string;
      }
      /** Crea los paquetes con montos propios y los asigna juntos a la hoja del repartidor. */
      const armar = async (
        repartidorId: string,
        specs: Spec[],
        fecha = FECHA,
      ) => {
        const grupos: PaqueteFila[][] = [];
        for (const sp of specs) {
          const grupo: PaqueteFila[] = [];
          for (let i = 0; i < sp.cantidad; i++) {
            grupo.push(
              await crearPaquete({
                cobroEnDestino: sp.cobroEnDestino,
                precioEnvio: sp.precioEnvio,
                pagoRepartidor: sp.pagoRepartidor,
              }),
            );
          }
          grupos.push(grupo);
        }
        const res = await asignar(
          repartidorId,
          grupos.flat().map((p) => p.id),
          { fecha },
        );
        expect(res.status).toBe(200);
        return { hoja: res.body as HojaRutaDetalle, grupos };
      };
      const marcar = (hojaId: string, paqueteId: string, estado: string) =>
        llamar(
          'patch',
          `/api/hojas-ruta/${hojaId}/paquetes/${paqueteId}`,
          tokenAdmin,
          { estado },
        );
      const rendir = (hojaId: string, token = tokenAdmin) =>
        llamar('post', `/api/hojas-ruta/${hojaId}/rendir`, token, {});
      const detalle = async (hojaId: string) => {
        const res = await llamar('get', `/api/hojas-ruta/${hojaId}`);
        expect(res.status).toBe(200);
        return res.body as HojaRutaDetalle;
      };
      const resumen = async (query: string) => {
        const res = await llamar('get', `/api/hojas-ruta/resumen?${query}`);
        expect(res.status).toBe(200);
        return res.body as ResumenPaqueteria;
      };
      const congelado = async (hojaId: string) => {
        const [fila] = await ds().query<
          {
            estado: string;
            rendida_por: string | null;
            monto_total_general: string;
            monto_cobrado_destino: string;
            neto_a_rendir: string;
          }[]
        >(
          `SELECT estado, rendida_por, monto_total_general, monto_cobrado_destino, neto_a_rendir
             FROM hojas_ruta WHERE hoja_ruta_id = $1`,
          [hojaId],
        );
        return fila;
      };

      // 10 con cobro en destino a 10.000 (pago 5.000) + dos pagados: uno entregado (7.000 / 3.000)
      // y uno no entregado (9.000 / 4.000, a propósito distinto: si se colara en algún total, se nota).
      const ejemploDelOwner = async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 10,
            cobroEnDestino: true,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
          {
            cantidad: 1,
            cobroEnDestino: false,
            precioEnvio: '7000',
            pagoRepartidor: '3000',
          },
          {
            cantidad: 1,
            cobroEnDestino: false,
            precioEnvio: '9000',
            pagoRepartidor: '4000',
          },
        ]);
        const [cobros, [pagadoEntregado], [pagadoNo]] = grupos;
        expect(
          (await marcar(hoja.id, pagadoEntregado.id, 'entregado')).status,
        ).toBe(200);
        expect(
          (await marcar(hoja.id, pagadoNo.id, 'no_entregado')).status,
        ).toBe(200);
        const todos = await llamar(
          'post',
          `/api/hojas-ruta/${hoja.id}/entregar-todos`,
          tokenAdmin,
          {},
        );
        expect(todos.status).toBe(200);
        return {
          repartidor,
          hoja,
          cobros,
          pagadoEntregado,
          pagadoNo,
          final: todos.body as HojaRutaDetalle,
        };
      };

      it('10 con cobro en destino a 10.000 y pago 5.000: el repartidor entrega 50.000 (más lo del pagado)', async () => {
        const { final, pagadoNo } = await ejemploDelOwner();
        expect(final).toMatchObject({
          estado: 'abierta',
          asignados: 12,
          enRuta: 0,
          entregados: 11,
          cobroDestino: 10,
          montoCobradoDestino: '100000.0000',
          montoPagoRepartidor: '53000.0000',
          montoTotalGeneral: '107000.0000',
          netoARendir: '47000.0000',
        });
        // entregar-todos no toca lo que ya estaba no entregado
        expect(
          final.lineas.find((l) => l.paqueteId === pagadoNo.id)?.estado,
        ).toBe('no_entregado');
      });

      it('rendir congela; GET /hojas-ruta y GET /:id devuelven lo mismo; los montos de un entregado ya no se editan', async () => {
        const { repartidor, hoja, cobros, final } = await ejemploDelOwner();
        const res = await rendir(hoja.id);
        expect(res.status).toBe(200);
        const rendida = res.body as HojaRutaDetalle;
        expect(rendida).toMatchObject({
          estado: 'rendida',
          asignados: 12,
          enRuta: 0,
          entregados: 11,
          cobroDestino: 10,
          montoCobradoDestino: '100000.0000',
          montoPagoRepartidor: '53000.0000',
          montoTotalGeneral: '107000.0000',
          netoARendir: '47000.0000',
        });
        expect(rendida.rendidaEl).not.toBeNull();
        expect(rendida.lineas).toEqual(final.lineas);

        const [fila] = await ds().query<{ email: string }[]>(
          `SELECT u.correo AS email FROM hojas_ruta h JOIN usuarios u ON u.usuario_id = h.rendida_por
            WHERE h.hoja_ruta_id = $1`,
          [hoja.id],
        );
        expect(fila.email).toBe(ADMIN_PARIS.email);
        expect(await congelado(hoja.id)).toMatchObject({
          estado: 'rendida',
          monto_total_general: '107000.0000',
          monto_cobrado_destino: '100000.0000',
          neto_a_rendir: '47000.0000',
        });

        const lista = await llamar(
          'get',
          `/api/hojas-ruta?desde=${FECHA}&hasta=${FECHA}&repartidorId=${repartidor.id}`,
        );
        expect(lista.status).toBe(200);
        const { lineas, ...sinLineas } = await detalle(hoja.id);
        expect(lineas).toHaveLength(12);
        expect(lista.body as HojaRutaFila[]).toEqual([sinLineas]);
        expect(sinLineas.estado).toBe('rendida');

        // Editar el monto de un entregado: 400 y el paquete queda como estaba.
        const edicion = await llamar(
          'patch',
          `/api/paquetes/${cobros[0].id}`,
          tokenAdmin,
          { precioEnvio: '99999' },
        );
        expect(edicion.status).toBe(400);
        expect(mensajeDe(edicion)).toContain('ya se rindió');
        expect((await paquetePorCodigo(cobros[0].codigo)).precioEnvio).toBe(
          '10000.0000',
        );
        // …pero completar la dirección sigue siendo posible
        const direccion = await llamar(
          'patch',
          `/api/paquetes/${cobros[0].id}`,
          tokenAdmin,
          { direccion: 'Av. Siempre Viva 742' },
        );
        expect(direccion.status).toBe(200);
      });

      it('una hoja rendida no se modifica: marcar, quitar, entregar-todos, rendir de nuevo y asignar a esa fecha dan 400', async () => {
        const { repartidor, hoja, cobros, pagadoNo } = await ejemploDelOwner();
        expect((await rendir(hoja.id)).status).toBe(200);

        const marcado = await marcar(hoja.id, cobros[0].id, 'no_entregado');
        expect(marcado.status).toBe(400);
        expect(mensajeDe(marcado)).toContain('ya está rendida');

        const quitado = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${cobros[0].id}`,
        );
        expect(quitado.status).toBe(400);
        const todos = await llamar(
          'post',
          `/api/hojas-ruta/${hoja.id}/entregar-todos`,
          tokenAdmin,
          {},
        );
        expect(todos.status).toBe(400);
        const otraVez = await rendir(hoja.id);
        expect(otraVez.status).toBe(400);
        expect(mensajeDe(otraVez)).toContain('ya está rendida');

        const nuevo = await crearPaquete({});
        expect((await asignar(repartidor.id, [nuevo.id])).status).toBe(400);
        expect((await escanear(repartidor.id, nuevo.codigo)).status).toBe(400);
        // el no entregado de una hoja rendida queda libre para otra hoja
        const otro = await nuevoRepartidor();
        const reintento = await escanear(otro.id, pagadoNo.codigo);
        expect(reintento.status).toBe(200);
      });

      it('quitar un entregado: 400; quitar uno en ruta lo saca de la hoja y lo deja disponible', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 2,
            cobroEnDestino: false,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        const [uno, dos] = grupos[0];
        expect((await marcar(hoja.id, uno.id, 'entregado')).status).toBe(200);

        const rechazado = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${uno.id}`,
        );
        expect(rechazado.status).toBe(400);
        expect(mensajeDe(rechazado)).toBe(
          'Solo se quita un paquete que sigue en ruta.',
        );

        const quitado = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${dos.id}`,
        );
        expect(quitado.status).toBe(200);
        const cuerpo = quitado.body as HojaRutaDetalle;
        expect(cuerpo.asignados).toBe(1);
        expect(cuerpo.lineas.map((l) => l.paqueteId)).toEqual([uno.id]);
        expect((await paquetePorCodigo(dos.codigo)).estado).toBe('disponible');

        const otraVez = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${dos.id}`,
        );
        expect(otraVez.status).toBe(404);
        // y vuelve a entrar con otro repartidor
        const otro = await nuevoRepartidor();
        expect((await escanear(otro.id, dos.codigo)).status).toBe(200);
      });

      it('neto negativo: un entregado sin cobro en destino → el repartidor cobra 5.000 del negocio', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 1,
            cobroEnDestino: false,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        const res = await marcar(hoja.id, grupos[0][0].id, 'entregado');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          montoCobradoDestino: '0.0000',
          montoPagoRepartidor: '5000.0000',
          netoARendir: '-5000.0000',
        });
        const rendida = await rendir(hoja.id);
        expect(rendida.status).toBe(200);
        expect(rendida.body).toMatchObject({ netoARendir: '-5000.0000' });
        expect((await congelado(hoja.id)).neto_a_rendir).toBe('-5000.0000');
        expect(
          await resumen(
            `desde=${FECHA}&hasta=${FECHA}&repartidorId=${repartidor.id}`,
          ),
        ).toEqual({
          asignados: 1,
          entregados: 1,
          cobroDestino: 0,
          montoCobradoDestino: '0.0000',
          montoTotalGeneral: '10000.0000',
          montoPagoRepartidor: '5000.0000',
        });
      });

      it('rendir con líneas en ruta: 400 que dice cuántas; una hoja sin paquetes: 400', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 3,
            cobroEnDestino: false,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        expect(
          (await marcar(hoja.id, grupos[0][0].id, 'entregado')).status,
        ).toBe(200);
        const res = await rendir(hoja.id);
        expect(res.status).toBe(400);
        expect(mensajeDe(res)).toContain('Quedan 2 paquetes en ruta');
        expect((await detalle(hoja.id)).estado).toBe('abierta');

        const vacia = await nuevoRepartidor();
        const escaneo = await escanear(vacia.id, codigoNuevo());
        expect(escaneo.status).toBe(200);
        const hojaVacia = (escaneo.body as RespuestaEscaneo).hoja;
        const codigoEscaneado = hojaVacia.lineas[0].paqueteId;
        expect(
          (
            await llamar(
              'delete',
              `/api/hojas-ruta/${hojaVacia.id}/paquetes/${codigoEscaneado}`,
            )
          ).status,
        ).toBe(200);
        const sinPaquetes = await rendir(hojaVacia.id);
        expect(sinPaquetes.status).toBe(400);
        expect(mensajeDe(sinPaquetes)).toBe('La hoja no tiene paquetes.');
      });

      it('marcar: deshacer a en_ruta con la hoja abierta; el estado, los ids y los extraños se validan', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 1,
            cobroEnDestino: true,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        const [p] = grupos[0];
        const entregado = await marcar(hoja.id, p.id, 'entregado');
        expect(entregado.status).toBe(200);
        expect(entregado.body).toMatchObject({
          entregados: 1,
          enRuta: 0,
          netoARendir: '5000.0000',
        });
        const deshecho = await marcar(hoja.id, p.id, 'en_ruta');
        expect(deshecho.status).toBe(200);
        expect(deshecho.body).toMatchObject({
          entregados: 0,
          enRuta: 1,
          netoARendir: '0.0000',
        });

        expect((await marcar(hoja.id, p.id, 'perdido')).status).toBe(400);
        expect((await marcar(hoja.id, 'no-es-uuid', 'entregado')).status).toBe(
          400,
        );
        expect((await marcar('no-es-uuid', p.id, 'entregado')).status).toBe(
          400,
        );
        expect((await marcar(hoja.id, uuidAjeno, 'entregado')).status).toBe(
          404,
        );
        expect((await marcar(uuidAjeno, p.id, 'entregado')).status).toBe(404);
        expect((await rendir(uuidAjeno)).status).toBe(404);
        // otro tenant: la hoja no existe
        expect((await rendir(hoja.id, tokenSegundoTenant)).status).toBe(404);
        const ajeno = await llamar(
          'get',
          `/api/hojas-ruta/${hoja.id}`,
          tokenSegundoTenant,
        );
        expect(ajeno.status).toBe(404);
        const lista = await llamar(
          'get',
          `/api/hojas-ruta?desde=${FECHA}&hasta=${FECHA}&repartidorId=${repartidor.id}`,
          tokenSegundoTenant,
        );
        expect(lista.status).toBe(200);
        expect(lista.body).toEqual([]);
      });

      it('no entregado ayer, entregado hoy con otro repartidor: la hoja de ayer no lo suma, no se puede volver a marcar acá y el resumen cuenta 1 entrega', async () => {
        const ayer = await nuevoRepartidor();
        const hoy = await nuevoRepartidor();
        const { hoja: hojaAyer, grupos } = await armar(
          ayer.id,
          [
            {
              cantidad: 1,
              cobroEnDestino: true,
              precioEnvio: '10000',
              pagoRepartidor: '5000',
            },
          ],
          AYER,
        );
        const [p] = grupos[0];
        expect((await marcar(hojaAyer.id, p.id, 'no_entregado')).status).toBe(
          200,
        );

        const escaneo = await escanear(hoy.id, p.codigo);
        expect(escaneo.status).toBe(200);
        const hojaHoy = (escaneo.body as RespuestaEscaneo).hoja;
        expect((await marcar(hojaHoy.id, p.id, 'entregado')).status).toBe(200);

        // la hoja de ayer, todavía abierta, no suma ese monto ni puede reclamarlo
        expect(await detalle(hojaAyer.id)).toMatchObject({
          asignados: 1,
          entregados: 0,
          montoTotalGeneral: '0.0000',
          netoARendir: '0.0000',
        });
        for (const estado of ['entregado', 'en_ruta']) {
          const choque = await marcar(hojaAyer.id, p.id, estado);
          expect(choque.status).toBe(409);
          expect(mensajeDe(choque)).toBe(
            `El paquete ${p.codigo} ya salió con ${hoy.nombre}: no se puede marcar acá.`,
          );
        }

        const rango = `desde=${AYER}&hasta=${FECHA}`;
        const deAyer = await resumen(`${rango}&repartidorId=${ayer.id}`);
        const deHoy = await resumen(`${rango}&repartidorId=${hoy.id}`);
        expect(deAyer).toMatchObject({
          asignados: 1,
          entregados: 0,
          montoTotalGeneral: '0.0000',
        });
        expect(deHoy).toMatchObject({
          asignados: 1,
          entregados: 1,
          montoTotalGeneral: '10000.0000',
        });
        expect(deAyer.entregados + deHoy.entregados).toBe(1);
        // sumadas las dos, es una sola entrega: 10.000, no 20.000
        expect(
          new Decimal(deAyer.montoTotalGeneral)
            .plus(deHoy.montoTotalGeneral)
            .toFixed(4),
        ).toBe('10000.0000');
      });

      it('resumen y lista: rango invertido, fecha inexistente y parámetros faltantes son 400; sin hojas, ceros', async () => {
        for (const q of [
          'desde=2026-10-31&hasta=2026-10-01',
          'desde=2026-02-31&hasta=2026-03-01',
          'desde=2026-10-01',
          'hasta=2026-10-01',
          'desde=2026-10-01&hasta=2026-10-31&repartidorId=nada',
        ]) {
          expect(
            (await llamar('get', `/api/hojas-ruta/resumen?${q}`)).status,
          ).toBe(400);
          expect((await llamar('get', `/api/hojas-ruta?${q}`)).status).toBe(
            400,
          );
        }
        const invertido = await llamar(
          'get',
          '/api/hojas-ruta/resumen?desde=2026-10-31&hasta=2026-10-01',
        );
        expect(mensajeDe(invertido)).toBe('El rango de fechas está invertido.');
        const vacio = await nuevoRepartidor();
        expect(
          await resumen(
            `desde=${FECHA}&hasta=${FECHA}&repartidorId=${vacio.id}`,
          ),
        ).toEqual({
          asignados: 0,
          entregados: 0,
          cobroDestino: 0,
          montoCobradoDestino: '0.0000',
          montoTotalGeneral: '0.0000',
          montoPagoRepartidor: '0.0000',
        });
      });

      it('lista: abiertas con totales en vivo y rendidas con lo congelado, por fecha descendente', async () => {
        const repartidor = await nuevoRepartidor();
        const dias = ['2026-11-02', '2026-11-03'];
        const hojas: HojaRutaDetalle[] = [];
        for (const dia of dias) {
          const { hoja, grupos } = await armar(
            repartidor.id,
            [
              {
                cantidad: 1,
                cobroEnDestino: true,
                precioEnvio: '10000',
                pagoRepartidor: '5000',
              },
            ],
            dia,
          );
          expect(
            (await marcar(hoja.id, grupos[0][0].id, 'entregado')).status,
          ).toBe(200);
          hojas.push(hoja);
        }
        expect((await rendir(hojas[0].id)).status).toBe(200);

        const res = await llamar(
          'get',
          `/api/hojas-ruta?desde=${dias[0]}&hasta=${dias[1]}&repartidorId=${repartidor.id}`,
        );
        expect(res.status).toBe(200);
        const filas = res.body as HojaRutaFila[];
        expect(filas.map((f) => [f.fecha, f.estado])).toEqual([
          [dias[1], 'abierta'],
          [dias[0], 'rendida'],
        ]);
        for (const f of filas) {
          expect(f).toMatchObject({
            entregados: 1,
            montoCobradoDestino: '10000.0000',
            netoARendir: '5000.0000',
          });
        }
        expect(
          await resumen(
            `desde=${dias[0]}&hasta=${dias[1]}&repartidorId=${repartidor.id}`,
          ),
        ).toEqual({
          asignados: 2,
          entregados: 2,
          cobroDestino: 2,
          montoCobradoDestino: '20000.0000',
          montoTotalGeneral: '20000.0000',
          montoPagoRepartidor: '10000.0000',
        });
        // el rango es inclusivo en los dos extremos y excluye lo de afuera
        const soloUno = await resumen(
          `desde=${dias[1]}&hasta=${dias[1]}&repartidorId=${repartidor.id}`,
        );
        expect(soloUno.asignados).toBe(1);
      });

      describe('carreras', () => {
        it('rendir dos veces a la vez: una 200 y otra 400, totales sin cambio', async () => {
          const repartidor = await nuevoRepartidor();
          const { hoja, grupos } = await armar(repartidor.id, [
            {
              cantidad: 2,
              cobroEnDestino: true,
              precioEnvio: '10000',
              pagoRepartidor: '5000',
            },
          ]);
          for (const p of grupos[0]) {
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
          }
          const { respuestas, esperando } = await correrCarrera(
            ds(),
            [
              'SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE',
              [hoja.id],
            ],
            [async () => rendir(hoja.id), async () => rendir(hoja.id)],
          );
          expect(esperando).toBe(2);
          expect(respuestas.map((r) => r.status).sort()).toEqual([200, 400]);
          const perdedora = respuestas.find((r) => r.status === 400)!;
          expect(mensajeDe(perdedora)).toContain('ya está rendida');
          expect(await congelado(hoja.id)).toMatchObject({
            estado: 'rendida',
            monto_total_general: '20000.0000',
            neto_a_rendir: '10000.0000',
          });
        });

        it.each([
          [
            'la rendición llega primero: gana, y el cambio de monto rebota con 400',
            'rendir',
            200,
            400,
            '10000.0000',
          ],
          [
            'el cambio de monto llega primero: gana, y la rendición congela el monto nuevo',
            'patch',
            200,
            200,
            '12000.0000',
          ],
        ] as const)(
          'cambiar el monto de un entregado a la vez que se rinde su hoja (%s)',
          async (
            _titulo,
            primero,
            esperadoRendir,
            esperadoPatch,
            montoFinal,
          ) => {
            const repartidor = await nuevoRepartidor();
            const { hoja, grupos } = await armar(repartidor.id, [
              {
                cantidad: 1,
                cobroEnDestino: true,
                precioEnvio: '10000',
                pagoRepartidor: '5000',
              },
            ]);
            const [p] = grupos[0];
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);

            const rendicion = async () => rendir(hoja.id);
            const cambio = async () =>
              llamar('patch', `/api/paquetes/${p.id}`, tokenAdmin, {
                precioEnvio: '12000',
              });
            const { respuestas, esperando } = await correrCarrera(
              ds(),
              [
                'SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE',
                [hoja.id],
              ],
              primero === 'rendir' ? [rendicion, cambio] : [cambio, rendicion],
              { escalonarMs: 300 },
            );
            expect(esperando).toBe(2);
            const [rRendir, rPatch] =
              primero === 'rendir'
                ? [respuestas[0], respuestas[1]]
                : [respuestas[1], respuestas[0]];
            expect([rRendir.status, rPatch.status]).toEqual([
              esperadoRendir,
              esperadoPatch,
            ]);
            if (rPatch.status === 400) {
              expect(mensajeDe(rPatch)).toContain('ya se rindió');
            }

            // Pase lo que pase en el orden: lo congelado es lo que el paquete valía al rendir.
            const fila = await congelado(hoja.id);
            expect(fila.estado).toBe('rendida');
            expect(fila.monto_total_general).toBe(montoFinal);
            expect(fila.monto_cobrado_destino).toBe(montoFinal);
            expect((await paquetePorCodigo(p.codigo)).precioEnvio).toBe(
              montoFinal,
            );
          },
        );

        it('el mismo paquete marcado entregado a la vez desde dos hojas: uno gana y el otro recibe 409', async () => {
          const ayer = await nuevoRepartidor();
          const hoy = await nuevoRepartidor();
          const { hoja: hojaAyer, grupos } = await armar(
            ayer.id,
            [
              {
                cantidad: 1,
                cobroEnDestino: false,
                precioEnvio: '10000',
                pagoRepartidor: '5000',
              },
            ],
            AYER,
          );
          const [p] = grupos[0];
          expect((await marcar(hojaAyer.id, p.id, 'no_entregado')).status).toBe(
            200,
          );
          const escaneo = await escanear(hoy.id, p.codigo);
          expect(escaneo.status).toBe(200);
          const hojaHoy = (escaneo.body as RespuestaEscaneo).hoja;
          expect((await marcar(hojaHoy.id, p.id, 'no_entregado')).status).toBe(
            200,
          );

          // Compuerta: el paquete. Las dos marcas llegan al cerrojo del paquete y se serializan.
          const { respuestas, esperando } = await correrCarrera(
            ds(),
            ['SELECT 1 FROM paquetes WHERE paquete_id = $1 FOR UPDATE', [p.id]],
            [
              async () => marcar(hojaAyer.id, p.id, 'entregado'),
              async () => marcar(hojaHoy.id, p.id, 'entregado'),
            ],
          );
          expect(esperando).toBe(2);
          expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
          const [{ entregadas }] = await ds().query<{ entregadas: number }[]>(
            `SELECT COUNT(*)::int AS entregadas FROM hoja_ruta_paquetes
              WHERE paquete_id = $1 AND estado = 'entregado' AND eliminado_el IS NULL`,
            [p.id],
          );
          expect(entregadas).toBe(1);
        });
      });
    });
  });

  describe('tenant demo', () => {
    const DEMO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440502';
    const ADMIN_DEMO = { email: 'admin@paquetes.cl', pass: 'admin' };
    let tokenDemo: string;

    beforeAll(async () => {
      tokenDemo = await login(
        app,
        ADMIN_DEMO.email,
        ADMIN_DEMO.pass,
        DEMO_TENANT_ID,
      );
    });

    it('el admin del demo ve solo Paquetería: su único permiso es Paquetería:Leer', async () => {
      const res = await llamar('get', '/api/rbac/mis-permisos', tokenDemo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(['Paquetería:Leer']);
    });

    it('no es superadmin ni miembro de otro tenant: entrar a Paris es 401/403', async () => {
      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: ADMIN_DEMO.email, password: ADMIN_DEMO.pass });
      expect(resLogin.status).toBe(200);
      const res = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set(
          'Cookie',
          (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
        )
        .set(
          'Authorization',
          `Bearer ${(resLogin.body as TokenResponse).access_token}`,
        )
        .send({ tenantId: PARIS_TENANT_ID });
      expect([401, 403]).toContain(res.status);
    });

    it('abre con números: 3 hojas (dos rendidas con totales congelados y una abierta con 5 en ruta) y 30 paquetes', async () => {
      const yo = await llamar('get', '/api/tenants/me', tokenDemo);
      expect(yo.status).toBe(200);
      const hoy = (yo.body as { diaNegocioHoy: string }).diaNegocioHoy;

      const res = await llamar(
        'get',
        `/api/hojas-ruta?desde=${fechaMenosDias(hoy, 7)}&hasta=${hoy}`,
        tokenDemo,
      );
      expect(res.status).toBe(200);
      const hojas = res.body as HojaRutaFila[];
      expect(hojas.map((h) => [h.fecha, h.estado])).toEqual([
        [hoy, 'abierta'],
        [fechaMenosDias(hoy, 1), 'rendida'],
        [fechaMenosDias(hoy, 2), 'rendida'],
      ]);

      const [abierta, ayer, antesDeAyer] = hojas;
      expect(abierta).toMatchObject({ asignados: 5, enRuta: 5, entregados: 0 });
      // Las rendidas leen lo congelado: un neto negativo y uno positivo, como el demo promete.
      expect(antesDeAyer).toMatchObject({
        asignados: 12,
        enRuta: 0,
        entregados: 10,
        cobroDestino: 3,
        montoCobradoDestino: '30000.0000',
        montoPagoRepartidor: '50000.0000',
        montoTotalGeneral: '100000.0000',
        netoARendir: '-20000.0000',
      });
      expect(ayer).toMatchObject({
        asignados: 10,
        enRuta: 0,
        entregados: 9,
        cobroDestino: 5,
        montoCobradoDestino: '50000.0000',
        montoPagoRepartidor: '45000.0000',
        montoTotalGeneral: '90000.0000',
        netoARendir: '5000.0000',
      });

      const paquetes = await llamar(
        'get',
        '/api/paquetes?pageSize=100',
        tokenDemo,
      );
      expect(paquetes.status).toBe(200);
      const pagina = paquetes.body as PaginatedResponse<PaqueteFila>;
      expect(pagina.meta.total).toBe(30);
      expect(pagina.data.every((p) => /^46\d{9}$/.test(p.codigo))).toBe(true);
      // Un tercio con cobro en destino y la mitad con dirección y comuna.
      expect(pagina.data.filter((p) => p.cobroEnDestino)).toHaveLength(10);
      expect(pagina.data.filter((p) => p.direccion && p.comuna)).toHaveLength(
        15,
      );
    });

    it('nace con lo que le da TenantsService.create: métodos de pago habilitados y los motivos fijos', async () => {
      const [fila] = await app.get(DataSource).query<Record<string, number>[]>(
        `SELECT
           (SELECT COUNT(*)::int FROM tenant_metodo_pago
             WHERE tenant_id = $1 AND habilitada AND eliminado_el IS NULL) AS metodos,
           (SELECT COUNT(*)::int FROM tenant_metodo_pago
             WHERE tenant_id = $1 AND NOT habilitada) AS apagados,
           (SELECT COUNT(*)::int FROM motivo_baja WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS baja,
           (SELECT COUNT(*)::int FROM motivo_diferencia_caja WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS caja,
           (SELECT COUNT(*)::int FROM motivo_diferencia_inventario WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS inventario,
           (SELECT COUNT(*)::int FROM motivo_traslado WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS traslado`,
        [DEMO_TENANT_ID],
      );
      expect(fila).toEqual({
        metodos: 4,
        apagados: 0,
        baja: MOTIVOS_BAJA_FIJOS.length,
        caja: MOTIVOS_DIFERENCIA_DEFAULTS.length,
        inventario: MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS.length,
        traslado: MOTIVOS_TRASLADO_FIJOS.length,
      });
    });

    it('el seed corrido otra vez no duplica ni pisa nada', async () => {
      const contar = async (): Promise<Record<string, number>> => {
        const filas = await app
          .get(DataSource)
          .query<{ tabla: string; n: number }[]>(
            `SELECT 'tenants' AS tabla, COUNT(*)::int AS n FROM tenants
           UNION ALL SELECT 'usuarios', COUNT(*)::int FROM usuarios
           UNION ALL SELECT 'usuarios_tenants', COUNT(*)::int FROM usuarios_tenants
           UNION ALL SELECT 'roles', COUNT(*)::int FROM roles
           UNION ALL SELECT 'roles_usuarios', COUNT(*)::int FROM roles_usuarios
           UNION ALL SELECT 'modulos_app', COUNT(*)::int FROM modulos_app
           UNION ALL SELECT 'modulo_app_permisos', COUNT(*)::int FROM modulo_app_permisos
           UNION ALL SELECT 'tenant_modulos', COUNT(*)::int FROM tenant_modulos
           UNION ALL SELECT 'ubicaciones', COUNT(*)::int FROM ubicaciones
           UNION ALL SELECT 'cajas', COUNT(*)::int FROM cajas
           UNION ALL SELECT 'tenant_moneda', COUNT(*)::int FROM tenant_moneda
           UNION ALL SELECT 'tenant_formula_precio', COUNT(*)::int FROM tenant_formula_precio
           UNION ALL SELECT 'tenant_metodo_pago', COUNT(*)::int FROM tenant_metodo_pago
           UNION ALL SELECT 'motivo_baja', COUNT(*)::int FROM motivo_baja
           UNION ALL SELECT 'motivo_diferencia_caja', COUNT(*)::int FROM motivo_diferencia_caja
           UNION ALL SELECT 'motivo_diferencia_inventario', COUNT(*)::int FROM motivo_diferencia_inventario
           UNION ALL SELECT 'motivo_traslado', COUNT(*)::int FROM motivo_traslado
           UNION ALL SELECT 'paquete_configuracion', COUNT(*)::int FROM paquete_configuracion
           UNION ALL SELECT 'repartidores', COUNT(*)::int FROM repartidores
           UNION ALL SELECT 'paquetes', COUNT(*)::int FROM paquetes
           UNION ALL SELECT 'hojas_ruta', COUNT(*)::int FROM hojas_ruta
           UNION ALL SELECT 'hoja_ruta_paquetes', COUNT(*)::int FROM hoja_ruta_paquetes`,
          );
        return Object.fromEntries(filas.map((f) => [f.tabla, f.n]));
      };
      const hojasDemo = async () =>
        app.get(DataSource).query<unknown[]>(
          `SELECT hoja_ruta_id, estado, rendida_el, total_asignados, neto_a_rendir
             FROM hojas_ruta WHERE tenant_id = $1 ORDER BY hoja_ruta_id`,
          [DEMO_TENANT_ID],
        );

      const antes = await contar();
      const hojasAntes = await hojasDemo();
      await app.get(SeederService).onApplicationBootstrap();
      expect(await contar()).toEqual(antes);
      expect(await hojasDemo()).toEqual(hojasAntes);
    });
  });
});
