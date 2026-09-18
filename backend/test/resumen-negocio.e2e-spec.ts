import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const SEGUNDO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
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
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
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
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ lineas: [{ itemId, cantidad: '1' }] });
      expect(resA.status).toBe(201);
      const ventaA = resA.body as VentaCreadaResponse;
      expect(ventaA.estado).toBe('pendiente');

      const pagoA = await request(app.getHttpServer())
        .post('/api/pagos')
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

    it('una venta anulada no mueve el vendido', async () => {
      const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

      // Lo único que `POST /ventas/:id/anular` acepta: pendiente, sin pagos y
      // sin `tipoDocumentoId` (`docs/features/ventas.md` ~L133).
      const resC = await request(app.getHttpServer())
        .post('/api/ventas')
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
  });
});
