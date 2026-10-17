import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface FilaItem {
  id: string;
  nombre: string;
  favorito: boolean;
}
interface ListadoResponse {
  data: FilaItem[];
  meta: { total: number };
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

/**
 * Favoritos del local (owner, 2026-10-17, 02.25): el admin marca productos como favoritos y
 * `GET /items?favorito=true` los devuelve. Quien no pide el filtro ve el mismo listado y el
 * mismo orden de siempre.
 */
describe('Ítems favoritos (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const marca = `E2E-FAV-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const ids: string[] = [];

  const crear = async (n: number, extra: Record<string, unknown> = {}) => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `${marca} ${n}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        ...extra,
      });
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    ids.push(id);
    return { id, body: res.body as FilaItem };
  };
  const listar = (query: string) =>
    request(app.getHttpServer())
      .get(`/api/items?search=${marca}&${query}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    token = await login(app);
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    try {
      for (const id of ids) {
        const res = await request(app.getHttpServer())
          .delete(`/api/items/${id}`)
          .set('Authorization', `Bearer ${token}`);
        if (![200, 204].includes(res.status)) {
          fallos.push(`borrar ${id} → ${res.status}`);
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  }, 60000);

  it('un ítem nace sin favorito, y crearlo favorito lo guarda', async () => {
    // `crear` ya afirma el 201.
    const { body: normal } = await crear(1);
    const { body: fav } = await crear(2, { favorito: true });
    expect(normal.favorito).toBe(false);
    expect(fav.favorito).toBe(true);
  });

  it('PATCH marca y desmarca el favorito, y el listado lo trae', async () => {
    const { id } = await crear(3);
    const marcar = await request(app.getHttpServer())
      .patch(`/api/items/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ favorito: true });
    expect(marcar.status).toBe(200);

    const uno = await request(app.getHttpServer())
      .get(`/api/items/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(uno.status).toBe(200);
    expect((uno.body as FilaItem).favorito).toBe(true);

    const desmarcar = await request(app.getHttpServer())
      .patch(`/api/items/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ favorito: false });
    expect(desmarcar.status).toBe(200);
    const otra = await request(app.getHttpServer())
      .get(`/api/items/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(otra.status).toBe(200);
    expect((otra.body as FilaItem).favorito).toBe(false);
  });

  it('favorito=true devuelve solo los marcados; favorito=false, los demás', async () => {
    const res = await listar('favorito=true&pageSize=100');
    expect(res.status).toBe(200);
    const filas = (res.body as ListadoResponse).data;
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.favorito)).toBe(true);
    expect(filas.map((f) => f.id)).toContain(ids[1]);
    expect(filas.map((f) => f.id)).not.toContain(ids[0]);

    const resto = await listar('favorito=false&pageSize=100');
    expect(resto.status).toBe(200);
    const idsResto = (resto.body as ListadoResponse).data.map((f) => f.id);
    expect(idsResto).toContain(ids[0]);
    expect(idsResto).not.toContain(ids[1]);
  });

  it('sin el parámetro el listado y su orden no cambian: trae favoritos y no favoritos por nombre', async () => {
    const res = await listar('pageSize=100');
    expect(res.status).toBe(200);
    const filas = (res.body as ListadoResponse).data;
    const nombres = filas.map((f) => f.nombre);
    expect(nombres).toEqual(
      [...nombres].sort((a, b) => a.localeCompare(b, 'es')),
    );
    expect(filas.some((f) => f.favorito)).toBe(true);
    expect(filas.some((f) => !f.favorito)).toBe(true);
  });

  it('un valor que no es true/false da 400', async () => {
    const res = await listar('favorito=TRUE');
    expect(res.status).toBe(400);
  });
});
