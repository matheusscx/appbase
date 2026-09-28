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
 * `pedido` y `porcentaje` en `GET /api/salones/anulaciones/resumen` (Task 2,
 * spec `docs/superpowers/specs/2026-09-27-porcentaje-anulaciones-por-garzon-design.md`
 * §§ 4 y 5.1). El % de lo pedido, por garzón, usando el reparto de la Task 1.
 *
 * Esqueleto: `salones-anulaciones-reporte.e2e-spec.ts` (login admin +
 * encargado, garzones propios con sesión, salón y mesa) más la caja propia de
 * `cuenta-precio-congelado.e2e-spec.ts` (abrir en `beforeAll`, conteo y cierre
 * en `afterAll`), porque cerrar una cuenta genera una venta `canal='fisico'`
 * que exige caja abierta.
 *
 * ⚠️ El orden de los tests importa: van acumulando pedido/anulado sobre los
 * mismos tres garzones (G1, G2, G3). No usar `it.only` ni reordenar sin
 * recalcular las constantes de la Escena 6.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Operar` + `Salones:Anular` + `Salones:Ver todas` (seedRolEncargadoSalon). */
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
  nombre: string;
  tipo: string;
}
interface CuentaLineaDetalle {
  id: string;
  itemId: string;
  cantidad: string;
  cantidadEnviada: string;
}
interface CuentaAnulacionDetalle {
  id: string;
  itemId: string;
}
interface CuentaDetalle {
  id: string;
  estado: string;
  lineas: CuentaLineaDetalle[];
  anulaciones: CuentaAnulacionDetalle[];
}
interface CostoPorMoneda {
  monedaId: string;
  monto: string;
}
interface GrupoResumenGarzon {
  garzonId: string | null;
  garzonNombre: string | null;
  platos: string;
  precioCarta: string;
  costo: CostoPorMoneda[];
  sinValorizar: number;
  pedido: string;
  porcentaje: string | null;
}
interface ResumenAnulaciones {
  porTipo: unknown[];
  porGarzon: GrupoResumenGarzon[];
  porAutorizo: unknown[];
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

describe('Salones — % de anulaciones sobre lo pedido, por garzón (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let mesaId: string;
  let garzon1: GarzonCreado; // G1
  let garzon2: GarzonCreado; // G2
  let garzon3: GarzonCreado; // G3
  let cajaId: string;

  let motivoMermaId: string;
  let motivoCortesiaId: string;

  let itemEntrada: string; // $10.000
  let itemPostre: string; // $5.000
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

  async function detalleCuenta(cuentaId: string): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const cuenta = (res.body as CuentaDetalle[]).find((c) => c.id === cuentaId);
    expect(cuenta).toBeDefined();
    return cuenta!;
  }

  async function anularLinea(
    cuentaId: string,
    lineaId: string,
    body: { cantidad: string; motivoBajaId: string },
  ): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas/${lineaId}/anular`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as CuentaDetalle;
  }

  async function cancelarConMotivo(
    cuentaId: string,
    motivoBajaId: string,
  ): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar-con-motivo`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ motivoBajaId });
    expect(res.status).toBe(201);
    return res.body as CuentaDetalle;
  }

  /** Cancelar SIN motivo: solo válido si nada se despachó (test 4). */
  async function cancelar(cuentaId: string): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({});
    expect(res.status).toBe(201);
  }

  async function transferir(cuentaId: string, a: GarzonCreado): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/transferir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId: a.id, pin: a.pin });
    expect(res.status).toBe(201);
  }

  /** Cierra la cuenta con el garzón dado (identifica quién cobra). */
  async function cerrar(
    cuentaId: string,
    garzon: GarzonCreado,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cerrar`)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId: garzon.id, pin: garzon.pin, pagos: [] });
    expect(res.status).toBe(201);
    return (res.body as { ventaId: string }).ventaId;
  }

  async function anularVenta(ventaId: string): Promise<{ estado?: string }> {
    const res = await request(app.getHttpServer())
      .post(`/api/ventas/${ventaId}/anular`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        motivo: 'Anulación E2E del % de anulaciones por garzón',
        reponerStock: false,
      });
    // Medido (ronda de fix 3): anular una venta de mesa cerrada con
    // `pagos: []` SÍ es posible (201) — no es la vía de escape del brief para
    // un caso incierto, así que el test 7 afirma sobre el resultado real.
    expect(res.status).toBe(201);
    return res.body as { estado?: string };
  }

  /**
   * `desde`/`hasta` son obligatorios en `/resumen` (ronda de fix 1). Una
   * ventana de ±3 días alrededor de "ahora" cubre todo lo que este archivo
   * crea en su propia corrida.
   */
  function rangoAmplio(): { desde: string; hasta: string } {
    const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const ahora = Date.now();
    const tresDiasMs = 3 * 24 * 60 * 60 * 1000;
    return {
      desde: fmt(ahora - tresDiasMs),
      hasta: fmt(ahora + tresDiasMs),
    };
  }

  async function resumen(
    query: Record<string, string> = {},
  ): Promise<ResumenAnulaciones> {
    const qs = new URLSearchParams({ ...rangoAmplio(), ...query }).toString();
    const res = await request(app.getHttpServer())
      .get(`/api/salones/anulaciones/resumen?${qs}`)
      .set('Authorization', `Bearer ${tokenEncargado}`);
    expect(res.status).toBe(200);
    return res.body as ResumenAnulaciones;
  }

  function fila(r: ResumenAnulaciones, g: GarzonCreado): GrupoResumenGarzon {
    const f = r.porGarzon.find((x) => x.garzonId === g.id);
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
    const motivos = resMotivos.body as MotivoBajaItem[];
    motivoMermaId = motivos.find((m) => m.tipo === 'merma')!.id;
    motivoCortesiaId = motivos.find((m) => m.tipo === 'cortesia')!.id;
    expect(motivoMermaId).toBeTruthy();
    expect(motivoCortesiaId).toBeTruthy();

    marca = Date.now();

    // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
    // `cantidadEnviada` — mismo molde que los otros specs del reporte.
    const cocinaId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina porcentaje-anulaciones E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-porcentaje-anulaciones-e2e-${marca}`,
      })
    ).id;
    const catCocinaId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Cocina porcentaje-anulaciones E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;

    itemEntrada = await crearItem('ENTRADA', '10000', catCocinaId);
    itemPostre = await crearItem('POSTRE', '5000', catCocinaId);
    itemVino = await crearItem('VINO', '20000', catCocinaId);

    // Garzones PROPIOS (G1, G2, G3): la sesión es única por garzón.
    garzon1 = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón porcentaje-anulaciones-1 E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon1.id,
      pin: garzon1.pin,
      turnoId: TURNO_MANANA_ID,
    });
    garzon2 = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón porcentaje-anulaciones-2 E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon2.id,
      pin: garzon2.pin,
      turnoId: TURNO_MANANA_ID,
    });
    garzon3 = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón porcentaje-anulaciones-3 E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon3.id,
      pin: garzon3.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón porcentaje-anulaciones E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa porcentaje-anulaciones',
      })
    ).id;

    // Cerrar una cuenta genera una venta `canal='fisico'`, que exige caja
    // abierta. Caja propia del spec.
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
        comentario: 'Apertura E2E % anulaciones',
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
      for (const g of [garzon1, garzon2, garzon3]) {
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

  it('1. la escena del owner: G1 pide $40.000, transfiere a G2, G2 pide $20.000 — cada uno con su pedido, 0% los dos', async () => {
    const cuenta = await abrirCuenta(garzon1);
    await agregarLinea(cuenta.id, itemEntrada, '4'); // $40.000
    await transferir(cuenta.id, garzon2);
    await agregarLinea(cuenta.id, itemVino, '1'); // $20.000
    await cerrar(cuenta.id, garzon2);

    const r = await resumen();
    const filaG1 = fila(r, garzon1);
    const filaG2 = fila(r, garzon2);

    expect(filaG1.pedido).toBe('40000.0000');
    expect(filaG1.porcentaje).toBe('0.0000');
    expect(filaG1.platos).toBe('0.0000');
    expect(filaG2.pedido).toBe('20000.0000');
    expect(filaG2.porcentaje).toBe('0.0000');
    expect(filaG2.platos).toBe('0.0000');
  });

  it('2. el % sobre lo pedido: 20 × POSTRE, una cortesía → vendido 95.000 + anulado 5.000', async () => {
    const cuenta = await abrirCuenta(garzon3);
    await agregarLinea(cuenta.id, itemPostre, '20'); // $100.000
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === itemPostre,
    )!;
    await anularLinea(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    await cerrar(cuenta.id, garzon3);

    const r = await resumen();
    const filaG3 = fila(r, garzon3);
    expect(filaG3.pedido).toBe('100000.0000');
    expect(filaG3.precioCarta).toBe('5000.0000');
    expect(filaG3.porcentaje).toBe('0.0500');
  });

  it('3. el filtro de tipo mueve el numerador y no el denominador', async () => {
    const cuenta = await abrirCuenta(garzon3);
    await agregarLinea(cuenta.id, itemPostre, '2'); // $10.000
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === itemPostre,
    )!;
    // Solo 1 de 2 (no la línea entera): con las dos anuladas la cuenta se
    // cancelaría entera, y este test necesita que siga abierta para cerrarla.
    await anularLinea(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
    });
    await cerrar(cuenta.id, garzon3);

    // Acumulado de G3: pedido test 2 (100.000) + esta cuenta (vendido 5.000 +
    // anulado 5.000 = 10.000) = 110.000.
    const sinFiltro = await resumen();
    const filaSinFiltro = fila(sinFiltro, garzon3);
    expect(filaSinFiltro.pedido).toBe('110000.0000');
    // precioCarta sin filtro: cortesía del test 2 (5.000) + merma de este (5.000).
    expect(filaSinFiltro.precioCarta).toBe('10000.0000');
    expect(filaSinFiltro.porcentaje).toBe('0.0909'); // 10000 / 110000

    const conFiltro = await resumen({ tipo: 'cortesia' });
    const filaConFiltro = fila(conFiltro, garzon3);
    expect(filaConFiltro.precioCarta).toBe('5000.0000'); // solo la cortesía
    expect(filaConFiltro.pedido).toBe('110000.0000'); // el mismo pedido
    expect(filaConFiltro.porcentaje).toBe('0.0455'); // 5000 / 110000
  });

  it('4. una cuenta abierta no suma a lo vendido', async () => {
    const antes = fila(await resumen(), garzon1);

    const cuenta = await abrirCuenta(garzon1);
    await agregarLinea(cuenta.id, itemVino, '1'); // $20.000, sin cerrar

    const durante = fila(await resumen(), garzon1);
    expect(durante.pedido).toBe(antes.pedido);

    await cancelar(cuenta.id);

    const despues = fila(await resumen(), garzon1);
    expect(despues.pedido).toBe(antes.pedido);
  });

  it('5. cancelar-con-motivo suma solo a lo anulado', async () => {
    const antes = fila(await resumen(), garzon2);

    const cuenta = await abrirCuenta(garzon2);
    await agregarLinea(cuenta.id, itemEntrada, '1'); // $10.000
    await despachar(cuenta.id);
    const detalle = await cancelarConMotivo(cuenta.id, motivoCortesiaId);
    expect(detalle.estado).toBe('cancelada');

    const despues = fila(await resumen(), garzon2);
    expect(new Decimal(despues.pedido).minus(antes.pedido).toFixed(4)).toBe(
      '10000.0000',
    );
    expect(
      new Decimal(despues.precioCarta).minus(antes.precioCarta).toFixed(4),
    ).toBe('10000.0000');
  });

  it('6. Σ pedido = carta cobrada + carta anulada (spec § 4.3)', async () => {
    // G1: test 1 (40.000) + test 4 (cancelada sin motivo, no suma) = 40.000.
    // G2: test 1 (20.000) + test 5 (10.000) = 30.000.
    // G3: test 2 (100.000) + test 3 (10.000) = 110.000.
    // Total = 40.000 + 30.000 + 110.000 = 180.000.
    const PEDIDO_TOTAL_ESPERADO = '180000.0000';

    const r = await resumen();
    const sumaPedido = [garzon1, garzon2, garzon3]
      .map((g) => fila(r, g).pedido)
      .reduce((acc, v) => acc.plus(v), new Decimal(0));
    expect(sumaPedido.toFixed(4)).toBe(PEDIDO_TOTAL_ESPERADO);

    const cobrada: { total: string }[] = await ds.query(
      `SELECT COALESCE(SUM(ROUND(cl.cantidad * cl.precio_unitario, 4)), 0)::text AS total
         FROM cuenta_lineas cl JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
        WHERE c.mesa_id = $1 AND c.estado = 'cerrada' AND cl.eliminado_el IS NULL`,
      [mesaId],
    );
    const anulada: { total: string }[] = await ds.query(
      `SELECT COALESCE(SUM(ROUND(cla.cantidad * cla.precio_unitario, 4)), 0)::text AS total
         FROM cuenta_linea_anulaciones cla
         JOIN cuentas c ON c.cuenta_id = cla.cuenta_id
        WHERE c.mesa_id = $1 AND cla.eliminado_el IS NULL`,
      [mesaId],
    );

    const cobradaMasAnulada = new Decimal(cobrada[0].total).plus(
      anulada[0].total,
    );
    expect(cobradaMasAnulada.toFixed(4)).toBe(PEDIDO_TOTAL_ESPERADO);
  });

  it('7. venta cancelada: el pedido de G1 no suma la línea de una venta anulada', async () => {
    const antes = fila(await resumen(), garzon1);

    const cuenta = await abrirCuenta(garzon1);
    await agregarLinea(cuenta.id, itemPostre, '1'); // $5.000
    const ventaId = await cerrar(cuenta.id, garzon1);

    const anulacion = await anularVenta(ventaId);
    expect(anulacion.estado).toBe('cancelada');

    const despues = fila(await resumen(), garzon1);
    expect(despues.pedido).toBe(antes.pedido);
  });
});
