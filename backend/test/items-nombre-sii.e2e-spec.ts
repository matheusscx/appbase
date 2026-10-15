import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { MENSAJE_NOMBRE_SII } from '../src/modules/items/dto/create-item.dto';

/**
 * El nombre del ítem se congela en la boleta, y el SII solo admite 80 caracteres
 * en ISO-8859-1 en `NmbItem`. El catálogo lo rechaza al capturar (create y edición)
 * para que la venta no deje una boleta `sin_emitir` por un nombre que ya estaba mal.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
type Respuesta = { status: number; body: unknown };

describe('El nombre del ítem cabe en la boleta (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let marca: string;
  const creados: string[] = [];

  function pedir(
    metodo: 'post' | 'patch' | 'delete',
    ruta: string,
    body: object = {},
  ): Promise<Respuesta> {
    return request(app.getHttpServer())
      [metodo](`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  const mensaje = (res: Respuesta) =>
    [(res.body as { message?: string | string[] }).message ?? ''].flat();

  /** `largo` caracteres exactos, con la marca al principio para reconocerlos. */
  const nombreDe = (largo: number, relleno = 'a') =>
    `E2E ${marca} `.padEnd(largo, relleno);

  /** Todo lo que el alta crea queda anotado para el `afterAll`, también cuando no debía crearse. */
  async function alta(nombre: string): Promise<Respuesta> {
    const res = await pedir('post', 'items', {
      nombre,
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      clasificacionTributaria: 'exento',
      unidadMedida: 'unidad',
    });
    if (res.status === 201) {
      creados.push((res.body as IdResponse).id);
    }
    return res;
  }

  async function crearValido(): Promise<string> {
    const res = await alta(nombreDe(30));
    expect(res.status).toBe(201);
    return (res.body as IdResponse).id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
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
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;
    marca = randomUUID().slice(0, 8);
  });

  afterAll(async () => {
    // Soft delete por la API: nunca SQL `DELETE`.
    for (const id of creados) {
      const res = await pedir('delete', `items/${id}`);
      expect([200, 204]).toContain(res.status);
    }
    await app.close();
  });

  it('POST /items con 81 caracteres es 400 con el mensaje del SII', async () => {
    const res = await alta(nombreDe(81));
    expect(res.status).toBe(400);
    expect(mensaje(res)).toContain(MENSAJE_NOMBRE_SII);
  });

  it('POST /items con un símbolo fuera de ISO-8859-1 es 400', async () => {
    const res = await alta('Cerveza €');
    expect(res.status).toBe(400);
    expect(mensaje(res)).toContain(MENSAJE_NOMBRE_SII);
  });

  it('POST /items con 80 caracteres que incluyen ñ es 201', async () => {
    const nombre = nombreDe(80, 'ñ');
    expect(nombre).toHaveLength(80);
    const res = await alta(nombre);
    expect(res.status).toBe(201);
  });

  it('PATCH /items/:id con 81 caracteres es 400 y con un emoji también', async () => {
    const id = await crearValido();

    const largo = await pedir('patch', `items/${id}`, {
      nombre: nombreDe(81),
    });
    expect(largo.status).toBe(400);
    expect(mensaje(largo)).toContain(MENSAJE_NOMBRE_SII);

    const emoji = await pedir('patch', `items/${id}`, { nombre: '🍺' });
    expect(emoji.status).toBe(400);
    expect(mensaje(emoji)).toContain(MENSAJE_NOMBRE_SII);
  });

  it('PATCH /items/:id con un nombre que cabe es 200', async () => {
    const id = await crearValido();
    const res = await pedir('patch', `items/${id}`, {
      nombre: nombreDe(80, 'ñ'),
    });
    expect(res.status).toBe(200);
  });
});
