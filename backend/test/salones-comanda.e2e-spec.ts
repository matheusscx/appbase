import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  /** El PIN se genera en el backend y se devuelve **una sola vez**, acá. */
  pin: string;
}
interface CuentaDetalle {
  id: string;
  lineas: { id: string; itemId: string; cantidad: string }[];
}
interface ComandaEstacion {
  impresoraId: string;
  nombre: string;
  items: {
    cuentaLineaId: string;
    nombre: string;
    cantidad: string;
    cantidadEnviada: string;
  }[];
}
interface ComandaResponse {
  estaciones: ComandaEstacion[];
}

/**
 * El camino que manda a cocina, contra Postgres.
 *
 * Hasta 2026-08-09 no lo tocaba **nada**: los únicos tests que afirmaban sobre
 * `estaciones` son unitarios con el SQL mockeado (`salones.service.spec.ts`), y
 * un `grep` de `comanda` sobre `backend/test/` y `frontend/e2e/` no devolvía
 * una línea. La razón por la que nunca se escribió está medida: con el seed,
 * `agruparEstacionesComanda` devolvía siempre `[]` —la categoría con impresora
 * existía, pero no tenía ningún ítem vendible adentro—, así que hacía falta
 * cablear datos a mano por SQL para ver una comanda.
 *
 * **Eso dejó de ser cierto el 2026-08-11**: la receta "Hamburguesa Especial" del
 * seed ahora se siembra con esa categoría, así que la comanda se puede ver a
 * mano sin tocar SQL. No cambia nada para este spec —que monta su propio
 * catálogo justo para no depender del seed— pero el párrafo de arriba describe
 * por qué el spec no existía, no el estado de hoy.
 *
 * Acá el **catálogo** lo crea el propio spec por API (dos impresoras, dos
 * categorías y cuatro ítems); del seed sale el escenario base que usan todos los
 * e2e: tenant, moneda, admin, el garzón y su turno. Eso deja lo que el seed no
 * tiene: **dos** estaciones distintas, **dos** líneas en una misma estación, y
 * una línea que no rutea a ninguna.
 */
describe('Salones — comanda a cocina (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let mesaId: string;
  let cocinaId: string;
  let barraId: string;
  let platoId: string;
  let postreId: string;
  let tragoId: string;
  let sinRutaId: string;
  let garzon: GarzonCreado;

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function abrirCuentaCon(
    lineas: { itemId: string; cantidad: string }[],
  ): Promise<CuentaDetalle> {
    const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    for (const linea of lineas) {
      await post(`/api/cuentas/${cuenta.id}/lineas`, linea);
    }
    return cuenta;
  }

  async function comandaPendiente(
    cuentaId: string,
  ): Promise<ComandaEstacion[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/cuentas/${cuentaId}/comanda/pendiente`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as ComandaResponse).estaciones;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
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

    const marca = Date.now();

    // Dos impresoras: el agrupado solo se puede afirmar si hay más de una
    // estación. Con una sola, un `agruparEstacionesComanda` que ignorara el
    // `impresora_id` y metiera todo en un balde pasaría igual.
    cocinaId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: 'cola-cocina-e2e',
      })
    ).id;
    barraId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Barra E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: 'cola-barra-e2e',
      })
    ).id;

    const catCocinaId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Cocina E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;
    const catBarraId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Barra E2E ${marca}`,
        impresoraId: barraId,
      })
    ).id;

    const item = (nombre: string, categoriaId?: string) => ({
      nombre: `${nombre} E2E ${marca}`,
      tipo: 'producto',
      precioBase: '5000',
      monedaId: CLP_MONEDA_ID,
      unidadMedida: 'unidad',
      ...(categoriaId ? { categoriaId } : {}),
    });
    platoId = (await post<IdResponse>('/api/items', item('Plato', catCocinaId)))
      .id;
    // Segundo ítem de la MISMA estación. Sin él, "agrupar por impresora" y "una
    // estación por línea" dan el mismo resultado, y el mutante que emite un
    // ticket por plato —tres papeles para una misma partida— sobrevive.
    postreId = (
      await post<IdResponse>('/api/items', item('Postre', catCocinaId))
    ).id;
    tragoId = (await post<IdResponse>('/api/items', item('Trago', catBarraId)))
      .id;
    // Sin categoría: el caso que el ruteo tiene que **saltear**, no romper.
    sinRutaId = (await post<IdResponse>('/api/items', item('Sin ruta'))).id;

    // ⚠️ Garzón PROPIO, no el del seed. La sesión es única por garzón y el
    // estado se filtra de un spec al siguiente (`jest-e2e.json` corre con
    // `maxWorkers: 1`): el que deja la sesión de Ana abierta le rompe el
    // `iniciar` al que viene, con un 400 "ya tiene una sesión abierta". Medido
    // — así se cayó `garzon-modo-personal` la primera vez que este archivo
    // entró a la suite.
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón comanda E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón comanda E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa comanda',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // El garzón es propio, así que dejar la sesión abierta no le cambiaría el
    // escenario a nadie. Se cierra igual: una sesión abierta para siempre es
    // ruido en el historial de turnos de la base de dev.
    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: garzon.pin });
    await app.close();
  });

  it('agrupa por impresora de la categoría, y saltea la línea que no rutea a ninguna', async () => {
    const cuenta = await abrirCuentaCon([
      { itemId: platoId, cantidad: '2' },
      { itemId: postreId, cantidad: '1' },
      { itemId: tragoId, cantidad: '1' },
      { itemId: sinRutaId, cantidad: '5' },
    ]);

    const estaciones = await comandaPendiente(cuenta.id);

    // Cuatro líneas, dos estaciones: una por impresora, no una por línea.
    expect(estaciones).toHaveLength(2);
    const cocina = estaciones.find((e) => e.impresoraId === cocinaId);
    const barra = estaciones.find((e) => e.impresoraId === barraId);
    // Explícito antes de desreferenciar: si el ruteo mandara a otra impresora,
    // sin esto el test moriría con un `TypeError` que no dice nada.
    expect(cocina).toBeDefined();
    expect(barra).toBeDefined();

    // Las dos de cocina van en el MISMO ticket.
    expect(cocina!.items).toHaveLength(2);
    expect(
      cocina!.items
        .map((i) => i.cantidad)
        .sort((a, b) => Number(a) - Number(b)),
    ).toEqual(['1', '2']);
    expect(barra!.items).toHaveLength(1);
    expect(barra!.items[0].cantidad).toBe('1');

    // Corolario de los tres conteos de arriba, escrito aparte porque es la
    // regla que importa: el ítem sin categoría no aparece en ninguna estación.
    // Nadie lo cocina, y el ticket no puede inventarle una impresora.
    const todos = estaciones.flatMap((e) => e.items.map((i) => i.nombre));
    expect(todos.some((n) => n.startsWith('Sin ruta'))).toBe(false);
  });

  it('reclamar avanza lo enviado: el segundo claim no vuelve a mandar lo mismo, y lo agregado después sale solo por la diferencia', async () => {
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '2' }]);

    const primero = await post<ComandaResponse>(
      `/api/cuentas/${cuenta.id}/comanda/reclamar`,
      {},
    );
    expect(primero.estaciones).toHaveLength(1);
    expect(primero.estaciones[0].items[0].cantidad).toBe('2');

    // El claim es lo que evita cocinar dos veces cuando el garzón toca
    // "Enviar" de nuevo o el ticket no salió.
    const segundo = await post<ComandaResponse>(
      `/api/cuentas/${cuenta.id}/comanda/reclamar`,
      {},
    );
    expect(segundo.estaciones).toEqual([]);

    // Y lo que se agrega DESPUÉS sale por la diferencia, no por el total: la
    // línea mergea a cantidad 3 con 2 ya enviadas.
    await post(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId: platoId,
      cantidad: '1',
    });
    const pendiente = await comandaPendiente(cuenta.id);
    expect(pendiente).toHaveLength(1);
    expect(pendiente[0].items[0].cantidad).toBe('1');
    // `cantidad` sale de un `Decimal.toString()` y `cantidadEnviada` es el
    // `numeric` crudo de la fila ('3.0000'): se comparan como número.
    expect(Number(pendiente[0].items[0].cantidadEnviada)).toBe(3);
  });
});
