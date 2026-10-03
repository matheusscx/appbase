import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Chile
const PROV_CABA = '550e8400-e29b-41d4-a716-446655440375'; // Argentina
const ARS_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440369';
const MODULO_VENTAS = '550e8400-e29b-41d4-a716-446655440058';
const MODULO_ITEMS = '550e8400-e29b-41d4-a716-446655440182';
const SUPERADMIN = { email: 'admin@sistema.com', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

/**
 * El receptor de una venta, en lo que `ventas.e2e-spec.ts` no cubre: el tercero
 * que lo precarga (giro y comuna) y un tenant de otro país. La Factura chilena
 * vive en el bloque "tipo de documento" de `ventas.e2e-spec.ts`, que ya tiene la
 * caja abierta que una venta física necesita.
 *
 * Reglas: `docs/agent/pendientes.md` → `resueltos.md`, "La Factura exige
 * receptor"; código: `VentasService.receptorDeLaVenta`.
 */
describe('Receptor de la factura (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenSuper: string;
  let tenantArId: string | undefined;

  // Login nuevo cada vez: `switch-tenant` rota la cookie de refresh, y una
  // segunda entrada con la misma cookie responde 401.
  async function entrarA(tenantId: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(login.status).toBe(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId });
    expect(res.status).toBe(200);
    return (res.body as TokenResponse).access_token;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(login.status).toBe(200);
    tokenSuper = (login.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    // `app.close()` en `finally`: si la limpieza tira, la app queda viva y su
    // `@Cron` sigue disparando contra otras suites.
    try {
      if (tenantArId) {
        await request(app.getHttpServer())
          .delete(`/api/admin/tenants/${tenantArId}`)
          .set('Authorization', `Bearer ${tokenSuper}`);
      }
    } finally {
      await app.close();
    }
  });

  describe('el tercero guarda giro y comuna para precargar la factura', () => {
    let token: string;
    beforeAll(async () => {
      token = await entrarA(PARIS_TENANT_ID);
    });

    it('alta y edición los guardan y la lista los devuelve', async () => {
      const alta = await request(app.getHttpServer())
        .post('/api/terceros')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'empresa',
          nombre: `Constructora E2E ${Date.now()}`,
          giro: 'Construcción de obras menores',
          comuna: 'Ñuñoa',
        });
      expect(alta.status).toBe(201);
      const id = (alta.body as { id: string }).id;

      const edicion = await request(app.getHttpServer())
        .patch(`/api/terceros/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ comuna: 'Providencia' });
      expect(edicion.status).toBe(200);

      const lista = await request(app.getHttpServer())
        .get('/api/terceros')
        .set('Authorization', `Bearer ${token}`);
      expect(lista.status).toBe(200);
      expect(
        (lista.body as { id: string }[]).find((t) => t.id === id),
      ).toMatchObject({
        giro: 'Construcción de obras menores',
        comuna: 'Providencia',
      });
    });

    it.each([
      ['giro', 41],
      ['comuna', 21],
    ])(
      'un %s más largo que el del SII responde 400, en el alta y en la edición',
      async (campo, largo) => {
        const alta = await request(app.getHttpServer())
          .post('/api/terceros')
          .set('Authorization', `Bearer ${token}`)
          .send({
            tipo: 'empresa',
            nombre: `Largo E2E ${Date.now()}`,
            [campo]: 'x'.repeat(largo),
          });
        expect(alta.status).toBe(400);
        expect(JSON.stringify(alta.body)).toContain(campo);

        const valida = await request(app.getHttpServer())
          .post('/api/terceros')
          .set('Authorization', `Bearer ${token}`)
          .send({ tipo: 'empresa', nombre: `Largo E2E ${Date.now()}` });
        expect(valida.status).toBe(201);
        const edicion = await request(app.getHttpServer())
          .patch(`/api/terceros/${(valida.body as { id: string }).id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ [campo]: 'x'.repeat(largo) });
        expect(edicion.status).toBe(400);
      },
    );
  });

  // Argentina no tiene boleta sembrada: la venta nace sin tipo y el RUT no se
  // mira. ⚠️ No discrimina el `LEFT JOIN` de `resolverTipoDocumento`: con un
  // JOIN interno no vuelve ninguna fila, tampoco hay Chile, y pasa igual. El
  // `LEFT JOIN` cuida a un Chile sin tipo que resolver (la boleta inactiva),
  // que con el catálogo sembrado y sin endpoint que lo edite no se alcanza.
  it('otro país: el customer pasa sin chequeo de RUT (un CUIT usa otro DV) y se guarda como vino', async () => {
    const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const alta = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({
        nombre: `E2E Receptor AR ${sufijo}`,
        correo: `receptor-ar-${sufijo}@e2e.test`,
        provinciaId: PROV_CABA,
      });
    expect(alta.status).toBe(201);
    tenantArId = (alta.body as { id: string }).id;
    for (const moduloAppId of [MODULO_VENTAS, MODULO_ITEMS]) {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/tenants/${tenantArId}/modules`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ moduloAppId });
      expect([200, 201]).toContain(res.status);
    }
    const tokenAr = await entrarA(tenantArId);

    const item = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAr}`)
      .send({
        nombre: `Servicio gratis AR ${sufijo}`,
        precioBase: '0',
        monedaId: ARS_MONEDA_ID,
        tipo: 'servicio',
        // Argentina no tiene IVA sembrado: un ítem afecto no se puede vender.
        clasificacionTributaria: 'exento',
      });
    expect(item.status).toBe(201);

    // Online: la caja virtual siempre está abierta, así que no hace falta caja.
    const venta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${tokenAr}`)
      .send({
        canal: 'online',
        lineas: [{ itemId: (item.body as { id: string }).id, cantidad: '1' }],
        customer: { nombre: 'Distribuidora Sur SA', rut: '20-12345678-9' },
      });
    expect(venta.status).toBe(201);
    const ventaId = (venta.body as { id: string }).id;

    const filas: { tipo_documento_id: string | null; rut: string }[] =
      await ds.query(
        `SELECT v.tipo_documento_id, vc.rut
           FROM ventas v
           JOIN venta_customer vc ON vc.venta_id = v.venta_id
                AND vc.eliminado_el IS NULL
          WHERE v.venta_id = $1`,
        [ventaId],
      );
    expect(filas).toEqual([{ tipo_documento_id: null, rut: '20-12345678-9' }]);
  });
});
