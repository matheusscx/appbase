import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  fechaLocalTenant,
  fechaMenosDias,
} from '../src/common/utils/rango-fecha.util';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * Qué lote sale cuando nadie lo elige (owner, 2026-09-28): **el que vence
 * antes**, los sin vencimiento al final, y dentro del mismo día de vencimiento
 * la llegada y después el código. Un lote vencido no se vende —la venta lo
 * salta— ni viaja en un traslado sin lote elegido (owner, 2026-10-03), pero sí
 * se merma, y la merma se lo lleva primero.
 *
 * Todo entra por una compra confirmada en el local y sale por la API real: la
 * venta del POS no manda lote nunca, así que es la que pasa por la
 * auto-selección. Qué lote salió se lee del desglose por ubicación de
 * `GET /items/:id/lotes`.
 *
 * Los códigos están elegidos **en contra** del criterio que no se está
 * probando —el lote que debería salir tiene el código mayor y va segundo en la
 * factura—, para que un orden por código o por inserción no pase de casualidad.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const BODEGA_SUBSUELO_ID = '550e8400-e29b-41d4-a716-446655440383';
const MOTIVO_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface LoteResponse {
  id: string;
  codigoLote: string;
  desglosePorUbicacion: { ubicacionId: string; cantidad: string }[];
}
interface LoteCompra {
  codigoLote: string;
  cantidad: string;
  fechaVencimiento?: string;
}

describe('Lotes — sale primero el que vence antes (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta | undefined;
  let localId: string;
  let proveedorId: string;
  let facturaId: string;
  /** Hoy en el calendario del local, como lo calcula el backend. */
  let hoy: string;

  const unico = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  async function login(): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASS });
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
    return (resTenant.body as TokenResponse).access_token;
  }

  async function post<T>(url: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  async function productoLote(nombre: string): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${nombre} FEFO E2E ${unico()}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        modoInventario: 'lote',
      })
    ).id;
  }

  /** Una factura confirmada en el local, una línea por lote y en ese orden. */
  async function comprar(itemId: string, lotes: LoteCompra[]): Promise<void> {
    const compra = await post<IdResponse>('/api/compras', {
      proveedorId,
      tipoDocumentoCompraId: facturaId,
      folio: `FEFO-${unico()}`,
      fechaDocumento: hoy,
      ubicacionId: localId,
      totalDocumento: '999999',
      lineas: lotes.map((l) => ({
        itemId,
        cantidad: l.cantidad,
        unidadCodigo: 'unidad',
        precioUnitario: '500',
        lote: {
          codigoLote: l.codigoLote,
          ...(l.fechaVencimiento
            ? { fechaVencimiento: l.fechaVencimiento }
            : {}),
        },
      })),
    });
    await post(`/api/compras/${compra.id}/confirmar`, {});
  }

  /** Saldo de cada lote EN EL LOCAL, por código. */
  async function enElLocal(itemId: string): Promise<Record<string, number>> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return Object.fromEntries(
      (res.body as LoteResponse[]).map((l) => [
        l.codigoLote,
        Number(
          l.desglosePorUbicacion.find((d) => d.ubicacionId === localId)
            ?.cantidad ?? 0,
        ),
      ]),
    );
  }

  async function loteIdDe(itemId: string, codigoLote: string) {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as LoteResponse[]).find(
      (l) => l.codigoLote === codigoLote,
    )!.id;
  }

  /** Venta del POS: sin lote, como la manda la pantalla. */
  async function vender(
    itemId: string,
    cantidad: string,
    loteId?: string,
  ): Promise<{ status: number; message: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId, cantidad, ...(loteId ? { loteId } : {}) }],
        pagos: [],
      });
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
    };
  }

  async function trasladarALaBodega(
    itemId: string,
    cantidad: string,
    loteId?: string,
  ): Promise<void> {
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${token}`);
    expect(motivos.status).toBe(200);
    await post('/api/traslados', {
      origenId: localId,
      destinoId: BODEGA_SUBSUELO_ID,
      motivoTrasladoId: (motivos.body as IdResponse[])[0].id,
      lineas: [{ itemId, cantidad, ...(loteId ? { loteId } : {}) }],
    });
  }

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

    token = await login();
    hoy = await fechaLocalTenant(ds, PARIS_TENANT_ID, new Date());

    const ubicaciones = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(ubicaciones.status).toBe(200);
    localId = (ubicaciones.body as { id: string; tipo: string }[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    proveedorId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'proveedor',
        nombre: `Lácteos FEFO E2E ${unico()}`,
      })
    ).id;
    const tipos = await request(app.getHttpServer())
      .get('/api/compras/tipos-documento')
      .set('Authorization', `Bearer ${token}`);
    expect(tipos.status).toBe(200);
    facturaId = (tipos.body as { id: string; codigo: string | null }[]).find(
      (t) => t.codigo === '33',
    )!.id;

    caja = await abrirCaja(app, token, { comentario: 'Apertura E2E FEFO' });
  }, 120000);

  afterAll(async () => {
    try {
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  it('el yogur: dos lotes en la misma factura, se vende uno y sale el de enero', async () => {
    const yogur = await productoLote('Yogur');
    await comprar(yogur, [
      { codigoLote: 'A-JUNIO', cantidad: '10', fechaVencimiento: '2099-06-30' },
      { codigoLote: 'B-ENERO', cantidad: '10', fechaVencimiento: '2099-01-31' },
    ]);

    expect((await vender(yogur, '1')).status).toBe(201);

    expect(await enElLocal(yogur)).toEqual({ 'B-ENERO': 9, 'A-JUNIO': 10 });
  });

  it('mismo vencimiento: decide la llegada, y en la misma factura el código', async () => {
    const leche = await productoLote('Leche');
    // Llega primero el de código mayor.
    await comprar(leche, [
      {
        codigoLote: 'Z-PRIMERO',
        cantidad: '2',
        fechaVencimiento: '2099-03-01',
      },
    ]);
    // Cuatro lotes de una unidad en la misma factura, listados fuera de orden.
    // Empatan en `creado_el` (misma transacción): si el código no decidiera,
    // decidiría `lote_id`, un UUID al azar, y con dos lotes un mutante sin el
    // código pasaba la mitad de las veces. Con cuatro, el azar acierta los tres
    // primeros en orden 1 de cada 24.
    await comprar(leche, [
      {
        codigoLote: 'M-FACTURA',
        cantidad: '1',
        fechaVencimiento: '2099-03-01',
      },
      {
        codigoLote: 'C-FACTURA',
        cantidad: '1',
        fechaVencimiento: '2099-03-01',
      },
      {
        codigoLote: 'T-FACTURA',
        cantidad: '1',
        fechaVencimiento: '2099-03-01',
      },
      {
        codigoLote: 'G-FACTURA',
        cantidad: '1',
        fechaVencimiento: '2099-03-01',
      },
    ]);

    // Una venta por unidad: cada una tiene que sacar del siguiente en orden.
    expect((await vender(leche, '2')).status).toBe(201);
    expect(await enElLocal(leche)).toMatchObject({ 'Z-PRIMERO': 0 });
    for (const siguiente of ['C-FACTURA', 'G-FACTURA', 'M-FACTURA']) {
      expect((await vender(leche, '1')).status).toBe(201);
      expect((await enElLocal(leche))[siguiente]).toBe(0);
    }
    expect(await enElLocal(leche)).toEqual({
      'Z-PRIMERO': 0,
      'C-FACTURA': 0,
      'G-FACTURA': 0,
      'M-FACTURA': 0,
      'T-FACTURA': 1,
    });
  });

  it('los lotes sin vencimiento salen después de los que tienen fecha', async () => {
    const harina = await productoLote('Harina');
    // El sin fecha llega antes: por llegada saldría primero.
    await comprar(harina, [{ codigoLote: 'A-SIN-FECHA', cantidad: '5' }]);
    await comprar(harina, [
      {
        codigoLote: 'Z-CON-FECHA',
        cantidad: '2',
        fechaVencimiento: '2099-12-31',
      },
    ]);

    expect((await vender(harina, '3')).status).toBe(201);

    expect(await enElLocal(harina)).toEqual({
      'Z-CON-FECHA': 0,
      'A-SIN-FECHA': 4,
    });
  });

  describe('lote vencido', () => {
    let queso: string;

    beforeAll(async () => {
      queso = await productoLote('Queso');
      await comprar(queso, [
        // El vencido tiene el código mayor y va segundo: la merma que se
        // lo lleva primero no puede estar ordenando por código ni por línea.
        { codigoLote: 'A-VENCE-HOY', cantidad: '5', fechaVencimiento: hoy },
        {
          codigoLote: 'Z-VENCIDO',
          cantidad: '3',
          fechaVencimiento: fechaMenosDias(hoy, 1),
        },
      ]);
    });

    it('la venta lo salta, y el lote que vence hoy todavía se vende', async () => {
      expect((await vender(queso, '1')).status).toBe(201);

      expect(await enElLocal(queso)).toEqual({
        'Z-VENCIDO': 3,
        'A-VENCE-HOY': 4,
      });
    });

    it('si no alcanza sin los vencidos, rechaza y dice cuánto hay vencido', async () => {
      const res = await vender(queso, '5');

      expect(res.status).toBe(400);
      expect(res.message).toContain('disponible: 4');
      expect(res.message).toContain('hay 3 más en lotes vencidos');
      expect(await enElLocal(queso)).toEqual({
        'Z-VENCIDO': 3,
        'A-VENCE-HOY': 4,
      });
    });

    it('elegido a mano en una venta, se rechaza', async () => {
      const res = await vender(queso, '1', await loteIdDe(queso, 'Z-VENCIDO'));

      expect(res.status).toBe(400);
      expect(res.message).toContain('Z-VENCIDO venció');
    });

    it('el traslado sin lote elegido lo deja; elegido a mano, lo mueve', async () => {
      await trasladarALaBodega(queso, '1');
      expect(await enElLocal(queso)).toEqual({
        'Z-VENCIDO': 3,
        'A-VENCE-HOY': 3,
      });

      await trasladarALaBodega(queso, '1', await loteIdDe(queso, 'Z-VENCIDO'));
      expect(await enElLocal(queso)).toEqual({
        'Z-VENCIDO': 2,
        'A-VENCE-HOY': 3,
      });
    });

    it('la merma sin lote elegido se lleva primero el vencido', async () => {
      await post('/api/mermas', {
        itemId: queso,
        ubicacionId: localId,
        cantidad: '1',
        motivoBajaId: MOTIVO_VENCIMIENTO_ID,
        comentario: 'E2E FEFO',
      });

      expect(await enElLocal(queso)).toEqual({
        'Z-VENCIDO': 1,
        'A-VENCE-HOY': 3,
      });
    });
  });
});
