import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Cambiar la unidad de un ingrediente que una receta ya referencia rompe esa
 * receta: la fila dice "150 g de carne" y la carne pasa a medirse en litros, con
 * lo cual `convertirUnidad` no puede resolverla nunca más.
 *
 * El guard viejo solo miraba **movimientos propios** del ítem, así que un
 * ingrediente sin costo ni movimientos pasaba de `kg` a `l` sin fricción. Las
 * dos mitades de la decisión están acá: (a) el cambio se bloquea si hay
 * referencias, y (b) si una fila ya quedó rota, el listado la tolera en vez de
 * caerse entero.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
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

describe('Unidad de un ingrediente referenciado (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let ingredienteLibreId: string;
  let ingredienteEnRecetaId: string;
  let recetaId: string;

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
    ds = app.get(DataSource);

    token = await login(app);

    const crearIngrediente = async (nombre: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `${nombre} ${Date.now()}`,
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'ingrediente',
          unidadMedida: 'g',
        });
      expect(res.status).toBe(201);
      return (res.body as ItemResponse).id;
    };

    ingredienteLibreId = await crearIngrediente('Ingrediente suelto E2E');
    ingredienteEnRecetaId = await crearIngrediente('Ingrediente en receta E2E');

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Receta unidad E2E ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: ingredienteEnRecetaId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
        ],
      });
    expect(resReceta.status).toBe(201);
    recetaId = (resReceta.body as ItemResponse).id;
  });

  it('un ingrediente SIN referencias sigue pudiendo cambiar de unidad', async () => {
    // El contrapunto: el guard nuevo no congela la unidad de cualquier
    // ingrediente, solo la de los que otra fila ya fijó.
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${ingredienteLibreId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unidadMedida: 'kg' });
    expect(res.status).toBe(200);
  });

  it('un ingrediente referenciado por una receta NO puede cambiar de unidad', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${ingredienteEnRecetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unidadMedida: 'l' });
    expect(res.status).toBe(400);
    // El mensaje nombra qué lo referencia: sin eso, el usuario no sabe qué
    // desarmar para poder hacer el cambio.
    expect((res.body as { message: string }).message).toContain('receta');
  });

  it('tampoco si la unidad nueva es compatible: el criterio es la referencia', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${ingredienteEnRecetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unidadMedida: 'kg' });
    expect(res.status).toBe(400);
  });

  /**
   * El valor del fix está en que son CUATRO tablas y no la obvia: si el guard
   * solo mirara `receta_ingredientes`, los otros tres casos de arriba pasarían
   * igual y el catálogo se rompería lo mismo. Este caso cubre una segunda rama
   * del `UNION ALL` —los extras permitidos— para que la afirmación esté probada
   * y no solo leída.
   */
  it('un ingrediente referenciado como EXTRA permitido tampoco puede cambiar de unidad', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Ingrediente extra E2E ${Date.now()}`,
        precioBase: '800',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'g',
      });
    expect(resIng.status).toBe(201);
    const extraId = (resIng.body as ItemResponse).id;

    // Antes de ser extra de nadie, la unidad se puede cambiar.
    const resAntes = await request(app.getHttpServer())
      .patch(`/api/items/${extraId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unidadMedida: 'kg' });
    expect(resAntes.status).toBe(200);

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Receta con extra E2E ${Date.now()}`,
        precioBase: '6000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: ingredienteLibreId,
            cantidad: '1',
            unidadCodigo: 'kg',
            bloqueante: true,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '0.05',
            unidadCodigo: 'kg',
            precioExtra: '500',
          },
        ],
      });
    expect(resReceta.status).toBe(201);

    const resDespues = await request(app.getHttpServer())
      .patch(`/api/items/${extraId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unidadMedida: 'l' });
    expect(resDespues.status).toBe(400);
    expect((resDespues.body as { message: string }).message).toContain('extra');
  });

  it('con una fila YA rota, el listado responde igual y la receta queda en 0', async () => {
    // La segunda mitad de la decisión, y la que protege contra lo que ya pueda
    // estar roto hoy. El estado se monta por SQL porque el guard de arriba lo
    // hace inalcanzable por API — que es justo el punto: la fila rota viene de
    // antes de que el guard existiera.
    await ds.query(
      `UPDATE item_producto SET unidad_medida = 'l' WHERE item_id = $1`,
      [ingredienteEnRecetaId],
    );

    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=receta&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    // Lo esencial: NO es 500. Antes, una sola fila así tumbaba `GET /items`
    // para todo el tenant, con el menú del POS adentro.
    expect(res.status).toBe(200);

    const receta = (
      res.body as { data: { id: string; disponible: number | null }[] }
    ).data.find((i) => i.id === recetaId);
    expect(receta).toBeDefined();
    // 0 y no `null`: `null` significa "sin límite" y mostraría como disponible
    // algo que no se puede preparar.
    expect(receta!.disponible).toBe(0);

    // Y el resto del catálogo sigue respondiendo con sus disponibilidades.
    const resTodos = await request(app.getHttpServer())
      .get('/api/items?pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(resTodos.status).toBe(200);

    // La bandeja de desfases recorre TODAS las recetas del tenant y convierte
    // con otro conversor: sin tolerancia también ahí, esta misma fila la hacía
    // responder 400 entera. Se descubrió porque este spec dejaba la fila rota y
    // la suite del simulador empezó a fallar.
    const resDesfases = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(resDesfases.status).toBe(200);
  });

  /**
   * Leer tolerante y escribir tolerante NO son lo mismo, y confundirlos es lo
   * peligroso: `costo_actual` es dinero y la columna es nullable, así que un
   * costo "no calculable" persistido como `null` no falla — se lee después como
   * costo 0 al costear un combo que use esta receta.
   *
   * Estos dos endpoints reciben el `itemId` por body, sin pasar por la
   * bandeja, así que la fila rota es alcanzable por ellos aunque el listado la
   * omita.
   */
  it('aplicar y descartar sobre una receta con unidad rota fallan RUIDOSO, y ninguna de las dos columnas queda en null', async () => {
    // Se siembra un `costo_propuesto_omitido` conocido: sin él, verificar que
    // `descartarDesfases` no lo puso en null no distinguiría el bug del estado
    // inicial (nace en null), y la aserción no probaría nada.
    await ds.query(
      `UPDATE item_receta SET costo_propuesto_omitido = '123.4567' WHERE item_id = $1`,
      [recetaId],
    );
    await ds.query(
      `UPDATE item_producto SET unidad_medida = 'l' WHERE item_id = $1`,
      [ingredienteEnRecetaId],
    );

    const resAplicar = await request(app.getHttpServer())
      .post('/api/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ itemId: recetaId }] });
    expect(resAplicar.status).toBe(400);
    expect((resAplicar.body as { message: string }).message).toContain(
      'unidad incompatible',
    );

    const resDescartar = await request(app.getHttpServer())
      .post('/api/desfases/descartar')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [recetaId] });
    expect(resDescartar.status).toBe(400);

    // Lo que importa de verdad: ninguna de las dos columnas de dinero quedó
    // pisada. `costo_actual` en null se leería después como costo 0 al costear
    // un combo; `costo_propuesto_omitido` en null haría reaparecer la receta en
    // la bandeja con el usuario creyendo que la descartó.
    const filas: {
      costo_actual: string | null;
      costo_propuesto_omitido: string | null;
    }[] = await ds.query(
      `SELECT costo_actual, costo_propuesto_omitido FROM item_receta WHERE item_id = $1`,
      [recetaId],
    );
    expect(filas[0].costo_actual).not.toBeNull();
    expect(filas[0].costo_propuesto_omitido).toBe('123.4567');
  });

  // La fila rota se monta a mano, así que se desmonta a mano: dejarla viva
  // envenena a cualquier suite posterior que liste recetas o desfases de este
  // tenant, y el fallo aparece lejos de acá.
  afterAll(async () => {
    if (ingredienteEnRecetaId) {
      await ds.query(
        `UPDATE item_producto SET unidad_medida = 'g' WHERE item_id = $1`,
        [ingredienteEnRecetaId],
      );
    }
    await app.close();
  });
});
