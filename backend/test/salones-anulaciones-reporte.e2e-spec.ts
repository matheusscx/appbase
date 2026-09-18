import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';

/**
 * `GET /api/salones/anulaciones` (Task 2, spec
 * `docs/superpowers/specs/2026-09-18-reporte-anulaciones-design.md` §§ 5.1 y 9).
 * El listado paginado del reporte de anulaciones, con su permiso nuevo
 * `Salones:Ver todas`.
 *
 * Garzones, salón, mesa e ítems son PROPIOS de este archivo (no del seed):
 * la sesión de garzón es única y varias suites la comparten
 * (`docs/agent/pendientes.md`). `ana.torres@paris.cl` solo como usuario del
 * 403 (tiene `Salones:Leer` + `Operar`, sin `Ver todas`).
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Operar` + `Salones:Anular` + `Salones:Ver todas` (seedRolEncargadoSalon). */
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };
/** `Salones:Leer` + `Salones:Operar`, SIN `Ver todas`: el 403 de este spec. */
const SOLO_OPERAR = { email: 'ana.torres@paris.cl', pass: 'admin' };

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
  precioUnitario: string;
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
interface AnulacionReporteItem {
  id: string;
  creadoEl: string;
  cuentaId: string;
  cuentaNumero: number;
  mesaNombre: string;
  salonNombre: string;
  itemNombre: string;
  cantidad: string;
  motivoBajaNombre: string;
  tipo: string;
  garzonNombre: string | null;
  autorizadoPorNombre: string;
  precioCarta: string;
  costoEstado: 'valorizado' | 'no_aplica' | 'sin_valorizar';
  costo: CostoPorMoneda[];
}
interface ReportePaginado {
  data: AnulacionReporteItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
interface GrupoResumen {
  platos: string;
  precioCarta: string;
  costo: CostoPorMoneda[];
  sinValorizar: number;
}
interface ResumenAnulaciones {
  porTipo: (GrupoResumen & { tipo: string })[];
  porGarzon: (GrupoResumen & {
    garzonId: string | null;
    garzonNombre: string | null;
  })[];
  porAutorizo: (GrupoResumen & { usuarioId: string; usuarioNombre: string })[];
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

describe('Salones — reporte de anulaciones, listado (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let tokenSoloOperar: string;
  let mesaId: string;
  let garzon1: GarzonCreado;
  let garzon2: GarzonCreado;

  let motivoMermaId: string;
  let motivoCortesiaId: string;
  let motivoNoElaboradoId: string;

  let catCocinaId: string;
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

  async function abrirCuentaCon(
    lineas: { itemId: string; cantidad: string }[],
    garzon: GarzonCreado,
  ): Promise<CuentaDetalle> {
    const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    for (const linea of lineas) {
      await post(`/api/cuentas/${cuenta.id}/lineas`, linea);
    }
    return cuenta;
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

  async function anular(
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

  async function reporte(
    token: string,
    query: Record<string, string> = {},
  ): Promise<{ status: number; body: ReportePaginado }> {
    const qs = new URLSearchParams({ pageSize: '50', ...query }).toString();
    const res = await request(app.getHttpServer())
      .get(`/api/salones/anulaciones?${qs}`)
      .set('Authorization', `Bearer ${token}`);
    // Helper devuelve status+body juntos a propósito (el 403 del permiso es
    // un caso de uso legítimo): cada llamador afirma el status ANTES de leer
    // `.body`, nunca acá.
    // status-tolerante: status y body se devuelven juntos; se afirma en cada llamador
    return { status: res.status, body: res.body as ReportePaginado };
  }

  /**
   * `GET /api/salones/anulaciones/resumen` (Task 3): mismo DTO de filtros que
   * `reporte`, sin paginar. Molde de `post` (`salones-anular-linea.e2e-spec.ts`):
   * asevera el status DENTRO del helper, antes de leer `.body` — a diferencia
   * de `reporte` (status-tolerante: devuelve status+body juntos porque el 403
   * es un caso de uso legítimo de ESE test y cada llamador lo afirma antes de
   * tocar `.body`), acá cada llamador ya sabe de antemano qué status espera
   * (200, 403 o 400), así que se lo pasa y el helper lo afirma él mismo.
   */
  async function resumen(
    token: string,
    query: Record<string, string> = {},
    esperado = 200,
  ): Promise<ResumenAnulaciones> {
    const qs = new URLSearchParams(query).toString();
    const res = await request(app.getHttpServer())
      .get(`/api/salones/anulaciones/resumen${qs ? `?${qs}` : ''}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(esperado);
    return res.body as ResumenAnulaciones;
  }

  /**
   * `desde`/`hasta` son obligatorios en `/resumen` desde la ronda de fix 1
   * (tope de 366 días, spec § 5.1). Una ventana de ±3 días alrededor de
   * "ahora" cubre cualquier fixture que este archivo cree en su propia
   * corrida sin acercarse al tope, sea cual sea la zona horaria del tenant.
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
    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenEncargado = await entrar(app, ENCARGADO.email, ENCARGADO.pass);
    tokenSoloOperar = await entrar(app, SOLO_OPERAR.email, SOLO_OPERAR.pass);

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resMotivos.status).toBe(200);
    const motivos = resMotivos.body as MotivoBajaItem[];
    motivoMermaId = motivos.find((m) => m.tipo === 'merma')!.id;
    motivoCortesiaId = motivos.find((m) => m.tipo === 'cortesia')!.id;
    motivoNoElaboradoId = motivos.find((m) => m.tipo === 'no_elaborado')!.id;
    expect(motivoMermaId).toBeTruthy();
    expect(motivoCortesiaId).toBeTruthy();
    expect(motivoNoElaboradoId).toBeTruthy();

    marca = Date.now();

    // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
    // `cantidadEnviada` — mismo molde que `salones-anular-linea.e2e-spec.ts`.
    const cocinaId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina reporte-anulaciones E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-reporte-anulaciones-e2e-${marca}`,
      })
    ).id;
    catCocinaId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Cocina reporte-anulaciones E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;

    // Garzones PROPIOS: la sesión es única por garzón.
    garzon1 = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón reporte-anulaciones-1 E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon1.id,
      pin: garzon1.pin,
      turnoId: TURNO_MANANA_ID,
    });
    garzon2 = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón reporte-anulaciones-2 E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon2.id,
      pin: garzon2.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón reporte-anulaciones E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa reporte-anulaciones',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    const limpiar = async (que: string, ejecutar: () => Promise<number>) => {
      try {
        const status = await ejecutar();
        if (![200, 201].includes(status)) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };

    try {
      await limpiar(
        'cerrar sesión garzón 1',
        async () =>
          (
            await request(app.getHttpServer())
              .post('/api/sesiones-garzon/cerrar')
              .set('Authorization', `Bearer ${tokenAdmin}`)
              .send({ garzonId: garzon1.id, pin: garzon1.pin })
          ).status,
      );
      await limpiar(
        'cerrar sesión garzón 2',
        async () =>
          (
            await request(app.getHttpServer())
              .post('/api/sesiones-garzon/cerrar')
              .set('Authorization', `Bearer ${tokenAdmin}`)
              .send({ garzonId: garzon2.id, pin: garzon2.pin })
          ).status,
      );
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('el permiso rige: 403 sin `Ver todas` (ana.torres), 200 con el encargado y con el admin', async () => {
    const rechazado = await reporte(tokenSoloOperar);
    expect(rechazado.status).toBe(403);

    const conEncargado = await reporte(tokenEncargado);
    expect(conEncargado.status).toBe(200);
    expect(Array.isArray(conEncargado.body.data)).toBe(true);

    const conAdmin = await reporte(tokenAdmin);
    expect(conAdmin.status).toBe(200);
  });

  it('el permiso rige también en `/resumen`: 403 sin `Ver todas`, 200 con el encargado y con el admin', async () => {
    // Sin `desde`/`hasta`: el guard de permiso corre ANTES que el pipe de
    // validación, así que el 403 tiene que llegar igual, sin rango.
    await resumen(tokenSoloOperar, {}, 403);

    const conEncargado = await resumen(tokenEncargado, rangoAmplio());
    expect(Array.isArray(conEncargado.porTipo)).toBe(true);
    expect(Array.isArray(conEncargado.porGarzon)).toBe(true);
    expect(Array.isArray(conEncargado.porAutorizo)).toBe(true);

    await resumen(tokenAdmin, rangoAmplio());
  });

  it('`/resumen` exige `desde`/`hasta` y acota el rango a 366 días (ronda de fix 1)', async () => {
    await resumen(tokenEncargado, {}, 400);

    const desde = '2026-01-01';
    // 367 días después: uno más que el tope de 366 (spec § 5.1, mismo tope
    // que `propinas`).
    const hasta = new Date(
      Date.parse(`${desde}T00:00:00.000Z`) + 367 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    await resumen(tokenEncargado, { desde, hasta }, 400);

    // El mismo día en las dos puntas es válido (`hasta` es inclusivo acá, a
    // diferencia de `propinas`): no debe rechazarlo.
    const hoy = new Date().toISOString().slice(0, 10);
    await resumen(tokenEncargado, { desde: hoy, hasta: hoy }); // default 200
  });

  it('cortesía, merma y no_elaborado: cada fila con su precioCarta, costoEstado y costo esperado (calculados a mano)', async () => {
    const platoCortesia = (
      await post<IdResponse>('/api/items', {
        nombre: `Cortesía reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '7300',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '2150',
        categoriaId: catCocinaId,
      })
    ).id;
    const platoMerma = (
      await post<IdResponse>('/api/items', {
        nombre: `Merma reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '5400',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '1800',
        categoriaId: catCocinaId,
      })
    ).id;
    const platoNoElaborado = (
      await post<IdResponse>('/api/items', {
        nombre: `No-elaborado reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '4200',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '900',
        categoriaId: catCocinaId,
      })
    ).id;

    const cuenta = await abrirCuentaCon(
      [
        { itemId: platoCortesia, cantidad: '2' },
        { itemId: platoMerma, cantidad: '3' },
        { itemId: platoNoElaborado, cantidad: '4' },
      ],
      garzon1,
    );
    await despachar(cuenta.id);
    const antesDeAnular = await detalleCuenta(cuenta.id);
    const lineaCortesia = antesDeAnular.lineas.find(
      (l) => l.itemId === platoCortesia,
    )!;
    const lineaMerma = antesDeAnular.lineas.find(
      (l) => l.itemId === platoMerma,
    )!;
    const lineaNoElaborado = antesDeAnular.lineas.find(
      (l) => l.itemId === platoNoElaborado,
    )!;

    const tras1 = await anular(cuenta.id, lineaCortesia.id, {
      cantidad: '2',
      motivoBajaId: motivoCortesiaId,
    });
    const anulacionCortesiaId = tras1.anulaciones.find(
      (a) => a.itemId === platoCortesia,
    )!.id;
    const tras2 = await anular(cuenta.id, lineaMerma.id, {
      cantidad: '3',
      motivoBajaId: motivoMermaId,
    });
    const anulacionMermaId = tras2.anulaciones.find(
      (a) => a.itemId === platoMerma,
    )!.id;
    const tras3 = await anular(cuenta.id, lineaNoElaborado.id, {
      cantidad: '4',
      motivoBajaId: motivoNoElaboradoId,
    });
    const anulacionNoElaboradoId = tras3.anulaciones.find(
      (a) => a.itemId === platoNoElaborado,
    )!.id;

    const res = await reporte(tokenEncargado, { garzonId: garzon1.id });
    expect(res.status).toBe(200);
    const filas = res.body.data;

    const filaCortesia = filas.find((f) => f.id === anulacionCortesiaId)!;
    expect(filaCortesia).toBeDefined();
    expect(filaCortesia.tipo).toBe('cortesia');
    expect(filaCortesia.precioCarta).toBe(
      new Decimal('2').mul(lineaCortesia.precioUnitario).toFixed(4),
    );
    expect(filaCortesia.costoEstado).toBe('valorizado');
    expect(filaCortesia.costo).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '4300.0000' }, // 2 × 2150
    ]);

    const filaMerma = filas.find((f) => f.id === anulacionMermaId)!;
    expect(filaMerma).toBeDefined();
    expect(filaMerma.tipo).toBe('merma');
    expect(filaMerma.precioCarta).toBe(
      new Decimal('3').mul(lineaMerma.precioUnitario).toFixed(4),
    );
    expect(filaMerma.costoEstado).toBe('valorizado');
    expect(filaMerma.costo).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '5400.0000' }, // 3 × 1800
    ]);

    const filaNoElaborado = filas.find((f) => f.id === anulacionNoElaboradoId)!;
    expect(filaNoElaborado).toBeDefined();
    expect(filaNoElaborado.tipo).toBe('no_elaborado');
    expect(filaNoElaborado.precioCarta).toBe(
      new Decimal('4').mul(lineaNoElaborado.precioUnitario).toFixed(4),
    );
    expect(filaNoElaborado.costoEstado).toBe('no_aplica');
    expect(filaNoElaborado.costo).toEqual([]);

    // Sanity de los JOINs: la mesa/salón/cuenta que se ven son los propios.
    expect(filaCortesia.mesaNombre).toBe('Mesa reporte-anulaciones');
    expect(filaCortesia.cuentaId).toBe(cuenta.id);
    expect(typeof filaCortesia.cuentaNumero).toBe('number');
  });

  it('un plato SIN costo cargado anulado como merma → sin_valorizar, costo []', async () => {
    const platoSinCosto = (
      await post<IdResponse>('/api/items', {
        nombre: `Sin costo reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        // Sin `costo`: `item_producto.costo_actual` queda NULL.
        categoriaId: catCocinaId,
      })
    ).id;

    const cuenta = await abrirCuentaCon(
      [{ itemId: platoSinCosto, cantidad: '2' }],
      garzon1,
    );
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoSinCosto,
    )!;

    const detalle = await anular(cuenta.id, linea.id, {
      cantidad: '2',
      motivoBajaId: motivoMermaId,
    });
    const anulacionId = detalle.anulaciones.find(
      (a) => a.itemId === platoSinCosto,
    )!.id;

    const res = await reporte(tokenEncargado, { garzonId: garzon1.id });
    expect(res.status).toBe(200);
    const fila = res.body.data.find((f) => f.id === anulacionId)!;
    expect(fila).toBeDefined();
    expect(fila.costoEstado).toBe('sin_valorizar');
    expect(fila.costo).toEqual([]);
  });

  it('anular y DESPUÉS transferir la cuenta a otro garzón: la fila sigue con el garzón original', async () => {
    const platoTransfer = (
      await post<IdResponse>('/api/items', {
        nombre: `Transfer reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '2600',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '1200',
        categoriaId: catCocinaId,
      })
    ).id;
    // Segundo ítem que se queda VIVO en la cuenta: sin él, anular el único
    // ítem cancela la cuenta entera (spec § 7 del frente anterior) y
    // `transferirCuentaPorPin` no tendría nada que transferir.
    const relleno = (
      await post<IdResponse>('/api/items', {
        nombre: `Relleno transfer reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '1500',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '500',
        categoriaId: catCocinaId,
      })
    ).id;

    const cuenta = await abrirCuentaCon(
      [
        { itemId: platoTransfer, cantidad: '2' },
        { itemId: relleno, cantidad: '1' },
      ],
      garzon1,
    );
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoTransfer,
    )!;

    const detalle = await anular(cuenta.id, linea.id, {
      cantidad: '2',
      motivoBajaId: motivoMermaId,
    });
    expect(detalle.estado).toBe('abierta'); // el relleno la mantiene abierta
    const anulacionId = detalle.anulaciones.find(
      (a) => a.itemId === platoTransfer,
    )!.id;

    // Transferencia PULL: se identifica el garzón DESTINO (garzon2).
    const transferida = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuenta.id}/transferir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId: garzon2.id, pin: garzon2.pin });
    expect(transferida.status).toBe(201);
    expect((transferida.body as CuentaDetalle).id).toBe(cuenta.id);

    const res = await reporte(tokenEncargado, { garzonId: garzon1.id });
    expect(res.status).toBe(200);
    const fila = res.body.data.find((f) => f.id === anulacionId)!;
    expect(fila).toBeDefined();
    expect(fila.garzonNombre).toBe(`Garzón reporte-anulaciones-1 E2E ${marca}`);

    // Y NO aparece bajo garzon2, aunque la cuenta ya sea suya.
    const resGarzon2 = await reporte(tokenEncargado, { garzonId: garzon2.id });
    expect(resGarzon2.status).toBe(200);
    expect(resGarzon2.body.data.some((f) => f.id === anulacionId)).toBe(false);
  });

  it('`cancelar-con-motivo` sobre una cuenta con algo despachado deja filas con precio y garzón', async () => {
    const platoCancelado = (
      await post<IdResponse>('/api/items', {
        nombre: `Cancelado reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '3300',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '1400',
        categoriaId: catCocinaId,
      })
    ).id;

    const cuenta = await abrirCuentaCon(
      [{ itemId: platoCancelado, cantidad: '2' }],
      garzon1,
    );
    await despachar(cuenta.id);

    // Motivo MERMA a propósito (no cortesía): así no contamina el filtro
    // `tipo=cortesia` del test de abajo.
    const detalle = await cancelarConMotivo(cuenta.id, motivoMermaId);
    expect(detalle.estado).toBe('cancelada');
    expect(detalle.anulaciones).toHaveLength(1);
    const anulacionId = detalle.anulaciones[0].id;

    const res = await reporte(tokenEncargado, { garzonId: garzon1.id });
    expect(res.status).toBe(200);
    const fila = res.body.data.find((f) => f.id === anulacionId)!;
    expect(fila).toBeDefined();
    expect(fila.tipo).toBe('merma');
    expect(fila.garzonNombre).toBe(`Garzón reporte-anulaciones-1 E2E ${marca}`);
    expect(new Decimal(fila.precioCarta).greaterThan(0)).toBe(true);
  });

  it('el filtro `tipo=cortesia` solo trae la cortesía; `garzonId` solo las del garzón', async () => {
    // Cuenta propia de garzon2, con su propia cortesía — así el filtro por
    // garzón se puede cruzar contra un segundo dueño real.
    const platoGarzon2 = (
      await post<IdResponse>('/api/items', {
        nombre: `Cortesía garzón-2 reporte E2E ${marca}`,
        tipo: 'producto',
        precioBase: '4100',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '1600',
        categoriaId: catCocinaId,
      })
    ).id;
    const cuentaG2 = await abrirCuentaCon(
      [{ itemId: platoGarzon2, cantidad: '3' }],
      garzon2,
    );
    await despachar(cuentaG2.id);
    const lineaG2 = (await detalleCuenta(cuentaG2.id)).lineas.find(
      (l) => l.itemId === platoGarzon2,
    )!;
    const detalleG2 = await anular(cuentaG2.id, lineaG2.id, {
      cantidad: '3',
      motivoBajaId: motivoCortesiaId,
    });
    const anulacionG2Id = detalleG2.anulaciones.find(
      (a) => a.itemId === platoGarzon2,
    )!.id;

    // `tipo=cortesia` + `garzonId=garzon1`: de todo lo que garzon1 acumuló en
    // los tests de arriba (cortesía, merma, no_elaborado, sin_valorizar,
    // transfer-merma, cancelar-con-motivo-merma), solo la cortesía.
    const soloCortesia = await reporte(tokenEncargado, {
      tipo: 'cortesia',
      garzonId: garzon1.id,
    });
    expect(soloCortesia.status).toBe(200);
    expect(soloCortesia.body.data.length).toBeGreaterThan(0);
    expect(soloCortesia.body.data.every((f) => f.tipo === 'cortesia')).toBe(
      true,
    );
    expect(
      soloCortesia.body.data.every((f) => f.garzonNombre?.includes('E2E')),
    ).toBe(true);
    expect(soloCortesia.body.data.some((f) => f.id === anulacionG2Id)).toBe(
      false,
    );

    // `garzonId=garzon2`: exactamente la fila que se acaba de crear.
    const soloGarzon2 = await reporte(tokenEncargado, {
      garzonId: garzon2.id,
    });
    expect(soloGarzon2.status).toBe(200);
    expect(soloGarzon2.body.data).toHaveLength(1);
    expect(soloGarzon2.body.data[0].id).toBe(anulacionG2Id);
    expect(soloGarzon2.body.data[0].garzonNombre).toBe(
      `Garzón reporte-anulaciones-2 E2E ${marca}`,
    );
  });

  it('receta con dos ingredientes de costo distinto, anulada como merma: costo = suma de los dos movimientos; el resumen coincide con la suma de las filas del listado', async () => {
    // Dos ingredientes, misma moneda (CLP), costos distintos a propósito: un
    // mutante que sumara solo uno de los dos, o que multiplicara por el
    // ingrediente equivocado, da otro número. Cantidades ≠ 1 en los dos ejes
    // (cantidad de la receta en la línea Y cantidad de cada ingrediente por
    // receta) por la misma razón.
    const ingredienteA = (
      await post<IdResponse>('/api/items', {
        nombre: `Ingrediente A reporte E2E ${marca}`,
        precioBase: '800',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '800',
      })
    ).id;
    const ingredienteB = (
      await post<IdResponse>('/api/items', {
        nombre: `Ingrediente B reporte E2E ${marca}`,
        precioBase: '650',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '650',
      })
    ).id;
    const platoReceta = (
      await post<IdResponse>('/api/items', {
        nombre: `Receta reporte E2E ${marca}`,
        precioBase: '9500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        categoriaId: catCocinaId,
        ingredientes: [
          {
            ingredienteItemId: ingredienteA,
            cantidad: '2',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
          {
            ingredienteItemId: ingredienteB,
            cantidad: '3',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      })
    ).id;

    const cuenta = await abrirCuentaCon(
      [{ itemId: platoReceta, cantidad: '2' }],
      garzon1,
    );
    await despachar(cuenta.id);
    const lineaReceta = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoReceta,
    )!;

    const detalle = await anular(cuenta.id, lineaReceta.id, {
      cantidad: '2',
      motivoBajaId: motivoMermaId,
    });
    const anulacionRecetaId = detalle.anulaciones.find(
      (a) => a.itemId === platoReceta,
    )!.id;

    // Por cada unidad de la receta anulada (2), se consume `cantidad` de cada
    // ingrediente: 2×2=4 de A (a 800) y 2×3=6 de B (a 650). Los dos
    // movimientos comparten `cuenta_linea_anulacion_id` y la misma moneda
    // (CLP), así que el costo de la fila es su SUMA, no uno de los dos.
    const costoEsperado = new Decimal('4')
      .mul('800')
      .plus(new Decimal('6').mul('650'))
      .toFixed(4); // 3200 + 3900 = 7100.0000

    const listado = await reporte(tokenEncargado, { garzonId: garzon1.id });
    expect(listado.status).toBe(200);
    const filaReceta = listado.body.data.find(
      (f) => f.id === anulacionRecetaId,
    )!;
    expect(filaReceta).toBeDefined();
    expect(filaReceta.precioCarta).toBe(
      new Decimal('2').mul(lineaReceta.precioUnitario).toFixed(4),
    );
    expect(filaReceta.costoEstado).toBe('valorizado');
    expect(filaReceta.costo).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: costoEsperado },
    ]);

    // La prueba de fondo: el resumen y el listado llevan el MISMO `garzonId`
    // — el resumen además lleva `rangoAmplio()` (±3 días) porque `desde`/
    // `hasta` son obligatorios ahí, el listado no lleva rango. Esa ventana
    // cubre TODO lo de este garzón porque es fresco de este mismo spec (todo
    // se crea segundos antes de leerlo): si no lo cubriera, el resumen
    // devolvería de menos y el test FALLARÍA al comparar contra la suma del
    // listado, no pasaría en falso. Se calcula acá sumando `listado.body.data`,
    // nunca copiando la respuesta del resumen (si divergen, uno de los dos
    // miente).
    const resumenGarzon1 = await resumen(tokenEncargado, {
      garzonId: garzon1.id,
      ...rangoAmplio(),
    });

    let platosEsperados = new Decimal(0);
    let precioCartaEsperado = new Decimal(0);
    let sinValorizarEsperado = 0;
    const costoPorMonedaEsperado = new Map<string, Decimal>();
    for (const fila of listado.body.data) {
      platosEsperados = platosEsperados.plus(fila.cantidad);
      precioCartaEsperado = precioCartaEsperado.plus(fila.precioCarta);
      if (fila.costoEstado === 'sin_valorizar') {
        sinValorizarEsperado += 1;
      } else {
        for (const c of fila.costo) {
          costoPorMonedaEsperado.set(
            c.monedaId,
            (costoPorMonedaEsperado.get(c.monedaId) ?? new Decimal(0)).plus(
              c.monto,
            ),
          );
        }
      }
    }

    // `garzonId=garzon1.id` filtra a un solo garzón: un único grupo en `porGarzon`.
    expect(resumenGarzon1.porGarzon).toHaveLength(1);
    const grupoGarzon1 = resumenGarzon1.porGarzon[0];
    expect(grupoGarzon1.garzonId).toBe(garzon1.id);
    expect(grupoGarzon1.platos).toBe(platosEsperados.toFixed(4));
    expect(grupoGarzon1.precioCarta).toBe(precioCartaEsperado.toFixed(4));
    expect(grupoGarzon1.sinValorizar).toBe(sinValorizarEsperado);
    expect(grupoGarzon1.costo).toEqual(
      [...costoPorMonedaEsperado].map(([monedaId, monto]) => ({
        monedaId,
        monto: monto.toFixed(4),
      })),
    );
    // Y el aporte de ESTA fila realmente entró a la suma (no es un cruce que
    // pasa de casualidad porque ambos lados están vacíos).
    expect(
      new Decimal(costoEsperado).lessThanOrEqualTo(
        costoPorMonedaEsperado.get(CLP_MONEDA_ID) ?? new Decimal(0),
      ),
    ).toBe(true);
  });

  /**
   * Aislamiento por tenant. `loginSegundoTenant` (Demo Bodega, …440040) no
   * sirve acá: ese tenant NO contrata el módulo `Salones` desde el
   * 2026-08-22 (`seeder.service.ts → seedTenantModulo`, comentario en el
   * código), así que su admin recibiría 403 por el módulo, no un 200 vacío —
   * probaría otra cosa. Se prueba en la dirección que sí se puede armar sin
   * tocar el seed: una fila REAL de `cuenta_linea_anulaciones` insertada por
   * SQL directo en el otro tenant (mismo criterio que el test de aislamiento
   * de `salones-anular-linea.e2e-spec.ts` — no hay camino de API para crear
   * un recurso en un tenant al que este token no pertenece) no aparece en el
   * reporte de Paris.
   */
  it('aislamiento: una fila de OTRO tenant no aparece en el reporte de Paris', async () => {
    const OTRO_TENANT = '550e8400-e29b-41d4-a716-446655440040'; // Demo Bodega
    const marcaAjena = `Ajena reporte E2E ${marca}`;

    const usuarioAjeno: { usuario_id: string }[] = await ds.query(
      `SELECT usuario_id FROM usuarios WHERE correo = 'admin@sistema.com'`,
    );
    const itemAjeno: { item_id: string }[] = await ds.query(
      `SELECT item_id FROM items WHERE tenant_id = $1 AND eliminado_el IS NULL LIMIT 1`,
      [OTRO_TENANT],
    );
    const motivoAjeno: { motivo_baja_id: string }[] = await ds.query(
      `SELECT motivo_baja_id FROM motivo_baja WHERE tenant_id = $1 AND eliminado_el IS NULL LIMIT 1`,
      [OTRO_TENANT],
    );
    expect(usuarioAjeno[0]).toBeDefined();
    expect(itemAjeno[0]).toBeDefined();
    expect(motivoAjeno[0]).toBeDefined();

    await ds.query(
      `WITH s AS (
         INSERT INTO salones (tenant_id, nombre) VALUES ($1, $2)
         RETURNING salon_id
       ), m AS (
         INSERT INTO mesas (tenant_id, salon_id, nombre)
         SELECT $1, salon_id, $2 FROM s
         RETURNING mesa_id
       ), c AS (
         INSERT INTO cuentas (tenant_id, mesa_id, numero, estado)
         SELECT $1, mesa_id, 1, 'abierta' FROM m
         RETURNING cuenta_id
       ), cl AS (
         INSERT INTO cuenta_lineas (
           tenant_id, cuenta_id, item_id, cantidad, cantidad_enviada,
           precio_unitario, precio_unitario_origen, tasa_cambio, reglas_congeladas
         )
         SELECT $1, cuenta_id, $3, '1', '1', '1000', '1000', '1', '{}'::jsonb FROM c
         RETURNING cuenta_linea_id, cuenta_id
       )
       INSERT INTO cuenta_linea_anulaciones (
         tenant_id, cuenta_id, cuenta_linea_id, item_id, item_nombre,
         precio_unitario, cantidad, motivo_baja_id, autorizado_por, garzon_id
       )
       SELECT $1, cl.cuenta_id, cl.cuenta_linea_id, $3, $4, '1000', '1', $5, $6, NULL
       FROM cl`,
      [
        OTRO_TENANT,
        `Ajena reporte E2E ${marca}`,
        itemAjeno[0].item_id,
        marcaAjena,
        motivoAjeno[0].motivo_baja_id,
        usuarioAjeno[0].usuario_id,
      ],
    );

    // Confirma la premisa contra la base: la fila ajena existe de verdad.
    const existeAjena: { total: string }[] = await ds.query(
      `SELECT COUNT(*)::text AS total FROM cuenta_linea_anulaciones
        WHERE tenant_id = $1 AND item_nombre = $2`,
      [OTRO_TENANT, marcaAjena],
    );
    expect(existeAjena[0].total).toBe('1');

    const res = await reporte(tokenAdmin);
    expect(res.status).toBe(200);
    expect(res.body.data.some((f) => f.itemNombre === marcaAjena)).toBe(false);
  });
});
