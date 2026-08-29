import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

// Admin del tenant: ve todo (short-circuit de rol fijo).
const ADMIN_EMAIL = 'admin.paris@paris.cl';
// Cajero: rol Vendedor — MiCaja + Ventas:Leer/Crear + Pagos:Leer/Crear, SIN Cajas.
// Es exactamente la combinación que hacía la fuga.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface PagoFila {
  id: string;
  ventaId: string;
  cajaId: string | null;
  monto: string;
}
interface VentaFila {
  id: string;
}

async function login(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: PASS });
  expect(resLogin.status).toBe(200);
  const inicial = (resLogin.body as TokenResponse).access_token;

  const resSwitch = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${inicial}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resSwitch.status).toBe(200);
  return (resSwitch.body as TokenResponse).access_token;
}

describe('Visibilidad de ventas y pagos por usuario (e2e)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenAdmin: string;
  let itemId: string;
  let ventaDelAdminId: string;
  let ventaDelCajeroId: string;
  let cajonCajeroId: string;
  let cajonAdminId: string;

  /**
   * Cierra la caja activa del token, venga como venga de otra suite. Mismo
   * criterio que `liberarCajeroSiQuedoOcupado` en `caja.e2e-spec.ts`: es una
   * **red de seguridad, no una aserción**, así que no afirma el status de cada
   * paso. Devuelve un problema describible en vez de tirar, para que el
   * `afterAll` pueda intentar liberar TAMBIÉN al otro usuario antes de fallar.
   *
   * ⚠️ **La fase 1 (`conteo`) AUTO-CIERRA si el arqueo cuadra**; solo pasa a
   * `en_conciliacion` cuando alguna línea descuadra. Un `cerrar` incondicional
   * después del conteo pega contra una caja ya cerrada y responde
   * `400 "La caja no está en conciliación"` — inofensivo, salvo que uno lo
   * trate como error: medido, tratarlo así abortaba la limpieza y dejaba la
   * caja del OTRO usuario abierta, que es el `409` en `costeo-cpp`.
   */
  async function liberarCaja(token: string): Promise<string | null> {
    const activa = await request(app.getHttpServer())
      .get('/api/caja/activa')
      .set('Authorization', `Bearer ${token}`);
    const caja = activa.body as { id?: string; estado?: string } | null;
    if (!caja?.id) return null;
    const cajaId = caja.id;

    // El arqueo se lee con el ADMIN: el modo ciego le retiene el `esperado` al
    // cajero, y sin el esperado esta higiene no puede contar exacto.
    const leerLineas = async () =>
      (
        (
          await request(app.getHttpServer())
            .get(`/api/caja/${cajaId}/arqueo`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
        ).body as {
          lineas: {
            metodoPagoId: string | null;
            esperado: string | null;
            diferencia?: string | null;
          }[];
        }
      ).lineas;

    if (caja.estado === 'abierta') {
      const lineas = await leerLineas();
      await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: lineas.map((l) => ({
            metodoPagoId: l.metodoPagoId,
            montoContado: l.esperado ?? '0',
          })),
        });
    }

    // Si el conteo no la auto-cerró, quedó `en_conciliacion` y la fase 2 la
    // cierra un admin justificando lo que ya venía descuadrado.
    const descuadres = (await leerLineas()).filter(
      (l) => l.diferencia != null && Number(l.diferencia) !== 0,
    );
    let motivoId: string | undefined;
    if (descuadres.length > 0) {
      const resMotivos = await request(app.getHttpServer())
        .get('/api/motivos-diferencia?soloActivas=true')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      motivoId = (resMotivos.body as { id: string }[])?.[0]?.id;
    }
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: descuadres.map((l) => ({
          metodoPagoId: l.metodoPagoId,
          ...(motivoId ? { motivoDiferenciaId: motivoId } : {}),
          comentarioDiferencia: 'Higiene E2E visibilidad',
        })),
        comentario: 'Higiene E2E visibilidad',
      });

    // Lo único que sí se verifica: que de verdad quedó libre. Estos dos usuarios
    // son del seed y los comparten decenas de specs, así que una caja abierta
    // que sobreviva a esta suite reaparece como un 409 en otra y se lee como una
    // regresión ajena.
    const quedo = await request(app.getHttpServer())
      .get('/api/caja/activa')
      .set('Authorization', `Bearer ${token}`);
    const restante = quedo.body as { id?: string; estado?: string } | null;
    return restante?.id
      ? `la caja ${restante.id} quedó ${restante.estado ?? 'ocupada'}`
      : null;
  }

  /** Cajón propio de esta suite: no compite con los del seed ni entre sí. */
  async function crearCajon(nombre: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Visibilidad ${nombre} ${Date.now()}` });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  /** Abre caja sobre `cajonId`, vende al contado y devuelve el id de la venta. */
  async function venderEnEfectivo(
    token: string,
    cajonId: string,
  ): Promise<string> {
    const abrir = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${token}`)
      .send({ cajonId, saldoInicial: '10000.0000' });
    expect(abrir.status).toBe(201);

    const venta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipoDocumentoId: BOLETA_ID,
        lineas: [{ itemId, cantidad: '1' }],
      });
    expect(venta.status).toBe(201);
    const { id, totalFinal } = venta.body as { id: string; totalFinal: string };

    const pago = await request(app.getHttpServer())
      .post('/api/pagos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ventaId: id,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: totalFinal }],
      });
    expect([200, 201]).toContain(pago.status);
    return id;
  }

  const pagosDe = async (token: string): Promise<PagoFila[]> => {
    const res = await request(app.getHttpServer())
      .get('/api/pagos?pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { data: PagoFila[] }).data;
  };

  const ventasDe = async (token: string): Promise<VentaFila[]> => {
    const res = await request(app.getHttpServer())
      .get('/api/ventas?pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { data: VentaFila[] }).data;
  };

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

    tokenAdmin = await login(app, ADMIN_EMAIL);
    tokenCajero = await login(app, VENDEDOR_EMAIL);

    // Ítem propio de tipo `servicio`: no tiene stock, así que esta suite no se
    // rompe cuando otra que corrió antes agotó el producto del seed —lo que pasó
    // de verdad en la corrida completa: la venta salía 400, y al fallar el
    // `beforeAll` dejaba las dos cajas abiertas y `costeo-cpp` se caía con 409.
    const item = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `E2E Visibilidad Servicio ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(item.status).toBe(201);
    itemId = (item.body as { id: string }).id;

    await liberarCaja(tokenCajero);
    await liberarCaja(tokenAdmin);

    // Dos cajas distintas, de dos personas distintas, cada una con su venta.
    cajonCajeroId = await crearCajon('cajero');
    cajonAdminId = await crearCajon('admin');
    ventaDelCajeroId = await venderEnEfectivo(tokenCajero, cajonCajeroId);
    ventaDelAdminId = await venderEnEfectivo(tokenAdmin, cajonAdminId);
  });

  // ⚠️ **`app.close()` va en el `finally`, y no es prolijidad.** Si algo de la
  // limpieza tira —y `liberarCaja` ahora tira a propósito—, sin el `finally` el
  // `close()` no corre y la app **queda viva**: `AppModule` registra un `@Cron`
  // (`expirar-ordenes`, cada 10 min) que sobrevive al teardown de Jest y sigue
  // disparando trabajo contra la base desde un módulo ya desmontado. Medido:
  // `"You are trying to require a file after the Jest environment has been torn
  // down. From visibilidad-ventas-pagos.e2e-spec.ts"`, con el cron pinchando a
  // las 22:20:00 y 22:30:00 mientras corrían OTRAS suites, y el worker de Jest
  // sin poder salir.
  afterAll(async () => {
    try {
      const problemas = [
        await liberarCaja(tokenCajero),
        await liberarCaja(tokenAdmin),
      ].filter((p): p is string => p !== null);
      for (const id of [cajonCajeroId, cajonAdminId]) {
        if (!id) continue;
        await request(app.getHttpServer())
          .delete(`/api/cajones/${id}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
      // El ítem también: si no, cada corrida deja uno más en el catálogo del seed.
      if (itemId) {
        await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
      if (problemas.length > 0) {
        throw new Error(`Higiene incompleta: ${problemas.join('; ')}`);
      }
    } finally {
      await app.close();
    }
  });

  // Este es EL test del frente: antes de esto, el cajero listaba todos los pagos
  // del tenant y con eso reconstruía el esperado de cualquier caja.
  it('el cajero NO ve los pagos de la caja de otro', async () => {
    const pagosDelCajero = await pagosDe(tokenCajero);
    const pagosDelAdmin = await pagosDe(tokenAdmin);

    expect(pagosDelCajero.length).toBeGreaterThan(0); // ve los suyos

    // La aserción puntual y falsable: el pago de la venta del ADMIN existe (el
    // admin lo ve) y NO está en la lista del cajero. Comparar tamaños de
    // conjuntos no alcanzaba — pasaba igual si el cajero viera alguna caja
    // ajena, mientras viera menos que el admin.
    const pagoAjeno = pagosDelAdmin.find((p) => p.ventaId === ventaDelAdminId);
    expect(pagoAjeno).toBeDefined();
    expect(pagosDelCajero.some((p) => p.id === pagoAjeno!.id)).toBe(false);

    // Y ninguna de las cajas que ve son ajenas.
    const cajasDelCajero = new Set(pagosDelCajero.map((p) => p.cajaId));
    expect(cajasDelCajero.has(pagoAjeno!.cajaId)).toBe(false);
  });

  it('el cajero SÍ ve los pagos de su propia caja', async () => {
    const pagos = await pagosDe(tokenCajero);
    expect(pagos.length).toBeGreaterThan(0);
  });

  it('el cajero no ve la venta ajena en el listado', async () => {
    const ventas = await ventasDe(tokenCajero);
    const ids = ventas.map((v) => v.id);
    expect(ids).toContain(ventaDelCajeroId);
    expect(ids).not.toContain(ventaDelAdminId);
  });

  it('el detalle de una venta ajena responde 404, no el detalle', async () => {
    // 404 y no 403: un 403 confirmaría que existe. El detalle trae caja_id,
    // monto y vuelto por pago — era el camino largo de la misma fuga.
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaDelAdminId}`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect(res.status).toBe(404);
  });

  it('el detalle de la venta propia sigue funcionando', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaDelCajeroId}`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect(res.status).toBe(200);
  });

  it('el admin ve las dos ventas y los dos detalles', async () => {
    const ids = (await ventasDe(tokenAdmin)).map((v) => v.id);
    expect(ids).toContain(ventaDelCajeroId);
    expect(ids).toContain(ventaDelAdminId);

    for (const id of [ventaDelCajeroId, ventaDelAdminId]) {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
    }
  });

  it('los KPI del cajero son estrictamente menores que los del tenant', async () => {
    const suyo = await request(app.getHttpServer())
      .get('/api/pagos/resumen')
      .set('Authorization', `Bearer ${tokenCajero}`);
    const todo = await request(app.getHttpServer())
      .get('/api/pagos/resumen')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(suyo.status).toBe(200);
    expect(todo.status).toBe(200);
    expect((suyo.body as { totalPagos: number }).totalPagos).toBeLessThan(
      (todo.body as { totalPagos: number }).totalPagos,
    );
  });
});
