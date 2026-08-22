import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Los filtros `desde`/`hasta` de kardex, mermas y órdenes de pasarela validan con
 * `@IsDateString()`, que acepta **fecha pura y timestamp**. La decisión del owner
 * es que *"desde el 1 de agosto"* sea la medianoche **del local** (zona del
 * tenant), y la trampa —medida y documentada en la entrada— es que castear con
 * `::date` para lograrlo **descarta la hora en silencio** cuando el llamador sí
 * mandó una: el filtro se ensancharía sin avisar.
 *
 * Estos casos fijan las dos mitades contra el stack real, que es donde se
 * resuelve la aritmética de la zona.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const CAUSA_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}
interface MermaListItem {
  id: string;
  itemId: string;
  creadoEl: string;
}
interface Paginated<T> {
  data: T[];
  meta: { total: number };
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

/** `YYYY-MM-DD` del instante dado, leído en la zona del tenant (Chile). */
function fechaLocal(iso: string, zona = 'America/Santiago'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

describe('Filtros de rango por fecha y zona del tenant (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemId: string;
  let mermaCreadoEl: string;

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

    token = await login(app);

    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto filtro fecha E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as ItemResponse).id;

    const resStock = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '1000',
      });
    expect(resStock.status).toBe(200);

    const resMerma = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        cantidad: '1',
        causaMermaId: CAUSA_VENCIMIENTO_ID,
        comentario: 'E2E filtro fecha',
      });
    expect(resMerma.status).toBe(201);

    const lista = await mermas('');
    expect(lista.data).toHaveLength(1);
    mermaCreadoEl = lista.data[0].creadoEl;
  });

  afterAll(async () => {
    await app.close();
  });

  async function mermas(qs: string): Promise<Paginated<MermaListItem>> {
    const res = await request(app.getHttpServer())
      .get(`/api/mermas?itemId=${itemId}${qs}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Paginated<MermaListItem>;
  }

  it('una fecha pura filtra desde la medianoche LOCAL del tenant', async () => {
    const hoyLocal = fechaLocal(mermaCreadoEl);

    // Desde la medianoche local del día en que ocurrió: entra.
    const dentro = await mermas(`&desde=${hoyLocal}`);
    expect(dentro.meta.total).toBe(1);

    // Desde la medianoche local del día siguiente: no entra.
    const fuera = await mermas(`&desde=${sumarDias(hoyLocal, 1)}`);
    expect(fuera.meta.total).toBe(0);
  });

  it('un timestamp con hora se respeta al segundo, sin ensancharse a medianoche', async () => {
    // Un segundo DESPUÉS de la merma: no debe aparecer. Si alguien "normalizara"
    // este valor con `::date`, el borde se correría a la medianoche de ese día y
    // la merma volvería a entrar — que es el bug que la entrada advirtió.
    const unSegundoDespues = new Date(
      new Date(mermaCreadoEl).getTime() + 1000,
    ).toISOString();
    const fuera = await mermas(`&desde=${unSegundoDespues}`);
    expect(fuera.meta.total).toBe(0);

    // Un segundo antes: entra. Prueba que el borde es real y no que el filtro
    // esté devolviendo cero por cualquier motivo.
    const unSegundoAntes = new Date(
      new Date(mermaCreadoEl).getTime() - 1000,
    ).toISOString();
    const dentro = await mermas(`&desde=${unSegundoAntes}`);
    expect(dentro.meta.total).toBe(1);
  });

  /**
   * Los dos casos de arriba pasan igual con la conducta vieja (medianoche UTC):
   * la ventana donde UTC y local discrepan son las primeras horas del día, y
   * `creado_el` lo pone la base con `now()`, así que a las 17:00 UTC no se
   * distingue una semántica de la otra.
   *
   * Este caso sí las distingue, y para eso **fija el instante por SQL**. No es
   * fabricar un estado inalcanzable —un movimiento a las 23:00 hora local ocurre
   * todos los días— sino controlar el reloj, que por API no se puede.
   */
  it('un movimiento de las 23:00 LOCALES pertenece al día local, no al UTC', async () => {
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto borde zona E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resItem.status).toBe(201);
    const bordeItemId = (resItem.body as ItemResponse).id;

    const resStock = await request(app.getHttpServer())
      .patch(`/api/items/${bordeItemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'entrada', motivo: 'compra', cantidad: '5' });
    expect(resStock.status).toBe(200);

    // Una hora ANTES de la medianoche local del 10 de marzo: o sea las 23:00
    // del 9 en la zona del tenant. La resta la hace Postgres para que el offset
    // salga de la zona real (y su DST), no de una constante escrita a mano.
    const ds = app.get(DataSource);
    await ds.query(
      `UPDATE movimientos_inventario
          SET creado_el = ('2026-03-10'::date::timestamp AT TIME ZONE $2)
                          - interval '1 hour'
        WHERE item_id = $1`,
      [bordeItemId, 'America/Santiago'],
    );

    const kardex = async (desde: string) => {
      const res = await request(app.getHttpServer())
        .get(`/api/inventario/movimientos?itemId=${bordeItemId}&desde=${desde}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return (res.body as Paginated<unknown>).meta.total;
    };

    // Locales son las 23:00 del 9 → "desde el 10" NO lo incluye.
    // Con la conducta vieja (medianoche UTC) sí entraba: en UTC ese instante ya
    // cayó en el día 10.
    expect(await kardex('2026-03-10')).toBe(0);

    // Y "desde el 9" sí lo incluye, que es el día al que pertenece localmente.
    expect(await kardex('2026-03-09')).toBe(1);
  });

  /**
   * El gemelo del borde de arriba, y el que **no** tenía red: `hasta` llega como
   * fecha pura y compararla contra un `timestamptz` la castea a la MEDIANOCHE
   * de ese día, así que `<= hasta` dejaba fuera el día entero — *"hasta hoy"* no
   * devolvía la merma de hoy. Decisión del owner (2026-08-22): **inclusivo del
   * día**, resuelto en el backend.
   *
   * Con la conducta vieja este caso da 0 y el de abajo da 1: los dos se
   * verificaron revirtiendo la implementación, no solo rompiéndola.
   */
  it('el borde `hasta` incluye el día elegido completo', async () => {
    const hoyLocal = fechaLocal(mermaCreadoEl);

    // "Hasta hoy" incluye lo de hoy. Es el bug exacto que cierra la entrada.
    const dentro = await mermas(`&hasta=${hoyLocal}`);
    expect(dentro.meta.total).toBe(1);

    // Y el borde sigue siendo un borde: "hasta ayer" no lo incluye.
    const fuera = await mermas(`&hasta=${sumarDias(hoyLocal, -1)}`);
    expect(fuera.meta.total).toBe(0);
  });

  /**
   * La otra mitad, y la que impide "arreglar" esto sumándole un día a todo: un
   * llamador que manda `T15:30:00Z` pidió **ese instante** como corte. Si el
   * borde superior expandiera también los timestamps, este caso devolvería la
   * merma y el filtro se habría ensanchado sin avisar — la misma trampa que el
   * caso de `desde` ya fija para el otro extremo.
   */
  it('un timestamp en `hasta` corta en el instante, no al final del día', async () => {
    const unSegundoAntes = new Date(
      new Date(mermaCreadoEl).getTime() - 1000,
    ).toISOString();
    const fuera = await mermas(`&hasta=${unSegundoAntes}`);
    expect(fuera.meta.total).toBe(0);

    // Un segundo después sí la incluye: el borde con hora es inclusivo del
    // instante (`<=`), y prueba que el cero de arriba no es un cero de cualquier
    // motivo.
    const unSegundoDespues = new Date(
      new Date(mermaCreadoEl).getTime() + 1000,
    ).toISOString();
    const dentro = await mermas(`&hasta=${unSegundoDespues}`);
    expect(dentro.meta.total).toBe(1);
  });

  it('el kardex hereda el `hasta` inclusivo, porque comparte el helper', async () => {
    const hoyLocal = fechaLocal(mermaCreadoEl);

    const res = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}&hasta=${hoyLocal}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // compra + merma, las dos de hoy
    expect((res.body as Paginated<unknown>).meta.total).toBe(2);
  });

  it('el mismo criterio rige en el kardex, que comparte el helper', async () => {
    const hoyLocal = fechaLocal(mermaCreadoEl);

    const res = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}&desde=${hoyLocal}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // compra + merma
    expect((res.body as Paginated<unknown>).meta.total).toBe(2);

    const resFuera = await request(app.getHttpServer())
      .get(
        `/api/inventario/movimientos?itemId=${itemId}&desde=${sumarDias(hoyLocal, 1)}`,
      )
      .set('Authorization', `Bearer ${token}`);
    expect(resFuera.status).toBe(200);
    expect((resFuera.body as Paginated<unknown>).meta.total).toBe(0);
  });
});
