import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';

/**
 * Una nota de crédito NO toca `pedido` ni `porcentaje` de
 * `GET /api/salones/anulaciones/resumen` (owner, 2026-10-03, AskUserQuestion del
 * frente fiscal "las NC en el % de anulaciones": *"No toca el %"*, recomendada).
 * El % mide lo que el garzón anula o regala ANTES del cobro; la nota la emite la
 * caja después, y también sirve para cambiar boleta por factura. Estos tests fijan
 * esa decisión: un arreglo que reste la nota de lo vendido los rompe.
 *
 * Esqueleto: `salones-anulaciones-porcentaje.e2e-spec.ts` (garzones propios con
 * sesión, impresora de cocina para despachar, salón, mesa y caja propia). Cada
 * test arma sus cuentas con garzones propios y afirma sobre la fila de ESOS
 * garzones, así que no depende del orden.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Ver todas` (seedRolEncargadoSalon). */
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
}
interface MotivoBajaItem {
  id: string;
  tipo: string;
}
interface CuentaDetalle {
  id: string;
  lineas: { id: string; itemId: string }[];
}
interface GrupoResumenGarzon {
  garzonId: string | null;
  platos: string;
  precioCarta: string;
  pedido: string;
  porcentaje: string | null;
}
interface ResumenAnulaciones {
  porGarzon: GrupoResumenGarzon[];
}

async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

describe('Salones — las notas de crédito en el % de anulaciones por garzón (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let mesaId: string;
  let cajaId: string;
  const garzones: GarzonCreado[] = [];

  let motivoCortesiaId: string;

  let itemEntrada: string; // $10.000
  let itemVino: string; // $20.000

  let marca: number;

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    token = tokenAdmin,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function crearItem(
    nombre: string,
    precioBase: string,
    categoriaId: string,
  ): Promise<string> {
    const item = await post<IdResponse>('/api/items', {
      nombre: `${nombre} E2E ${marca}`,
      tipo: 'producto',
      precioBase,
      monedaId: CLP_MONEDA_ID,
      unidadMedida: 'unidad',
      stock: '1000',
      costo: '1',
      categoriaId,
    });
    return item.id;
  }

  /** Garzón propio con sesión abierta: la sesión es única por garzón. */
  async function nuevoGarzon(): Promise<GarzonCreado> {
    const g = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón NC-anulaciones-${garzones.length + 1} E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: g.id,
      pin: g.pin,
      turnoId: TURNO_MANANA_ID,
    });
    garzones.push(g);
    return g;
  }

  async function abrirCuenta(garzon: GarzonCreado): Promise<CuentaDetalle> {
    return post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
  }

  async function agregarLinea(
    cuentaId: string,
    itemId: string,
    cantidad: string,
  ): Promise<CuentaDetalle> {
    return post<CuentaDetalle>(`/api/cuentas/${cuentaId}/lineas`, {
      itemId,
      cantidad,
    });
  }

  async function despachar(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/comanda/reclamar`, {});
  }

  async function regalar(
    cuentaId: string,
    lineaId: string,
    cantidad: string,
  ): Promise<void> {
    await post(
      `/api/cuentas/${cuentaId}/lineas/${lineaId}/anular`,
      { cantidad, motivoBajaId: motivoCortesiaId },
      tokenEncargado,
    );
  }

  /**
   * Sin `pagos`, la venta queda con saldo y su NC va `sinPlata`; con pagos, la
   * NC puede devolver por uno de ellos.
   */
  async function cerrar(
    cuentaId: string,
    garzon: GarzonCreado,
    pagos: { metodoPagoId: string; monto: string }[] = [],
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cerrar`)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId: garzon.id, pin: garzon.pin, pagos });
    expect(res.status).toBe(201);
    return (res.body as { ventaId: string }).ventaId;
  }

  async function totalFinal(ventaId: string): Promise<string> {
    const filas: { total_final: string }[] = await ds.query(
      `SELECT total_final::text AS total_final FROM ventas
        WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    expect(filas).toHaveLength(1);
    return filas[0].total_final;
  }

  /** Σ `total_linea` de las líneas de la venta con ese ítem. */
  async function totalLineasDeItem(
    ventaId: string,
    itemId: string,
  ): Promise<string> {
    const filas: { total: string | null }[] = await ds.query(
      `SELECT SUM(total_linea)::text AS total FROM venta_detalles
        WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [ventaId, itemId],
    );
    expect(filas[0].total).not.toBeNull();
    return filas[0].total!;
  }

  async function notaCredito(
    ventaId: string,
    monto: string,
    devoluciones: { itemId: string; cantidad: string }[] = [],
    // Lo devuelto se pierde salvo que el caso diga otra cosa: es lo que hacía
    // el `reponerStock: false` de antes (no vuelve al stock), y la merma que
    // deja no es una anulación de plato, así que no toca el %.
    via: { pagoId?: string; stock?: 'recupera' | 'pierde' } = {},
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/ventas/${ventaId}/notas-credito`)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        monto,
        comentario: 'NC E2E del % de anulaciones',
        devolucion: via.pagoId ? { pagoId: via.pagoId } : { sinPlata: true },
        devoluciones: devoluciones.map((d) => ({
          ...d,
          stock: via.stock ?? 'pierde',
        })),
      });
    expect(res.status).toBe(201);
  }

  function rangoAmplio(): { desde: string; hasta: string } {
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const ahora = Date.now();
    const tresDiasMs = 3 * 24 * 60 * 60 * 1000;
    return {
      desde: fmt(ahora - tresDiasMs),
      hasta: fmt(ahora + tresDiasMs),
    };
  }

  async function filaDe(g: GarzonCreado): Promise<GrupoResumenGarzon> {
    const qs = new URLSearchParams({
      ...rangoAmplio(),
      garzonId: g.id,
    }).toString();
    const res = await request(app.getHttpServer())
      .get(`/api/salones/anulaciones/resumen?${qs}`)
      .set('Authorization', `Bearer ${tokenEncargado}`);
    expect(res.status).toBe(200);
    const f = (res.body as ResumenAnulaciones).porGarzon.find(
      (x) => x.garzonId === g.id,
    );
    expect(f).toBeDefined();
    return f!;
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
    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenEncargado = await entrar(app, ENCARGADO.email, ENCARGADO.pass);

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resMotivos.status).toBe(200);
    motivoCortesiaId = (resMotivos.body as MotivoBajaItem[]).find(
      (m) => m.tipo === 'cortesia',
    )!.id;
    expect(motivoCortesiaId).toBeTruthy();

    marca = Date.now();

    // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
    // `cantidadEnviada` y no hay nada despachado que regalar.
    const cocinaId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina NC-anulaciones E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-nc-anulaciones-e2e-${marca}`,
      })
    ).id;
    const catId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `NC-anulaciones E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;
    itemEntrada = await crearItem('ENTRADA NC', '10000', catId);
    itemVino = await crearItem('VINO NC', '20000', catId);

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón NC-anulaciones E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa NC-anulaciones',
      })
    ).id;

    const disp = await request(app.getHttpServer())
      .get('/api/caja/cajones-disponibles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(disp.status).toBe(200);
    const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;
    expect(cajonId).toBeTruthy();
    cajaId = (
      await post<IdResponse>('/api/caja/abrir', {
        cajonId,
        saldoInicial: '0.0000',
        comentario: 'Apertura E2E NC en % anulaciones',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
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
      for (const g of garzones) {
        await limpiar(
          `cerrar sesión ${g.id}`,
          async () =>
            (
              await request(app.getHttpServer())
                .post('/api/sesiones-garzon/cerrar')
                .set('Authorization', `Bearer ${tokenAdmin}`)
                .send({ garzonId: g.id, pin: g.pin })
            ).status,
        );
      }

      await limpiar('cerrar caja', async () => {
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
        if (![200, 201].includes(conteo.status)) return conteo.status;
        if ((conteo.body as { estado?: string }).estado !== 'en_conciliacion') {
          return 200;
        }
        const motivosDif = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
        const motivoId = (motivosDif.body as { id: string }[])[0]?.id;
        return (
          await request(app.getHttpServer())
            .post(`/api/caja/${cajaId}/cerrar`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({
              lineas: [
                {
                  metodoPagoId: null,
                  motivoDiferenciaId: motivoId,
                  comentarioDiferencia: 'Cierre de la suite e2e',
                },
              ],
            })
        ).status;
      });
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('una NC total, sin nombrar platos (todo Ajuste), no saca la venta de lo pedido del garzón', async () => {
    const g = await nuevoGarzon();
    const cuenta = await abrirCuenta(g);
    await agregarLinea(cuenta.id, itemEntrada, '2'); // $20.000 de carta
    const ventaId = await cerrar(cuenta.id, g);
    const antes = await filaDe(g);
    expect(antes.pedido).toBe('20000.0000');

    await notaCredito(ventaId, await totalFinal(ventaId));

    expect(await filaDe(g)).toEqual(antes);
  });

  it('con una cortesía de por medio, ni la NC que devuelve el vino ni la que acredita el resto mueven pedido ni %', async () => {
    const g = await nuevoGarzon();
    const cuenta = await abrirCuenta(g);
    await agregarLinea(cuenta.id, itemEntrada, '2'); // $20.000
    const conVino = await agregarLinea(cuenta.id, itemVino, '1'); // $20.000
    await despachar(cuenta.id);
    const lineaEntrada = conVino.lineas.find((l) => l.itemId === itemEntrada)!;
    await regalar(cuenta.id, lineaEntrada.id, '1'); // $10.000 de cortesía
    const ventaId = await cerrar(cuenta.id, g);

    // Vendido 30.000 + anulado 10.000 = 40.000 pedidos; 10.000 / 40.000 = 25%.
    const antes = await filaDe(g);
    expect(antes.pedido).toBe('40000.0000');
    expect(antes.porcentaje).toBe('0.2500');

    const montoVino = await totalLineasDeItem(ventaId, itemVino);
    await notaCredito(ventaId, montoVino, [
      { itemId: itemVino, cantidad: '1' },
    ]);
    expect(await filaDe(g)).toEqual(antes);

    // El resto de la venta, sin nombrar platos: la venta queda acreditada entera.
    const resto = new Decimal(await totalFinal(ventaId))
      .minus(montoVino)
      .toString();
    await notaCredito(ventaId, resto);
    expect(await filaDe(g)).toEqual(antes);
  });

  it('una NC que devuelve efectivo y repone el vino al stock tampoco mueve pedido ni %', async () => {
    const g = await nuevoGarzon();
    const cuenta = await abrirCuenta(g);
    await agregarLinea(cuenta.id, itemEntrada, '1'); // $10.000
    await agregarLinea(cuenta.id, itemVino, '1'); // $20.000
    const ventaId = await cerrar(cuenta.id, g, [
      { metodoPagoId: EFECTIVO_ID, monto: '100000.0000' },
    ]);
    const pagos: { pago_id: string }[] = await ds.query(
      `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    expect(pagos).toHaveLength(1);
    const antes = await filaDe(g);
    expect(antes.pedido).toBe('30000.0000');

    const montoVino = await totalLineasDeItem(ventaId, itemVino);
    await notaCredito(
      ventaId,
      montoVino,
      [{ itemId: itemVino, cantidad: '1' }],
      { pagoId: pagos[0].pago_id, stock: 'recupera' },
    );

    // Premisa: la nota devolvió plata y repuso el vino de verdad.
    const ncs: { movimientos: string }[] = await ds.query(
      `SELECT COUNT(mi.*)::text AS movimientos
         FROM ventas n
         JOIN movimientos_inventario mi
           ON mi.venta_id = n.venta_id AND mi.motivo = 'devolucion'
          AND mi.eliminado_el IS NULL
        WHERE n.venta_referencia_id = $1 AND n.eliminado_el IS NULL`,
      [ventaId],
    );
    expect(ncs[0].movimientos).toBe('1');

    expect(await filaDe(g)).toEqual(antes);
  });
});
