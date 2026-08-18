import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}

interface DesfaseItemResponse {
  itemId: string;
  tipo: 'receta' | 'combo';
  /** El costo recalculado que la bandeja propone: el esperado tras aplicar. */
  costoPropuesto: string;
  precioSugerido: string | null;
}

interface ItemDetalleResponse {
  id: string;
  costoActual: string | null;
  precioBase: string;
}

interface AplicarDesfasesResponse {
  aplicados: number;
  omitidos: { itemId: string; nombre: string; motivo: string }[];
  /** La segunda pasada: los combos que la receta recién aplicada movió. */
  afectados: DesfaseItemResponse[];
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

describe('Simulador impacto costos (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('compra → afectadas → aplicar con precio → sale de bandeja', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Carne E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'kg',
        stock: '10',
        costo: '8000',
      });
    expect(resIng.status).toBe(201);
    const carneId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Burger E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: carneId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;
    // costo cacheado ≈ 8000 * 0.15 = 1200

    await request(app.getHttpServer())
      .patch(`/api/items/${carneId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '1',
        costoUnitario: '10000',
      })
      .expect(200);

    const afectadas = await request(app.getHttpServer())
      .get(`/api/items/${carneId}/afectados`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (afectadas.body as DesfaseItemResponse[]).some(
        (r) => r.itemId === recetaId,
      ),
    ).toBe(true);

    const fila = (afectadas.body as DesfaseItemResponse[]).find(
      (r) => r.itemId === recetaId,
    );
    await request(app.getHttpServer())
      .post('/api/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          {
            itemId: recetaId,
            actualizarPrecio: true,
            precioBase: fila?.precioSugerido ?? '4000',
          },
        ],
      })
      .expect(201);

    const bandeja = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (bandeja.body as DesfaseItemResponse[]).some(
        (r) => r.itemId === recetaId,
      ),
    ).toBe(false);

    const detalle = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = detalle.body as ItemDetalleResponse;
    // Contra el valor ESPERADO, no contra el viejo. Un `not.toBe('1200.0000')`
    // pasaba con cualquier número recalculado mal: la única forma de ponerlo
    // rojo era que el valor no cambiara en absoluto. Los dos esperados salen
    // de la propia bandeja —`costoPropuesto` es el costo que propuso, y
    // `precioSugerido` es literalmente el `precioBase` que este test mandó a
    // aplicar unas líneas más arriba—, así que no hay número hardcodeado que
    // se desincronice si cambia la fórmula del CPP.
    expect(fila?.costoPropuesto).toBeDefined();
    expect(body.costoActual).toBe(fila!.costoPropuesto);
    expect(body.precioBase).toBe(fila!.precioSugerido);
    // Y siguen sin ser los de antes: el test original afirmaba solo esto.
    expect(body.costoActual).not.toBe('1200.0000');
    expect(body.precioBase).not.toBe('3500.0000');
  });

  it('descartar oculta hasta nuevo cambio de costo', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Pan E2E ${Date.now()}`,
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '20',
        costo: '500',
      });
    expect(resIng.status).toBe(201);
    const panId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Simple E2E ${Date.now()}`,
        precioBase: '2000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;

    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: panId, costoNuevo: '700', comentario: 'Ajuste E2E' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/desfases/descartar')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [recetaId] })
      .expect(201);

    let bandeja = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(
      (bandeja.body as DesfaseItemResponse[]).some(
        (r) => r.itemId === recetaId,
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: panId, costoNuevo: '800', comentario: 'Ajuste E2E' })
      .expect(201);

    bandeja = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(
      (bandeja.body as DesfaseItemResponse[]).some(
        (r) => r.itemId === recetaId,
      ),
    ).toBe(true);
  });

  it('aplicar sin checkbox no cambia precio_base', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Queso E2E ${Date.now()}`,
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'kg',
        stock: '5',
        costo: '6000',
      });
    expect(resIng.status).toBe(201);
    const quesoId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Con queso E2E ${Date.now()}`,
        precioBase: '2500.0000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: quesoId,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;

    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: quesoId, costoNuevo: '9000', comentario: 'Ajuste E2E' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ itemId: recetaId, actualizarPrecio: false }] })
      .expect(201);

    const detalle = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detalle.body as ItemDetalleResponse).precioBase).toBe('2500.0000');
  });

  it('combo: sube un componente producto → aparece en afectados y en la bandeja', async () => {
    const sufijo = Date.now();
    const resProd = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Papas E2E ${sufijo}`,
        precioBase: '1500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '500',
      });
    expect(resProd.status).toBe(201);
    const papasId = resProd.body.id as string;

    const resCombo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo E2E ${sufijo}`,
        precioBase: '4200',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: papasId, cantidad: '1', bloqueante: true },
        ],
      });
    expect(resCombo.status).toBe(201);
    const comboId = resCombo.body.id as string;
    // costo cacheado = 500

    await request(app.getHttpServer())
      .patch(`/api/items/${papasId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '700',
      })
      .expect(200);

    // Antes de esta tarea este GET respondía 404: `papasId` es `tipo='producto'`.
    const afectados = await request(app.getHttpServer())
      .get(`/api/items/${papasId}/afectados`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const fila = (afectados.body as DesfaseItemResponse[]).find(
      (r) => r.itemId === comboId,
    );
    expect(fila).toBeDefined();
    expect(fila!.tipo).toBe('combo');

    const bandeja = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (bandeja.body as DesfaseItemResponse[]).some((r) => r.itemId === comboId),
    ).toBe(true);
  });

  it('aplicar la receta devuelve el combo en afectados, y aplicarlo escribe ese mismo costo', async () => {
    const sufijo = Date.now();
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Carne Combo E2E ${sufijo}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'kg',
        stock: '10',
        costo: '8000',
      });
    expect(resIng.status).toBe(201);
    const carneId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Burger Combo E2E ${sufijo}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: carneId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;
    // costo cacheado de la receta ≈ 8000 × 0,15 = 1200

    const resCombo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo Burger E2E ${sufijo}`,
        precioBase: '4200',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: recetaId, cantidad: '1', bloqueante: true },
        ],
      });
    expect(resCombo.status).toBe(201);
    const comboId = resCombo.body.id as string;
    // costo cacheado del combo = el CACHEADO de la receta × 1 = 1200

    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: carneId, costoNuevo: '10000', comentario: 'Ajuste E2E' })
      .expect(201);

    // Primera pasada: solo la receta. El combo NO aparece todavía porque su Σ
    // usa el costo CACHEADO de la receta, que sigue en 1200.
    const bandeja1 = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const filaReceta = (bandeja1.body as DesfaseItemResponse[]).find(
      (r) => r.itemId === recetaId,
    );
    expect(filaReceta).toBeDefined();
    expect(
      (bandeja1.body as DesfaseItemResponse[]).some(
        (r) => r.itemId === comboId,
      ),
    ).toBe(false);

    // Aplicar la receta: la respuesta trae el combo en `afectados`, ya
    // recalculado contra el costo que esta misma transacción acaba de escribir.
    const resAplicarReceta = await request(app.getHttpServer())
      .post('/api/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ itemId: recetaId }] })
      .expect(201);
    const aplicarReceta = resAplicarReceta.body as AplicarDesfasesResponse;
    expect(aplicarReceta.aplicados).toBe(1);
    const filaCombo = aplicarReceta.afectados.find((r) => r.itemId === comboId);
    expect(filaCombo).toBeDefined();
    expect(filaCombo!.tipo).toBe('combo');
    // El propuesto del combo es el costo RECIÉN aplicado de la receta.
    expect(filaCombo!.costoPropuesto).toBe(filaReceta!.costoPropuesto);

    const resAplicarCombo = await request(app.getHttpServer())
      .post('/api/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ itemId: comboId }] })
      .expect(201);
    expect((resAplicarCombo.body as AplicarDesfasesResponse).aplicados).toBe(1);

    // Contra el valor ESPERADO que devolvió la propia bandeja, nunca contra un
    // `not.toBe(<viejo>)`: ese patrón pasa con cualquier número mal recalculado.
    const detalle = await request(app.getHttpServer())
      .get(`/api/items/${comboId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detalle.body as ItemDetalleResponse).costoActual).toBe(
      filaCombo!.costoPropuesto,
    );

    // Y el combo ya no está desfasado.
    const bandeja2 = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (bandeja2.body as DesfaseItemResponse[]).some(
        (r) => r.itemId === comboId,
      ),
    ).toBe(false);
  });

  it('el lote que mezcla una receta con el combo que la contiene omite el combo', async () => {
    const sufijo = Date.now();
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Carne Mixta E2E ${sufijo}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'kg',
        stock: '10',
        costo: '8000',
      });
    expect(resIng.status).toBe(201);
    const carneId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Burger Mixta E2E ${sufijo}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: carneId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;

    const resCombo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo Mixto E2E ${sufijo}`,
        precioBase: '4200',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: recetaId, cantidad: '1', bloqueante: true },
        ],
      });
    expect(resCombo.status).toBe(201);
    const comboId = resCombo.body.id as string;

    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: carneId, costoNuevo: '10000', comentario: 'Ajuste E2E' })
      .expect(201);

    // El costo del combo ANTES de aplicar: el esperado de "no se movió". Se lee
    // del mismo GET que la aserción de después —y no del POST de creación—
    // porque el POST devuelve el costo sin escalar (`1200`) y el GET lo
    // devuelve como lo guardó la columna (`1200.0000`).
    const antes = await request(app.getHttpServer())
      .get(`/api/items/${comboId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const costoComboInicial = (antes.body as ItemDetalleResponse).costoActual;

    // El combo entra al lote aunque hoy no esté en la bandeja: el body lo acepta
    // sin pasar por el listado, que es justo el caso que hay que neutralizar.
    const res = await request(app.getHttpServer())
      .post('/api/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ itemId: recetaId }, { itemId: comboId }] })
      .expect(201);
    const body = res.body as AplicarDesfasesResponse;

    // Solo la receta se aplicó; el combo se omitió y volvió con el número nuevo.
    expect(body.aplicados).toBe(1);
    expect(body.omitidos.map((o) => o.itemId)).toEqual([comboId]);
    const filaCombo = body.afectados.find((r) => r.itemId === comboId);
    expect(filaCombo).toBeDefined();

    // Y el costo del combo NO se movió: sigue el cacheado con el que nació.
    const detalleCombo = await request(app.getHttpServer())
      .get(`/api/items/${comboId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detalleCombo.body as ItemDetalleResponse).costoActual).toBe(
      costoComboInicial,
    );

    // El propuesto que se le ofrece al usuario es el costo que la receta acaba
    // de tomar, no el viejo: contra el ESPERADO, no contra un `not.toBe`.
    const detalleReceta = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(filaCombo!.costoPropuesto).toBe(
      (detalleReceta.body as ItemDetalleResponse).costoActual,
    );
  });
});
