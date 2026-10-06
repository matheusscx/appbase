import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { randomUUID } from 'node:crypto';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * **Una cantidad grande con promo: el tope de unidades por venta y la venta que
 * guarda decenas de miles de aplicaciones.** Spec:
 * `docs/superpowers/specs/2026-10-06-cantidad-grande-con-promo-design.md`.
 *
 * Hasta el 2026-10-06 `cantidad` no tenía máximo y el motor de promociones
 * trabaja por unidad: 10⁶ unidades con un 2x1 tomaban el event loop de todos
 * los tenants por 4–5 s. Y antes de colgarse, la venta ya se caía: 16.384
 * unidades con un 2x1 daban 500 al guardar sus trazas (un INSERT con más de
 * 65.535 parámetros), y 65.536 no entraban en el `smallint` de `aplicacion`.
 *
 * El tope (99.999 unidades o kilos por venta o mesa) lo decidió el owner.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
// "Boleta" — tipo de documento sembrado, mismo id que usa promociones.e2e-spec.ts.
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
// Turno del seed. El garzón lo crea el spec: el del seed se lo pisan otras suites.
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
// Sobre el umbral de la Res. Ex. SII 44/2025 la boleta lleva nombre y RUT.
const PAGADOR = { nombre: 'Juana Pérez Soto', rut: '12.345.678-5' };

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
interface CuentaDetalle {
  id: string;
  lineas: { id: string; cantidad: string }[];
}
interface ErrorResponse {
  message: string | string[];
}

describe('Cantidad grande con promo (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let itemId: string;
  let otroItemId: string;
  let promoId: string;
  let mesaId: string;
  let garzon: GarzonCreado;
  let caja: CajaAbierta;

  const post = (url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(url)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const calcular = (lineas: { cantidad: string }[]) =>
    post('/api/calculo-precios/calcular', {
      lineas: lineas.map((l) => ({ itemId, ...l })),
    });

  const vender = (lineas: { cantidad: string }[]) =>
    post('/api/ventas', {
      tipoDocumentoId: BOLETA_ID,
      lineas: lineas.map((l) => ({ itemId, ...l })),
      customer: PAGADOR,
    });

  async function abrirCuenta(): Promise<CuentaDetalle> {
    const res = await post(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    expect(res.status).toBe(201);
    return res.body as CuentaDetalle;
  }

  const agregar = (cuentaId: string, cantidad: string, item = itemId) =>
    post(`/api/cuentas/${cuentaId}/lineas`, { itemId: item, cantidad });

  const mensaje = (res: request.Response): string => {
    const m = (res.body as ErrorResponse).message;
    return Array.isArray(m) ? m.join(' | ') : m;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`.
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
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
    token = (resTenant.body as TokenResponse).access_token;

    const marca = Date.now();
    // Servicio y sin categoría: no consume stock, y ninguna promo de categoría
    // de otra suite lo toca.
    const resItem = await post('/api/items', {
      nombre: `Servicio cantidad grande E2E ${marca}`,
      tipo: 'servicio',
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      clasificacionTributaria: 'exento',
    });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as IdResponse).id;
    const resOtro = await post('/api/items', {
      nombre: `Servicio sin promo cantidad grande E2E ${marca}`,
      tipo: 'servicio',
      precioBase: '500',
      monedaId: CLP_MONEDA_ID,
      clasificacionTributaria: 'exento',
    });
    expect(resOtro.status).toBe(201);
    otroItemId = (resOtro.body as IdResponse).id;

    const resPromo = await post('/api/promociones', {
      nombre: `2x1 cantidad grande E2E ${marca}`,
      tipo: 'nxm',
      valorPorcentaje: '1.0000',
      cadaN: 2,
      fechaInicio: '2020-01-01',
      fechaFin: '2035-12-31',
      scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
    });
    expect(resPromo.status).toBe(201);
    promoId = (resPromo.body as IdResponse).id;

    // Caja física para vender en canal 'fisico'. Se cierra en `afterAll`: la
    // del admin es una sola, y abierta le rompe la apertura a las otras suites.
    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E cantidad grande',
    });

    const resSalon = await post('/api/salones', {
      nombre: `Salón cantidad grande E2E ${marca}`,
    });
    expect(resSalon.status).toBe(201);
    const resMesa = await post(
      `/api/salones/${(resSalon.body as IdResponse).id}/mesas`,
      { nombre: 'Mesa cantidad grande' },
    );
    expect(resMesa.status).toBe(201);
    mesaId = (resMesa.body as IdResponse).id;

    const resGarzon = await post('/api/garzones', {
      nombre: `Garzón cantidad grande E2E ${marca}`,
    });
    expect(resGarzon.status).toBe(201);
    garzon = resGarzon.body as GarzonCreado;
    const resSesion = await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    expect(resSesion.status).toBe(201);
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar (molde `promociones.e2e-spec.ts`): si un paso
    // de limpieza falla, los que siguen corren igual, y el `close` va último.
    // Las ventas de esta suite quedan pendientes, sin pagos: el efectivo de la
    // caja sigue siendo el saldo inicial, que es lo que cuenta `cerrarCaja`.
    const fallos: string[] = [];
    const limpiar = async (que: string, ejecutar: () => Promise<unknown>) => {
      try {
        await ejecutar();
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };
    try {
      await limpiar('cerrar caja', () => cerrarCaja(app, token, caja));
      await limpiar('apagar la promo', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/api/promociones/${promoId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ activo: false });
        expect(res.status).toBe(200);
      });
      await limpiar('cerrar la sesión del garzón', async () => {
        const res = await post('/api/sesiones-garzon/cerrar', {
          garzonId: garzon.id,
          pin: garzon.pin,
        });
        expect([200, 201]).toContain(res.status);
      });
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  describe('el tope de una línea, en el borde', () => {
    it('/calcular, la venta, agregar a una cuenta y cambiar una línea rechazan 99.999,0001 con 400', async () => {
      const resCalcular = await calcular([{ cantidad: '99999.0001' }]);
      expect(resCalcular.status).toBe(400);
      expect(mensaje(resCalcular)).toContain('no puede superar 99.999');

      const resVenta = await vender([{ cantidad: '99999.0001' }]);
      expect(resVenta.status).toBe(400);
      expect(mensaje(resVenta)).toContain('no puede superar 99.999');

      const cuenta = await abrirCuenta();
      const resAgregar = await agregar(cuenta.id, '99999.0001');
      expect(resAgregar.status).toBe(400);
      expect(mensaje(resAgregar)).toContain('no puede superar 99.999');

      const resLinea = await agregar(cuenta.id, '1');
      expect(resLinea.status).toBe(201);
      const lineaId = (resLinea.body as CuentaDetalle).lineas[0].id;
      const resCambiar = await request(app.getHttpServer())
        .patch(`/api/cuentas/${cuenta.id}/lineas/${lineaId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ cantidad: '99999.0001' });
      expect(resCambiar.status).toBe(400);
      expect(mensaje(resCambiar)).toContain('no puede superar 99.999');
    });
  });

  describe('el tope de la venta entera, en el service', () => {
    it('/calcular: 99.999 repartidas en dos líneas pasan; una unidad más es 400 con la suma', async () => {
      const enElTope = await calcular([
        { cantidad: '50000' },
        { cantidad: '49999' },
      ]);
      expect(enElTope.status).toBe(201);

      const pasado = await calcular([
        { cantidad: '50000' },
        { cantidad: '50000' },
      ]);
      expect(pasado.status).toBe(400);
      expect(mensaje(pasado)).toBe(
        'Una venta puede llevar hasta 99.999 unidades en total, y esta suma 100.000',
      );
    });

    it('la venta del POS: dos líneas que suman 100.000 son 400 y no se guarda nada', async () => {
      const antes: { n: string }[] = await ds.query(
        `SELECT count(*)::text AS n FROM venta_detalles
          WHERE item_id = $1 AND eliminado_el IS NULL`,
        [itemId],
      );
      const res = await vender([{ cantidad: '50000' }, { cantidad: '50000' }]);
      expect(res.status).toBe(400);
      expect(mensaje(res)).toBe(
        'Una venta puede llevar hasta 99.999 unidades en total, y esta suma 100.000',
      );
      const despues: { n: string }[] = await ds.query(
        `SELECT count(*)::text AS n FROM venta_detalles
          WHERE item_id = $1 AND eliminado_el IS NULL`,
        [itemId],
      );
      expect(despues[0].n).toBe(antes[0].n);
    });

    it('la cuenta: agregar, subir una línea y fusionar no pasan de 99.999 en la mesa', async () => {
      const cuenta = await abrirCuenta();
      const resA = await agregar(cuenta.id, '60000');
      expect(resA.status).toBe(201);
      const lineaA = (resA.body as CuentaDetalle).lineas[0].id;

      const pasada = await agregar(cuenta.id, '40000');
      expect(pasada.status).toBe(400);
      expect(mensaje(pasada)).toBe(
        'Una mesa puede llevar hasta 99.999 unidades en total, y esta suma 100.000',
      );
      // Otro ítem, para que sea otra línea y no se fusione con la primera.
      const resB = await agregar(cuenta.id, '39999', otroItemId);
      expect(resB.status).toBe(201);

      // Cambiar la cantidad REEMPLAZA la de la línea: 60.000 → 60.001 suma
      // 100.000 con la otra; 60.000 → 60.000 sigue en 99.999 (si se sumara la
      // vieja, daría 159.999 y rebotaría).
      const cambiar = (cantidad: string) =>
        request(app.getHttpServer())
          .patch(`/api/cuentas/${cuenta.id}/lineas/${lineaA}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ cantidad });
      const subida = await cambiar('60001');
      expect(subida.status).toBe(400);
      expect(mensaje(subida)).toBe(
        'Una mesa puede llevar hasta 99.999 unidades en total, y esta suma 100.000',
      );
      expect((await cambiar('60000')).status).toBe(200);

      const otra = await abrirCuenta();
      expect((await agregar(otra.id, '1')).status).toBe(201);
      const fusion = await post(`/api/mesas/${mesaId}/cuentas/fusionar`, {
        cuentaIds: [cuenta.id, otra.id],
      });
      expect(fusion.status).toBe(400);
      expect(mensaje(fusion)).toBe(
        'Una mesa puede llevar hasta 99.999 unidades en total, y esta suma 100.000',
      );
    });
  });

  describe('una venta con decenas de miles de aplicaciones de una promo', () => {
    /**
     * 65.536 unidades con un 2x1 son 32.768 aplicaciones y 32.768 filas de
     * `ventas_promociones`: pasa a la vez el INSERT de un solo tiro (8.192 filas
     * × 8 parámetros ya no entraban) y el `smallint` de `aplicacion` (32.767).
     */
    it('65.536 unidades con 2x1 → 201, y las 32.768 aplicaciones quedan congeladas', async () => {
      const res = await vender([{ cantidad: '65536' }]);
      expect(res.status).toBe(201);
      const ventaId = (res.body as IdResponse).id;

      const filas: { n: string; max: string; descuento: string }[] =
        await ds.query(
          `SELECT count(*)::text AS n, max(aplicacion)::text AS max,
                  sum(monto)::text AS descuento
             FROM ventas_promociones
            WHERE venta_id = $1 AND promocion_id = $2 AND eliminado_el IS NULL`,
          [ventaId, promoId],
        );
      expect(filas[0]).toEqual({
        n: '32768',
        max: '32768',
        descuento: '32768000.0000',
      });
    }, 60000);
  });
});
