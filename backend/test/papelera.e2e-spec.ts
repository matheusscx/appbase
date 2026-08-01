import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Task 2 de la feature "papelera": categorías es la entidad de referencia —
// familia TypeORM, sin nombre único, sin colaterales. Este spec es el patrón
// que las tareas siguientes (3-6) replican para el resto de los 16 recursos.

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin: rol Administrador, es_fijo=true → short-circuit de permisos, y el
// único que pasa TenantAdminGuard.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Vendedor: no es admin del tenant → TenantAdminGuard lo rechaza tanto en
// DELETE como en restaurar.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CategoriaItem {
  id: string;
  nombre: string;
  activo: boolean;
  eliminadoEl: string | null;
  eliminadoPor: string | null;
  eliminadoPorNombre?: string | null;
}
interface CausaMermaItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}
interface ItemResponse {
  id: string;
  activo: boolean;
  impuestosIds?: string[];
  descuentosIds?: string[];
  recargosIds?: string[];
  extrasPermitidos?: { ingredienteItemId: string }[];
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Papelera (e2e) — categorías, patrón de referencia', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let categoriaId: string;

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenNoAdmin = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /categorias con admin → 201 crea la categoría de prueba', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Categoría papelera E2E ${Date.now()}` });

    expect(res.status).toBe(201);
    const body = res.body as CategoriaItem;
    expect(body.id).toBeDefined();
    expect(body.eliminadoEl).toBeNull();
    categoriaId = body.id;
  });

  it('DELETE /categorias/:id por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/categorias/${categoriaId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /categorias/:id con admin → 200 (soft delete)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/categorias/${categoriaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
  });

  it('GET /categorias sin flag no trae la categoría borrada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const categorias = res.body as CategoriaItem[];
    expect(categorias.find((c) => c.id === categoriaId)).toBeUndefined();
  });

  it('GET /categorias?incluirEliminados=true trae la categoría con el nombre de quien borró', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categorias?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const categorias = res.body as CategoriaItem[];
    const borrada = categorias.find((c) => c.id === categoriaId);
    expect(borrada).toBeDefined();
    expect(borrada?.eliminadoEl).not.toBeNull();
    expect(borrada?.eliminadoPorNombre).toBe('admin.paris');
  });

  it('POST /categorias/:id/restaurar por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('POST /categorias/:id/restaurar con admin → 201 y vuelve al listado normal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    const body = res.body as CategoriaItem;
    expect(body.eliminadoEl).toBeNull();

    const listado = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const categorias = listado.body as CategoriaItem[];
    expect(categorias.find((c) => c.id === categoriaId)).toBeDefined();
  });

  it('POST /categorias/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});

// Task 3: causas de merma — segunda referencia. Familia SQL cruda (no
// softDelete() de TypeORM) y con nombre único por tenant, así que agrega el
// 400 de colisión al restaurar: el índice único es parcial (WHERE
// eliminado_el IS NULL), así que mientras la causa está borrada, otra causa
// puede tomar su nombre y competir cuando se intenta revivirla.
describe('Papelera (e2e) — causas de merma, SQL cruda + colisión de nombre', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let causaId: string;
  let causaNombre: string;

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenNoAdmin = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /causas-merma con admin → 201 crea la causa de prueba', async () => {
    causaNombre = `Vencimiento E2E ${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: causaNombre });

    expect(res.status).toBe(201);
    const body = res.body as CausaMermaItem;
    expect(body.id).toBeDefined();
    causaId = body.id;
  });

  it('DELETE /causas-merma/:id por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${causaId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /causas-merma/:id con admin → 204 (soft delete)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${causaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);
  });

  it('GET /causas-merma sin flag no trae la causa borrada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    expect(causas.find((c) => c.id === causaId)).toBeUndefined();
  });

  it('GET /causas-merma?incluirEliminados=true trae la causa con el nombre de quien borró', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    const borrada = causas.find((c) => c.id === causaId);
    expect(borrada).toBeDefined();
    expect(borrada?.eliminadoEl).not.toBeNull();
    expect(borrada?.eliminadoPorNombre).toBe('admin.paris');
  });

  it('POST /causas-merma/:id/restaurar por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('colisión real de Postgres: crear otra causa con el mismo nombre y restaurar la borrada → 400, nada cambia', async () => {
    // Mientras `causaId` estaba borrada, nadie competía por su nombre: se
    // puede crear una causa nueva y activa con el mismo nombre.
    const otra = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: causaNombre });
    expect(otra.status).toBe(201);
    const otraId = (otra.body as CausaMermaItem).id;

    // El 23505 lo tira Postgres de verdad (índice único parcial), no un mock.
    const restaurar = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(restaurar.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/causas-merma?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const causas = listado.body as CausaMermaItem[];
    const viva = causas.find((c) => c.id === otraId);
    const borrada = causas.find((c) => c.id === causaId);
    expect(viva?.eliminadoEl).toBeNull();
    expect(borrada?.eliminadoEl).not.toBeNull();

    // Limpieza: sin la causa activa que ocupa el nombre, restaurar sí puede.
    const deleteOtra = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${otraId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(deleteOtra.status).toBe(204);
  });

  it('POST /causas-merma/:id/restaurar con admin (sin colisión) → 201 y vuelve al listado normal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    const body = res.body as CausaMermaItem;
    expect(body.eliminadoEl).toBeNull();

    const listado = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const causas = listado.body as CausaMermaItem[];
    expect(causas.find((c) => c.id === causaId)).toBeDefined();
  });

  it('POST /causas-merma/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});

// Task 4: items — la entidad que motivó la feature entera y la más delicada
// de las 16: es la única que se restaura INACTIVA (`remove()` pisa
// `activo = false` y el valor previo no sobrevive en ninguna parte) y una de
// las dos que arrastra colateral (`receta_extras_permitidos`, en las dos
// direcciones — como ingrediente y como receta que ofrece el extra).
//
// El guard no es `TenantAdminGuard` como en categorías/causas de merma: items
// usa `PermisosGuard` + `@RequiresPermiso('Items', 'Eliminar')` (heredado del
// `@Controller`). El usuario "sin permiso" sigue siendo vendedor@paris.cl: el
// seed le da `Items: Leer` (necesita ver el catálogo para el POS) pero no
// `Eliminar` (seedVendedorPermisosCaja, seeder.service.ts).
describe('Papelera (e2e) — items, restaurar INACTIVO + colateral acotado por timestamp', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenSinPermiso: string;
  let itemId: string;

  const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
  // Descuento "Promo fija $5.000" y recargo "Interés cuotas 5%": los dos con
  // `condicionTipo: NINGUNA` en el seed de Paris — se asocian al ítem sin
  // depender de ninguna condición de venta.
  const DESCUENTO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440338';
  const RECARGO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440115';
  // Efectivo: el único método de pago con `permiteVuelto` en el seed — paga
  // de más sin que la venta rechace el sobrepago.
  const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenSinPermiso = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('la promesa de la feature: item con impuesto propio + descuento + recargo → borrar → restaurar conserva las tres reglas, e inactivo', async () => {
    const resImpuesto = await request(app.getHttpServer())
      .post('/api/impuestos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Impuesto papelera E2E ${Date.now()}`,
        porcentaje: '0.05',
      });
    expect(resImpuesto.status).toBe(201);
    const impuestoId = (resImpuesto.body as { id: string }).id;

    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Servicio papelera E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        impuestosIds: [impuestoId],
        descuentosIds: [DESCUENTO_SIN_CONDICION_ID],
        recargosIds: [RECARGO_SIN_CONDICION_ID],
      });
    expect(resItem.status).toBe(201);
    const item = resItem.body as ItemResponse;
    itemId = item.id;
    expect(item.activo).toBe(true);
    expect(item.impuestosIds).toEqual([impuestoId]);
    expect(item.descuentosIds).toEqual([DESCUENTO_SIN_CONDICION_ID]);
    expect(item.recargosIds).toEqual([RECARGO_SIN_CONDICION_ID]);

    // Se vende UNA vez antes de borrar, para dejar rastro: el detalle de la
    // venta congela `descripcion`/precios/impuestos en el momento de vender
    // (ADR-010 — el hecho fiscal se congela en la transacción). Borrar y
    // restaurar el ítem no debería tocar ese histórico ya emitido.
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        canal: 'online', // evita depender de una caja abierta
        lineas: [{ itemId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      });
    expect(resVenta.status).toBe(201);
    const ventaId = (resVenta.body as { id: string }).id;

    // El snapshot "antes" se toma con el MISMO endpoint (`GET /ventas/:id`)
    // que se usa después de restaurar, no con la respuesta de `POST /ventas`:
    // esa devuelve las entities `VentaDetalle` crudas (otros campos, otro
    // shape) mientras que `findOne` arma un objeto propio — compararlas
    // directo habría sido comparar peras con manzanas, no una prueba real de
    // "no cambió".
    const resVentaAntes = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resVentaAntes.status).toBe(200);
    const detallesAntes = (resVentaAntes.body as { detalles: unknown[] })
      .detalles;
    expect(detallesAntes).toHaveLength(1);

    const resDeleteSinPermiso = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resDeleteSinPermiso.status).toBe(403);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDelete.status).toBe(200);

    const resRestaurarSinPermiso = await request(app.getHttpServer())
      .post(`/api/items/${itemId}/restaurar`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resRestaurarSinPermiso.status).toBe(403);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/items/${itemId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(201);
    const restaurado = resRestaurar.body as ItemResponse;
    // `remove()` es el único de los 16 que pisa `activo = false`, y el valor
    // previo se perdió: `restaurar()` NO lo revierte a `true`.
    expect(restaurado.activo).toBe(false);
    // `remove()` no toca `item_impuestos`/`item_descuentos`/`item_recargos`
    // (esos DELETE físicos viven en `update()`), así que restaurar devuelve
    // el ítem entero con sus tres reglas intactas.
    expect(restaurado.impuestosIds).toEqual([impuestoId]);
    expect(restaurado.descuentosIds).toEqual([DESCUENTO_SIN_CONDICION_ID]);
    expect(restaurado.recargosIds).toEqual([RECARGO_SIN_CONDICION_ID]);

    const resGet = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect((resGet.body as ItemResponse).activo).toBe(false);

    // El histórico de la venta emitida ANTES del borrado no se altera:
    // `remove()`/`restaurar()` no tocan `venta_detalles`, así que el detalle
    // congelado (ADR-010) tiene que ser el mismo objeto, no una versión
    // recalculada con las reglas de precio "restauradas".
    const resVentaDespues = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resVentaDespues.status).toBe(200);
    const detallesDespues = (resVentaDespues.body as { detalles: unknown[] })
      .detalles;
    expect(detallesDespues).toEqual(detallesAntes);
  });

  it('POST /items/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/items/${itemId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  it('el colateral revive SOLO lo que este borrado se llevó, acotado por timestamp', async () => {
    // Ingrediente que se ofrecerá como "extra" de una receta — el caso que
    // dispara el colateral en `receta_extras_permitidos`.
    const resExtra = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Palta papelera E2E ${Date.now()}`,
        precioBase: '2000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'g',
        stock: '1000',
        costo: '2000',
      });
    expect(resExtra.status).toBe(201);
    const extraId = (resExtra.body as ItemResponse).id;

    const resPan = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Pan papelera E2E ${Date.now()}`,
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '500',
      });
    expect(resPan.status).toBe(201);
    const panId = (resPan.body as ItemResponse).id;

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Receta papelera E2E ${Date.now()}`,
        precioBase: '4000',
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
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '500',
          },
        ],
      });
    expect(resReceta.status).toBe(201);
    const recetaId = (resReceta.body as ItemResponse).id;

    // `update()` con `extrasPermitidos` SIEMPRE soft-deletea las filas vivas
    // e inserta de nuevo (items.service.ts, rama `tipo === 'receta'`): esto
    // deja una fila v1 borrada por ESTE motivo (con SU propio timestamp) y
    // una fila v2 viva, distinta de la v1 aunque referencien el mismo par
    // ingrediente/receta. Es la "otra fila borrada antes, por otro motivo"
    // que NO debe revivir cuando se restaure el ingrediente.
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '500',
          },
        ],
      });
    expect(resPatch.status).toBe(200);

    // Borra el ingrediente: la ÚNICA fila viva de `receta_extras_permitidos`
    // que lo referencia (la v2) se soft-deletea con ESTE timestamp.
    const resDelete = await request(app.getHttpServer())
      .delete(`/api/items/${extraId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDelete.status).toBe(200);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/items/${extraId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(201);

    const resGetReceta = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resGetReceta.status).toBe(200);
    const extras = (resGetReceta.body as ItemResponse).extrasPermitidos ?? [];
    // Si el acotamiento por timestamp no existiera (revivir CUALQUIER fila
    // borrada del mismo `item_id`, sin importar cuándo), la v1 —muerta por el
    // PATCH, con otro `eliminado_el`— reviviría también, y el ingrediente
    // aparecería DOS veces en `extrasPermitidos`.
    expect(extras.filter((e) => e.ingredienteItemId === extraId)).toHaveLength(
      1,
    );
  });
});
