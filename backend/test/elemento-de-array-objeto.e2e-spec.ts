import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * Un elemento de un array de objetos es un objeto (2026-10-08).
 *
 * Con un `[]` como elemento (`pagos: [[]]`), `@ValidateNested({ each: true })`
 * no tiene nada que validar y el pipe lo dejaba pasar: el service recibía un
 * elemento con todos sus campos `undefined`. Medido por HTTP en los 40 arrays
 * del backend que no tenían `@IsObject({ each: true })`, ninguno escribía nada,
 * pero contestaban de tres formas, y hay una prueba por forma:
 *
 * - **500 por una excepción del código**: la venta online sumaba los pagos con
 *   `new Decimal(undefined)`.
 * - **500 por una restricción de la base**: la promoción llegaba al INSERT de
 *   sus scopes con `tipo_scope` en NULL. Entre las dos, 27 sitios.
 * - **400 que miente**: la venta física decía "Método de pago no habilitado
 *   para este tenant" sin que hubiera método alguno. Solo eso, en 13 sitios.
 *
 * Que ningún `@ValidateNested` vuelva a quedar sin su `@IsObject` lo fuerza
 * `src/common/invariants/validate-nested-objeto.invariant.spec.ts`; esto prueba
 * que el 400 nombra el campo y no escribe.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}

describe('Un elemento de un array de objetos es un objeto (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta | undefined;
  /** Servicio de $1.000 con el IVA adentro: sin stock, no depende de otras suites. */
  let servicioId: string;
  let categoriaId: string;
  const marca = randomUUID().slice(0, 8);

  function enviar(ruta: string, body: object) {
    return request(app.getHttpServer())
      .post(`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  function mensajes(res: { body: unknown }): string[] {
    return [(res.body as { message?: string | string[] }).message ?? []].flat();
  }

  async function contar(sql: string, params: unknown[]): Promise<number> {
    const filas: { n: string }[] = await ds.query(sql, params);
    return Number(filas[0].n);
  }

  // Sin `eliminado_el IS NULL` a propósito: lo que se cuenta es si el pedido
  // escribió algo, y una fila borrada también sería una escritura.
  const ventasDelTenant = () =>
    contar(`SELECT count(*) AS n FROM ventas WHERE tenant_id = $1`, [
      PARIS_TENANT_ID,
    ]);
  const promocionesDelTenant = () =>
    contar(`SELECT count(*) AS n FROM promociones WHERE tenant_id = $1`, [
      PARIS_TENANT_ID,
    ]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

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

    const servicio = await enviar('items', {
      nombre: `Servicio array-objeto E2E ${marca}`,
      precioBase: '1000',
      precioIncluyeImpuesto: true,
      monedaId: CLP_MONEDA_ID,
      tipo: 'servicio',
    });
    expect(servicio.status).toBe(201);
    servicioId = (servicio.body as IdResponse).id;

    const categoria = await enviar('categorias', {
      nombre: `Categoría array-objeto E2E ${marca}`,
    });
    expect(categoria.status).toBe(201);
    categoriaId = (categoria.body as IdResponse).id;

    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E array-objeto',
    });
  }, 60000);

  afterAll(async () => {
    try {
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  const linea = () => ({ itemId: servicioId, cantidad: '1' });

  it('venta online: pagos [[]] es 400, no el 500 de new Decimal(undefined)', async () => {
    const control = await enviar('ventas', {
      canal: 'online',
      lineas: [linea()],
      pagos: [{ metodoPagoId: DEBITO_ID, monto: '1000.0000' }],
    });
    expect(control.status).toBe(201);

    const antes = await ventasDelTenant();
    const res = await enviar('ventas', {
      canal: 'online',
      lineas: [linea()],
      pagos: [[]],
    });
    expect(mensajes(res)).toEqual(['each value in pagos must be an object']);
    expect(res.status).toBe(400);
    expect(await ventasDelTenant()).toBe(antes);
  });

  it('promoción: scopes [[]] es 400, no el 500 del tipo_scope en NULL', async () => {
    const promocion = (nombre: string, scopes: unknown[]) => ({
      nombre,
      tipo: 'porcentaje',
      activo: false,
      valorPorcentaje: '0.15',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-12-31',
      scopes,
    });
    const control = await enviar(
      'promociones',
      promocion(`Promo control E2E ${marca}`, [
        { tipoScope: 'categoria', categoriaId },
      ]),
    );
    expect(control.status).toBe(201);

    const antes = await promocionesDelTenant();
    const res = await enviar(
      'promociones',
      promocion(`Promo [[]] E2E ${marca}`, [[]]),
    );
    expect(mensajes(res)).toEqual(['each value in scopes must be an object']);
    expect(res.status).toBe(400);
    expect(await promocionesDelTenant()).toBe(antes);
  });

  it('venta física: pagos [[]] es 400 que nombra el campo, no "Método de pago no habilitado"', async () => {
    const control = await enviar('ventas', {
      lineas: [linea()],
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1000.0000' }],
    });
    expect(control.status).toBe(201);

    const antes = await ventasDelTenant();
    const res = await enviar('ventas', { lineas: [linea()], pagos: [[]] });
    expect(mensajes(res)).toEqual(['each value in pagos must be an object']);
    expect(res.status).toBe(400);
    expect(await ventasDelTenant()).toBe(antes);
  });
});
