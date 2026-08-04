import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Consulta inversa a `GET /items/:id/uso`: dada una regla (descuento, recargo
 * o impuesto), los ítems vivos que la usan. Alimenta el modal de confirmación
 * al pausar ("deja de aplicarse en N ítems") — `descuentos`, `recargos` e
 * `impuestos` son gemelos, así que un solo spec cubre los tres, igual que
 * `reglas-valor.e2e-spec.ts` cubre descuentos y recargos juntos.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' };
// `contacto@falabella.cl` es el correo de contacto del tenant (no un usuario
// logueable); el admin real es_fijo de Falabella es `admin@sistema.com`
// (mismo patrón que cajones.e2e-spec.ts / recuentos.e2e-spec.ts).
const ADMIN_FALABELLA = { email: 'admin@sistema.com', pass: 'admin' };

// "Promo fija $5.000" y "Interés cuotas 5%": ambos con `condicionTipo:
// NINGUNA` en el seed de Paris (ver papelera.e2e-spec.ts), se asocian a un
// ítem sin depender de ninguna condición de venta.
const DESCUENTO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440338';
const RECARGO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440115';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';

interface TokenResponse {
  access_token: string;
}
interface UsoResponse {
  items: { id: string; nombre: string }[];
}
interface IdResponse {
  id: string;
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
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Uso de reglas (e2e) — GET /descuentos|recargos|impuestos/:id/uso', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenFalabella: string;
  let itemId: string;
  let impuestoId: string;
  let descuentoSinUsoId: string;
  let recargoSinUsoId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
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
    tokenFalabella = await login(
      app,
      ADMIN_FALABELLA.email,
      ADMIN_FALABELLA.pass,
      FALABELLA_TENANT_ID,
    );

    // Impuesto personalizado propio de Paris (no hay uno sembrado además del
    // IVA de sistema, que no es de este tenant — ver impuestos.service.ts).
    const resImpuesto = await request(app.getHttpServer())
      .post('/api/impuestos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Impuesto uso E2E ${Date.now()}`,
        porcentaje: '0.05',
      });
    expect(resImpuesto.status).toBe(201);
    impuestoId = (resImpuesto.body as IdResponse).id;

    // Un ítem que usa las tres reglas a la vez: alcanza para probar los tres
    // endpoints con un solo fixture.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Item uso E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        impuestosIds: [impuestoId],
        descuentosIds: [DESCUENTO_SIN_CONDICION_ID],
        recargosIds: [RECARGO_SIN_CONDICION_ID],
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as IdResponse).id;

    // Un descuento y un recargo propios de Paris sin ningún ítem asociado,
    // para el caso "nadie la usa".
    const resDescuentoSinUso = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Descuento sin uso E2E ${Date.now()}`,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'porcentaje',
        valor: '0.10',
      });
    expect(resDescuentoSinUso.status).toBe(201);
    descuentoSinUsoId = (resDescuentoSinUso.body as IdResponse).id;

    const resRecargoSinUso = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Recargo sin uso E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'porcentaje',
        valor: '0.02',
      });
    expect(resRecargoSinUso.status).toBe(201);
    recargoSinUsoId = (resRecargoSinUso.body as IdResponse).id;
  }, 60000);

  afterAll(async () => {
    if (itemId) {
      await request(app.getHttpServer())
        .delete(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
    if (impuestoId) {
      await request(app.getHttpServer())
        .delete(`/api/impuestos/${impuestoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
    if (descuentoSinUsoId) {
      await request(app.getHttpServer())
        .delete(`/api/descuentos/${descuentoSinUsoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
    if (recargoSinUsoId) {
      await request(app.getHttpServer())
        .delete(`/api/recargos/${recargoSinUsoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
    await app.close();
  });

  // ─── Devuelve los ítems que usan la regla ─────────────────────────────────

  it('descuentos/:id/uso devuelve el ítem que lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const body = res.body as UsoResponse;
    expect(body.items.map((i) => i.id)).toContain(itemId);
  });

  it('recargos/:id/uso devuelve el ítem que lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/recargos/${RECARGO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const body = res.body as UsoResponse;
    expect(body.items.map((i) => i.id)).toContain(itemId);
  });

  it('impuestos/:id/uso devuelve el ítem que lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/impuestos/${impuestoId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const body = res.body as UsoResponse;
    expect(body.items).toEqual([{ id: itemId, nombre: expect.any(String) }]);
  });

  // ─── Lista vacía cuando nadie la usa ──────────────────────────────────────

  it('descuentos/:id/uso devuelve lista vacía cuando nadie lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${descuentoSinUsoId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body as UsoResponse).toEqual({ items: [] });
  });

  it('recargos/:id/uso devuelve lista vacía cuando nadie lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/recargos/${recargoSinUsoId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body as UsoResponse).toEqual({ items: [] });
  });

  // ─── Aislamiento multi-tenant ──────────────────────────────────────────────
  // Falabella no puede ver NI CONTAR los ítems de Paris: el precheck de
  // pertenencia (`{ id, tenantId }`) 404-ea antes de llegar al JOIN, así que
  // ni siquiera se ejecuta la query que podría filtrar por error.

  it('un tenant no ve los ítems de otro: descuento de Paris es 404 para Falabella', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenFalabella}`);

    expect(res.status).toBe(404);
  });

  it('un tenant no ve los ítems de otro: recargo de Paris es 404 para Falabella', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/recargos/${RECARGO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenFalabella}`);

    expect(res.status).toBe(404);
  });

  it('un tenant no ve los ítems de otro: impuesto personalizado de Paris es 404 para Falabella', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/impuestos/${impuestoId}/uso`)
      .set('Authorization', `Bearer ${tokenFalabella}`);

    expect(res.status).toBe(404);
  });

  // ─── Ítems borrados ────────────────────────────────────────────────────────

  /**
   * El conteo alimenta un modal donde el admin decide: si contara ítems
   * borrados, decidiría con un número inflado. Se prueba borrando de verdad y
   * volviendo a consultar, no afirmando que el SQL contiene `eliminado_el` —
   * un `toContain` sobre la query también matchea el comentario de arriba.
   *
   * ⚠️ Borra el ítem que usan los tests de arriba, así que tiene que quedar
   * DESPUÉS de todos los que dependan de él. Solo puede seguirlo el test del
   * guard, que corta en `TenantAdminGuard` sin llegar al service y por eso no
   * mira ningún ítem. Cualquier test nuevo que consulte `/uso` va ANTES de este.
   */
  it('un ítem borrado deja de contarse en el uso de las tres reglas', async () => {
    const antes = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect((antes.body as UsoResponse).items.some((i) => i.id === itemId)).toBe(
      true,
    );

    const del = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(del.status).toBe(200);

    for (const url of [
      `/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`,
      `/api/recargos/${RECARGO_SIN_CONDICION_ID}/uso`,
      `/api/impuestos/${impuestoId}/uso`,
    ]) {
      const res = await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect((res.body as UsoResponse).items.some((i) => i.id === itemId)).toBe(
        false,
      );
    }
  });

  // ─── Guard: admin-only ─────────────────────────────────────────────────────

  it('un usuario sin rol admin no puede consultar el uso', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenVendedor}`);

    expect(res.status).toBe(403);
  });
});
