import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Todo descuento y todo recargo tiene que expresar CUÁNTO descuenta o recarga.
 * Decisión del owner (2026-08-01): *"los descuentos tienen que tener valor, no
 * se me ocurre para qué puede servir un descuento sin valor"*.
 *
 * Existe como e2e y no solo como unit porque el unit mockea el repositorio y
 * **no ejercita el `ValidationPipe` ni el DTO**, que es justo por donde entraba
 * el agujero: `valor` es `@IsOptional()`, así que un `{ "valor": null }` pasa
 * la validación de forma y llega al service. Las dos puertas se verificaron
 * ABIERTAS contra esta misma API antes de cerrarlas — las CUATRO: crear un
 * `directo` sin valor (201), vaciar el valor con `PATCH { valor: null }` (200),
 * y cambiar el `tipoReglaId` a uno que exige valor o tramas sin mandarlos (200
 * las dos). Estos tests fijan conducta que estuvo rota, no hipótesis.
 *
 * Las dos últimas son la lección: no alcanza con validar el campo que llega,
 * porque cambiar el TIPO cambia qué campos hacen falta. Se valida el estado
 * con el que la fila queda.
 *
 * No vive en `calculo-precios.e2e-spec.ts` (que consume estas reglas) porque
 * esto es validación de CRUD, no aritmética de precios; y no había ningún e2e
 * de descuentos/recargos donde meterlo.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

// Tipos sembrados (`seeder.service.ts` → `seedTiposRegla`).
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_DESCUENTO_PROMOCIONAL = '550e8400-e29b-41d4-a716-446655440121';
const TIPO_DESCUENTO_POR_MAYOR = '550e8400-e29b-41d4-a716-446655440101';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';

interface TokenResponse {
  access_token: string;
}
interface ReglaResponse {
  id: string;
  nombre: string;
  valor: string | null;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('Descuentos y recargos (e2e) — todo expresa su monto', () => {
  let app: INestApplication<App>;
  let token: string;

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
    token = await login(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const crearDescuento = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  // ─── Puerta 1: crear ──────────────────────────────────────────────────────

  it('crear un descuento `directo` SIN valor es 400', async () => {
    const res = await crearDescuento({
      nombre: `Directo sin valor E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
    });

    expect(res.status).toBe(400);
  });

  it('crear un descuento `directo` CON valor sigue funcionando', async () => {
    // Ancla positiva: sin esto, el test de arriba pasaría igual si el endpoint
    // estuviera roto para cualquier `directo`.
    const res = await crearDescuento({
      nombre: `Directo con valor E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valor: '0.10',
    });

    expect(res.status).toBe(201);
    // El POST devuelve el valor TAL CUAL se mandó; el normalizado a 4 decimales
    // de la columna aparece recién al releerlo.
    expect((res.body as ReglaResponse).valor).toBe('0.10');
  });

  // ─── Puerta 2: vaciar por PATCH ───────────────────────────────────────────
  // La más grave de las dos, y la que no era exclusiva de `directo`: afectaba
  // a CUALQUIER tipo, en descuentos y en recargos.

  it('vaciar el valor de un descuento por PATCH es 400, y el valor no cambia', async () => {
    const nombre = `Promo PATCH E2E ${Date.now()}`;
    const creado = await crearDescuento({
      nombre,
      tipoReglaId: TIPO_DESCUENTO_PROMOCIONAL,
      modo: 'porcentaje',
      valor: '0.15',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-12-31',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valor: null });
    expect(res.status).toBe(400);

    // Y no quedó a medias: el valor original sigue ahí.
    const listado = await request(app.getHttpServer())
      .get('/api/descuentos')
      .set('Authorization', `Bearer ${token}`);
    const fila = (listado.body as ReglaResponse[]).find((d) => d.id === id);
    expect(fila?.valor).toBe('0.1500');
  });

  it('vaciar el valor de un recargo por PATCH es 400, y el valor no cambia', async () => {
    const nombre = `Recargo PATCH E2E ${Date.now()}`;
    const creado = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'porcentaje',
        valor: '0.05',
      });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/recargos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valor: null });
    expect(res.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/recargos')
      .set('Authorization', `Bearer ${token}`);
    const fila = (listado.body as ReglaResponse[]).find((r) => r.id === id);
    expect(fila?.valor).toBe('0.0500');
  });

  // ─── Puertas 3 y 4: cambiar el TIPO ───────────────────────────────────────
  // Las encontró la revisión (la 3) y la reproducción en vivo (la 4). Son la
  // misma clase: cambiar `tipoReglaId` cambia QUÉ campos hacen falta, y mirar
  // solo el campo que llega en el PATCH no lo ve. Las dos devolvían 200.

  it('cambiar el tipo a `directo` sin mandar valor es 400', async () => {
    // `por_mayor` guarda el monto en tramos, así que su `valor` es nulo.
    const creado = await crearDescuento({
      nombre: `Por tramos E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimo: '10', valor: '0.05' }],
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoReglaId: TIPO_DESCUENTO_DIRECTO });

    expect(res.status).toBe(400);
  });

  it('cambiar el tipo a uno por tramos sin mandarlos es 400', async () => {
    const creado = await crearDescuento({
      nombre: `Directo a tramos E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valor: '0.10',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoReglaId: TIPO_DESCUENTO_POR_MAYOR });

    expect(res.status).toBe(400);
  });

  it('cambiar el tipo MANDANDO lo que el nuevo exige sí funciona (ancla positiva)', async () => {
    const creado = await crearDescuento({
      nombre: `Cambio de tipo válido E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimo: '10', valor: '0.05' }],
    });
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoReglaId: TIPO_DESCUENTO_DIRECTO, valor: '0.25' });

    expect(res.status).toBe(200);

    const listado = await request(app.getHttpServer())
      .get('/api/descuentos')
      .set('Authorization', `Bearer ${token}`);
    const fila = (listado.body as ReglaResponse[]).find((d) => d.id === id);
    expect(fila?.valor).toBe('0.2500');
  });

  it('un PATCH que no toca el valor sigue funcionando (ancla positiva)', async () => {
    // Sin esta ancla, los dos tests de arriba pasarían igual si el PATCH
    // estuviera roto para todo.
    const creado = await crearDescuento({
      nombre: `Directo renombrable E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valor: '0.20',
    });
    const id = (creado.body as ReglaResponse).id;
    const nuevoNombre = `Directo renombrado E2E ${Date.now()}`;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: nuevoNombre });

    expect(res.status).toBe(200);
    expect((res.body as ReglaResponse).nombre).toBe(nuevoNombre);
  });

  // ─── Puerta 3: el monto de un TRAMO ───────────────────────────────────────
  // Tercera cara de la misma falla: la regla "un porcentaje se expresa en
  // decimal" se enforzaba solo por el camino del `valor` único. Los dos casos
  // de abajo se verificaron ABIERTOS contra esta API antes de cerrarlos (201 y
  // 400 respectivamente, 2026-08-02).

  it('crear un descuento por tramos con un tramo `50` en porcentaje es 400', async () => {
    // El typo natural de quien piensa "50%". Entraba con 201 y producía un
    // descuento del 5000% sobre la línea.
    const res = await crearDescuento({
      nombre: `Tramo 50 E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimo: '10', valor: '50' }],
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimal/);
  });

  it('el mismo `5000` en modo monto fijo sí entra (ancla positiva)', async () => {
    // Lo que decide es el modo, no el número: sin esta ancla el test de arriba
    // pasaría igual si los tramos estuvieran rotos para todo.
    const res = await crearDescuento({
      nombre: `Tramo fijo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'monto_fijo',
      tramos: [{ minimo: '10', valor: '5000' }],
    });

    expect(res.status).toBe(201);
  });

  it('cambiar SOLO el modo a porcentaje revalida los tramos ya guardados', async () => {
    // El `PATCH` no trae tramos: mirar solo lo que llega deja pasar la
    // reinterpretación de valores que ya estaban guardados.
    const creado = await crearDescuento({
      nombre: `Tramo remodo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'monto_fijo',
      tramos: [{ minimo: '10', valor: '5000' }],
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ modo: 'porcentaje' });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimal/);
  });

  it('un PATCH de valor sobre una regla monto_fijo no lo lee como porcentaje', async () => {
    // La cara opuesta: la validación adivinaba `porcentaje` cuando el `PATCH`
    // no reenviaba el modo, y rechazaba con 400 una edición legítima.
    const creado = await crearDescuento({
      nombre: `Cupón fijo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'monto_fijo',
      valor: '1000',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valor: '5000' });

    expect(res.status).toBe(200);
    expect((res.body as ReglaResponse).valor).toBe('5000');
  });

  it('un recargo con un tramo `50` en porcentaje también es 400', async () => {
    // Ningún tipo de recargo pide tramos, pero la plomería es alcanzable por
    // API y el motor los evalúa mirando `tramos.length` antes que el código.
    const res = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Recargo tramo 50 E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'porcentaje',
        valor: '0.05',
        tramos: [{ minimo: '10', valor: '50' }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimal/);
  });
});
