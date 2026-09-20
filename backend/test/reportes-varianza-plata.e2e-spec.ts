import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { contarYAplicar } from './helpers/recuentos';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const USD_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440005';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface CostoPorMonedaResp {
  monedaId: string;
  monto: string;
}
interface VarianzaFilaResp {
  itemId: string;
  itemNombre: string;
  medible: boolean;
  sinExplicacion: string | null;
  costoSinExplicacion: CostoPorMonedaResp[];
  faltaCosto: boolean;
}
interface VarianzaResp {
  data: VarianzaFilaResp[];
  meta: { total: number };
}

/**
 * La **plata** de la varianza, el **orden** de la página y el filtro
 * `soloConVarianza`, contra Postgres real.
 *
 * ⛔ **Es el único lugar donde esto se puede probar.** Los tres son SQL: una
 * suma, un `ORDER BY` y un `WHERE`. El spec unitario tiene `Db` mockeado, así
 * que recibe las filas ya sumadas y ya ordenadas — lo que cubre es el mapeo.
 * Es la misma lección que dejó la Tarea 3, donde los cuatro mutantes de
 * clasificación sobrevivieron a 18 unitarios.
 *
 * 📌 **Cada test crea su propia bodega y filtra por ella.** El reporte lista
 * todo lo que se contó en el tenant, así que sin ese aislamiento un producto de
 * otra suite —o de un test anterior de este mismo archivo— entraría en la página
 * y el test de orden diría cualquier cosa según qué corrió antes. Una bodega
 * propia por test convierte "las filas del tenant" en "mis filas".
 *
 * No hay andamiaje de salones ni caja: acá no se vende nada. Los movimientos que
 * importan los escribe el recuento.
 */
describe('Reporte de varianza — la plata, el orden y el filtro (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let motivoDiferenciaId: string;
  let marca = 0;

  async function post<T>(url: string, body: object): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

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

    const resDif = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    expect(resDif.status).toBe(200);
    motivoDiferenciaId = (resDif.body as { id: string }[])[0].id;
  }, 90000);

  afterAll(async () => {
    await app.close();
  });

  /** Una bodega nueva por test: convierte "las filas del tenant" en "mis filas". */
  async function crearBodega(): Promise<string> {
    marca += 1;
    const res = await post<IdResponse>('/api/ubicaciones', {
      nombre: `Bodega varianza plata E2E ${Date.now()}-${marca}`,
      tipo: 'bodega',
    });
    return res.id;
  }

  /**
   * Crea un producto y le pone su stock inicial **en la bodega del test**.
   *
   * `costo` ausente deja `costo_actual` en `NULL` —y el `PATCH` sin
   * `costoUnitario` no lo toca—, que es como se llega por la API real a un
   * movimiento sin costo. El `inventario_inicial` cae fuera de la ventana:
   * ocurre antes del primer recuento.
   */
  async function crearProductoEnBodega(
    bodegaId: string,
    opciones: {
      nombre: string;
      stock: string;
      costo?: string;
      monedaId?: string;
    },
  ): Promise<string> {
    const item = await post<IdResponse>('/api/items', {
      nombre: `${opciones.nombre} ${Date.now()}-${marca}`,
      tipo: 'producto',
      precioBase: '1000',
      monedaId: opciones.monedaId ?? CLP_MONEDA_ID,
      unidadMedida: 'unidad',
      stock: '0',
      ...(opciones.costo != null ? { costo: opciones.costo } : {}),
    });

    const res = await request(app.getHttpServer())
      .patch(`/api/items/${item.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ubicacionId: bodegaId,
        cantidad: opciones.stock,
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ...(opciones.costo != null ? { costoUnitario: opciones.costo } : {}),
      });
    expect(res.status).toBe(200);
    return item.id;
  }

  async function reporte(
    bodegaId: string,
    queryExtra = '',
  ): Promise<VarianzaResp> {
    const res = await request(app.getHttpServer())
      .get(`/api/reportes/varianza?ubicacionId=${bodegaId}${queryExtra}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as VarianzaResp;
  }

  /**
   * ⛔ **`Σ ROUND(...)`, nunca `ROUND(Σ ...)`.** Cada movimiento tiene su costo;
   * la suma no tiene ninguno. Los números están elegidos para que los dos
   * órdenes **no den lo mismo**, que es lo único que vuelve al test capaz de
   * cazar el bug: con un costo redondo las dos formas coinciden y el mutante
   * sobrevive sin que la línea esté bien.
   *
   * Tres salidas de 1,5 a un costo de 0,3333:
   * - `Σ ROUND`: `ROUND(0,49995) × 3` = `0,5000 × 3` = **1,5000**
   * - `ROUND(Σ)`: `ROUND(1,49985)` = **1,4999**
   */
  it('la plata suma costos ya redondeados, no redondea la suma', async () => {
    const bodegaId = await crearBodega();
    const itemId = await crearProductoEnBodega(bodegaId, {
      nombre: 'Varianza plata redondeo',
      stock: '100',
      costo: '0.3333',
    });

    // El primero abre la ventana: su propio movimiento queda FUERA, porque el
    // borde inferior es abierto. Los tres siguientes son los que suman.
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: itemId,
      cantidadContada: '99',
      motivoDiferenciaId,
    });
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: itemId,
      cantidadContada: '97.5',
      motivoDiferenciaId,
    });
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: itemId,
      cantidadContada: '96',
      motivoDiferenciaId,
    });
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: itemId,
      cantidadContada: '94.5',
      motivoDiferenciaId,
    });

    const { data } = await reporte(bodegaId);
    const fila = data.find((f) => f.itemId === itemId)!;

    expect(fila.sinExplicacion).toBe('4.5000');
    expect(fila.costoSinExplicacion).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '1.5000' },
    ]);
    expect(fila.faltaCosto).toBe(false);
  }, 60000);

  /**
   * ⛔ **El orden tiene que salir ANTES del `LIMIT`.** Con `pageSize=1`, la
   * página 1 tiene que traer al que más plata perdió — aunque sea el último por
   * nombre. Si el orden se aplicara después de elegir la página, acá vendría
   * "AAA" y la pantalla se vería igual de prolija: por eso el caso se monta con
   * el orden alfabético y el orden por plata **enfrentados**.
   */
  it('la página trae al que más plata perdió, no al primero por nombre', async () => {
    const bodegaId = await crearBodega();
    const pocaPlata = await crearProductoEnBodega(bodegaId, {
      nombre: 'AAA varianza plata poca',
      stock: '100',
      costo: '10',
    });
    const muchaPlata = await crearProductoEnBodega(bodegaId, {
      nombre: 'ZZZ varianza plata mucha',
      stock: '100',
      costo: '10',
    });

    for (const itemId of [pocaPlata, muchaPlata]) {
      await contarYAplicar(app, token, {
        ubicacionId: bodegaId,
        itemId: itemId,
        cantidadContada: '100',
        motivoDiferenciaId,
      });
    }
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: pocaPlata,
      cantidadContada: '99',
      motivoDiferenciaId,
    });
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: muchaPlata,
      cantidadContada: '95',
      motivoDiferenciaId,
    });

    const { data, meta } = await reporte(bodegaId, '&pageSize=1');

    expect(meta.total).toBe(2);
    expect(data).toHaveLength(1);
    expect(data[0].itemId).toBe(muchaPlata);
    expect(data[0].costoSinExplicacion).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '50.0000' },
    ]);
  }, 60000);

  /**
   * `soloConVarianza` esconde lo que cerró justo. **El total tiene que moverse
   * con la página**: si el `COUNT` contara sin el filtro, la paginación
   * prometería filas que no existen y la última página vendría vacía.
   *
   * El producto que cierra justo se cuenta dos veces **exacto**: delta cero, que
   * además es el caso que no escribe ningún movimiento.
   *
   * ⛔ **Y el tercer producto fija la decisión del owner (2026-09-20): el filtro
   * esconde TAMBIÉN lo que no se puede medir.** Se cuenta una sola vez, así que
   * su `sinExplicacion` es `null` —"todavía no se puede saber", distinto de
   * "no faltó nada"— y aun así desaparece al tildar el filtro. Sin este test la
   * conducta quedaría como efecto del `COALESCE` y el próximo que lo lea no
   * sabría si alguien la eligió.
   */
  it('soloConVarianza esconde las filas sin diferencia, y el total las descuenta', async () => {
    const bodegaId = await crearBodega();
    const conDiferencia = await crearProductoEnBodega(bodegaId, {
      nombre: 'Varianza plata con diferencia',
      stock: '100',
      costo: '10',
    });
    const cerroJusto = await crearProductoEnBodega(bodegaId, {
      nombre: 'Varianza plata cerro justo',
      stock: '100',
      costo: '10',
    });
    const sinMedir = await crearProductoEnBodega(bodegaId, {
      nombre: 'Varianza plata sin medir',
      stock: '100',
      costo: '10',
    });

    for (const itemId of [conDiferencia, cerroJusto]) {
      await contarYAplicar(app, token, {
        ubicacionId: bodegaId,
        itemId: itemId,
        cantidadContada: '100',
        motivoDiferenciaId,
      });
    }
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: conDiferencia,
      cantidadContada: '97',
      motivoDiferenciaId,
    });
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: cerroJusto,
      cantidadContada: '100',
      motivoDiferenciaId,
    });
    // Un solo conteo: no hay ventana, así que no se puede medir.
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: sinMedir,
      cantidadContada: '98',
      motivoDiferenciaId,
    });

    const sinFiltro = await reporte(bodegaId);
    expect(sinFiltro.meta.total).toBe(3);
    expect(sinFiltro.data).toHaveLength(3);
    const filaSinMedir = sinFiltro.data.find((f) => f.itemId === sinMedir)!;
    expect(filaSinMedir.medible).toBe(false);
    expect(filaSinMedir.sinExplicacion).toBeNull();
    const filaJusta = sinFiltro.data.find((f) => f.itemId === cerroJusto)!;
    expect(filaJusta.sinExplicacion).toBe('0.0000');
    // El cero medido viaja CON su moneda, no como lista vacía: "no faltó nada"
    // y "no hay dato" son respuestas distintas, y la lista vacía ya significa
    // la segunda (fila no medible, o movimiento sin costo).
    expect(filaJusta.costoSinExplicacion).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '0.0000' },
    ]);

    const filtrado = await reporte(bodegaId, '&soloConVarianza=true');
    expect(filtrado.meta.total).toBe(1);
    expect(filtrado.data).toHaveLength(1);
    expect(filtrado.data[0].itemId).toBe(conDiferencia);
    // La decisión del owner, atada: el que no se puede medir tampoco aparece.
    expect(filtrado.data.find((f) => f.itemId === sinMedir)).toBeUndefined();
  }, 60000);

  /**
   * ⛔ **Sin costo, la fila va sin cifra — y la cantidad sigue viajando.**
   *
   * El caso se monta **por la API real**, no por SQL: un producto creado sin
   * `costo` queda con `costo_actual` en `NULL`, el ajuste de stock sin
   * `costoUnitario` no lo toca, y el recuento no trae costo propio — congela ese
   * `NULL` (`inventario.service.ts`). Es exactamente lo que le pasa al local que
   * todavía no cargó lo que paga por un insumo.
   */
  it('un movimiento sin costo deja la fila sin cifra, pero con la cantidad', async () => {
    const bodegaId = await crearBodega();
    const itemId = await crearProductoEnBodega(bodegaId, {
      nombre: 'Varianza plata sin costo',
      stock: '50',
    });

    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: itemId,
      cantidadContada: '49',
      motivoDiferenciaId,
    });
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: itemId,
      cantidadContada: '45',
      motivoDiferenciaId,
    });

    const { data } = await reporte(bodegaId);
    const fila = data.find((f) => f.itemId === itemId)!;

    expect(fila.medible).toBe(true);
    expect(fila.sinExplicacion).toBe('4.0000');
    expect(fila.faltaCosto).toBe(true);
    expect(fila.costoSinExplicacion).toEqual([]);
  }, 60000);

  /**
   * ⛔ **La moneda sale del ítem y las monedas NO se suman ni se convierten.**
   * Dos productos en monedas distintas dan dos filas, cada una con la suya. Una
   * fila nunca puede traer dos: `items.moneda_id` es `NOT NULL` y una fila es un
   * ítem.
   *
   * ⚠️ **Los montos están elegidos para que la conversión CAMBIE el orden**, que
   * es lo único que vuelve discriminante a la última aserción: 20 USD es menos
   * que 12.400 CLP como número, pero a la tasa del tenant (1 USD = 950 CLP) son
   * 19.000 — más que los pesos. Si alguien convirtiera, la fila en dólares
   * pasaría a encabezar. Con montos donde las dos cuentas dan el mismo orden, la
   * aserción se vería igual de prolija y no probaría nada.
   *
   * 📌 Esta aserción también cae si se saca el `ORDER BY` por plata, así que este
   * test y el del orden mueren con el mismo mutante. Es deliberado: el orden es
   * el único lugar donde una conversión se haría visible.
   */
  it('cada moneda viaja con su fila, sin convertir ni sumar entre monedas', async () => {
    const bodegaId = await crearBodega();
    const enPesos = await crearProductoEnBodega(bodegaId, {
      nombre: 'Varianza plata en pesos',
      stock: '100',
      costo: '3100',
    });
    const enDolares = await crearProductoEnBodega(bodegaId, {
      nombre: 'Varianza plata en dolares',
      stock: '100',
      costo: '2',
      monedaId: USD_MONEDA_ID,
    });

    for (const itemId of [enPesos, enDolares]) {
      await contarYAplicar(app, token, {
        ubicacionId: bodegaId,
        itemId: itemId,
        cantidadContada: '100',
        motivoDiferenciaId,
      });
    }
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: enPesos,
      cantidadContada: '96',
      motivoDiferenciaId,
    });
    await contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId: enDolares,
      cantidadContada: '90',
      motivoDiferenciaId,
    });

    const { data } = await reporte(bodegaId);

    expect(data.find((f) => f.itemId === enPesos)!.costoSinExplicacion).toEqual(
      [{ monedaId: CLP_MONEDA_ID, monto: '12400.0000' }],
    );
    expect(
      data.find((f) => f.itemId === enDolares)!.costoSinExplicacion,
    ).toEqual([{ monedaId: USD_MONEDA_ID, monto: '20.0000' }]);
    expect(data[0].itemId).toBe(enPesos);
  }, 60000);
});
