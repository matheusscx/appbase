import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';
import { loginSegundoTenant } from './helpers/segundo-tenant';
import { randomUUID } from 'node:crypto';
import { PasarelaOrden } from '../src/modules/pasarela/entities/pasarela-orden.entity';
import { TransaccionesService } from '../src/modules/pasarela/services/transacciones.service';
import { VentasReembolsoHandler } from '../src/modules/ventas/reembolso-callback.handler';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const SEGUNDO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
/** Turno de la mañana del seed — mismo que usa `salones-anular-linea.e2e-spec.ts`. */
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

interface TokenResponse {
  access_token: string;
}
interface CostoPorMonedaResp {
  monedaId: string;
  monto: string;
}
interface GrupoAnulacionResp {
  tipo: string;
  platos: string;
  precioCarta: string;
  costo: CostoPorMonedaResp[];
  sinValorizar: number;
}
interface ResumenMermasResp {
  cantidad: number;
  costo: CostoPorMonedaResp[];
  sinValorizar: number;
}
interface MasVendidoResp {
  itemId: string;
  itemNombre: string;
  cantidad: string;
  monto: string;
}
interface ResumenHoyResponse {
  fecha: string;
  ventas: {
    vendido: { hoy: string; semanaPasada: string; variacion: string | null };
    vendidoDesglose: { bruto: string; notasCredito: string };
    cobradoDesglose: { cobrado: string; devuelto: string };
    cobrado: { hoy: string; semanaPasada: string; variacion: string | null };
    cantidad: { hoy: number; semanaPasada: number; variacion: string | null };
    ticketPromedio: {
      hoy: string | null;
      semanaPasada: string | null;
      variacion: string | null;
    };
    porCanal: { fisico: string; online: string };
  };
  porCobrar: { cantidad: number; saldo: string };
  perdidas: {
    anulaciones: GrupoAnulacionResp[];
    mermas: ResumenMermasResp;
  };
  masVendidos: MasVendidoResp[];
}
interface LineaVentaResp {
  itemId: string;
  cantidad: string;
  totalLinea: string;
}
interface ConfigPasarelaRow {
  tenantPasarelaId: string;
  codigo: string;
}
interface ItemResponse {
  id: string;
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
interface UbicacionListada {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
}
interface CuentaLineaDetalle {
  id: string;
  itemId: string;
}
interface CuentaDetalle {
  id: string;
  estado: string;
  lineas: CuentaLineaDetalle[];
}
interface VentaCreadaResponse {
  id: string;
  estado: string;
  totalFinal: string;
}
interface AbonoResponse {
  venta: { id: string; estado: string; saldo: string };
}
interface RolResponse {
  id: string;
}
interface ModuloDisponibleResponse {
  moduloTenantId: string;
  nombre: string;
  permisos: { moduloAppPermisoId: string; permisoNombre: string }[];
}
interface AltaUsuarioResponse {
  usuarioId: string;
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

function correoNuevo(prefijo: string): string {
  return `${prefijo}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.cl`;
}

describe('Resumen del negocio (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let caja: CajaAbierta;
  let ds: DataSource;

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

    tokenAdmin = await login(app);
    caja = await abrirCaja(app, tokenAdmin, {
      saldoInicial: '10000.0000',
      comentario: 'Apertura E2E resumen-negocio',
    });
  }, 60000);

  afterAll(async () => {
    try {
      if (caja) await cerrarCaja(app, tokenAdmin, caja);
    } finally {
      await app.close();
    }
  });

  async function leerResumen(
    token: string,
    query = '',
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .get(`/api/resumen-negocio/hoy${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  /** `POST` genérico contra la API real, con el admin por defecto (mismo molde que `salones-anular-linea.e2e-spec.ts`). */
  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    token = tokenAdmin,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      // Una clave nueva por llamada: cada POST de este spec es un cobro distinto,
      // y los endpoints que cobran la exigen (Idempotency-Key).
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  /**
   * Por dónde vuelve la plata de una corrección: el único pago de la venta
   * (`devolucion.pagoId`). Toda corrección declara su vía; si el pago es en
   * efectivo, la plata sale de la caja física del que corrige.
   */
  async function devolucionDe(
    ventaId: string,
  ): Promise<{ devolucion: { pagoId: string } }> {
    const pagos: { pago_id: string }[] = await ds.query(
      `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    expect(pagos).toHaveLength(1);
    return { devolucion: { pagoId: pagos[0].pago_id } };
  }

  /**
   * Un usuario propio, con un rol propio que tiene `Ventas:Leer` y NADA de
   * `Resumen del negocio` — no lo hay en el seed (`seedRolesUsuarios`: el rol
   * "Vendedor" no tiene ningún permiso asignado), así que se arma por API,
   * igual que `permiso-operar-salon.e2e-spec.ts`. Cuenta propia y no
   * `vendedor.paris@paris.cl`: ese usuario lo comparten ~20 specs y sus
   * roles/permisos son estado que hereda todo el que se loguee con él
   * (`docs/patterns/backend.md` §7).
   */
  async function crearUsuarioSoloVentasLeer(): Promise<string> {
    const modulos = await request(app.getHttpServer())
      .get('/api/roles/modulos-disponibles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(modulos.status).toBe(200);
    const ventas = (modulos.body as ModuloDisponibleResponse[]).find(
      (m) => m.nombre === 'Ventas',
    );
    expect(ventas).toBeTruthy();
    const ventasLeer = ventas!.permisos.find((p) => p.permisoNombre === 'Leer');
    expect(ventasLeer).toBeTruthy();

    const rol = await request(app.getHttpServer())
      .post('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E solo Ventas Leer ${Date.now()}` });
    expect(rol.status).toBe(201);
    const rolId = (rol.body as RolResponse).id;

    const setPermisos = await request(app.getHttpServer())
      .put(`/api/roles/${rolId}/modules/${ventas!.moduloTenantId}/permissions`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ moduloAppPermisoIds: [ventasLeer!.moduloAppPermisoId] });
    expect(setPermisos.status).toBe(200);

    const correo = correoNuevo('resumen-negocio-sin-permiso');
    const alta = await request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Sin', apellido: 'Resumen', correo, rolIds: [rolId] });
    expect(alta.status).toBe(201);
    const usuarioId = (alta.body as AltaUsuarioResponse).usuarioId;

    // El token en claro no sale por la API: se emite uno propio con el mismo
    // servicio que usa producción (mismo camino que
    // `invitacion-y-reset.e2e-spec.ts`).
    const tokens = app.get(TokensAccesoService);
    const invitacion = await tokens.emitir(
      usuarioId,
      TipoTokenAcceso.INVITACION,
    );
    const contrasena = 'clave-e2e-resumen-negocio-1234';
    const elegir = await request(app.getHttpServer())
      .post(`/api/auth/invitacion/${invitacion}`)
      .send({ contrasena });
    expect(elegir.status).toBe(200);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: correo, password: contrasena });
    expect(loginRes.status).toBe(200);
    const suelto = (loginRes.body as TokenResponse).access_token;

    const enTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (loginRes.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set('Authorization', `Bearer ${suelto}`)
      .send({ tenantId: PARIS_TENANT_ID });
    expect(enTenant.status).toBe(200);
    return (enTenant.body as TokenResponse).access_token;
  }

  describe('permisos', () => {
    it('200 con el admin de Paris', async () => {
      const res = await leerResumen(tokenAdmin);
      expect(res.status).toBe(200);
      expect((res.body as ResumenHoyResponse).fecha).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    });

    it('403 con Ventas:Leer pero sin Resumen del negocio:Leer', async () => {
      const tokenSinPermiso = await crearUsuarioSoloVentasLeer();
      const res = await leerResumen(tokenSinPermiso);
      expect(res.status).toBe(403);
    });

    it('403 para el admin del segundo tenant, que no contrató el módulo', async () => {
      const tokenSegundoTenant = await loginSegundoTenant(app);
      const res = await leerResumen(tokenSegundoTenant);
      expect(res.status).toBe(403);
    });

    it('la ruta no acepta un tenant de afuera: ?tenantId=<otro> devuelve lo mismo que sin el parámetro', async () => {
      const sinQuery = await leerResumen(tokenAdmin);
      expect(sinQuery.status).toBe(200);
      const conQueryAjena = await leerResumen(
        tokenAdmin,
        `?tenantId=${SEGUNDO_TENANT_ID}`,
      );
      expect(conQueryAjena.status).toBe(200);
      expect(conQueryAjena.body).toEqual(sinQuery.body);
    });
  });

  describe('el delta, por el camino de la app', () => {
    let itemId: string;

    beforeAll(async () => {
      // Ítem propio con precio no redondo, para que A y B (cantidades
      // distintas) den totales distintos entre sí y frente al resto del seed.
      const item = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: `E2E Resumen Negocio ${Date.now()}`,
          precioBase: '1234',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      expect(item.status).toBe(201);
      itemId = (item.body as ItemResponse).id;
    });

    it('venta A pagada entera + venta B pendiente con abono parcial mueven vendido, cobrado, cantidad y por cobrar', async () => {
      const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

      // A: 1 unidad, se paga completa por `/api/pagos` (no en la misma
      // creación): así el total —que lo calcula el servidor— se lee de la
      // respuesta de la creación antes de armar el pago.
      const resA = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ lineas: [{ itemId, cantidad: '1' }] });
      expect(resA.status).toBe(201);
      const ventaA = resA.body as VentaCreadaResponse;
      expect(ventaA.estado).toBe('pendiente');

      const pagoA = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          ventaId: ventaA.id,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: ventaA.totalFinal }],
        });
      expect(pagoA.status).toBe(201);
      expect((pagoA.body as AbonoResponse).venta.estado).toBe('pagada');

      // B: 3 unidades (precio distinto de A), se abona una parte DISTINTA de
      // los dos totales.
      const resB = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ lineas: [{ itemId, cantidad: '3' }] });
      expect(resB.status).toBe(201);
      const ventaB = resB.body as VentaCreadaResponse;
      expect(ventaB.estado).toBe('pendiente');

      // CLP no tiene decimales: el abono se redondea hacia abajo para quedar
      // estrictamente bajo el total (nunca lo paga entero) y distinto de A.
      const abono = new Decimal(ventaB.totalFinal)
        .dividedBy(2)
        .toFixed(0, Decimal.ROUND_DOWN);
      expect(abono).not.toBe(ventaA.totalFinal);
      expect(abono).not.toBe(ventaB.totalFinal);

      const pagoB = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          ventaId: ventaB.id,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: abono }],
        });
      expect(pagoB.status).toBe(201);
      expect((pagoB.body as AbonoResponse).venta.estado).toBe('pagada_parcial');

      const despues = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;

      const totalAB = new Decimal(ventaA.totalFinal)
        .plus(ventaB.totalFinal)
        .toString();
      const cobradoEsperado = new Decimal(ventaA.totalFinal)
        .plus(abono)
        .toString();
      const saldoEsperado = new Decimal(ventaB.totalFinal)
        .minus(abono)
        .toString();

      expect(
        new Decimal(despues.ventas.vendido.hoy)
          .minus(antes.ventas.vendido.hoy)
          .toString(),
      ).toBe(totalAB);
      expect(despues.ventas.cantidad.hoy - antes.ventas.cantidad.hoy).toBe(2);
      expect(
        new Decimal(despues.ventas.cobrado.hoy)
          .minus(antes.ventas.cobrado.hoy)
          .toString(),
      ).toBe(cobradoEsperado);
      expect(despues.porCobrar.cantidad - antes.porCobrar.cantidad).toBe(1);
      expect(
        new Decimal(despues.porCobrar.saldo)
          .minus(antes.porCobrar.saldo)
          .toString(),
      ).toBe(saldoEsperado);
    });

    /** Venta de `cantidad` unidades del ítem propio, pagada entera (en efectivo si no se dice otro medio). El total lo calcula el servidor (puede llevar IVA): se lee de la respuesta. */
    async function crearVentaPagada(
      cantidad: string,
      metodoPagoId: string = EFECTIVO_ID,
    ): Promise<VentaCreadaResponse> {
      const resV = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ lineas: [{ itemId, cantidad }] });
      expect(resV.status).toBe(201);
      const venta = resV.body as VentaCreadaResponse;
      const pago = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          ventaId: venta.id,
          pagos: [{ metodoPagoId, monto: venta.totalFinal }],
        });
      expect(pago.status).toBe(201);
      return venta;
    }

    const delta = (a: string, b: string) => new Decimal(b).minus(a).toString();

    it('una NC de hoy sobre una venta de ayer resta del vendido de hoy, no de ayer, y no cuenta como venta', async () => {
      const venta = await crearVentaPagada('7');

      const conVentaHoy = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;

      // La venta pasa a ayer. No es un estado inventado: es el reloj. La app
      // no deja fechar una venta, y lo que se prueba es justamente que la NC
      // cuenta en SU día y no en el de la venta.
      const [movidas] = await ds.query<[unknown[], number]>(
        `UPDATE ventas SET fecha = fecha - interval '1 day'
          WHERE venta_id = $1 RETURNING venta_id`,
        [venta.id],
      );
      expect(movidas).toHaveLength(1);

      // Prueba de que el UPDATE sacó la venta de hoy: sin esto, el -3150 de
      // abajo saldría igual aunque el UPDATE no moviera nada, y el test no
      // distinguiría "la NC resta en SU fecha" de "la NC resta en la de la
      // venta que corrige".
      const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;
      expect(
        delta(
          conVentaHoy.ventas.vendidoDesglose.bruto,
          antes.ventas.vendidoDesglose.bruto,
        ),
      ).toBe(new Decimal(venta.totalFinal).negated().toString());
      expect(
        delta(conVentaHoy.ventas.vendido.hoy, antes.ventas.vendido.hoy),
      ).toBe(new Decimal(venta.totalFinal).negated().toString());

      const nc = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/notas-credito`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ monto: '3150', ...(await devolucionDe(venta.id)) });
      expect(nc.status).toBe(201);
      const despues = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;

      expect(delta(antes.ventas.vendido.hoy, despues.ventas.vendido.hoy)).toBe(
        '-3150',
      );
      expect(
        delta(
          antes.ventas.vendidoDesglose.bruto,
          despues.ventas.vendidoDesglose.bruto,
        ),
      ).toBe('0');
      expect(
        delta(
          antes.ventas.vendidoDesglose.notasCredito,
          despues.ventas.vendidoDesglose.notasCredito,
        ),
      ).toBe('3150');
      expect(despues.ventas.cantidad.hoy).toBe(antes.ventas.cantidad.hoy);
      expect(
        delta(antes.ventas.porCanal.fisico, despues.ventas.porCanal.fisico),
      ).toBe('-3150');
    });

    it('una venta y su NC de hace una semana: el vendido de la semana pasada es el neto y la cantidad cuenta la venta, no la NC', async () => {
      const venta = await crearVentaPagada('7');
      // 2870 no coincide con ningún otro monto del test ni con el total.
      const nc = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/notas-credito`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ monto: '2870', ...(await devolucionDe(venta.id)) });
      expect(nc.status).toBe(201);

      const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

      // La venta y su NC pasan a hace 7 días. No es un estado inventado: es el
      // reloj. La app no deja fechar una venta, y lo que se prueba es la
      // columna de la semana pasada, que ninguna venta de hoy alcanza.
      const [movidas] = await ds.query<[unknown[], number]>(
        `UPDATE ventas SET fecha = fecha - interval '7 days'
          WHERE venta_id = $1 OR venta_referencia_id = $1
      RETURNING venta_id`,
        [venta.id],
      );
      expect(movidas).toHaveLength(2);

      const despues = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;

      const neto = new Decimal(venta.totalFinal).minus('2870').toString();
      expect(
        delta(
          antes.ventas.vendido.semanaPasada,
          despues.ventas.vendido.semanaPasada,
        ),
      ).toBe(neto);
      expect(
        despues.ventas.cantidad.semanaPasada -
          antes.ventas.cantidad.semanaPasada,
      ).toBe(1);
      // Y salió de hoy, entera: la venta no cuenta y la NC tampoco resta.
      expect(delta(antes.ventas.vendido.hoy, despues.ventas.vendido.hoy)).toBe(
        new Decimal(neto).negated().toString(),
      );
    });

    it('una venta anulada no mueve el vendido', async () => {
      const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

      // Lo único que `POST /ventas/:id/anular` acepta: pendiente y sin pagos
      // (el tipo de documento ya no cuenta: `docs/features/ventas.md`).
      const resC = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ lineas: [{ itemId, cantidad: '2' }] });
      expect(resC.status).toBe(201);
      const ventaC = resC.body as VentaCreadaResponse;

      const anular = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaC.id}/anular`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ motivo: 'Anulación de prueba e2e resumen-negocio' });
      expect(anular.status).toBe(201);

      const despues = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;

      expect(despues.ventas.vendido.hoy).toBe(antes.ventas.vendido.hoy);
      expect(despues.ventas.cantidad.hoy).toBe(antes.ventas.cantidad.hoy);
    });

    describe('lo devuelto resta del cobrado', () => {
      const leer = async () =>
        (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

      /** La config demo de Paris: la fila con `codigo = 'demo'` de la lista de configuraciones, como la busca `tienda-pasarela-demo.e2e-spec.ts`. */
      async function idConfigDemo(): Promise<string> {
        const res = await request(app.getHttpServer())
          .get('/api/pasarela/admin/config')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(res.status).toBe(200);
        const demo = (res.body as ConfigPasarelaRow[]).find(
          (c) => c.codigo === 'demo',
        );
        expect(demo).toBeDefined();
        return demo!.tenantPasarelaId;
      }

      async function usuarioIdAdmin(): Promise<string> {
        const rows: { usuario_id: string }[] = await ds.query(
          `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
          [ADMIN_EMAIL],
        );
        return rows[0].usuario_id;
      }

      /**
       * Lo que deja el proveedor después de un reembolso aprobado. En el e2e no
       * hay cómo llegar por la app: `ProviderFactory.getReembolsable` solo
       * conoce Oneclick y Webpay Plus (Transbank) y la pasarela demo no
       * reembolsa. Se arma con las piezas de la app —el repositorio de la orden
       * y `TransaccionesService.registrar`, el mismo que usa
       * `CobrosService.reembolsar`— y de ahí en adelante todo va por el camino
       * real.
       */
      async function reembolsoAprobado(ventaId: string | null, monto: string) {
        const tenantPasarelaId = await idConfigDemo();
        const orden = await ds.getRepository(PasarelaOrden).save({
          tenantId: PARIS_TENANT_ID,
          ventaId,
          codigoOrden: `e2e-${randomUUID().slice(0, 20)}`,
          descripcion: 'Orden e2e vendido neto',
          monto,
          moneda: 'CLP',
          estado: 'conciliada',
          origen: 'interno',
        });
        await app.get(TransaccionesService).registrar({
          tenantId: PARIS_TENANT_ID,
          ordenId: orden.ordenId,
          tenantPasarelaId,
          tipo: 'REFUND',
          estado: 'aprobada',
          monto,
          moneda: 'CLP',
          codigoOrden: orden.codigoOrden,
        });
        return orden;
      }

      it('una NC devuelta en efectivo resta el efectivo devuelto; un retiro de caja ajeno no entra', async () => {
        const venta = await crearVentaPagada('5');
        const antes = await leer();

        const nc = await request(app.getHttpServer())
          .post(`/api/ventas/${venta.id}/notas-credito`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ monto: '2340', ...(await devolucionDe(venta.id)) });
        expect(nc.status).toBe(201);
        // Control: una salida de caja que NO es devolución (sin venta_id). Si la
        // consulta contara cualquier salida, el cobrado caería 2340 + 4100.
        await post(`/api/caja/${caja.id}/movimientos`, {
          tipo: 'salida',
          concepto: 'Retiro e2e',
          monto: '4100',
        });
        const despues = await leer();

        expect(
          delta(antes.ventas.cobrado.hoy, despues.ventas.cobrado.hoy),
        ).toBe('-2340');
        expect(
          delta(
            antes.ventas.cobradoDesglose.devuelto,
            despues.ventas.cobradoDesglose.devuelto,
          ),
        ).toBe('2340');
        expect(
          delta(
            antes.ventas.cobradoDesglose.cobrado,
            despues.ventas.cobradoDesglose.cobrado,
          ),
        ).toBe('0');
      });

      it('una NC devuelta por la máquina (débito) resta del cobrado aunque no deje salida de caja', async () => {
        // La escena del dueño: se cobró con débito y se devuelve reversando en la
        // máquina. La plata volvió, pero ni la caja ni la pasarela dejan rastro.
        const venta = await crearVentaPagada('5', DEBITO_ID);
        const antes = await leer();

        const nc = await post<IdResponse>(
          `/api/ventas/${venta.id}/notas-credito`,
          { monto: '2340', ...(await devolucionDe(venta.id)) },
        );
        const despues = await leer();

        const salidas: { n: string }[] = await ds.query(
          `SELECT COUNT(*)::text AS n FROM movimientos_caja WHERE venta_id = $1`,
          [nc.id],
        );
        expect(salidas[0].n).toBe('0');
        expect(
          delta(antes.ventas.cobrado.hoy, despues.ventas.cobrado.hoy),
        ).toBe('-2340');
        expect(
          delta(
            antes.ventas.cobradoDesglose.devuelto,
            despues.ventas.cobradoDesglose.devuelto,
          ),
        ).toBe('2340');
        expect(
          delta(
            antes.ventas.cobradoDesglose.cobrado,
            despues.ventas.cobradoDesglose.cobrado,
          ),
        ).toBe('0');
      });

      it('una devolución en efectivo y otra por la máquina restan cada una UNA vez', async () => {
        const enEfectivo = await crearVentaPagada('5');
        const enDebito = await crearVentaPagada('4', DEBITO_ID);
        const antes = await leer();

        await post(`/api/ventas/${enEfectivo.id}/notas-credito`, {
          monto: '2340',
          ...(await devolucionDe(enEfectivo.id)),
        });
        await post(`/api/ventas/${enDebito.id}/notas-credito`, {
          monto: '1785',
          ...(await devolucionDe(enDebito.id)),
        });
        const despues = await leer();

        // 2340 + 1785. Si el efectivo entrara por la caja Y por la vía "pago",
        // serían 2340 de más.
        expect(
          delta(antes.ventas.cobrado.hoy, despues.ventas.cobrado.hoy),
        ).toBe('-4125');
        expect(
          delta(
            antes.ventas.cobradoDesglose.devuelto,
            despues.ventas.cobradoDesglose.devuelto,
          ),
        ).toBe('4125');
      });

      it('control: una NC "no vuelve plata" no devolvió nada y no resta del cobrado', async () => {
        const venta = await post<VentaCreadaResponse>('/api/ventas', {
          lineas: [{ itemId, cantidad: '3' }],
        });
        await post('/api/pagos', {
          ventaId: venta.id,
          pagos: [
            {
              metodoPagoId: DEBITO_ID,
              monto: new Decimal(venta.totalFinal)
                .times('0.7')
                .toFixed(0, Decimal.ROUND_DOWN),
            },
          ],
        });
        const antes = await leer();

        await post(`/api/ventas/${venta.id}/notas-credito`, {
          monto: '515',
          devolucion: { sinPlata: true },
        });
        const despues = await leer();

        expect(despues.ventas.cobrado.hoy).toBe(antes.ventas.cobrado.hoy);
        expect(despues.ventas.cobradoDesglose).toEqual(
          antes.ventas.cobradoDesglose,
        );
      });

      it('una devolución por la máquina de hace una semana resta del cobrado de la semana pasada, no del de hoy', async () => {
        const venta = await crearVentaPagada('6', DEBITO_ID);
        const nc = await post<IdResponse>(
          `/api/ventas/${venta.id}/notas-credito`,
          { monto: '2210', ...(await devolucionDe(venta.id)) },
        );
        const antes = await leer();

        // Solo la corrección pasa a hace 7 días (el reloj, no un estado
        // inventado: la app no deja fechar una nota).
        const [movidas] = await ds.query<[unknown[], number]>(
          `UPDATE ventas SET fecha = fecha - interval '7 days'
            WHERE venta_id = $1
        RETURNING venta_id`,
          [nc.id],
        );
        expect(movidas).toHaveLength(1);
        const despues = await leer();

        expect(
          delta(
            antes.ventas.cobrado.semanaPasada,
            despues.ventas.cobrado.semanaPasada,
          ),
        ).toBe('-2210');
        expect(
          delta(antes.ventas.cobrado.hoy, despues.ventas.cobrado.hoy),
        ).toBe('2210');
      });

      it('un REFUND aprobado sin NC resta del cobrado y no toca lo vendido ni lo que se debe', async () => {
        // La app ya no produce este estado (todo REFUND con venta crea su corrección):
        // se emula a mano para fijar que la consulta del cobrado resta el REFUND solo.
        const venta = await crearVentaPagada('5');
        const antes = await leer();

        await reembolsoAprobado(venta.id, '1785');
        const despues = await leer();

        expect(
          delta(antes.ventas.cobrado.hoy, despues.ventas.cobrado.hoy),
        ).toBe('-1785');
        expect(
          delta(antes.ventas.vendido.hoy, despues.ventas.vendido.hoy),
        ).toBe('0');
        expect(despues.porCobrar).toEqual(antes.porCobrar);
      });

      it('un REFUND con la NC del webhook resta del cobrado UNA vez y del vendido, y la NC no deja salida de caja', async () => {
        const venta = await crearVentaPagada('5');
        const antes = await leer();

        const orden = await reembolsoAprobado(venta.id, '1785');
        const { correccionVentaId: notaCreditoId } = await app
          .get(VentasReembolsoHandler)
          .onReembolsoAprobado({
            tenantId: PARIS_TENANT_ID,
            ordenId: orden.ordenId,
            codigoOrden: orden.codigoOrden,
            ventaId: venta.id,
            monto: '1785',
            devoluciones: [],
            usuarioId: await usuarioIdAdmin(),
            // Llamado directo, sin CobrosService: no liga ningún REFUND.
            ligarCorreccion: async () => {},
          });
        expect(notaCreditoId).toBeDefined();
        const despues = await leer();

        // Una vez: el REFUND. Si la NC también restara su salida de caja, o
        // contara dos veces, sería -3570.
        expect(
          delta(antes.ventas.cobrado.hoy, despues.ventas.cobrado.hoy),
        ).toBe('-1785');
        expect(
          delta(antes.ventas.vendido.hoy, despues.ventas.vendido.hoy),
        ).toBe('-1785');
        const salidas: { n: string }[] = await ds.query(
          `SELECT COUNT(*)::text AS n FROM movimientos_caja WHERE venta_id = $1`,
          [notaCreditoId],
        );
        expect(salidas[0].n).toBe('0');
      });

      it('control: el REFUND de una orden sin venta no resta del cobrado', async () => {
        const antes = await leer();

        await reembolsoAprobado(null, '2210');
        const despues = await leer();

        expect(despues.ventas.cobrado.hoy).toBe(antes.ventas.cobrado.hoy);
        expect(despues.ventas.cobradoDesglose).toEqual(
          antes.ventas.cobradoDesglose,
        );
      });

      /**
       * El resumen de Pagos resta lo devuelto con la MISMA cuenta que el
       * "Cobrado" del inicio (`devuelto-venta.ts`, owner 2026-10-02): "Cobrado
       * $100.000 · devuelto −$40.000 → $60.000". Cada escena lee los dos
       * resúmenes antes y después, y afirma que el devuelto de Pagos se movió
       * lo mismo que el del inicio, en el histórico y en hoy.
       */
      describe('el resumen de Pagos resta lo mismo que el inicio', () => {
        interface PagosResumenResponse {
          montoCobrado: string;
          montoPropinas: string;
          montoDevuelto: string;
          montoNeto: string;
          montoHoy: string;
          propinasHoy: string;
          devueltoHoy: string;
          netoHoy: string;
        }
        const leerPagos = async (): Promise<PagosResumenResponse> => {
          const res = await request(app.getHttpServer())
            .get('/api/pagos/resumen')
            .set('Authorization', `Bearer ${tokenAdmin}`);
          expect(res.status).toBe(200);
          return res.body as PagosResumenResponse;
        };
        const leerAmbos = async () => ({
          pagos: await leerPagos(),
          inicio: await leer(),
        });
        type Lectura = Awaited<ReturnType<typeof leerAmbos>>;
        /** Cuánto se movió cada número de Pagos, y el devuelto del inicio. */
        const movimiento = (antes: Lectura, despues: Lectura) => ({
          cobrado: delta(antes.pagos.montoCobrado, despues.pagos.montoCobrado),
          propinas: delta(
            antes.pagos.montoPropinas,
            despues.pagos.montoPropinas,
          ),
          devuelto: delta(
            antes.pagos.montoDevuelto,
            despues.pagos.montoDevuelto,
          ),
          neto: delta(antes.pagos.montoNeto, despues.pagos.montoNeto),
          cobradoHoy: delta(antes.pagos.montoHoy, despues.pagos.montoHoy),
          propinasHoy: delta(
            antes.pagos.propinasHoy,
            despues.pagos.propinasHoy,
          ),
          devueltoHoy: delta(
            antes.pagos.devueltoHoy,
            despues.pagos.devueltoHoy,
          ),
          netoHoy: delta(antes.pagos.netoHoy, despues.pagos.netoHoy),
          devueltoInicio: delta(
            antes.inicio.ventas.cobradoDesglose.devuelto,
            despues.inicio.ventas.cobradoDesglose.devuelto,
          ),
          cobradoInicio: delta(
            antes.inicio.ventas.cobrado.hoy,
            despues.inicio.ventas.cobrado.hoy,
          ),
        });

        it('el café: cobra $100.000 con débito y devuelve $40.000 en la máquina → cobrado 100.000, devuelto 40.000, neto 60.000', async () => {
          const item = await request(app.getHttpServer())
            .post('/api/items')
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({
              nombre: `E2E Café devuelto ${randomUUID().slice(0, 8)}`,
              precioBase: '100000',
              precioIncluyeImpuesto: true,
              monedaId: CLP_MONEDA_ID,
              tipo: 'servicio',
            });
          expect(item.status).toBe(201);
          const antes = await leerAmbos();

          const venta = await post<VentaCreadaResponse>('/api/ventas', {
            lineas: [{ itemId: (item.body as ItemResponse).id, cantidad: '1' }],
          });
          expect(new Decimal(venta.totalFinal).toString()).toBe('100000');
          await post('/api/pagos', {
            ventaId: venta.id,
            pagos: [{ metodoPagoId: DEBITO_ID, monto: venta.totalFinal }],
          });
          await post(`/api/ventas/${venta.id}/notas-credito`, {
            monto: '40000',
            ...(await devolucionDe(venta.id)),
          });
          const despues = await leerAmbos();

          expect(movimiento(antes, despues)).toEqual({
            cobrado: '100000',
            propinas: '0',
            devuelto: '40000',
            neto: '60000',
            cobradoHoy: '100000',
            propinasHoy: '0',
            devueltoHoy: '40000',
            netoHoy: '60000',
            devueltoInicio: '40000',
            cobradoInicio: '60000',
          });
        });

        it('con propina: "Cobrado $105.000 · propinas −$5.000 · devuelto −$40.000 → $60.000", y el neto es el cobrado del inicio', async () => {
          const item = await request(app.getHttpServer())
            .post('/api/items')
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({
              nombre: `E2E Café propina ${randomUUID().slice(0, 8)}`,
              precioBase: '100000',
              precioIncluyeImpuesto: true,
              monedaId: CLP_MONEDA_ID,
              tipo: 'servicio',
            });
          expect(item.status).toBe(201);
          const antes = await leerAmbos();

          const venta = await post<VentaCreadaResponse>('/api/ventas', {
            lineas: [{ itemId: (item.body as ItemResponse).id, cantidad: '1' }],
            pagos: [{ metodoPagoId: DEBITO_ID, monto: '105000' }],
            propinaDirecta: { montoPagado: '5000' },
          });
          expect(new Decimal(venta.totalFinal).toString()).toBe('100000');
          await post(`/api/ventas/${venta.id}/notas-credito`, {
            monto: '40000',
            ...(await devolucionDe(venta.id)),
          });
          const despues = await leerAmbos();

          // El cobrado cuadra con las filas (el pago fue de 105.000) y el neto
          // con el "Cobrado" del inicio, que no cuenta la propina.
          expect(movimiento(antes, despues)).toEqual({
            cobrado: '105000',
            propinas: '5000',
            devuelto: '40000',
            neto: '60000',
            cobradoHoy: '105000',
            propinasHoy: '5000',
            devueltoHoy: '40000',
            netoHoy: '60000',
            devueltoInicio: '40000',
            cobradoInicio: '60000',
          });
        });

        it('efectivo: resta la salida de la caja de la nota; un retiro de caja ajeno no entra', async () => {
          const venta = await crearVentaPagada('5');
          const antes = await leerAmbos();

          await post(`/api/ventas/${venta.id}/notas-credito`, {
            monto: '2340',
            ...(await devolucionDe(venta.id)),
          });
          // Control: una salida de caja que no es devolución (sin venta_id).
          await post(`/api/caja/${caja.id}/movimientos`, {
            tipo: 'salida',
            concepto: 'Retiro e2e Pagos',
            monto: '4100',
          });
          const despues = await leerAmbos();

          expect(movimiento(antes, despues)).toEqual({
            cobrado: '0',
            propinas: '0',
            devuelto: '2340',
            neto: '-2340',
            cobradoHoy: '0',
            propinasHoy: '0',
            devueltoHoy: '2340',
            netoHoy: '-2340',
            devueltoInicio: '2340',
            cobradoInicio: '-2340',
          });
        });

        it('REFUND con la NC del webhook: resta UNA vez, como en el inicio', async () => {
          const venta = await crearVentaPagada('5');
          const antes = await leerAmbos();

          const orden = await reembolsoAprobado(venta.id, '1785');
          await app.get(VentasReembolsoHandler).onReembolsoAprobado({
            tenantId: PARIS_TENANT_ID,
            ordenId: orden.ordenId,
            codigoOrden: orden.codigoOrden,
            ventaId: venta.id,
            monto: '1785',
            devoluciones: [],
            usuarioId: await usuarioIdAdmin(),
            ligarCorreccion: async () => {},
          });
          const despues = await leerAmbos();

          expect(movimiento(antes, despues)).toEqual({
            cobrado: '0',
            propinas: '0',
            devuelto: '1785',
            neto: '-1785',
            cobradoHoy: '0',
            propinasHoy: '0',
            devueltoHoy: '1785',
            netoHoy: '-1785',
            devueltoInicio: '1785',
            cobradoInicio: '-1785',
          });
        });
      });
    });

    describe('por cobrar descuenta solo las notas "no vuelve plata" (saldo por venta, piso 0)', () => {
      const leer = async () =>
        (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

      /** `⌊x⌋` en CLP: Decimal, hacia abajo, sin decimales. */
      const piso = (x: Decimal.Value) =>
        new Decimal(x).toFixed(0, Decimal.ROUND_DOWN);

      /**
       * Venta de 3 unidades del ítem propio con un abono en efectivo de
       * `⌊fraccion·T⌋`, donde `T` es el `totalFinal` que calculó el servidor
       * (puede llevar IVA): los montos salen de `T` para que ninguno coincida
       * con otro.
       */
      async function ventaParcial(
        fraccion: string,
        metodoPagoId: string = EFECTIVO_ID,
      ) {
        const venta = await post<VentaCreadaResponse>('/api/ventas', {
          lineas: [{ itemId, cantidad: '3' }],
        });
        const T = new Decimal(venta.totalFinal);
        const P = piso(T.times(fraccion));
        const pago = await post<AbonoResponse>('/api/pagos', {
          ventaId: venta.id,
          pagos: [{ metodoPagoId, monto: P }],
        });
        expect(pago.venta.estado).toBe('pagada_parcial');
        return { venta, T, P };
      }

      it('una NC por un pago mayor que lo que se debe NO mueve el saldo: lo devuelto salió de lo pagado, no de la deuda', async () => {
        // El abono es con débito: la devolución vuelve por la máquina y no
        // toca la caja. Ninguna nota por un pago pasa de lo que ese pago trajo (P):
        // por eso el abono (P) tiene que superar lo que falta (T − P), para
        // que una nota N ≤ P pueda ser mayor que lo que se debe.
        const { venta, T, P } = await ventaParcial('0.7', DEBITO_ID);
        const antes = await leer();

        // T − P < N ≤ P: con la regla vieja (la nota rebajaba la deuda) el saldo
        // de esta venta caía a cero y la venta salía de la cuenta; con la actual,
        // el cliente sigue debiendo T − P.
        const N = piso(T.times('0.5')).toString();
        expect(new Decimal(N).gt(T.minus(P))).toBe(true);
        expect(new Decimal(N).lte(P)).toBe(true);
        await post(`/api/ventas/${venta.id}/notas-credito`, {
          monto: N,
          ...(await devolucionDe(venta.id)),
        });
        const despues = await leer();

        expect(delta(antes.porCobrar.saldo, despues.porCobrar.saldo)).toBe('0');
        expect(despues.porCobrar.cantidad).toBe(antes.porCobrar.cantidad);
      });

      it('"no vuelve plata" por todo lo que se debe deja el saldo en cero, y la venta sale de la cuenta', async () => {
        const { venta, T, P } = await ventaParcial('0.7', DEBITO_ID);
        const antes = await leer();

        await post(`/api/ventas/${venta.id}/notas-credito`, {
          monto: T.minus(P).toString(),
          devolucion: { sinPlata: true },
        });
        const despues = await leer();

        expect(delta(antes.porCobrar.saldo, despues.porCobrar.saldo)).toBe(
          T.minus(P).negated().toString(),
        );
        expect(despues.porCobrar.cantidad - antes.porCobrar.cantidad).toBe(-1);
      });

      it('lo devuelto en efectivo no cambia lo que se debe', async () => {
        const { venta, T } = await ventaParcial('0.6');
        const antes = await leer();

        const N = piso(T.times('0.25'));
        await post(`/api/ventas/${venta.id}/notas-credito`, {
          monto: N,
          ...(await devolucionDe(venta.id)),
        });
        const despues = await leer();

        // Antes T − P, después T − P: lo devuelto en efectivo no cambia lo que
        // se debe. Si la nota rebajara la deuda, el saldo bajaría N.
        expect(delta(antes.porCobrar.saldo, despues.porCobrar.saldo)).toBe('0');
        expect(despues.porCobrar.cantidad).toBe(antes.porCobrar.cantidad);
      });
    });
  });

  /**
   * Task 2 (spec 2026-09-18-dashboard-inicio § 4.4/§ 5.1): `perdidas` y
   * `masVendidos`. Salón, mesa y garzón PROPIOS (molde:
   * `salones-anular-linea.e2e-spec.ts`) — la sesión de garzón es única y
   * varios specs la comparten (`docs/agent/pendientes.md`).
   */
  describe('pérdidas y lo más vendido (delta)', () => {
    let motivoCortesiaId: string;
    let motivoMermaId: string;
    let localId: string;
    let garzon: GarzonCreado;
    let mesaId: string;
    let platoId: string;

    beforeAll(async () => {
      const resMotivos = await request(app.getHttpServer())
        .get('/api/motivos-baja')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resMotivos.status).toBe(200);
      const motivos = resMotivos.body as MotivoBajaItem[];
      motivoCortesiaId = motivos.find((m) => m.tipo === 'cortesia')!.id;
      motivoMermaId = motivos.find((m) => m.tipo === 'merma')!.id;
      expect(motivoCortesiaId).toBeTruthy();
      expect(motivoMermaId).toBeTruthy();

      const resUbic = await request(app.getHttpServer())
        .get('/api/ubicaciones')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resUbic.status).toBe(200);
      localId = (resUbic.body as UbicacionListada[]).find(
        (u) => u.tipo === 'local',
      )!.id;

      const marca = Date.now();

      // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
      // `cantidadEnviada`, y sin despachar no hay nada que anular (mismo
      // molde que `salones-anular-linea.e2e-spec.ts`).
      const cocinaId = (
        await post<IdResponse>('/api/impresoras', {
          nombre: `Cocina resumen-negocio E2E ${marca}`,
          rol: 'comanda',
          tipoConexion: 'sistema',
          nombreCola: `cola-resumen-negocio-e2e-${marca}`,
        })
      ).id;
      const catCocinaId = (
        await post<IdResponse>('/api/categorias', {
          nombre: `Cocina resumen-negocio E2E ${marca}`,
          impresoraId: cocinaId,
        })
      ).id;
      platoId = (
        await post<IdResponse>('/api/items', {
          nombre: `Plato resumen-negocio E2E ${marca}`,
          tipo: 'producto',
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          unidadMedida: 'unidad',
          stock: '100',
          costo: '100',
          categoriaId: catCocinaId,
        })
      ).id;

      garzon = await post<GarzonCreado>('/api/garzones', {
        nombre: `Garzón resumen-negocio E2E ${marca}`,
      });
      await post('/api/sesiones-garzon/iniciar', {
        garzonId: garzon.id,
        pin: garzon.pin,
        turnoId: TURNO_MANANA_ID,
      });

      const salonId = (
        await post<IdResponse>('/api/salones', {
          nombre: `Salón resumen-negocio E2E ${marca}`,
        })
      ).id;
      mesaId = (
        await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: 'Mesa resumen-negocio',
        })
      ).id;
    });

    afterAll(async () => {
      const cerrar = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ garzonId: garzon.id, pin: garzon.pin });
      expect(cerrar.status).toBe(201);
    });

    it('anular un plato despachado como cortesía mueve perdidas.anulaciones de tipo cortesia', async () => {
      const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;
      const platosAntes = new Decimal(
        antes.perdidas.anulaciones.find((a) => a.tipo === 'cortesia')?.platos ??
          '0',
      );

      const cuenta = await post<{ id: string }>(
        `/api/mesas/${mesaId}/cuentas`,
        { garzonId: garzon.id, pin: garzon.pin },
      );
      await post(`/api/cuentas/${cuenta.id}/lineas`, {
        itemId: platoId,
        cantidad: '1',
      });
      await post(`/api/cuentas/${cuenta.id}/comanda/reclamar`, {});

      const resDetalle = await request(app.getHttpServer())
        .get(`/api/mesas/${mesaId}/cuentas`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resDetalle.status).toBe(200);
      const cuentaAbierta = (resDetalle.body as CuentaDetalle[]).find(
        (c) => c.id === cuenta.id,
      )!;
      const lineaId = cuentaAbierta.lineas.find(
        (l) => l.itemId === platoId,
      )!.id;

      // Anula la línea ENTERA (única línea de la cuenta): la cuenta queda
      // cancelada, sin dejar nada abierto para el resto de la suite.
      const anular = await request(app.getHttpServer())
        .post(`/api/cuentas/${cuenta.id}/lineas/${lineaId}/anular`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ cantidad: '1', motivoBajaId: motivoCortesiaId });
      expect(anular.status).toBe(201);

      const despues = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;
      const grupoCortesia = despues.perdidas.anulaciones.find(
        (a) => a.tipo === 'cortesia',
      );
      expect(grupoCortesia).toBeDefined();
      expect(
        new Decimal(grupoCortesia!.platos).minus(platosAntes).toString(),
      ).toBe('1');
    });

    it('registrar una merma sin costo cargado sube sinValorizar en 1 sin mover costo', async () => {
      const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

      const itemSinCosto = await post<ItemResponse>('/api/items', {
        nombre: `Insumo resumen-negocio E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'kg',
      });

      // Entrada de stock SIN costoUnitario, para que costo_actual quede NULL
      // (mismo molde que `test/mermas.e2e-spec.ts`).
      const entrada = await request(app.getHttpServer())
        .patch(`/api/items/${itemSinCosto.id}/stock`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          ubicacionId: localId,
          cantidad: '5',
        });
      expect(entrada.status).toBe(200);

      const merma = await request(app.getHttpServer())
        .post('/api/mermas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          itemId: itemSinCosto.id,
          ubicacionId: localId,
          cantidad: '1',
          motivoBajaId: motivoMermaId,
        });
      expect(merma.status).toBe(201);
      expect(
        (merma.body as { costoPerdido: string | null }).costoPerdido,
      ).toBeNull();

      const despues = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;

      expect(
        despues.perdidas.mermas.sinValorizar -
          antes.perdidas.mermas.sinValorizar,
      ).toBe(1);
      // El costo por moneda no se mueve: la fila sin costo no suma (regla 6
      // de la spec del costo sin tipear).
      expect(despues.perdidas.mermas.costo).toEqual(
        antes.perdidas.mermas.costo,
      );
    });

    it('una venta de un ítem propio con precio muy alto sale primera en masVendidos, con su monto igual al totalFinal de la línea', async () => {
      // El precio suma los ms de Date.now(), no un '9990000' fijo: un fijo le
      // gana a cualquier venta del seed o de otros specs del día (spec del
      // Step 5), pero EMPATA byte a byte si esta suite corre dos veces el
      // mismo día sin `reset-db.sh` —medido: el segundo ítem "carísimo" quedó
      // con el mismo `monto` que el primero, y el desempate de la consulta
      // (`item_id`) no tenía por qué favorecer al de esta corrida—. Sumar
      // `Date.now()` hace que cada corrida tenga un monto distinto, sin
      // depender de qué corrida quedó primera por id.
      const marca = Date.now();
      const itemCaro = await post<ItemResponse>('/api/items', {
        nombre: `Ítem carísimo resumen-negocio E2E ${marca}`,
        precioBase: (9990000 + marca).toString(),
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });

      const venta = await post<VentaCreadaResponse>('/api/ventas', {
        lineas: [{ itemId: itemCaro.id, cantidad: '1' }],
      });

      const despues = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;

      expect(despues.masVendidos.length).toBeGreaterThan(0);
      expect(despues.masVendidos[0]).toMatchObject({
        itemId: itemCaro.id,
        monto: venta.totalFinal,
      });
    });

    /** Las líneas de una venta o de una NC, tal como las lee el detalle. */
    async function leerLineas(ventaId: string): Promise<LineaVentaResp[]> {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas/${ventaId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      return (res.body as { detalles: LineaVentaResp[] }).detalles;
    }

    /** Venta de `cantidad` unidades de `itemId`, pagada entera en efectivo. */
    async function ventaPagada(
      itemId: string,
      cantidad: string,
    ): Promise<VentaCreadaResponse> {
      const venta = await post<VentaCreadaResponse>('/api/ventas', {
        lineas: [{ itemId, cantidad }],
      });
      await post('/api/pagos', {
        ventaId: venta.id,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: venta.totalFinal }],
      });
      return venta;
    }

    it('una NC con líneas resta su cantidad y su monto de la fila del ítem en masVendidos', async () => {
      // Precio no redondo y alto, para entrar al top 5 del día aunque el seed
      // y los demás tests también vendan. Sin `Date.now()` a propósito: el
      // monto neto (2 unidades) queda muy por debajo del "carísimo" de arriba,
      // así ese test sigue primero en cada corrida. Como contrapartida, este
      // test asume la base reseteada (`entorno.sh db` antes del e2e): cada
      // corrida repetida el mismo día suma otro "carísimo" que se lleva un
      // lugar del top 5, y tras cuatro o cinco corridas la fila de acá no entra.
      const marca = Date.now();
      const item = await post<ItemResponse>('/api/items', {
        nombre: `Ítem devuelto resumen-negocio E2E ${marca}`,
        precioBase: '9870001',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
      const venta = await ventaPagada(item.id, '3');
      // Un tercio del total, redondeado hacia abajo: una NC por UNA de las
      // tres unidades, con un monto que no es el de la línea exacta.
      const montoNC = new Decimal(venta.totalFinal)
        .div(3)
        .toDecimalPlaces(0, Decimal.ROUND_DOWN)
        .toString();
      const nc = await post<IdResponse>(
        `/api/ventas/${venta.id}/notas-credito`,
        {
          monto: montoNC,
          ...(await devolucionDe(venta.id)),
          devoluciones: [{ itemId: item.id, cantidad: '1' }],
        },
      );

      // Las dos líneas, leídas de la app: el monto esperado sale de lo que
      // quedó persistido, no de una cuenta propia sobre el precio.
      const lineaVenta = (await leerLineas(venta.id)).find(
        (l) => l.itemId === item.id,
      );
      const lineasNC = (await leerLineas(nc.id)).filter(
        (l) => l.itemId === item.id,
      );
      expect(lineaVenta).toBeDefined();
      expect(lineasNC).toHaveLength(1);
      const montoNeto = new Decimal(lineaVenta!.totalLinea).minus(
        lineasNC[0].totalLinea,
      );
      // El mismo monto en la venta y en la NC no discrimina: la NC no es la
      // línea entera.
      expect(montoNeto.gt(0)).toBe(true);
      expect(montoNeto.eq(lineaVenta!.totalLinea)).toBe(false);

      const resumen = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;
      const fila = resumen.masVendidos.find((m) => m.itemId === item.id);
      expect(fila).toBeDefined();
      expect(new Decimal(fila!.cantidad).toString()).toBe('2');
      expect(new Decimal(fila!.monto).toString()).toBe(montoNeto.toString());
    });

    it('una NC por monto libre no mete el ítem de ajuste en masVendidos', async () => {
      const item = await post<ItemResponse>('/api/items', {
        nombre: `Ítem ajuste resumen-negocio E2E ${Date.now()}`,
        precioBase: '9870001',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
      const venta = await ventaPagada(item.id, '1');
      const nc = await post<IdResponse>(
        `/api/ventas/${venta.id}/notas-credito`,
        {
          monto: '4321',
          ...(await devolucionDe(venta.id)),
        },
      );

      // El ítem de ajuste no sale en `GET /api/items`: se toma de la base.
      // Existe recién después de la primera NC, por eso se lee acá.
      const ajuste: { item_id: string }[] = await ds.query(
        `SELECT item_id FROM items
          WHERE tenant_id = $1 AND es_ajuste_nota_credito = true
            AND eliminado_el IS NULL`,
        [PARIS_TENANT_ID],
      );
      expect(ajuste).toHaveLength(1);
      const ajusteId = ajuste[0].item_id;
      // Prueba de que la NC sí dejó una línea de ajuste: sin esto, "no
      // aparece" valdría también si la NC no lo hubiera usado.
      expect((await leerLineas(nc.id)).map((l) => l.itemId)).toContain(
        ajusteId,
      );

      // Sin el `HAVING`, un ítem con neto <= 0 se ordena último y no entra al
      // top 5 mientras haya cinco ítems con neto positivo, que en este e2e
      // siempre hay: por eso esta aserción sobrevive a quitarlo. Quitar solo
      // `es_ajuste_nota_credito = false` es equivalente en conducta mientras
      // exista el `HAVING`, porque el ajuste que llega por una NC tiene
      // siempre neto negativo. El filtro solo agrega algo si el ítem de ajuste
      // se vendiera directo por `POST /ventas` con su id (la API no lo
      // rechaza). Los dos los cubre el unitario sobre el texto del SQL.
      const resumen = (await leerResumen(tokenAdmin))
        .body as ResumenHoyResponse;
      expect(resumen.masVendidos.map((m) => m.itemId)).not.toContain(ajusteId);
    });
  });
});
