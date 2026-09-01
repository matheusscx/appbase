import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * **Lo pedido se cobra como se pidió** (decisión del owner, 2026-08-30).
 *
 * Una línea de cuenta abierta se cobra con el precio que el ítem tenía **cuando
 * se pidió**, no con el de la carta de hoy: *"¿cuál carta? si la hamburguesa se
 * pidió en 5 mil se paga en 5 mil"*. Hasta el 2026-08-31 el precio de la línea
 * no se guardaba en ningún lado —`cuenta_lineas` no tenía columna de plata— y
 * salía del catálogo vivo cada vez que se tasaba.
 *
 * Spec propia y no colgada de `salones-comanda.e2e-spec.ts` a propósito: el
 * frente entero (congelar precio, congelar reglas, cobrar sin re-validar, la
 * precuenta) agrega casos a este mismo archivo, y meterlos en el spec de
 * comanda lo volvería otra cosa.
 *
 * Plan: `docs/superpowers/plans/2026-08-30-lo-pedido-se-cobra-como-se-pidio.md`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
// USD: habilitada para Paris con `valor_del_dia = '950'` (`seedTenantMonedas`).
const USD_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440005';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

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
interface CuentaLineaDetalle {
  id: string;
  itemId: string;
  cantidad: string;
  precioBase: string;
  precioUnitario?: string;
}
interface CuentaDetalle {
  id: string;
  lineas: CuentaLineaDetalle[];
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

describe('Lo pedido se cobra como se pidió — precio congelado (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let mesaId: string;
  let garzon: GarzonCreado;
  let cajaId: string;

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function crearProducto(
    nombre: string,
    precioBase: string,
    monedaId: string = CLP_MONEDA_ID,
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${nombre} ${Date.now()}`,
        precioBase,
        monedaId,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '1',
      })
    ).id;
  }

  async function repreciar(itemId: string, precioBase: string): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ precioBase });
    expect(res.status).toBe(200);
  }

  async function abrirCuenta(): Promise<string> {
    return (
      await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      })
    ).id;
  }

  async function agregarLinea(
    cuentaId: string,
    itemId: string,
    cantidad = '1',
  ): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/lineas`, { itemId, cantidad });
  }

  /**
   * No hay `GET /cuentas/:id`: el detalle de una cuenta se lee por su mesa
   * (`GET /mesas/:id/cuentas`, solo las abiertas). Se filtra por id porque el
   * spec abre y cancela varias sobre la misma mesa.
   */
  async function detalle(cuentaId: string): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const cuenta = (res.body as CuentaDetalle[]).find((c) => c.id === cuentaId);
    expect(cuenta).toBeDefined();
    return cuenta!;
  }

  async function cancelar(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/cancelar`, {});
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
    token = await login(app);

    const marca = Date.now();

    // ⚠️ Garzón PROPIO, no el del seed: la sesión es única por garzón y el
    // estado se filtra de un spec al siguiente (`maxWorkers: 1`).
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón congelado E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón congelado E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa congelado',
      })
    ).id;

    // Cerrar una cuenta genera una venta `canal='fisico'`, que exige caja
    // abierta. Caja propia del spec.
    const disp = await request(app.getHttpServer())
      .get('/api/caja/cajones-disponibles')
      .set('Authorization', `Bearer ${token}`);
    expect(disp.status).toBe(200);
    const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;
    expect(cajonId).toBeTruthy();
    cajaId = (
      await post<IdResponse>('/api/caja/abrir', {
        cajonId,
        saldoInicial: '0.0000',
        comentario: 'Apertura E2E precio congelado',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar, y el `close` en un `finally`: si un paso de
    // limpieza falla, lo que quede sin cerrar contamina las suites siguientes.
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
      await limpiar(
        'cerrar sesión del garzón',
        async () =>
          (
            await request(app.getHttpServer())
              .post('/api/sesiones-garzon/cerrar')
              .set('Authorization', `Bearer ${token}`)
              .send({ garzonId: garzon.id, pin: garzon.pin })
          ).status,
      );

      await limpiar('cerrar caja', async () => {
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${token}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
        if (![200, 201].includes(conteo.status)) return conteo.status;
        if ((conteo.body as { estado?: string }).estado !== 'en_conciliacion') {
          return 200;
        }
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${token}`);
        const motivoId = (motivos.body as { id: string }[])[0]?.id;
        return (
          await request(app.getHttpServer())
            .post(`/api/caja/${cajaId}/cerrar`)
            .set('Authorization', `Bearer ${token}`)
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

  it('1. el precio de la línea no se mueve cuando cambia la carta', async () => {
    const itemId = await crearProducto('Hamburguesa congelada', '5000');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    await repreciar(itemId, '6000');

    const { lineas } = await detalle(cuentaId);
    expect(lineas).toHaveLength(1);
    // Lo que la mesa pidió, no lo que dice la carta ahora.
    expect(lineas[0].precioUnitario).toBe('5000.0000');

    await cancelar(cuentaId);
  });

  it('2. el precio congelado está en moneda OFICIAL, no en la del ítem', async () => {
    // USD vale 950 para Paris: entre el precio crudo y el convertido hay tres
    // órdenes de magnitud, así que este caso distingue de verdad. Con la moneda
    // oficial (tasa 1) congelar sin convertir daría el mismo número y el test no
    // probaría nada. Es el mismo bug que ya se pagó con la moneda del extra
    // (`resueltos.md`, 2026-08-26).
    const itemId = await crearProducto('Vino congelado', '10', USD_MONEDA_ID);
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    const { lineas } = await detalle(cuentaId);
    expect(lineas[0].precioUnitario).toBe('9500.0000');

    await cancelar(cuentaId);
  });

  it('3. dos pedidos a precios distintos son DOS líneas, no una de cantidad 2', async () => {
    // Hoy `agregarLinea` fusiona por hash de personalización: el mismo ítem
    // pedido dos veces es una línea de cantidad 2. Con el precio congelado eso
    // mezcla plata — son dos hechos distintos, cada uno con el suyo.
    const itemId = await crearProducto('Cerveza congelada', '3000');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    await repreciar(itemId, '4000');
    await agregarLinea(cuentaId, itemId);

    const { lineas } = await detalle(cuentaId);
    expect(lineas).toHaveLength(2);
    expect(
      lineas.map((l) => l.precioUnitario).sort((a, b) => (a! < b! ? -1 : 1)),
    ).toEqual(['3000.0000', '4000.0000']);
    for (const l of lineas) expect(l.cantidad).toBe('1.0000');

    await cancelar(cuentaId);
  });

  it('4. dos pedidos al MISMO precio siguen siendo una línea de cantidad 2', async () => {
    // El control del guard de arriba: sin él, congelar el precio partiría toda
    // línea repetida en dos y la cuenta pasaría a mostrar "1 + 1" donde el
    // garzón espera "2".
    const itemId = await crearProducto('Agua congelada', '1500');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);
    await agregarLinea(cuentaId, itemId);

    const { lineas } = await detalle(cuentaId);
    expect(lineas).toHaveLength(1);
    expect(lineas[0].cantidad).toBe('2.0000');
    expect(lineas[0].precioUnitario).toBe('1500.0000');

    await cancelar(cuentaId);
  });

  it('5. fusionar dos cuentas no mezcla precios congelados distintos', async () => {
    // La otra puerta del mismo merge, y la más fácil de olvidar: `agregarLinea`
    // compara el precio, pero `fusionarCuentas` tenía su propia clave
    // (`itemId|hash`) y sin el precio colapsaba las dos líneas sobre la de
    // destino — medido antes del arreglo: 3000 + 4000 quedaban como 2 × 3000, y
    // los $1.000 de la otra desaparecían.
    const itemId = await crearProducto('Pisco congelado', '3000');

    const cuentaA = await abrirCuenta();
    await agregarLinea(cuentaA, itemId);

    await repreciar(itemId, '4000');

    const cuentaB = await abrirCuenta();
    await agregarLinea(cuentaB, itemId);

    const fusionada = await post<CuentaDetalle>(
      `/api/mesas/${mesaId}/cuentas/fusionar`,
      { cuentaIds: [cuentaA, cuentaB] },
    );

    expect(fusionada.lineas).toHaveLength(2);
    expect(
      fusionada.lineas
        .map((l) => l.precioUnitario)
        .sort((a, b) => (a! < b! ? -1 : 1)),
    ).toEqual(['3000.0000', '4000.0000']);
    for (const l of fusionada.lineas) expect(l.cantidad).toBe('1.0000');

    await cancelar(fusionada.id);
  });

  it('6. fusionar SÍ junta las líneas que comparten precio congelado', async () => {
    // El control del anterior: sin él, meter el precio en la clave de fusión
    // partiría toda línea repetida y la fusión dejaría de fusionar.
    const itemId = await crearProducto('Ron congelado', '2500');

    const cuentaA = await abrirCuenta();
    await agregarLinea(cuentaA, itemId);
    const cuentaB = await abrirCuenta();
    await agregarLinea(cuentaB, itemId);

    const fusionada = await post<CuentaDetalle>(
      `/api/mesas/${mesaId}/cuentas/fusionar`,
      { cuentaIds: [cuentaA, cuentaB] },
    );

    expect(fusionada.lineas).toHaveLength(1);
    expect(fusionada.lineas[0].cantidad).toBe('2.0000');
    expect(fusionada.lineas[0].precioUnitario).toBe('2500.0000');

    await cancelar(fusionada.id);
  });
});
