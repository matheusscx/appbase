import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

interface Paginated {
  data: { id: string }[];
  meta: { total: number };
}
interface Resumen {
  totalVentas: number;
  totalBruto: string;
}

/**
 * El historial de ventas parte en "Hoy" y busca por folio (auditoría UX 01.28,
 * decidido por el owner el 2026-10-16). Fija contra el stack real lo que un mock
 * no ve: la expansión de la fecha pura al día del negocio, el borde `hasta`
 * inclusivo, el folio exacto sobre el número del documento vigente, y que las
 * tarjetas (`/ventas/resumen`) midan el mismo rango que la lista.
 */
describe('Historial de ventas: rango de fechas y folio (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let caja: CajaAbierta;
  let ventaId: string;
  const folio = String(Date.now()).slice(-9);

  const get = (ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);
  const patchDebito = async (emisor: string) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/metodos-pago/${DEBITO_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emisor });
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(ADMIN);
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
      .send({ tenantId: TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as { access_token: string }).access_token;

    await patchDebito('maquina');
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Historial filtros E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP,
        tipo: 'servicio',
        clasificacionTributaria: 'exento',
      });
    expect(resItem.status).toBe(201);
    const itemId = (resItem.body as { id: string }).id;

    caja = await abrirCaja(app, token);
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId, cantidad: '1' }],
        pagos: [
          {
            metodoPagoId: DEBITO_ID,
            monto: '1000',
            numeroDocumento: folio,
            claseDocumento: 'voucher',
          },
        ],
      });
    expect(resVenta.status).toBe(201);
    ventaId = (resVenta.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    try {
      await patchDebito('sistema');
    } finally {
      try {
        if (caja) await cerrarCaja(app, token, caja);
      } finally {
        await app.close();
      }
    }
  });

  const rangoAlrededorDeHoy = () => {
    const d = new Date();
    const mas = (n: number) =>
      new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    return { desde: mas(-1), hasta: mas(1) };
  };

  it('el folio encuentra la venta por el número de su documento, exacto', async () => {
    const ok = await get(`/api/ventas?folio=${folio}`);
    expect(ok.status).toBe(200);
    const lista = ok.body as Paginated;
    expect(lista.data.map((v) => v.id)).toEqual([ventaId]);

    // Con espacios alrededor igual; un prefijo del folio no coincide.
    const conEspacios = await get(`/api/ventas?folio=%20${folio}%20`);
    expect(conEspacios.status).toBe(200);
    expect((conEspacios.body as Paginated).meta.total).toBe(1);
    const prefijo = await get(`/api/ventas?folio=${folio.slice(0, 5)}`);
    expect(prefijo.status).toBe(200);
    expect((prefijo.body as Paginated).meta.total).toBe(0);
  });

  it('un folio que no existe devuelve la lista vacía, no un error', async () => {
    const res = await get('/api/ventas?folio=000000000000');
    expect(res.status).toBe(200);
    expect((res.body as Paginated).meta.total).toBe(0);
  });

  it('el rango que contiene el día de la venta la trae; uno de otro año, no', async () => {
    const { desde, hasta } = rangoAlrededorDeHoy();
    const dentro = await get(
      `/api/ventas?desde=${desde}&hasta=${hasta}&pageSize=100`,
    );
    expect(dentro.status).toBe(200);
    expect((dentro.body as Paginated).data.map((v) => v.id)).toContain(ventaId);

    const fuera = await get('/api/ventas?desde=2000-01-01&hasta=2000-01-02');
    expect(fuera.status).toBe(200);
    expect((fuera.body as Paginated).meta.total).toBe(0);
  });

  it('hasta es inclusivo del día completo: "hasta mañana" trae lo de hoy', async () => {
    const res = await get(
      `/api/ventas?desde=2000-01-01&hasta=${rangoAlrededorDeHoy().hasta}&pageSize=100`,
    );
    expect(res.status).toBe(200);
    expect((res.body as Paginated).data.map((v) => v.id)).toContain(ventaId);
  });

  it('las tarjetas miden el mismo rango que la lista', async () => {
    const vacio = await get(
      '/api/ventas/resumen?desde=2000-01-01&hasta=2000-01-02',
    );
    expect(vacio.status).toBe(200);
    expect((vacio.body as Resumen).totalVentas).toBe(0);
    expect(Number((vacio.body as Resumen).totalBruto)).toBe(0);

    const { desde, hasta } = rangoAlrededorDeHoy();
    const conVenta = await get(
      `/api/ventas/resumen?desde=${desde}&hasta=${hasta}`,
    );
    expect(conVenta.status).toBe(200);
    expect((conVenta.body as Resumen).totalVentas).toBeGreaterThanOrEqual(1);
  });

  it('una fecha que no existe se rechaza con 400', async () => {
    const lista = await get('/api/ventas?desde=2026-02-31');
    expect(lista.status).toBe(400);
    const resumen = await get('/api/ventas/resumen?hasta=ayer');
    expect(resumen.status).toBe(400);
  });
});
