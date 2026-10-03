import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { localDelSegundoTenant } from './helpers/segundo-tenant';

/**
 * El `loteId` de una unidad con serie (`item_unidad.lote_id`, metadato según
 * ADR-007) tiene que ser un lote **vivo, de este tenant y de este ítem**.
 *
 * Medido antes del arreglo (2026-10-03): la entrada en modo serie —el alta
 * `POST /items` y el ajuste `PATCH /items/:id/stock`— guardaba el valor tal
 * cual, y `item_unidad.lote_id` no tiene FK en la base (la entity no la
 * declara). Una unidad de Paris colgada del lote del otro tenant hacía que
 * `GET /items/:id/unidades` devolviera el `codigoLote` ajeno: un oráculo que
 * respondía el código de cualquier lote cuyo uuid se conociera. Entraban
 * también el lote de otro producto propio y un uuid que no existe.
 *
 * El lote ajeno es REAL —creado del otro lado por la API—, no un uuid
 * inventado: uno inventado daría 400 por no existir y el test pasaría aunque
 * el chokepoint no mirara el tenant.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const MENSAJE = 'El lote de la serie no es de este producto';

interface UnidadResponse {
  serie: string;
  loteId: string | null;
  codigoLote: string | null;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set(
      'Authorization',
      `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as { access_token: string }).access_token;
}

describe('loteId de una unidad con serie: solo un lote de este tenant y de este ítem (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let localId: string;
  let loteAjeno: { id: string; codigo: string };
  let loteDeOtroItem: { id: string; codigo: string };
  const INEXISTENTE = '00000000-0000-4000-8000-000000000000';
  const unico = () => `${Date.now()}-${Math.random()}`;

  /** Un producto en modo lote con un lote cargado por la API, del lado de `tk`. */
  async function crearLote(
    tk: string,
    local: string,
  ): Promise<{ id: string; codigo: string }> {
    const item = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tk}`)
      .send({
        nombre: `Lote serie-ajeno E2E ${unico()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'lote',
      });
    expect(item.status).toBe(201);
    const itemId = (item.body as { id: string }).id;
    const codigo = `LOTE-AJENO-${unico()}`;
    const entrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${tk}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: local,
        cantidad: '5',
        lote: { codigoLote: codigo, fechaVencimiento: '2027-06-01' },
      });
    expect(entrada.status).toBe(200);
    const lotes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${tk}`);
    expect(lotes.status).toBe(200);
    return { id: (lotes.body as { id: string }[])[0].id, codigo };
  }

  async function crearItemSerie(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Serie lote-ajeno E2E ${unico()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'serie',
      });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  async function unidades(itemId: string): Promise<UnidadResponse[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as UnidadResponse[];
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

    token = await login(app);
    const ubic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(ubic.status).toBe(200);
    localId = (ubic.body as { id: string; tipo: string }[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    const otro = await localDelSegundoTenant(app);
    loteAjeno = await crearLote(otro.token, otro.localId);
    loteDeOtroItem = await crearLote(token, localId);
  });

  afterAll(async () => {
    await app.close();
  });

  const casos = () => [
    { caso: 'del otro tenant', loteId: loteAjeno.id },
    { caso: 'de otro producto del mismo tenant', loteId: loteDeOtroItem.id },
    { caso: 'que no existe', loteId: INEXISTENTE },
  ];

  it('el alta (POST /items) rechaza con 400 un lote que no es de este producto, y no crea el ítem', async () => {
    for (const { caso, loteId } of casos()) {
      const nombre = `Serie alta lote-ajeno E2E ${unico()}`;
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre,
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          modoInventario: 'serie',
          stock: '1',
          series: [{ serie: `S-${unico()}`, loteId }],
        });
      expect({ caso, status: res.status }).toEqual({ caso, status: 400 });
      // El mismo mensaje para los tres: distinguir "es de otro tenant" de "no
      // existe" sería un oráculo de uuids ajenos.
      expect((res.body as { message: string }).message).toBe(MENSAJE);

      const quedo: unknown[] = await ds.query(
        `SELECT 1 FROM items WHERE tenant_id = $1 AND nombre = $2`,
        [PARIS_TENANT_ID, nombre],
      );
      expect({ caso, quedo }).toEqual({ caso, quedo: [] });
    }
  });

  it('la entrada por ajuste (PATCH /items/:id/stock) rechaza con 400 un lote que no es de este producto, y no deja la unidad', async () => {
    for (const { caso, loteId } of casos()) {
      const itemId = await crearItemSerie();
      const res = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          ubicacionId: localId,
          cantidad: '1',
          series: [{ serie: `A-${unico()}`, loteId }],
        });
      expect({ caso, status: res.status }).toEqual({ caso, status: 400 });
      expect((res.body as { message: string }).message).toBe(MENSAJE);
      expect({ caso, unidades: await unidades(itemId) }).toEqual({
        caso,
        unidades: [],
      });
    }
  });

  it('una serie sin loteId sigue entrando, en el alta y en el ajuste', async () => {
    const alta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Serie sin lote E2E ${unico()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'serie',
        stock: '1',
        series: [{ serie: `S-${unico()}` }],
      });
    expect(alta.status).toBe(201);
    const deAlta = await unidades((alta.body as { id: string }).id);
    expect(deAlta).toHaveLength(1);
    expect(deAlta[0].loteId).toBeNull();

    const itemId = await crearItemSerie();
    const ajuste = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '1',
        series: [{ serie: `A-${unico()}` }],
      });
    expect(ajuste.status).toBe(200);
    expect(await unidades(itemId)).toHaveLength(1);
  });

  it('la lectura (GET /items/:id/unidades) no devuelve el código de un lote que no es del producto, aunque la fila ya lo tenga', async () => {
    // Las unidades nacen por la API, sin lote, y después se les contamina
    // `lote_id` a mano: con la escritura cerrada la API ya no puede producir
    // esa fila (los tests de arriba). Este caso fija la otra mitad —que la
    // lectura no confíe en `item_unidad.lote_id`, que no tiene FK— para filas
    // escritas antes del arreglo o por un camino que mañana se agregue sin
    // pasar por el chokepoint. Solo `lote_id`: la ubicación de la unidad la
    // custodia `costo-stock-choke-point.invariant.spec.ts`.
    const itemId = await crearItemSerie();
    const serieAjena = `LEER-AJENO-${unico()}`;
    const serieOtroItem = `LEER-OTRO-${unico()}`;
    const entrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '2',
        series: [{ serie: serieAjena }, { serie: serieOtroItem }],
      });
    expect(entrada.status).toBe(200);
    for (const [serie, loteId] of [
      [serieAjena, loteAjeno.id],
      [serieOtroItem, loteDeOtroItem.id],
    ]) {
      await ds.query(
        `UPDATE item_unidad SET lote_id = $1
          WHERE item_id = $2 AND serie = $3`,
        [loteId, itemId, serie],
      );
    }

    const lista = await unidades(itemId);
    const ajena = lista.find((u) => u.serie === serieAjena);
    const deOtro = lista.find((u) => u.serie === serieOtroItem);
    // El escenario existe: las dos filas sí quedaron colgadas del lote. Sin
    // esto, un UPDATE que no matcheara dejaría `codigoLote` en null por la
    // razón equivocada y el test pasaría vacío.
    expect(ajena?.loteId).toBe(loteAjeno.id);
    expect(deOtro?.loteId).toBe(loteDeOtroItem.id);
    expect(ajena?.codigoLote).toBeNull();
    expect(deOtro?.codigoLote).toBeNull();
    expect(JSON.stringify(lista)).not.toContain(loteAjeno.codigo);
    expect(JSON.stringify(lista)).not.toContain(loteDeOtroItem.codigo);
  });
});
