import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * La serie de una unidad es única **por producto vivo**, y se compara
 * **normalizada**: sin los espacios de los bordes y sin distinguir mayúsculas —
 * `ABC123` y `abc123 ` son la misma serie (owner, 2026-09-20)—. En la base se
 * guarda **tal como la tipeó el usuario**: la normalización es para comparar, no
 * para escribir. El índice es `(item_id, serieNormalizadaSql('serie'))` con
 * `eliminado_el IS NULL` — `lower(btrim(...))` con la lista de blancos explícita,
 * porque `btrim` a secas recorta solo el espacio ASCII.
 *
 * Sigue siendo por producto y NO por tenant: cada proveedor numera como quiere y
 * no hay estándar global, así que dos productos distintos del mismo tenant sí
 * pueden repetir número.
 *
 * Los dos bugs que cierra, en orden. (1) El índice único existía solo en
 * `startup-pos.sql`, que es documentación —el esquema lo crea `synchronize` desde
 * las entities—, así que dos unidades vivas del mismo producto compartían serie
 * en silencio. (2) Cerrado eso con un `@Index` de columnas peladas, **un espacio
 * de más seguía esquivando la unicidad**: `"X "` entraba junto a `"X"`, y una
 * serie de solo espacios también entraba. (3) Cerrado eso con `btrim` a secas,
 * **un tab, un newline o un NBSP en el borde seguían esquivándola** —`btrim` sin
 * lista de caracteres recorta solo el espacio ASCII—, que es lo que fija la tabla
 * de casos de más abajo. Lo levantó la revisión de seguridad.
 *
 * Acá van los dos caminos de `ItemsService`; los dos de compras —`confirmar` y
 * `corregirCantidad`— viven en `compras.e2e-spec.ts`, con los helpers de ese
 * archivo. Los cuatro pasan por el mismo chokepoint
 * (`InventarioService.moverSerie`, el único que inserta en `item_unidad`), y por
 * eso cada caso de acá prueba un camino distinto de la API y no el mismo dos
 * veces. Que el índice esté en la base real lo mide `esquema.e2e-spec.ts`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}

describe('serie única por producto (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  const serieUnica = (base: string) =>
    `${base}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

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
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  /** Status y mensaje del intento crudo, para afirmar sobre los dos. */
  async function intentar(
    metodo: 'post' | 'patch',
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; message: string; body: unknown }> {
    const res = await request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
      body: res.body,
    };
  }

  function altaSerie(extra: Record<string, unknown> = {}) {
    return {
      nombre: serieUnica('Serie única E2E'),
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      modoInventario: 'serie',
      unidadMedida: 'unidad',
      ...extra,
    };
  }

  async function crearProductoSerie(
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const r = await intentar('post', '/api/items', altaSerie(extra));
    expect(r.status).toBe(201);
    return (r.body as { id: string }).id;
  }

  async function ubicacionLocal(): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const local = (res.body as { id: string; tipo: string }[]).find(
      (u) => u.tipo === 'local',
    );
    expect(local).toBeDefined();
    return local!.id;
  }

  async function seriesDe(itemId: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { serie: string }[]).map((u) => u.serie).sort();
  }

  // --- Camino 1: alta de producto en modo serie con stock inicial ------------

  it('el alta con stock inicial rechaza dos series que solo difieren en mayúsculas o espacios', async () => {
    const serie = serieUnica('IMEI-ALTA-REPE');
    const r = await intentar(
      'post',
      '/api/items',
      altaSerie({ series: [{ serie }, { serie: `${serie.toLowerCase()} ` }] }),
    );
    expect(r.status).toBe(400);
    expect(r.message).toContain(serie.toLowerCase());
  });

  it('el alta rechaza una serie de solo espacios, y contesta el BORDE', async () => {
    const r = await intentar(
      'post',
      '/api/items',
      altaSerie({ series: [{ serie: '   ' }] }),
    );
    expect(r.status).toBe(400);
    // ⚠️ Afirma el texto del DTO (`La serie…`) y no un `toContain('solo
    // espacios')`, y la razón se midió: el chokepoint tiene su propio rechazo
    // para lo mismo, con el texto `Una serie…`, así que un `toContain` genérico
    // pasa igual **sin el validador del borde** —lo probó un mutante que
    // sobrevivió—. Los dos textos se escribieron distintos a propósito: es lo que
    // permite pinchar cuál de las dos capas contestó. El rechazo del chokepoint
    // lo cubre su test unitario.
    expect(r.message).toContain('La serie no puede ser solo espacios');
  });

  it('la misma serie entra en dos productos distintos: la regla es por producto, no por tenant', async () => {
    // Si el índice fuera por tenant, el segundo producto se caería con 500.
    const serie = serieUnica('IMEI-DOS-PRODUCTOS');
    const primero = await crearProductoSerie({ series: [{ serie }] });
    const segundo = await crearProductoSerie({ series: [{ serie }] });
    expect(await seriesDe(primero)).toEqual([serie]);
    expect(await seriesDe(segundo)).toEqual([serie]);
  });

  // --- Camino 2: ajuste/entrada manual de stock ------------------------------

  it('el ajuste rechaza la serie ya viva aunque cambie mayúsculas y espacios, y nombra las dos', async () => {
    // El caso que reabrió el frente: hasta el 2026-09-20 esto devolvía 200 y
    // dejaba DOS unidades vivas.
    const serie = serieUnica('IMEI-Ajuste-Viva');
    const itemId = await crearProductoSerie({ series: [{ serie }] });
    const localId = await ubicacionLocal();

    const r = await intentar('patch', `/api/items/${itemId}/stock`, {
      tipo: 'entrada',
      motivo: 'compra',
      ubicacionId: localId,
      cantidad: '1',
      series: [{ serie: `  ${serie.toUpperCase()}  ` }],
    });
    expect(r.status).toBe(400);
    // El mensaje nombra la mandada Y la guardada: cuando difieren solo en
    // mayúsculas, ver una sola hace que parezca un error del sistema.
    expect(r.message).toContain(serie.toUpperCase());
    expect(r.message).toContain(serie);

    // Y sigue habiendo UNA sola unidad, con el texto original intacto.
    expect(await seriesDe(itemId)).toEqual([serie]);
  });

  it('la serie se guarda tal como se tipeó, con sus espacios y mayúsculas', async () => {
    // La otra mitad de la decisión del owner: normalizar es para COMPARAR. Si
    // alguien trimeara al escribir, este test cae.
    const base = serieUnica('IMEI-Literal');
    const conBordes = `  ${base}  `;
    const itemId = await crearProductoSerie({ series: [{ serie: conBordes }] });
    expect(await seriesDe(itemId)).toEqual([conBordes]);
  });

  it('el ajuste rechaza dos series que normalizan igual en la misma tanda', async () => {
    const serie = serieUnica('IMEI-AJUSTE-TANDA');
    const itemId = await crearProductoSerie();
    const localId = await ubicacionLocal();

    const r = await intentar('patch', `/api/items/${itemId}/stock`, {
      tipo: 'entrada',
      motivo: 'compra',
      ubicacionId: localId,
      cantidad: '2',
      series: [{ serie }, { serie: `${serie.toLowerCase()} ` }],
    });
    expect(r.status).toBe(400);
    expect(await seriesDe(itemId)).toEqual([]);
  });

  it.each([
    ['tab', '\t'],
    ['newline', '\n'],
    ['NBSP', '\u00a0'],
  ])(
    'el ajuste rechaza la serie ya viva con un %s en el borde',
    async (_nombre, blanco) => {
      // El agujero que encontró la revisión de seguridad: `btrim(serie)` **sin
      // lista de caracteres recorta solo el espacio ASCII**, así que con la
      // primera versión de este frente `\tABC123\t` NO colisionaba con `ABC123`
      // y entraba como una segunda unidad viva — el mismo duplicado silencioso,
      // por un borde que no es el espacio. Por eso `serieNormalizadaSql` enumera
      // los blancos.
      const serie = serieUnica('IMEI-BLANCO');
      const itemId = await crearProductoSerie({ series: [{ serie }] });
      const localId = await ubicacionLocal();

      const r = await intentar('patch', `/api/items/${itemId}/stock`, {
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '1',
        series: [{ serie: `${blanco}${serie}${blanco}` }],
      });
      expect(r.status).toBe(400);
      expect(await seriesDe(itemId)).toEqual([serie]);
    },
  );

  it('rechaza la serie que pasa de 100 caracteres', async () => {
    // Sin tope, una serie enorme participa del índice por expresión y btree
    // corta en ~2,7 KB: el INSERT reventaría con un error de Postgres sin mapear
    // —un 500— en el mismo chokepoint que da 400 para todo lo demás.
    const r = await intentar(
      'post',
      '/api/items',
      altaSerie({ series: [{ serie: 'A'.repeat(101) }] }),
    );
    expect(r.status).toBe(400);
  });

  it('el espacio de ADENTRO sí distingue: son dos series distintas', async () => {
    // El control de la normalización: si `ABC 123` y `ABC123` colisionaran, la
    // normalización estaría borrando más de lo que la regla dice.
    const base = serieUnica('IMEI');
    const itemId = await crearProductoSerie({ series: [{ serie: base }] });
    const localId = await ubicacionLocal();

    const conEspacioInterno = base.replace('IMEI-', 'IMEI ');
    const r = await intentar('patch', `/api/items/${itemId}/stock`, {
      tipo: 'entrada',
      motivo: 'compra',
      ubicacionId: localId,
      cantidad: '1',
      series: [{ serie: conEspacioInterno }],
    });
    expect(r.status).toBe(200);
    expect(await seriesDe(itemId)).toEqual([base, conEspacioInterno].sort());
  });

  it('el ajuste sigue aceptando una serie nueva del mismo producto', async () => {
    // El control del guard: sin este caso, un chequeo que rechazara TODA serie
    // pasaría los tests de arriba.
    const primera = serieUnica('IMEI-OK-A');
    const segunda = serieUnica('IMEI-OK-B');
    const itemId = await crearProductoSerie({ series: [{ serie: primera }] });
    const localId = await ubicacionLocal();

    const r = await intentar('patch', `/api/items/${itemId}/stock`, {
      tipo: 'entrada',
      motivo: 'compra',
      ubicacionId: localId,
      cantidad: '1',
      series: [{ serie: segunda }],
    });
    expect(r.status).toBe(200);
    expect(await seriesDe(itemId)).toEqual([primera, segunda].sort());
  });
});
