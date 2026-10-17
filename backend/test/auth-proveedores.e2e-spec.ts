import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * 08.25: el login muestra "Continuar con Google" solo si el servidor lo tiene
 * configurado. El endpoint es público y devuelve solo un booleano: nunca el
 * client id ni el secreto. (Los casos con la variable puesta están en
 * `auth.controller.spec.ts`: el e2e corre con el entorno real, sin Google.)
 */
describe('GET /auth/proveedores (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('es público y devuelve solo { google: boolean }', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/proveedores');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).toEqual(['google']);
    expect(typeof (res.body as { google: unknown }).google).toBe('boolean');
  });
});
