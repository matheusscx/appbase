import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * La tienda online sin pasarela conectada.
 *
 * Hasta el 2026-08-26 `pagar()` decidía por AUSENCIA: sin Webpay Plus activo
 * caía al flujo simulado, y esa pantalla registra la venta como pagada por el
 * total sin que entre un peso. Cualquier tenant que se registrara y no
 * conectara nada heredaba una tienda que entrega mercadería y la anota cobrada,
 * sin haberlo elegido.
 *
 * Ahora la pasarela demo se PRENDE desde Configuración → Pasarelas, y sin
 * ninguna configurada la tienda no cierra el pedido.
 *
 * Corre sobre Demo Bodega porque es el tenant sin Webpay: el camino de Demo
 * Restaurante sale por redirect a Transbank y necesita red (ver
 * `pasarela-oneclick.e2e-spec.ts`, detrás de RUN_TRANSBANK_E2E).
 */
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
// El admin real de Falabella es el superadmin del seed; `contacto@falabella.cl`
// es el correo de contacto del tenant, no un usuario logueable.
const ADMIN_FALABELLA = { email: 'admin@sistema.com', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}
interface ConfigRow {
  tenantPasarelaId: string;
  codigo: string;
  activo: boolean;
  tieneCredenciales: boolean;
}
interface PagarSimulado {
  modo: string;
  metodoPagoId: string | null;
  checkoutUrl: string;
}

describe('Tienda online sin pasarela conectada (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemId: string;
  let demoConfigId: string;

  const pagar = () =>
    request(app.getHttpServer())
      .post('/api/online/pagar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });

  const prenderDemo = (activo: boolean) =>
    request(app.getHttpServer())
      .patch(`/api/pasarela/admin/config/${demoConfigId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activo });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`,
    // que el e2e no ejecuta.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_FALABELLA.email, password: ADMIN_FALABELLA.pass });
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
      .send({ tenantId: FALABELLA_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;

    // Demo Bodega no tiene catálogo sembrado: el carrito necesita algo que
    // comprar y este ítem es de la suite, no del seed.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto tienda demo E2E ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as ItemResponse).id;
  });

  afterAll(async () => {
    const errores: unknown[] = [];
    try {
      // Dejarla apagada rompe el checkout online de las suites siguientes.
      if (demoConfigId) await prenderDemo(true);
    } catch (e) {
      errores.push(e);
    }
    try {
      await request(app.getHttpServer())
        .delete(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`);
    } catch (e) {
      errores.push(e);
    }
    await app.close();
    expect(errores).toEqual([]);
  });

  it('el seed la deja prendida y sin credenciales que pedir', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/pasarela/admin/config')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const demo = (res.body as ConfigRow[]).find((c) => c.codigo === 'demo');
    expect(demo).toBeDefined();
    expect(demo!.activo).toBe(true);
    // No habla con ningún proveedor: `resolverConfiguracionActiva` la daría por
    // no configurada justamente por esto, y de ahí que el chequeo sea otro.
    expect(demo!.tieneCredenciales).toBe(false);
    demoConfigId = demo!.tenantPasarelaId;
  });

  it('con la demo prendida, el checkout simula y el método lo resuelve el backend', async () => {
    const res = await pagar();

    expect(res.status).toBe(201);
    const body = res.body as PagarSimulado;
    expect(body.modo).toBe('simulado');
    expect(body.checkoutUrl).toContain('/tienda/pasarela?ref=');
    // La pantalla lo elegía sola por el nombre y caía en `metodos[0]` sin mirar
    // si estaba habilitado.
    expect(body.metodoPagoId).toEqual(expect.any(String));
  });

  it('apagada, la tienda no cierra el pedido en vez de entregar sin cobrar', async () => {
    expect((await prenderDemo(false)).status).toBe(200);

    const res = await pagar();

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toBe(
      'Este local todavía no tiene un medio de cobro online configurado',
    );

    expect((await prenderDemo(true)).status).toBe(200);
    expect((await pagar()).status).toBe(201);
  });
});
