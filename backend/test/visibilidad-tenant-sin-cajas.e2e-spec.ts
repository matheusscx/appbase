import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * La **rama 2** del eje de visibilidad de `ventas`/`pagos`: el tenant que no
 * contrató el módulo `Cajas` ve todo, porque ahí `Cajas:Leer` es *inobtenible*
 * —`userHasPermiso` exige el módulo contratado incluso en el short-circuit del
 * rol fijo, así que ni el admin puede tenerlo—. Acotar ahí sería permanente y
 * sin arreglo posible por configuración.
 *
 * ⚠️ **Por qué existe este archivo y no un `it` más en
 * `visibilidad-ventas-pagos.e2e-spec.ts`:** los dos tenants del seed (Paris y
 * Falabella) contratan `Cajas`, así que esta rama **no la ejercía nadie**. El
 * tenant se crea acá, con `Ventas` y `Pagos` y sin ningún módulo de caja.
 *
 * 📌 **Lo que este test fija, dicho sin inflarlo:** que ese tenant **no queda
 * bloqueado**. Es exactamente la regresión que se cometió al construir el eje
 * —la primera versión lanzaba `403` cuando faltaban los permisos de caja, y en
 * un tenant así le pegaba a todo el mundo, admin incluido—, y una regresión que
 * los unit del rule no atajan solas porque vivía en la cadena
 * guard → controller → service.
 *
 * ❌ **Lo que NO puede fijar, y no hay que leerle:** que "ve TODO" en vez de
 * "ve lo suyo". No es una limitación del test: en este tenant **es imposible por
 * construcción**. `POST /caja/abrir` pide `MiCaja:Crear`, que acá nadie puede
 * tener, así que toda venta creable es `canal='online'` — y `filtroDeMisCajas`
 * deja pasar las online explícitamente. O sea que las dos ramas devuelven lo
 * mismo **aunque hubiera dos usuarios**. La distinción rama-por-rama ya está
 * fijada en `rbac.service.spec.ts`; acá se fija la cadena completa.
 *
 * ⚠️ Y por lo mismo, este archivo **no es red** para un cambio en la rama 2: si
 * devolviera `false`, `listar`/`resumen` solo agregarían un `AND` y seguirían
 * respondiendo 200. Lo que fija es el `403`, que es el bug que pasó.
 */

const PROVINCIA_ID = '550e8400-e29b-41d4-a716-446655440001';
const MODULO_VENTAS = '550e8400-e29b-41d4-a716-446655440058';
const MODULO_PAGOS = '550e8400-e29b-41d4-a716-446655440180';

// Superadmin del seed: es el único que puede dar de alta un tenant, y el alta lo
// deja como **admin** del tenant nuevo (`create` inserta su `usuarios_tenants` y
// su `roles_usuarios` contra el rol fijo).
const SUPERADMIN_EMAIL = 'admin@sistema.com';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}

describe('Visibilidad — el tenant sin el módulo Cajas (e2e)', () => {
  let app: INestApplication<App>;
  let tokenSinTenant: string;
  let cookies: string[];
  let tenantId: string;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN_EMAIL, password: PASS });
    expect(login.status).toBe(200);
    tokenSinTenant = (login.body as TokenResponse).access_token;
    cookies = (login.headers['set-cookie'] as unknown as string[]) ?? [];

    // `POST /api/admin/tenants` va con `SuperadminGuard` y SIN `TenantGuard`,
    // así que el token todavía sin tenant alcanza.
    const alta = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${tokenSinTenant}`)
      .send({
        nombre: `E2E Sin Cajas ${Date.now()}`,
        correo: `sin-cajas-${Date.now()}@e2e.test`,
        provinciaId: PROVINCIA_ID,
      });
    expect(alta.status).toBe(201);
    tenantId = (alta.body as { id: string }).id;

    // Solo Ventas y Pagos. Ningún módulo de caja: ese es el punto del archivo.
    for (const moduloAppId of [MODULO_VENTAS, MODULO_PAGOS]) {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/tenants/${tenantId}/modules`)
        .set('Authorization', `Bearer ${tokenSinTenant}`)
        .send({ moduloAppId });
      expect([200, 201]).toContain(res.status);
    }

    const cambio = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', cookies)
      .set('Authorization', `Bearer ${tokenSinTenant}`)
      .send({ tenantId });
    expect(cambio.status).toBe(200);
    token = (cambio.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    // `app.close()` en `finally`: si la limpieza tira, la app queda viva y su
    // `@Cron` sigue disparando después del teardown de Jest, contra otras suites.
    try {
      if (tenantId) {
        await request(app.getHttpServer())
          .delete(`/api/admin/tenants/${tenantId}`)
          .set('Authorization', `Bearer ${tokenSinTenant}`);
      }
    } finally {
      await app.close();
    }
  });

  it('el admin de un tenant sin módulos de caja NO queda bloqueado', async () => {
    // El bug real que esto ataja: con `resolverAlcanceCaja` (la variante que
    // lanza) acá respondía 403, y en este tenant NADIE podía arreglarlo desde la
    // configuración, porque el permiso que pedía es inobtenible sin el módulo.
    for (const ruta of [
      '/api/ventas',
      '/api/ventas/resumen',
      '/api/pagos',
      '/api/pagos/resumen',
    ]) {
      const res = await request(app.getHttpServer())
        .get(ruta)
        .set('Authorization', `Bearer ${token}`);
      expect([ruta, res.status]).toEqual([ruta, 200]);
    }
  });

  it('el tenant no ve ningún módulo de caja en sus permisos', async () => {
    // La razón de ser de la rama 2, comprobada en vez de asumida: si esto
    // devolviera `Cajas`, el tenant podría expresar supervisión y acotar sería
    // reversible por configuración — la rama no tendría por qué existir.
    //
    // ⚠️ Mide `getMisPermisos` —lo que ve el frontend—, que es una consulta
    // DISTINTA de `userHasPermiso`, la que gobierna el eje. Las dos derivan de
    // `tenant_modulos`, así que la conclusión vale, pero esto no es el camino de
    // enforcement: por eso el título dice lo que mide y no lo que se infiere.
    const res = await request(app.getHttpServer())
      .get('/api/rbac/mis-permisos')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    // Formato `Modulo:Permiso`.
    const permisos = res.body as string[];
    const modulos = new Set(permisos.map((p) => p.split(':')[0]));
    expect(modulos.has('Ventas')).toBe(true);
    expect(permisos).not.toContain('Cajas:Leer');
    expect(modulos.has('Cajas')).toBe(false);
    expect(modulos.has('MiCaja')).toBe(false);
  });
});
