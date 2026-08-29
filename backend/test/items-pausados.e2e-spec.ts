import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
// Turno del seed. El garzón lo crea el spec: la sesión es única por garzón y
// seis specs comparten a Ana, así que el estado se filtra de un spec al
// siguiente (`jest-e2e.json` corre con `maxWorkers: 1`).
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface AdvertenciaResponse {
  titulo: string;
  detalle: string;
}
interface CatalogoResponse {
  data: { id: string; activo: boolean }[];
  meta: { total: number };
}
interface ResultadoVentaResponse {
  lineas: { advertencias: AdvertenciaResponse[] }[];
  totales: { totalFinal: string };
  advertencias: AdvertenciaResponse[];
  advertenciasVenta: AdvertenciaResponse[];
}
interface VentaResponse {
  id: string;
  estado: string;
  advertencias?: string[];
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

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  expect(disp.status).toBe(200);
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '100000.0000',
      comentario: 'Apertura E2E ítems pausados',
    });
  expect(res.status).toBe(201);
  return (res.body as CajaResponse).id;
}

/**
 * Cierre en DOS fases (patrón de `caja.e2e-spec.ts`): `conteo` congela el arqueo
 * y auto-cierra si cuadra; si descuadra pasa a `en_conciliacion` y hay que
 * resolver con `cerrar` + motivo por línea. Llamar solo a `cerrar` deja el cajón
 * ocupado y la suite siguiente ve un 409 críptico al abrir.
 */
async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  const conteo = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: [{ metodoPagoId: null, montoContado: '100000' }] });
  expect([200, 201]).toContain(conteo.status);

  if ((conteo.body as { estado?: string }).estado === 'en_conciliacion') {
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    expect(motivos.status).toBe(200);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    const cierre = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            metodoPagoId: null,
            motivoDiferenciaId: motivoId,
            comentarioDiferencia: 'Cierre de la suite e2e',
          },
        ],
      });
    expect([200, 201]).toContain(cierre.status);
  }
}

async function getStock(ds: DataSource, itemId: string): Promise<number> {
  const rows: { stock: string }[] = await ds.query(
    `SELECT ip.stock FROM item_producto ip
      JOIN items i ON i.item_id = ip.item_id AND i.eliminado_el IS NULL
     WHERE ip.item_id = $1`,
    [itemId],
  );
  return parseFloat(rows[0]?.stock ?? '0');
}

async function contarOrdenes(ds: DataSource): Promise<number> {
  const rows: { total: string }[] = await ds.query(
    `SELECT COUNT(*) AS total FROM pasarela_ordenes
      WHERE tenant_id = $1 AND eliminado_el IS NULL`,
    [PARIS_TENANT_ID],
  );
  return parseInt(rows[0]?.total ?? '0', 10);
}

/**
 * Un ítem pausado (`activo = false`) se comporta distinto según el canal: se
 * bloquea donde todavía no pasó nada, no se bloquea donde el consumo ya ocurrió
 * (owner, 2026-08-03).
 *
 * - **Tienda online:** el checkout falla, con el nombre del producto adentro.
 * - **POS:** la venta sale igual y trae la advertencia.
 * - **Salones:** rechaza agregar líneas nuevas (`getItemVendibleOrThrow`) pero
 *   **sí deja cobrar** una cuenta que ya lo tenía cargado. Los dos casos están
 *   cubiertos acá desde el 2026-08-09; hasta entonces era el único canal sin
 *   test, porque no había arnés de mesa y cuenta del que partir.
 *
 * El control con el ítem ACTIVO está antes de pausar: sin él, un 400 del
 * checkout podría venir de cualquier otra cosa del ítem recién creado.
 */
describe('Ítem pausado según el canal (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let itemId: string;
  let nombreItem: string;
  let totalActivo: string;
  /** Cuántos productos vendibles había ANTES de pausar el ítem de este spec. */
  let vendiblesAntes: number;
  /** Cuenta de salón con el ítem YA cargado, abierta mientras seguía activo. */
  let cuentaSalonId: string;
  let garzon: { id: string; pin: string };

  const listarProductos = (query: string) =>
    request(app.getHttpServer())
      .get(`/api/items?tipo=producto&pageSize=100${query}`)
      .set('Authorization', `Bearer ${token}`);

  const calcular = () =>
    request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });

  const checkoutOnline = () =>
    request(app.getHttpServer())
      .post('/api/online/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });

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

    ds = app.get(DataSource);
    token = await login(app);
    cajaId = await abrirCaja(app, token);

    nombreItem = `Item pausable canal E2E ${Date.now()}`;
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreItem,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '500',
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as { id: string }).id;

    // Total con el ítem ACTIVO: pausar no puede moverlo ni un peso.
    const previo = await calcular();
    expect(previo.status).toBe(201);
    totalActivo = (previo.body as ResultadoVentaResponse).totales.totalFinal;

    const catalogo = await listarProductos('&activo=true');
    expect(catalogo.status).toBe(200);
    vendiblesAntes = (catalogo.body as CatalogoResponse).meta.total;

    // ⚠️ La cuenta de salón se arma acá, con el ítem TODAVÍA ACTIVO: ese es el
    // escenario entero. `getItemVendibleOrThrow` rechaza agregar la línea una
    // vez pausado, así que montarla después probaría el otro caso —el que ya
    // estaba cubierto— y no "se pausó después de cargarlo".
    const resGarzon = await request(app.getHttpServer())
      .post('/api/garzones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Garzón pausados E2E ${Date.now()}` });
    expect(resGarzon.status).toBe(201);
    garzon = resGarzon.body as { id: string; pin: string };

    const resSesion = await request(app.getHttpServer())
      .post('/api/sesiones-garzon/iniciar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        garzonId: garzon.id,
        pin: garzon.pin,
        turnoId: TURNO_MANANA_ID,
      });
    expect(resSesion.status).toBe(201);

    const resSalon = await request(app.getHttpServer())
      .post('/api/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Salón pausados E2E ${Date.now()}` });
    expect(resSalon.status).toBe(201);
    const resMesa = await request(app.getHttpServer())
      .post(`/api/salones/${(resSalon.body as { id: string }).id}/mesas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Mesa pausados' });
    // Sin este `expect`, un salón que falla deja la URL siguiente en
    // `/api/salones/undefined/mesas` y el error recién aparece dos pasos
    // después, como un 404 sin relación aparente.
    expect(resMesa.status).toBe(201);
    const resCuenta = await request(app.getHttpServer())
      .post(`/api/mesas/${(resMesa.body as { id: string }).id}/cuentas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: garzon.pin });
    expect(resCuenta.status).toBe(201);
    cuentaSalonId = (resCuenta.body as { id: string }).id;

    const resLinea = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaSalonId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, cantidad: '1' });
    expect(resLinea.status).toBe(201);
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar: si un paso falla, los que siguen igual tienen
    // que correr — lo que dejen sin limpiar contamina las suites siguientes. El
    // `close` va en un `finally` y la aserción DESPUÉS: afirmar antes deja la
    // app de Nest viva con su `@Cron` escribiéndole a la base desde un módulo
    // desmontado (medido: cuelga jest para siempre). Molde:
    // `caja-testigo.e2e-spec.ts`. Ver `docs/agent/pendientes.md` § 1.
    const fallos: string[] = [];
    const limpiar = async (
      que: string,
      ejecutar: () => Promise<number>,
      ok: number[] = [200, 201],
    ) => {
      try {
        const status = await ejecutar();
        if (!ok.includes(status)) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };

    try {
      if (garzon) {
        await limpiar(
          'cerrar sesión del garzón',
          async () =>
            (
              await request(app.getHttpServer())
                .post('/api/sesiones-garzon/cerrar')
                .set('Authorization', `Bearer ${token}`)
                .send({ garzonId: garzon.id, pin: garzon.pin })
            ).status,
        );
      }
      // `cerrarCaja` afirma sus status adentro: acá solo hay que evitar que su
      // fallo se lleve puesto el `close`, y dejar registro de que falló.
      if (cajaId) {
        await limpiar('cerrar caja', async () => {
          await cerrarCaja(app, token, cajaId);
          return 200;
        });
      }
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('control — activo: el checkout online pasa y el cálculo no advierte nada', async () => {
    const res = await checkoutOnline();
    expect(res.status).toBe(201);

    const calc = await calcular();
    expect(calc.status).toBe(201);
    expect((calc.body as ResultadoVentaResponse).advertencias).toHaveLength(0);
  });

  describe('una vez pausado', () => {
    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ activo: false });
      expect(res.status).toBe(200);
    });

    /**
     * El catálogo que piden las cuatro pantallas de venta (POS, salones,
     * tienda y suscripciones).
     *
     * Hasta 2026-08-09 el backend mandaba los pausados igual y cada pantalla
     * los descartaba en el cliente. **No era equivalente**: el pausado ocupaba
     * uno de los `pageSize` lugares pedidos, así que en un catálogo de más de
     * 100 ítems cada pausado empujaba fuera de la pantalla a uno vendible.
     * Por eso lo que se afirma acá es el `total` de la paginación, no solo que
     * el ítem no venga en `data`: es la diferencia entre las dos formas.
     */
    describe('el catálogo de venta', () => {
      it('con `activo=true` no lo trae, y libera su lugar de la página', async () => {
        const res = await listarProductos('&activo=true');

        expect(res.status).toBe(200);
        const body = res.body as CatalogoResponse;
        expect(body.data.some((i) => i.id === itemId)).toBe(false);
        expect(body.data.every((i) => i.activo)).toBe(true);
        // La mitad que un filtro de cliente no puede dar.
        expect(body.meta.total).toBe(vendiblesAntes - 1);
      });

      it('con `activo=false` trae solo los pausados, y el ítem está entre ellos', async () => {
        const res = await listarProductos('&activo=false');

        expect(res.status).toBe(200);
        const body = res.body as CatalogoResponse;
        expect(body.data.some((i) => i.id === itemId)).toBe(true);
        expect(body.data.every((i) => !i.activo)).toBe(true);
      });

      it('sin el parámetro sigue trayendo todo: la pantalla de configuración depende de eso', async () => {
        // El contrato viejo no se movió. Si esto empezara a filtrar, el admin
        // dejaría de ver —y de poder reactivar— lo que él mismo pausó.
        const [todos, vendibles, pausados] = await Promise.all([
          listarProductos(''),
          listarProductos('&activo=true'),
          listarProductos('&activo=false'),
        ]);

        expect(todos.status).toBe(200);
        const body = todos.body as CatalogoResponse;
        expect(body.data.some((i) => i.id === itemId)).toBe(true);
        // Sin filtrar = la suma exacta de las dos mitades. Comparar contra un
        // número fijo no serviría: la base de dev arrastra pausados de otras
        // corridas, y en CI arranca solo con los del seed.
        expect(pausados.status).toBe(200);
        expect(vendibles.status).toBe(200);
        expect(body.meta.total).toBe(
          (vendibles.body as CatalogoResponse).meta.total +
            (pausados.body as CatalogoResponse).meta.total,
        );
      });

      it('un valor que no es booleano da 400, no "solo los pausados"', async () => {
        // La coerción de `incluirEliminados` —`value === 'true'`— habría
        // convertido esto en `false` en silencio, o sea en el catálogo
        // invertido. Acá `activo` tiene TRES estados y el borde importa.
        const res = await listarProductos('&activo=sí');

        expect(res.status).toBe(400);
      });
    });

    it('tienda online: el checkout falla nombrando el producto, sin tocar el stock', async () => {
      const stockAntes = await getStock(ds, itemId);

      const res = await checkoutOnline();

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        `El producto "${nombreItem}" ya no se encuentra disponible`,
      );
      expect(await getStock(ds, itemId)).toBe(stockAntes);
    });

    it('tienda online: `pagar` corta antes y no deja orden de pasarela creada', async () => {
      const ordenesAntes = await contarOrdenes(ds);

      const res = await request(app.getHttpServer())
        .post('/api/online/pagar')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId, cantidad: '1' }] });

      expect(res.status).toBe(400);
      expect(await contarOrdenes(ds)).toBe(ordenesAntes);
    });

    it('POS: el preview advierte en la línea y en la venta, con el mismo total', async () => {
      const res = await calcular();

      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.lineas[0].advertencias).toEqual([
        {
          titulo: `Producto "${nombreItem}"`,
          detalle: 'está en pausa y ya no se ofrece en el catálogo',
        },
      ]);
      expect(body.advertencias).toHaveLength(1);
      // Pausar un ítem no es una regla de venta: `advertenciasVenta` es solo
      // para los avisos que no pertenecen a ninguna línea.
      expect(body.advertenciasVenta).toHaveLength(0);
      // No cambia ningún monto: por eso la advertencia no vive en el motor.
      expect(body.totales.totalFinal).toBe(totalActivo);
    });

    it('POS: `POST /ventas` cobra igual y devuelve la advertencia', async () => {
      const stockAntes = await getStock(ds, itemId);

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: totalActivo }],
        });

      expect(res.status).toBe(201);
      const venta = res.body as VentaResponse;
      expect(venta.estado).toBe('pagada');
      // `ventas.service.ts` aplana las advertencias del motor a `string[]`.
      expect(venta.advertencias).toContain(
        `Producto "${nombreItem}": está en pausa y ya no se ofrece en el catálogo`,
      );
      // La venta se cobró de verdad: el stock bajó.
      expect(await getStock(ds, itemId)).toBe(stockAntes - 1);
    });

    /**
     * El canal que faltaba, y el que la regla del owner deja del lado de "el
     * consumo ya ocurrió": el plato ya está en la mesa. Que la cuenta no se
     * pueda cobrar porque el admin pausó el ítem mientras el cliente comía
     * sería dejar a la mesa sin forma de pagar.
     *
     * Va último porque cobra: descuenta stock y cierra la cuenta.
     */
    it('salones: una cuenta con el ítem cargado ANTES de pausarlo se cobra igual', async () => {
      const stockAntes = await getStock(ds, itemId);

      // Control del escenario: agregar el ítem AHORA sí se rechaza. Sin esto,
      // un `getItemVendibleOrThrow` que dejara de mirar `activo` haría pasar el
      // cobro de abajo por la razón equivocada.
      const agregarAhora = await request(app.getHttpServer())
        .post(`/api/cuentas/${cuentaSalonId}/lineas`)
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId, cantidad: '1' });
      expect(agregarAhora.status).toBe(404);

      const res = await request(app.getHttpServer())
        .post(`/api/cuentas/${cuentaSalonId}/cerrar`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          garzonId: garzon.id,
          pin: garzon.pin,
          tipoDocumentoId: BOLETA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: totalActivo }],
        });

      expect(res.status).toBe(201);
      const cierre = res.body as {
        cuenta: { estado: string };
        ventaId: string;
      };
      expect(cierre.cuenta.estado).toBe('cerrada');

      // Cobrada de verdad, no solo "cerrada": el cierre no exige saldo cero.
      const ventaRows: { estado: string }[] = await ds.query(
        `SELECT estado FROM ventas WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [cierre.ventaId],
      );
      expect(ventaRows[0]?.estado).toBe('pagada');
      expect(await getStock(ds, itemId)).toBe(stockAntes - 1);
    });
  });
});

/**
 * Hermano menor del describe de arriba, y por eso vive en el mismo archivo:
 * misma regla ("lo pausado no admite uso nuevo") sobre entidades que se
 * **referencian** en vez de aplicarse. No mueven ningún monto, que es la razón
 * por la que quedaron fuera del alcance de la feature de pausa de 2026-08-03.
 *
 * Hasta 2026-08-11 la regla la sostenía solo el frontend —`items.vue` filtra
 * las categorías, `ClienteForm.vue` filtra los terceros por `activo`— así que
 * un POST directo asignaba igual. El backend ahora la enforcea.
 *
 * ⚠️ Lo que estos tests protegen tanto como el rechazo: que los vínculos YA
 * existentes sobrevivan. Un ítem no pierde su categoría porque la categoría se
 * pause; la alternativa —filtrar en las lecturas— habría sido el arreglo fácil
 * y equivocado.
 */
describe('Categoría y tercero pausados: el backend rechaza la asignación nueva (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let categoriaId: string;
  let itemPrevioId: string;
  let terceroId: string;

  const crearItem = (nombre: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '5',
        costo: '400',
        ...body,
      });

  const venderCon = (customer: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'fisico',
        tipoDocumentoId: BOLETA_ID,
        lineas: [{ itemId: itemPrevioId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1000' }],
        customer,
      });

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

    ds = app.get(DataSource);
    token = await login(app);
    cajaId = await abrirCaja(app, token);

    const resCat = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Categoría pausable E2E ${Date.now()}` });
    expect(resCat.status).toBe(201);
    categoriaId = (resCat.body as { id: string }).id;

    // El vínculo se crea con la categoría TODAVÍA activa: es la mitad del
    // escenario que hay que proteger, y montarlo después sería imposible.
    const resItem = await crearItem(`Item con categoría E2E ${Date.now()}`, {
      categoriaId,
    });
    expect(resItem.status).toBe(201);
    itemPrevioId = (resItem.body as { id: string }).id;

    const resTercero = await request(app.getHttpServer())
      .post('/api/terceros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Tercero pausable E2E ${Date.now()}`,
        tipo: 'persona_natural',
      });
    expect(resTercero.status).toBe(201);
    terceroId = (resTercero.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    // `close` en un `finally`: `cerrarCaja` afirma sus status adentro, así que
    // si la caja no cierra **tira**, y sin esto la app de Nest quedaba viva con
    // su `@Cron` escribiéndole a la base durante las suites siguientes.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      if (cajaId) await cerrarCaja(app, token, cajaId);
    } finally {
      await app.close();
    }
  });

  it('control — con la categoría y el tercero activos, ambos se asignan', async () => {
    const res = await crearItem(`Item control categoría E2E ${Date.now()}`, {
      categoriaId,
    });
    expect(res.status).toBe(201);

    const venta = await venderCon({ nombre: 'Cliente activo', terceroId });
    expect(venta.status).toBe(201);
  });

  describe('una vez pausados', () => {
    beforeAll(async () => {
      const cat = await request(app.getHttpServer())
        .patch(`/api/categorias/${categoriaId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ activo: false });
      expect(cat.status).toBe(200);

      const ter = await request(app.getHttpServer())
        .patch(`/api/terceros/${terceroId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ activo: false });
      expect(ter.status).toBe(200);
    });

    it('crear un ítem con la categoría pausada devuelve 400 y la nombra', async () => {
      const res = await crearItem(`Item rechazado E2E ${Date.now()}`, {
        categoriaId,
      });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('pausada');
    });

    it('mover un ítem existente a la categoría pausada devuelve 400', async () => {
      const otro = await crearItem(`Item sin categoría E2E ${Date.now()}`);
      expect(otro.status).toBe(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/items/${(otro.body as { id: string }).id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ categoriaId });
      expect(res.status).toBe(400);
    });

    /**
     * ⚠️ **Este test no prueba el cambio: lo custodia.** Hoy pasa igual sin la
     * feature —ninguna lectura filtra `activo`, y `categoriaId` sale de la
     * columna de `items`, no del JOIN— así que ningún mutante de esta tanda lo
     * mata. Está por lo que vendría después: el arreglo fácil y equivocado de
     * "ignorar lo pausado" es filtrar en las lecturas, y ese día el ítem
     * perdería su categoría en silencio. Acá se pone rojo.
     */
    it('el ítem que YA tenía la categoría la conserva', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/items/${itemPrevioId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect((res.body as { categoriaId: string | null }).categoriaId).toBe(
        categoriaId,
      );
    });

    it('vender con el tercero pausado devuelve 400 y lo nombra', async () => {
      const res = await venderCon({ nombre: 'Cliente pausado', terceroId });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('pausado');
    });

    it('la venta sin terceroId sigue pasando: el customer suelto no se toca', async () => {
      const res = await venderCon({ nombre: 'Cliente de mostrador' });
      expect(res.status).toBe(201);
    });
  });

  /**
   * Este caso NO nace de la decisión de pausa: apareció al medirla. El
   * `terceroId` no se validaba en absoluto —el DTO solo exige formato UUID— y
   * la FK de `venta_customer` referencia `terceros` sin tenant, así que el id
   * de un tercero ajeno se guardaba en la venta sin que nada chistara.
   *
   * El tercero se inserta por SQL a propósito: no hay ningún camino de API para
   * crear datos en un tenant al que no pertenecés, que es justo el punto.
   */
  it('un tercero de OTRO tenant no se puede adjuntar a la venta', async () => {
    const OTRO_TENANT = '550e8400-e29b-41d4-a716-446655440040'; // Demo Bodega
    const filas: { tercero_id: string }[] = await ds.query(
      `INSERT INTO terceros (tenant_id, nombre, tipo, activo)
       VALUES ($1, $2, 'persona_natural', true)
       RETURNING tercero_id`,
      [OTRO_TENANT, `Tercero ajeno E2E ${Date.now()}`],
    );
    const ajenoId = filas[0].tercero_id;

    const res = await venderCon({
      nombre: 'Cliente ajeno',
      terceroId: ajenoId,
    });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'no pertenece a este tenant',
    );

    // Soft delete, no `DELETE`: la invariante del proyecto no tiene excepción
    // para los tests, y dejar la fila viva ensucia el otro tenant del seed.
    await ds.query(
      `UPDATE terceros SET eliminado_el = NOW() WHERE tercero_id = $1`,
      [ajenoId],
    );
  });
});

/**
 * Regla 5 de
 * `docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md`: el
 * filtro `sinCosto` de `GET /items` es la vista de conjunto que hace visible
 * el agujero (`costo` opcional al crear el ítem, `costoUnitario` opcional al
 * ingresar stock) sin entrar ítem por ítem.
 *
 * Vive acá y no en un spec nuevo porque este archivo ya es el que ejercita
 * filtros de `GET /items` contra Postgres real (ver "el catálogo de venta"
 * arriba, para `activo`).
 *
 * ⚠️ Es la aserción que el spec del service NO puede dar: `ItemsService`
 * mockea `db.query`, así que un alias mal resuelto en el `where` (por
 * ejemplo si `sinCosto` referenciara `ip`/`ir`/`icb` en vez de subconsultas
 * correlacionadas) pasaría en verde ahí y solo revienta acá, porque el
 * mismo `where` alimenta el COUNT de `findAll`, que corre SIN los `LEFT
 * JOIN` de esos alias — un `42P01` real de Postgres.
 */
describe('Filtro sinCosto en GET /items (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let itemSinCostoId: string;
  let itemConCostoId: string;

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

    const sinCosto = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Item sin costo E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '5',
      });
    expect(sinCosto.status).toBe(201);
    itemSinCostoId = (sinCosto.body as { id: string }).id;

    const conCosto = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Item con costo E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '5',
        costo: '400',
      });
    expect(conCosto.status).toBe(201);
    itemConCostoId = (conCosto.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    // Soft delete, no `DELETE`: mismo molde que el describe anterior
    // (`terceros`, línea ~735). Sin esto, cada corrida local sin
    // `reset-db.sh` deja dos productos más sembrados en el tenant, y con
    // `ORDER BY i.nombre ASC` + el `pageSize` máximo (100) la acumulación
    // puede terminar empujando estos ítems fuera de la página — intermitente
    // en vez de repetible.
    try {
      await ds.query(
        `UPDATE items SET eliminado_el = NOW() WHERE item_id = ANY($1)`,
        [[itemSinCostoId, itemConCostoId]],
      );
    } finally {
      await app.close();
    }
  });

  it('devuelve 200 y solo trae ítems con costoActual null (ejercita el COUNT contra Postgres real)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=producto&pageSize=100&sinCosto=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      data: { id: string; costoActual: string | null }[];
    };
    expect(body.data.some((i) => i.id === itemSinCostoId)).toBe(true);
    expect(body.data.some((i) => i.id === itemConCostoId)).toBe(false);
    expect(body.data.every((i) => i.costoActual === null)).toBe(true);
  });

  it('sin sinCosto, el ítem con costo sigue apareciendo', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=producto&pageSize=100')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as { data: { id: string }[] };
    expect(body.data.some((i) => i.id === itemConCostoId)).toBe(true);
    expect(body.data.some((i) => i.id === itemSinCostoId)).toBe(true);
  });
});
