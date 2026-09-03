import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * E2E del motor de promociones (Task 9 del plan `2026-08-27-motor-promociones`).
 *
 * ⚠️ CORRIDA DIFERIDA: este archivo se escribió con el stack Docker ocupado por
 * otra sesión — no se ejecutó (`./scripts/reset-db.sh` + `jest --config
 * test/jest-e2e.json test/promociones.e2e-spec.ts`) contra Postgres real. La
 * fidelidad es estática: moldes copiados de specs existentes (login,
 * `app.close()` en `finally`, garzón propio, `liberarCajero`-style cleanup) y
 * los endpoints/DTOs se leyeron del código commiteado, no del plan. Los
 * supuestos que solo la corrida real puede confirmar están anotados en
 * `docs/superpowers/sdd/2026-08-27-motor-promociones/task-9-report.md`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

// Admin del tenant Paris: rol Administrador, es_fijo=true → short-circuit de
// permisos, incluye TenantAdminGuard.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
// Vendedor: sin admin del tenant — el arnés de "escritura no-admin → 403".
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

// Tipo sembrado (`seeder.service.ts` → `seedTiposRegla`): descuento `directo`,
// solo exige su valor. Reusado en reglas-valor.e2e-spec.ts, calculo-precios.e2e-spec.ts.
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
// "Boleta" — tipo de documento sembrado, mismo id que usa caja.e2e-spec.ts.
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
// "Efectivo" — método de pago sembrado, mismo id que usa caja.e2e-spec.ts.
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

// Rango de fechas ancho a propósito: no depende de en qué fecha corra la
// suite (la corrida queda diferida, potencialmente lejos de hoy).
const FECHA_INICIO_AMPLIA = '2020-01-01';
const FECHA_FIN_AMPLIA = '2035-12-31';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface CajaResponse {
  id: string;
  estado?: string;
}
interface ScopeResponse {
  id: string;
  tipoScope: string;
  categoriaId: string | null;
  cantidad: number;
  itemIds: string[];
}
interface PromocionResponse {
  id: string;
  nombre: string;
  activo: boolean;
  tipo: string;
  valorPorcentaje: string | null;
  cadaN: number | null;
  valorMonto: string | null;
  scopes: ScopeResponse[];
}
interface AdvertenciaResponse {
  titulo: string;
  detalle: string;
}
interface TrazaPromoResponse {
  id: string;
  nombre: string;
  tipo: string;
  monto: string;
  valorEfectivo: string;
  aplicacion: number;
}
interface ResultadoLineaResponse {
  advertencias: AdvertenciaResponse[];
  trazas: { promociones: TrazaPromoResponse[] };
}
interface ResultadoVentaResponse {
  lineas: ResultadoLineaResponse[];
  totales: {
    subtotalNeto: string;
    totalDescuentos: string;
    totalRecargos: string;
    totalImpuestos: string;
    totalFinal: string;
  };
  advertencias: AdvertenciaResponse[];
  advertenciasVenta: AdvertenciaResponse[];
}
interface VentaDetalleLinea {
  id: string;
  itemId: string;
  descuentoAplicado: string;
  totalLinea: string;
}
interface VentaCreateResponse {
  id: string;
  estado: string;
  canal: string;
  totalBruto: string;
  totalDescuentos: string;
  totalRecargos: string;
  totalImpuestos: string;
  totalFinal: string;
  detalles: VentaDetalleLinea[];
}
interface VentaDescuentoResponse {
  id: string;
  descuentoId: string;
  detalleId: string;
  valorAplicado: string;
}
interface VentaPromocionResponse {
  id: string;
  detalleId: string;
  promocionId: string;
  nombre: string;
  tipo: string;
  valorEfectivo: string;
  monto: string;
}
interface VentaDetalleResponse extends VentaCreateResponse {
  totalFinal: string;
  configCalculo: { promosAcumulanDescuentos: boolean } | null;
  descuentos: VentaDescuentoResponse[];
  promociones: VentaPromocionResponse[];
}
interface PreferenciasFinancieras {
  calculoDescuentos: string;
  calculoRecargos: string;
  formula: string[];
  escalaCalculo: number;
  modoRedondeo: string;
  nivelRedondeo: string;
  montoTolerancia: string;
  umbralDescuadreAviso: string;
  umbralDescuadreAlto: string;
  promosAcumulanDescuentos: boolean;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
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

/** `Intl` con la MISMA forma que `instanteLocalEnZona` (`rango-fecha.util.ts`):
 * `'HH:mm'` de 24 horas, `hourCycle: 'h23'` explícito. */
function horaHHmm(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instante);
}

describe('Motor de promociones (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let ds: DataSource;
  let cajaFisicaId: string;

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
    token = tokenAdmin,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  /** Ítem sin stock que consumir (`tipo: 'servicio'`): aísla estos tests del
   * caveat de polución de stock acumulado entre corridas de e2e locales
   * (`docs/agent/pendientes.md`). */
  const crearItem = (
    nombre: string,
    extra: Record<string, unknown> = {},
  ): Promise<IdResponse> =>
    post<IdResponse>('/api/items', {
      nombre,
      tipo: 'servicio',
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      ...extra,
    });

  const crearPromo = (
    nombre: string,
    extra: Record<string, unknown>,
    esperado = 201,
  ): Promise<PromocionResponse> =>
    post<PromocionResponse>(
      '/api/promociones',
      {
        nombre,
        tipo: 'porcentaje',
        fechaInicio: FECHA_INICIO_AMPLIA,
        fechaFin: FECHA_FIN_AMPLIA,
        ...extra,
      },
      esperado,
    );

  const calcular = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(body);

  const crearVenta = (body: Record<string, unknown>, token = tokenAdmin) =>
    request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoDocumentoId: BOLETA_ID, ...body });

  const detalleVenta = async (
    ventaId: string,
  ): Promise<VentaDetalleResponse> => {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return res.body as VentaDetalleResponse;
  };

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenVendedor = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);

    // Caja física ÚNICA para toda la suite: todos los describes que cobran
    // canal='fisico' (aplica-y-congela, previsualización=venta, salón,
    // interruptor, góndola) la comparten. Tolerante a un 409 residual (misma
    // higiene que `abrirOReusarCaja` en caja.e2e-spec.ts): si admin.paris ya
    // tiene una caja abierta de una corrida anterior abortada, se reusa.
    const disp = await request(app.getHttpServer())
      .get('/api/caja/cajones-disponibles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(disp.status).toBe(200);
    const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;
    expect(cajonId).toBeTruthy();

    const abrir = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cajonId,
        saldoInicial: '0',
        comentario: 'Apertura E2E promociones',
      });
    if (abrir.status === 201) {
      cajaFisicaId = (abrir.body as CajaResponse).id;
    } else {
      const activa = await request(app.getHttpServer())
        .get('/api/caja/activa')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(activa.status).toBe(200);
      cajaFisicaId = (activa.body as CajaResponse).id;
    }
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar (molde `vigencia-cuenta.e2e-spec.ts`): si un
    // paso de limpieza falla, los que siguen igual tienen que correr, y el
    // `close` va en un `finally` — nunca antes de intentar cerrar la caja.
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
      // Ninguna venta de esta suite registró pagos (todas quedan `pendiente`,
      // el punto era leer los totales congelados, no cobrar) salvo la de
      // canal online, que cae en la caja VIRTUAL, no en esta. El efectivo
      // esperado sigue en 0.
      await limpiar('cerrar caja física', async () => {
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaFisicaId}/conteo`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
        if (![200, 201].includes(conteo.status)) return conteo.status;
        if ((conteo.body as { estado?: string }).estado !== 'en_conciliacion') {
          return 200;
        }
        // Sin aserción: este helper DEVUELVE el status en vez de afirmarlo (mirá
        // el `return conteo.status` de arriba), y quien lo llama decide.
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        // status-tolerante: el helper DEVUELVE el status en vez de afirmarlo; decide el llamador
        const motivoId = (motivos.body as { id: string }[])[0]?.id;
        return (
          await request(app.getHttpServer())
            .post(`/api/caja/${cajaFisicaId}/cerrar`)
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

  // ─── 1. CRUD ────────────────────────────────────────────────────────────

  describe('CRUD', () => {
    let categoriaId: string;

    beforeAll(async () => {
      categoriaId = (
        await post<IdResponse>('/api/categorias', {
          nombre: `Categoría promo E2E ${Date.now()}`,
        })
      ).id;
    });

    it('crear un `porcentaje` con scope categoría → 201, y el GET la lista con sus scopes', async () => {
      const nombre = `Promo categoría E2E ${Date.now()}`;
      const creada = await crearPromo(nombre, {
        valorPorcentaje: '0.15',
        scopes: [{ tipoScope: 'categoria', categoriaId }],
      });
      expect(creada.scopes).toHaveLength(1);
      expect(creada.scopes[0].tipoScope).toBe('categoria');
      expect(creada.scopes[0].categoriaId).toBe(categoriaId);

      const listado = await request(app.getHttpServer())
        .get('/api/promociones')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(listado.status).toBe(200);
      const fila = (listado.body as PromocionResponse[]).find(
        (p) => p.id === creada.id,
      );
      expect(fila).toBeDefined();
      expect(fila!.scopes).toHaveLength(1);
      expect(fila!.scopes[0].categoriaId).toBe(categoriaId);
    });

    it('sin fechaFin → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/promociones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: `Promo sin fechaFin E2E ${Date.now()}`,
          tipo: 'porcentaje',
          fechaInicio: FECHA_INICIO_AMPLIA,
          valorPorcentaje: '0.10',
          scopes: [{ tipoScope: 'categoria', categoriaId }],
        });
      expect(res.status).toBe(400);
    });

    it('escritura con token no-admin → 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/promociones')
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({
          nombre: `Promo vendedor E2E ${Date.now()}`,
          tipo: 'porcentaje',
          fechaInicio: FECHA_INICIO_AMPLIA,
          fechaFin: FECHA_FIN_AMPLIA,
          valorPorcentaje: '0.10',
          scopes: [{ tipoScope: 'categoria', categoriaId }],
        });
      expect(res.status).toBe(403);
    });

    it('lectura con token común → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/promociones')
        .set('Authorization', `Bearer ${tokenVendedor}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── 2. Aplica y congela ────────────────────────────────────────────────

  describe('Aplica y congela', () => {
    let itemId: string;
    let promoId: string;
    let promoNombre: string;
    let ventaId: string;

    beforeAll(async () => {
      const marca = Date.now();
      itemId = (
        await crearItem(`Item congela E2E ${marca}`, {
          clasificacionTributaria: 'exento',
        })
      ).id;
      promoNombre = `Promo congela E2E ${marca}`;
      const promo = await crearPromo(promoNombre, {
        valorPorcentaje: '0.10',
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });
      promoId = promo.id;
    });

    it('POST /ventas: totalDescuentos refleja el 10% y GET /ventas/:id muestra promociones[] con nombre y monto', async () => {
      const res = await crearVenta({
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(res.status).toBe(201);
      const venta = res.body as VentaCreateResponse;
      ventaId = venta.id;

      // Ítem exento a $1.000, promo 10% → descuento neto = 100, sin impuesto
      // de por medio.
      expect(Number(venta.totalDescuentos)).toBe(100);
      expect(Number(venta.detalles[0].descuentoAplicado)).toBe(100);

      const detalle = await detalleVenta(ventaId);
      expect(Number(detalle.totalDescuentos)).toBe(100);
      expect(detalle.promociones).toHaveLength(1);
      expect(detalle.promociones[0].nombre).toBe(promoNombre);
      expect(Number(detalle.promociones[0].monto)).toBe(100);
      expect(detalle.promociones[0].promocionId).toBe(promoId);
    });

    it('editar la promo al 20% después NO cambia la venta ya emitida', async () => {
      const editar = await request(app.getHttpServer())
        .patch(`/api/promociones/${promoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ valorPorcentaje: '0.20' });
      expect(editar.status).toBe(200);

      const detalle = await detalleVenta(ventaId);
      expect(Number(detalle.totalDescuentos)).toBe(100);
      expect(Number(detalle.promociones[0].monto)).toBe(100);

      // Ancla positiva: una venta NUEVA sí ve el 20% — sin esto, el test de
      // arriba pasaría igual si el PATCH no hubiera escrito nada.
      const resNueva = await crearVenta({
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(resNueva.status).toBe(201);
      expect(
        Number((resNueva.body as VentaCreateResponse).totalDescuentos),
      ).toBe(200);
    });
  });

  // ─── 3. Previsualización = venta ────────────────────────────────────────

  describe('Previsualización = venta', () => {
    it('POST /calculo-precios/calcular con las mismas líneas → mismos totales que la venta', async () => {
      const marca = Date.now();
      const itemId = (
        await crearItem(`Item preview E2E ${marca}`, {
          precioBase: '1500',
          clasificacionTributaria: 'exento',
        })
      ).id;
      await crearPromo(`Promo preview E2E ${marca}`, {
        valorPorcentaje: '0.12',
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });

      const lineas = [{ itemId, cantidad: '1' }];

      const preview = await calcular({ lineas });
      expect(preview.status).toBe(201);
      const previewBody = preview.body as ResultadoVentaResponse;

      const res = await crearVenta({ lineas });
      expect(res.status).toBe(201);
      const venta = res.body as VentaCreateResponse & { id: string };

      const detalle = await detalleVenta(venta.id);

      expect(Number(previewBody.totales.totalDescuentos)).toBe(
        Number(detalle.totalDescuentos),
      );
      expect(Number(previewBody.totales.totalFinal)).toBe(
        Number(detalle.totalFinal),
      );
    });
  });

  // ─── 4. 2x1 ──────────────────────────────────────────────────────────────

  describe('2x1 (nxm)', () => {
    it('cadaN=2 sobre 2 unidades descuenta el neto de la más barata; con 3, igual (grupo incompleto no suma)', async () => {
      const marca = Date.now();
      const itemId = (
        await crearItem(`Item 2x1 E2E ${marca}`, {
          precioBase: '1000',
          clasificacionTributaria: 'exento',
        })
      ).id;
      await crearPromo(`Promo 2x1 E2E ${marca}`, {
        tipo: 'nxm',
        valorPorcentaje: '1.0000',
        cadaN: 2,
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });

      const dosUnidades = await calcular({
        lineas: [{ itemId, cantidad: '2' }],
      });
      expect(dosUnidades.status).toBe(201);
      expect(
        Number(
          (dosUnidades.body as ResultadoVentaResponse).totales.totalDescuentos,
        ),
      ).toBe(1000);

      const tresUnidades = await calcular({
        lineas: [{ itemId, cantidad: '3' }],
      });
      expect(tresUnidades.status).toBe(201);
      expect(
        Number(
          (tresUnidades.body as ResultadoVentaResponse).totales.totalDescuentos,
        ),
      ).toBe(1000);
    });
  });

  // ─── 5. Franja horaria ───────────────────────────────────────────────────

  describe('Franja horaria', () => {
    it('franja que NO cubre ahora no descuenta; la misma promo editada para cubrir ahora sí', async () => {
      // Zona de la provincia del tenant (misma query que `zonaHorariaTenant`,
      // `rango-fecha.util.ts`): el instante de la línea se resuelve con
      // `Intl` sobre ESTA zona, no la del contenedor. Se computa acá en vez de
      // depender de `to_char(now())` de Postgres, que corre en la zona del
      // SERVIDOR de base de datos — la que le importa al evaluador es la de
      // la provincia.
      const zonaRows: { zona_horaria: string }[] = await ds.query(
        `SELECT pr.zona_horaria AS zona_horaria
           FROM tenants t
           JOIN provincia pr ON pr.provincia_id = t.provincia_id AND pr.eliminado_el IS NULL
           JOIN pais p ON p.pais_id = pr.pais_id AND p.eliminado_el IS NULL
          WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
        [PARIS_TENANT_ID],
      );
      const zona = zonaRows[0]?.zona_horaria;
      expect(zona).toBeTruthy();

      const ahora = new Date();
      // Franja FUERA: 2h a 3h desde ahora. Un offset de solo 2-3h nunca puede
      // envolver hasta incluir "ahora" (haría falta un salto de ~24h), así que
      // es seguro independientemente de si la franja cruza medianoche.
      const horaInicioFuera = horaHHmm(
        new Date(ahora.getTime() + 2 * 60 * 60 * 1000),
        zona,
      );
      const horaFinFuera = horaHHmm(
        new Date(ahora.getTime() + 3 * 60 * 60 * 1000),
        zona,
      );
      // Franja DENTRO: ±1h desde ahora — cubre "ahora" con margen para la
      // latencia entre construir la franja acá y que el server resuelva su
      // propio "ahora" al recibir el POST.
      const horaInicioDentro = horaHHmm(
        new Date(ahora.getTime() - 60 * 60 * 1000),
        zona,
      );
      const horaFinDentro = horaHHmm(
        new Date(ahora.getTime() + 60 * 60 * 1000),
        zona,
      );

      const marca = Date.now();
      const itemId = (
        await crearItem(`Item franja E2E ${marca}`, {
          precioBase: '1000',
          clasificacionTributaria: 'exento',
        })
      ).id;
      const promo = await crearPromo(`Promo franja E2E ${marca}`, {
        valorPorcentaje: '0.10',
        horaInicio: horaInicioFuera,
        horaFin: horaFinFuera,
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });

      const fueraDeVentana = await calcular({
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(fueraDeVentana.status).toBe(201);
      expect(
        Number(
          (fueraDeVentana.body as ResultadoVentaResponse).totales
            .totalDescuentos,
        ),
      ).toBe(0);

      const editar = await request(app.getHttpServer())
        .patch(`/api/promociones/${promo.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ horaInicio: horaInicioDentro, horaFin: horaFinDentro });
      expect(editar.status).toBe(200);

      const dentroDeVentana = await calcular({
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(dentroDeVentana.status).toBe(201);
      expect(
        Number(
          (dentroDeVentana.body as ResultadoVentaResponse).totales
            .totalDescuentos,
        ),
      ).toBe(100);
    });
  });

  // ─── 6. Cuenta de salón ──────────────────────────────────────────────────

  describe('Cuenta de salón', () => {
    const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
    interface GarzonCreado {
      id: string;
      pin: string;
    }
    interface CuentaDetalle {
      id: string;
    }

    let garzon: GarzonCreado;
    let mesaId: string;
    let itemId: string;
    let promoNombre: string;

    beforeAll(async () => {
      const marca = Date.now();

      // ⚠️ Garzón PROPIO, no el del seed: la sesión es única por garzón y el
      // estado se filtra de un spec al siguiente (`jest-e2e.json` corre con
      // `maxWorkers: 1`) — molde `salones-comanda.e2e-spec.ts` /
      // `vigencia-cuenta.e2e-spec.ts`.
      garzon = await post<GarzonCreado>('/api/garzones', {
        nombre: `Garzón promo E2E ${marca}`,
      });
      await post('/api/sesiones-garzon/iniciar', {
        garzonId: garzon.id,
        pin: garzon.pin,
        turnoId: TURNO_MANANA_ID,
      });

      const salonId = (
        await post<IdResponse>('/api/salones', {
          nombre: `Salón promo E2E ${marca}`,
        })
      ).id;
      mesaId = (
        await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: 'Mesa promo',
        })
      ).id;

      itemId = (
        await crearItem(`Item salón E2E ${marca}`, {
          clasificacionTributaria: 'exento',
        })
      ).id;
      promoNombre = `Promo salón E2E ${marca}`;
      await crearPromo(promoNombre, {
        valorPorcentaje: '0.10',
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });
    });

    afterAll(async () => {
      // El garzón es propio: dejar la sesión abierta no cambia el escenario
      // de nadie, pero se cierra igual para no ensuciar el historial de
      // turnos de la base de dev (higiene, no aserción — `try/finally` como
      // en `salones-comanda.e2e-spec.ts`).
      try {
        await request(app.getHttpServer())
          .post('/api/sesiones-garzon/cerrar')
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ garzonId: garzon.id, pin: garzon.pin });
      } catch {
        // best-effort
      }
    });

    it('abrir cuenta, agregar línea, cerrar → la venta lleva la promo vigente y la congela', async () => {
      const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
      await post(`/api/cuentas/${cuenta.id}/lineas`, {
        itemId,
        cantidad: '1',
      });

      // Cierra sin cobrar (pagos vacíos): alcanza para leer los totales
      // congelados — molde `vigencia-cuenta.e2e-spec.ts`.
      const cierre = await post<{ ventaId: string }>(
        `/api/cuentas/${cuenta.id}/cerrar`,
        { garzonId: garzon.id, pin: garzon.pin, pagos: [] },
      );

      const detalle = await detalleVenta(cierre.ventaId);
      expect(Number(detalle.totalDescuentos)).toBe(100);
      expect(detalle.promociones).toHaveLength(1);
      expect(detalle.promociones[0].nombre).toBe(promoNombre);
    });
  });

  // ─── 7. El interruptor ───────────────────────────────────────────────────

  describe('El interruptor (promosAcumulanDescuentos)', () => {
    let itemId: string;
    let descuentoId: string;
    let original: PreferenciasFinancieras;

    const getPrefs = async (): Promise<PreferenciasFinancieras> => {
      const res = await request(app.getHttpServer())
        .get('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      return res.body as PreferenciasFinancieras;
    };

    const putPrefs = (promosAcumulanDescuentos: boolean) =>
      request(app.getHttpServer())
        .put('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...original, promosAcumulanDescuentos });

    beforeAll(async () => {
      original = await getPrefs();

      const marca = Date.now();
      descuentoId = (
        await post<IdResponse>('/api/descuentos', {
          nombre: `Descuento interruptor E2E ${marca}`,
          tipoReglaId: TIPO_DESCUENTO_DIRECTO,
          modo: 'porcentaje',
          valorPorcentaje: '0.10',
        })
      ).id;
      itemId = (
        await crearItem(`Item interruptor E2E ${marca}`, {
          clasificacionTributaria: 'exento',
          descuentosIds: [descuentoId],
        })
      ).id;
      await crearPromo(`Promo interruptor E2E ${marca}`, {
        valorPorcentaje: '0.20',
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });
    });

    afterAll(async () => {
      // Preferencia GLOBAL del tenant: se restaura para no contaminar otras
      // suites que compartan la base (misma higiene que `arqueo_ciego` en
      // caja.e2e-spec.ts). Guardado: si el `beforeAll` murió ANTES de asignar
      // `original` (p. ej. el GET inicial falló), no hay nada que restaurar —
      // sin el guard, este `afterAll` tiraría `Cannot read properties of
      // undefined` y taparía el error real del `beforeAll`.
      if (original !== undefined) {
        const restaurar = await putPrefs(original.promosAcumulanDescuentos);
        expect(restaurar.status).toBe(200);
      }
    });

    it('default (no acumula): la venta aplica SOLO la promo, el descuento queda en 0 en la traza', async () => {
      const off = await putPrefs(false);
      expect(off.status).toBe(200);

      const res = await crearVenta({ lineas: [{ itemId, cantidad: '1' }] });
      expect(res.status).toBe(201);
      const venta = res.body as VentaCreateResponse;
      // Solo la promo (20% de 1.000 = 200): el descuento de catálogo pierde.
      expect(Number(venta.totalDescuentos)).toBe(200);

      const detalle = await detalleVenta(venta.id);
      expect(detalle.configCalculo?.promosAcumulanDescuentos).toBe(false);
      const trazaDescuento = detalle.descuentos.find(
        (d) => d.descuentoId === descuentoId,
      );
      expect(trazaDescuento).toBeDefined();
      expect(Number(trazaDescuento!.valorAplicado)).toBe(0);
      expect(detalle.promociones).toHaveLength(1);
      expect(Number(detalle.promociones[0].monto)).toBe(200);
    });

    it('con promosAcumulanDescuentos=true, otra venta aplica los dos y congela ese valor', async () => {
      const on = await putPrefs(true);
      expect(on.status).toBe(200);

      const res = await crearVenta({ lineas: [{ itemId, cantidad: '1' }] });
      expect(res.status).toBe(201);
      const venta = res.body as VentaCreateResponse;
      // Los dos: 10% (100) + 20% (200) = 300, contra la misma base neta.
      expect(Number(venta.totalDescuentos)).toBe(300);

      const detalle = await detalleVenta(venta.id);
      expect(detalle.configCalculo?.promosAcumulanDescuentos).toBe(true);
      const trazaDescuento = detalle.descuentos.find(
        (d) => d.descuentoId === descuentoId,
      );
      expect(Number(trazaDescuento!.valorAplicado)).toBe(100);
      expect(Number(detalle.promociones[0].monto)).toBe(200);
    });
  });

  // ─── 8. Canal ────────────────────────────────────────────────────────────

  describe('Canal', () => {
    it('promo canal=fisico no la aplica una venta online (caja virtual, pago completo)', async () => {
      const marca = Date.now();
      const itemId = (
        await crearItem(`Item canal E2E ${marca}`, {
          precioBase: '2000',
          clasificacionTributaria: 'exento',
        })
      ).id;
      await crearPromo(`Promo canal E2E ${marca}`, {
        valorPorcentaje: '0.15',
        canal: 'fisico',
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });

      // Ítem exento sin ninguna otra regla: el total online es exactamente
      // el precio de lista, así que el pago completo se puede fijar de
      // antemano sin necesidad de previsualizar — molde
      // `venta-total-cero.e2e-spec.ts` / `tienda-pasarela-demo.e2e-spec.ts`.
      const res = await crearVenta({
        canal: 'online',
        lineas: [{ itemId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000' }],
      });
      expect(res.status).toBe(201);
      const venta = res.body as VentaCreateResponse;
      expect(venta.canal).toBe('online');
      expect(Number(venta.totalDescuentos)).toBe(0);
      expect(Number(venta.totalFinal)).toBe(2000);
    });
  });

  // ─── 9. Pausa ────────────────────────────────────────────────────────────

  describe('Pausa', () => {
    it('promo activo=false no aplica y la respuesta NO trae advertencia nueva', async () => {
      const marca = Date.now();
      const itemId = (
        await crearItem(`Item pausa E2E ${marca}`, {
          precioBase: '500',
          clasificacionTributaria: 'exento',
        })
      ).id;
      const promo = await crearPromo(`Promo pausa E2E ${marca}`, {
        valorPorcentaje: '0.10',
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });

      const pausar = await request(app.getHttpServer())
        .patch(`/api/promociones/${promo.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activo: false });
      expect(pausar.status).toBe(200);

      const res = await calcular({ lineas: [{ itemId, cantidad: '1' }] });
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(Number(body.totales.totalDescuentos)).toBe(0);
      // A diferencia de un descuento pausado (que SÍ avisa "está en pausa y no
      // se aplicó"), una promo pausada ni siquiera llega al evaluador —
      // `cargarVigentes` la filtra por `activo = true` en SQL— así que no hay
      // nada que explicar en el ticket.
      expect(body.lineas[0].advertencias).toHaveLength(0);
      expect(body.advertencias).toHaveLength(0);
      expect(body.advertenciasVenta).toHaveLength(0);
    });
  });

  // ─── Extra (review del motor): góndola ──────────────────────────────────

  describe('Góndola (precio_incluye_impuesto) — casos exigidos por la review', () => {
    it('línea de góndola con promo 20%: el cliente paga etiqueta × 0,8 al peso', async () => {
      const marca = Date.now();
      // `precioIncluyeImpuesto: true` (afecto por default, sin especificarlo:
      // `items.service.ts` lo persiste `?? 'afecto'`) — necesario para que el
      // motor cierre "a góndola" (`cierraAGondola` exige `impuestosVigentes.length > 0`).
      const itemId = (
        await crearItem(`Item góndola E2E ${marca}`, {
          precioBase: '1000',
          precioIncluyeImpuesto: true,
        })
      ).id;
      await crearPromo(`Promo góndola E2E ${marca}`, {
        valorPorcentaje: '0.20',
        scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
      });

      const res = await crearVenta({ lineas: [{ itemId, cantidad: '1' }] });
      expect(res.status).toBe(201);
      const venta = res.body as VentaCreateResponse;
      // Etiqueta 1.000 × 0,8 = 800 EXACTO: el "cierre a góndola" deriva el
      // impuesto por resta contra el precio prometido, así que el resultado
      // no depende de la tasa de IVA del país — ver el docblock de
      // `cierraAGondola` en `calculo-precios.engine.ts`.
      expect(Number(venta.totalFinal)).toBe(800);
      expect(Number(venta.detalles[0].totalLinea)).toBe(800);

      const detalle = await detalleVenta(venta.id);
      expect(Number(detalle.totalFinal)).toBe(800);
    });

    it('combo de góndola (precio_fijo) aterriza EXACTO en su valorMonto', async () => {
      const marca = Date.now();
      const itemA = (
        await crearItem(`Góndola combo A E2E ${marca}`, {
          precioBase: '6000',
          precioIncluyeImpuesto: true,
        })
      ).id;
      const itemB = (
        await crearItem(`Góndola combo B E2E ${marca}`, {
          precioBase: '5000',
          precioIncluyeImpuesto: true,
        })
      ).id;
      // Σ etiquetas = 11.000; combo a 9.990 → descuento 1.010, repartido entre
      // las dos líneas (a prorrata del precio aportado) pero la SUMA de la
      // venta cierra exacta al valorMonto — es la garantía de diseño del
      // "ancla" del cierre a góndola, no una coincidencia de redondeo.
      await crearPromo(`Combo góndola E2E ${marca}`, {
        tipo: 'precio_fijo',
        valorMonto: '9990',
        scopes: [
          { tipoScope: 'items', itemIds: [itemA], cantidad: 1 },
          { tipoScope: 'items', itemIds: [itemB], cantidad: 1 },
        ],
      });

      const res = await crearVenta({
        lineas: [
          { itemId: itemA, cantidad: '1' },
          { itemId: itemB, cantidad: '1' },
        ],
      });
      expect(res.status).toBe(201);
      const venta = res.body as VentaCreateResponse;
      // (a) La garantía de diseño del owner: el TOTAL cierra exacto al
      // valorMonto del combo, en el dominio en que el cliente paga.
      expect(Number(venta.totalFinal)).toBe(9990);

      // (b) Identidad agregada entre los componentes que la propia respuesta
      // trae — ninguno se cuantiza aparte, se derivan (CLAUDE.md, motor de
      // precios). `toBeCloseTo` en vez de `===` exacto: la resta de strings
      // decimales vía `Number` puede arrastrar el error de representación
      // binaria de punto flotante en el último decimal, no un error del motor.
      const totalBruto = Number(venta.totalBruto);
      const totalDescuentos = Number(venta.totalDescuentos);
      const totalRecargos = Number(venta.totalRecargos);
      const totalImpuestos = Number(venta.totalImpuestos);
      expect(
        totalBruto - totalDescuentos + totalRecargos + totalImpuestos,
      ).toBeCloseTo(Number(venta.totalFinal), 4);

      // (c) `totalDescuentos` vive en NETO, no en el dominio de LISTA en el
      // que se prometió el combo (Σ etiquetas 11.000 − valorMonto 9.990 =
      // 1.010 DE LISTA): es justo el bug de dominios que el motor corrigió
      // (ver `promociones.evaluator.ts`, `LineaPromo.precioListaUnitario`),
      // así que afirmar `1010` acá lo reintroduciría en el test. Con IVA
      // 19% el neto sería ≈ 1010 / 1,19 ≈ 848, pero el número exacto depende
      // de cómo cuantiza cada línea por separado — lo único que este test
      // garantiza es que es positivo y estrictamente menor que el monto de
      // lista.
      expect(totalDescuentos).toBeGreaterThan(0);
      expect(totalDescuentos).toBeLessThan(1010);

      const detalle = await detalleVenta(venta.id);
      expect(Number(detalle.totalFinal)).toBe(9990);
    });
  });
});
