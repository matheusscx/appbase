import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';

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
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
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
      comentario: 'Apertura E2E ítems pausados',
    });
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
 * - **Salones:** ya rechazaba agregar líneas nuevas (`getItemVendibleOrThrow`) y
 *   eso no se tocó.
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
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('control — activo: el checkout online pasa y el cálculo no advierte nada', async () => {
    const res = await checkoutOnline();
    expect(res.status).toBe(201);

    const calc = await calcular();
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
  });
});
