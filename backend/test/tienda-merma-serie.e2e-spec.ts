import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Los productos con número de serie no salen por la tienda online ni por Mermas
 * (`docs/features/inventario-serializado.md`,
 * § «Quién elige qué unidad con serie sale»): las dos salidas nombran la unidad que se va, y ahí no hay quien
 * la elija. En la tienda, además, rechazar la venta después de Webpay dejaría
 * un cargo sin venta.
 *
 * Los productos son PROPIOS de este archivo: el stock del seed se agota entre
 * corridas locales.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const MOTIVO_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface ItemListado {
  id: string;
}
interface ListadoItems {
  data: ItemListado[];
  total: number;
}
interface ErrorResponse {
  message: string;
}

describe('tienda online y mermas — productos con serie (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let localId: string;
  let sufijo: string;
  let serie: { id: string; nombre: string };
  let cantidad: { id: string; nombre: string };
  let servicio: { id: string; nombre: string };

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

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.pass });
    expect(login.status).toBe(200);
    const tenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(tenant.status).toBe(200);
    token = (tenant.body as TokenResponse).access_token;

    const local: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = local[0].ubicacion_id;

    sufijo = `${Date.now()}-${Math.random()}`;
    serie = await crearItem('Celular tienda-merma-serie E2E', {
      tipo: 'producto',
      modoInventario: 'serie',
    });
    cantidad = await crearItem('Harina tienda-merma-serie E2E', {
      tipo: 'producto',
      modoInventario: 'cantidad',
      stock: '5',
      costo: '100',
    });
    servicio = await crearItem('Servicio tienda-merma-serie E2E', {
      tipo: 'servicio',
    });

    const entrada = await request(app.getHttpServer())
      .patch(`/api/items/${serie.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '2',
        series: [
          { serie: `IMEI-A-${sufijo}`, condicion: 'nuevo' },
          { serie: `IMEI-B-${sufijo}`, condicion: 'usado' },
        ],
      });
    expect(entrada.status).toBe(200);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  async function crearItem(
    prefijo: string,
    extra: Record<string, unknown>,
  ): Promise<{ id: string; nombre: string }> {
    const nombre = `${prefijo} ${sufijo}`;
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        ...extra,
      });
    expect(res.status).toBe(201);
    return { id: (res.body as IdResponse).id, nombre };
  }

  const idsListados = async (query: string): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get(`/api/items?${query}&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as ListadoItems).data.map((i) => i.id);
  };

  describe('GET /items?vendibleOnline=true', () => {
    // `ids` acota el listado a los tres productos de la suite: el catálogo del
    // seed y lo que dejan otras suites no entra en la cuenta.
    const ids = () => `ids=${serie.id},${cantidad.id},${servicio.id}`;

    it('sin el filtro, el listado trae el producto con serie', async () => {
      const listados = await idsListados(ids());

      expect(listados).toHaveLength(3);
      expect(listados).toContain(serie.id);
    });

    it('con el filtro, deja afuera el de serie y conserva el de cantidad y el servicio', async () => {
      const listados = await idsListados(`${ids()}&vendibleOnline=true`);

      expect(listados).not.toContain(serie.id);
      expect([...listados].sort()).toEqual([cantidad.id, servicio.id].sort());
    });

    it('vendibleOnline=false no filtra', async () => {
      const listados = await idsListados(`${ids()}&vendibleOnline=false`);

      expect(listados).toContain(serie.id);
    });

    it('con orden=disponibilidad (el de la grilla de venta) el filtro también rige', async () => {
      const listados = await idsListados(
        `${ids()}&vendibleOnline=true&orden=disponibilidad`,
      );

      expect(listados).not.toContain(serie.id);
      expect(listados).toHaveLength(2);
    });

    it('un valor que no es true/false es 400, no un catálogo sin filtrar', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/items?vendibleOnline=TRUE')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('checkout online', () => {
    const ordenes = async (): Promise<number> => {
      const filas: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM pasarela_ordenes WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      return Number(filas[0].n);
    };
    const ventas = async (itemId: string): Promise<number> => {
      const filas: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM venta_detalles WHERE item_id = $1`,
        [itemId],
      );
      return Number(filas[0].n);
    };

    it.each(['checkout', 'pagar'])(
      'POST /online/%s con una línea de serie: 400 nombrándolo y sin orden ni venta',
      async (ruta) => {
        const ordenesAntes = await ordenes();

        const res = await request(app.getHttpServer())
          .post(`/api/online/${ruta}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            lineas: [
              { itemId: servicio.id, cantidad: '1' },
              { itemId: serie.id, cantidad: '1' },
            ],
          });

        expect(res.status).toBe(400);
        expect((res.body as ErrorResponse).message).toBe(
          `«${serie.nombre}» se vende solo en el local`,
        );
        expect(await ordenes()).toBe(ordenesAntes);
        expect(await ventas(serie.id)).toBe(0);
      },
    );

    it('el mismo carrito sin la línea de serie sí calcula', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/online/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId: cantidad.id, cantidad: '1' }] });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /mermas', () => {
    const stockDe = async (itemId: string): Promise<string> => {
      const filas: { stock: string }[] = await ds.query(
        `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
        [itemId, localId],
      );
      return filas[0].stock;
    };
    const movimientos = async (itemId: string): Promise<number> => {
      const filas: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM movimientos_inventario
          WHERE item_id = $1 AND motivo = 'merma'`,
        [itemId],
      );
      return Number(filas[0].n);
    };
    const mermar = (itemId: string) =>
      request(app.getHttpServer())
        .post('/api/mermas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          itemId,
          ubicacionId: localId,
          cantidad: '1',
          motivoBajaId: MOTIVO_VENCIMIENTO_ID,
        });

    it('un producto con serie: 400 apuntando a Ajuste de stock, sin movimiento y con el stock intacto', async () => {
      const stockAntes = await stockDe(serie.id);

      const res = await mermar(serie.id);

      expect(res.status).toBe(400);
      expect((res.body as ErrorResponse).message).toBe(
        `«${serie.nombre}» tiene número de serie: dalo de baja desde Ajuste de stock, eligiendo la unidad`,
      );
      expect(await movimientos(serie.id)).toBe(0);
      expect(await stockDe(serie.id)).toBe(stockAntes);
    });

    it('un producto por cantidad sigue registrándose', async () => {
      const res = await mermar(cantidad.id);

      expect(res.status).toBe(201);
      expect(await movimientos(cantidad.id)).toBe(1);
    });
  });
});
