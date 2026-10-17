import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * **El RUT de un tercero se valida** (auditoría UX 06.16, owner 2026-10-17):
 * formato y dígito verificador en `POST` y `PATCH /terceros` (`rut` y
 * `rutFiscal`), y se guarda siempre normalizado (`76543210-3`). Vacío se
 * permite. El alta de proveedor desde compras lo cubre
 * `compras-proveedor-alta.e2e-spec.ts`.
 */

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface TerceroRes {
  id: string;
  rut: string | null;
  rutFiscal: string | null;
}

describe('Terceros — RUT validado y normalizado (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  const nombreUnico = (base: string) =>
    `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASS });
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
      .send({ tenantId: '550e8400-e29b-41d4-a716-446655440007' });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  const crear = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/terceros')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'proveedor', nombre: nombreUnico('Tercero RUT'), ...body });
  const editar = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/api/terceros/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it.each([['76.543.210-3'], ['76543210-3'], ['765432103']])(
    'crea con RUT válido %s y lo guarda normalizado',
    async (rut) => {
      const res = await crear({ rut, rutFiscal: rut });
      expect(res.status).toBe(201);
      const t = res.body as TerceroRes;
      expect(t.rut).toBe('76543210-3');
      expect(t.rutFiscal).toBe('76543210-3');
    },
  );

  it('acepta la K en minúscula y la guarda en mayúscula', async () => {
    const res = await crear({ rut: '10.000.013-k' });
    expect(res.status).toBe(201);
    expect((res.body as TerceroRes).rut).toBe('10000013-K');
  });

  it('dígito verificador malo: 400 que nombra el campo', async () => {
    const res = await crear({ rut: '76.543.210-5' });
    expect(res.status).toBe(400);
    expect((res.body as { message: string[] }).message).toEqual([
      'rut El RUT no es válido',
    ]);
    const fiscal = await crear({ rutFiscal: 'no-es-un-rut' });
    expect(fiscal.status).toBe(400);
    expect((fiscal.body as { message: string[] }).message).toEqual([
      'rutFiscal El RUT no es válido',
    ]);
  });

  it('sin RUT, o vacío, se permite', async () => {
    expect((await crear({})).status).toBe(201);
    const vacio = await crear({ rut: '', rutFiscal: '  ' });
    expect(vacio.status).toBe(201);
    expect((vacio.body as TerceroRes).rut).toBeNull();
    expect((vacio.body as TerceroRes).rutFiscal).toBeNull();
  });

  it('PATCH: normaliza, rechaza el DV malo y omitirlo conserva el que tenía', async () => {
    const t = (await crear({ rut: '76.543.210-3' })).body as TerceroRes;

    const ok = await editar(t.id, { rut: '9.876.543-3' });
    expect(ok.status).toBe(200);
    expect((ok.body as TerceroRes).rut).toBe('9876543-3');

    const malo = await editar(t.id, { rut: '9.876.543-K' });
    expect(malo.status).toBe(400);

    const sinTocar = await editar(t.id, { telefono: '123' });
    expect(sinTocar.status).toBe(200);
    expect((sinTocar.body as TerceroRes).rut).toBe('9876543-3');

    const borra = await editar(t.id, { rut: '' });
    expect(borra.status).toBe(200);
    expect((borra.body as TerceroRes).rut).toBeNull();
  });
});
