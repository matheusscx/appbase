import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface ItemResponse {
  id: string;
  disponible: number | null;
  disponibleCondicional?: boolean;
}
interface GrupoModificadorResponse {
  grupoModificadorId: string;
}
interface VentaResponse {
  id: string;
  estado: string;
  totalFinal: string;
  advertencias?: string[];
}
interface MovimientoInventario {
  tipo: string;
  motivo: string;
  item_id: string;
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
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '100000.0000',
      comentario: 'Apertura E2E grupos-modificadores',
    });
  return (res.body as CajaResponse).id;
}

/**
 * Cierra la caja por las DOS fases reales: `POST /:id/conteo` congela el arqueo y
 * auto-cierra si cuadra; si alguna línea descuadra pasa a `en_conciliacion` y hay
 * que finalizar con `POST /:id/cerrar` + un motivo por línea descuadrada.
 * Antes esto llamaba SOLO a la fase 2 sobre una caja `abierta` e ignoraba el
 * status: no cerraba nada, el cajón quedaba ocupado y la fuga reaparecía como un
 * `409` críptico al abrir en otra suite. Por eso asevera las dos fases.
 * Patrón de referencia: `cerrarEnDosFases` en `caja.e2e-spec.ts`.
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
    // El conteo declara un monto fijo, así que las ventas en efectivo de esta
    // suite descuadran. La fase 2 exige motivo por línea descuadrada: mandar
    // `lineas: []` da 400 y deja el cajón ocupado. El comentario va siempre para
    // no depender de si el primer motivo activo pide `requiereComentario`.
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
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

async function crearProducto(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  stock: string,
  costo: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `${nombre} ${Date.now()}`,
      precioBase: costo,
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'unidad',
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Grupos de modificadores — venta descuenta stock de opciones elegidas (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let componenteFijoId: string;
  let bebidaId: string;
  let grupoBebidaId: string;
  let comboId: string;

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

    // 1. Producto con stock: componente fijo del combo, y la Bebida (opción de grupo).
    componenteFijoId = await crearProducto(
      app,
      token,
      'Papas fijas GM E2E',
      '30',
      '500',
    );
    bebidaId = await crearProducto(app, token, 'Bebida GM E2E', '20', '300');
  }, 60000);

  afterAll(async () => {
    // `close` en un `finally`: `cerrarCaja` afirma sus status adentro, así que
    // si la caja no cierra **tira**, y sin esto la app de Nest quedaba viva con
    // su `@Cron` escribiéndole a la base durante las suites siguientes. El
    // fallo sigue propagando; lo que cambia es que ya no se lleva el cierre
    // puesto. Ver `docs/agent/pendientes.md` § 1.
    try {
      if (cajaId) await cerrarCaja(app, token, cajaId);
    } finally {
      await app.close();
    }
  });

  it('2. crea el grupo de modificadores "Bebida" (familia vendible, opción con precioExtra 800)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bebida GM E2E ${Date.now()}`,
        opciones: [{ itemId: bebidaId, cantidad: '1', precioExtra: '800' }],
      });

    expect(res.status).toBe(201);
    grupoBebidaId = (res.body as GrupoModificadorResponse).grupoModificadorId;
  });

  it('3. crea el combo con un componente fijo + el grupo de modificadores obligatorio (min:1, max:1)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo GM E2E ${Date.now()}`,
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          {
            componenteItemId: componenteFijoId,
            cantidad: '1',
            bloqueante: true,
          },
        ],
        gruposModificadores: [
          { grupoModificadorId: grupoBebidaId, min: 1, max: 1 },
        ],
      });

    expect(res.status).toBe(201);
    comboId = (res.body as ItemResponse).id;
  });

  it('4. GET /items?tipo=combo → disponibleCondicional: true', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=combo&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const combo = (res.body as { data: ItemResponse[] }).data.find(
      (i) => i.id === comboId,
    );
    expect(combo?.disponibleCondicional).toBe(true);
  });

  it('5-6-7. vende 1 combo eligiendo la Bebida del grupo: descuenta stock del componente fijo Y de la Bebida, cobra precioBase + precioExtra', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: comboId,
            cantidad: '1',
            personalizacion: {
              grupos: [
                {
                  grupoId: grupoBebidaId,
                  opciones: [{ itemId: bebidaId, unidades: 1 }],
                },
              ],
            },
          },
        ],
        // Combo afecto (default): (3000 + 800) + 19% IVA = 4522 (Task 1, ADR-018).
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4522.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertencias ?? []).toEqual([]);
    // 7. Total = (precioBase del combo (3000) + precioExtra de la opción
    // elegida (800)) + 19% IVA (afecto por default)
    expect(venta.totalFinal).toBe('4522.0000');

    // 6. Movimientos de inventario: salida del componente fijo Y de la opción de grupo (Bebida)
    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id FROM movimientos_inventario
       WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [venta.id],
    );

    const movFijo = movs.find((m) => m.item_id === componenteFijoId);
    expect(movFijo?.tipo).toBe('salida');
    expect(movFijo?.motivo).toBe('venta');

    const movBebida = movs.find((m) => m.item_id === bebidaId);
    expect(movBebida?.tipo).toBe('salida');
    expect(movBebida?.motivo).toBe('venta');

    // Stock resultante: componente fijo 30-1=29, bebida 20-1=19
    const stockFijoRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [componenteFijoId],
    );
    expect(stockFijoRows[0]?.stock).toBe('29.0000');

    const stockBebidaRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [bebidaId],
    );
    expect(stockBebidaRows[0]?.stock).toBe('19.0000');
  });

  it('8. (negativo) vender el combo sin elegir opción del grupo obligatorio → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: comboId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3000.0000' }],
      });

    expect(res.status).toBe(400);
  });

  // ─── El índice de nombre único es CASE-INSENSITIVE ────────────────────────
  // No es un detalle de esquema: es la única defensa del lado del motor, y hay
  // un camino que NO pasa por `assertNombreLibre` — el `restaurar()` de la
  // papelera. Mientras la entity declaraba el índice con `@Index`, TypeORM lo
  // creaba en dev sobre `nombre` PELADO (no sabe expresar `LOWER()`), así que
  // dev enforzaba una regla distinta de la de `startup-pos.sql`. Ahora lo crea
  // el seeder con SQL cruda, igual que `causas_merma`.

  it('el índice único de nombre existe y es sobre lower(nombre)', async () => {
    const rows: { indexdef: string }[] = await ds.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'grupos_modificadores'
          AND indexname = 'uq_grupo_modificador_nombre_vivo'`,
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;
    expect(def).toContain('UNIQUE');
    expect(def).toContain('tenant_id');
    // Lo que este test existe para fijar: `lower(...)`, no `nombre` pelado.
    // Volver a poner el `@Index` en la entity lo pone rojo.
    expect(def).toMatch(/lower\(/i);
    // Parcial: sin esto bloquearía recrear un grupo tras un borrado legítimo.
    expect(def).toContain('eliminado_el');
  });

  it('restaurar un grupo cuyo nombre lo tomó otro que solo difiere en mayúsculas es 400', async () => {
    // Este camino NO pasa por `assertNombreLibre` (el `restaurar()` de la
    // papelera escribe directo), así que lo único que lo frena es el índice.
    const base = `Extras CI E2E ${Date.now()}`;
    const crear = async (nombre: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/grupos-modificadores')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre,
          opciones: [{ itemId: bebidaId, cantidad: '1', precioExtra: '800' }],
        });
      expect(res.status).toBe(201);
      return (res.body as GrupoModificadorResponse).grupoModificadorId;
    };

    const originalId = await crear(base);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/api/grupos-modificadores/${originalId}`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
      // 204, no 200: este DELETE no devuelve cuerpo.
    ).toBe(204);

    // Con el original en la papelera el nombre queda libre, así que otro lo
    // toma — en MINÚSCULA, que es el caso que un índice case-sensitive dejaría
    // pasar.
    await crear(base.toLowerCase());

    const res = await request(app.getHttpServer())
      .post(`/api/grupos-modificadores/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    // Y trae la salida: un nombre libre para reintentar.
    expect((res.body as { nombreSugerido?: string }).nombreSugerido).toBe(
      `${base} 2`,
    );
  });
});
