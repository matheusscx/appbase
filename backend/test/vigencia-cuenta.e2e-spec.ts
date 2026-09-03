import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';

/**
 * **El instante que decide la vigencia por fecha es cuándo se PIDIÓ la línea.**
 *
 * Historia, porque este archivo cambió de premisa y el cambio importa: la Task 3
 * de vigencia (2026-08-23/24) hizo que una venta nacida de una cuenta evaluara
 * contra **la apertura de la cuenta** en vez de "ahora", para que la mesa que se
 * sienta con una promo vigente no la perdiera al pagar tarde. El 2026-08-31, al
 * decidir el owner que *lo pedido se cobra como se pidió*, la línea pasó a
 * congelar sus descuentos y recargos —con su vigencia ya resuelta— **en el
 * momento en que se pide**. Los dos criterios se unificaron en el más fino.
 *
 * Lo que eso cambia, y está fijado por los dos últimos tests de este archivo:
 *   - una línea pedida con el descuento vivo lo conserva aunque venza antes de
 *     cobrar (el caso que la Task 3 vino a resolver: sigue funcionando);
 *   - una cuenta abierta hace una semana con una línea pedida hoy **ya no**
 *     lleva la promo de la semana pasada (esto sí cambió).
 *
 * El caso real ya **no** necesita controlar el reloj: se arma por API abriendo y
 * cerrando la ventana del descuento alrededor del pedido. El SQL directo quedó
 * solo para el caso inverso —cuenta vieja con línea nueva—, que por API no se
 * puede fabricar porque no hay forma de pedirle a `POST /mesas/:id/cuentas` que
 * abra hace una semana. Mismo criterio que `filtros-fecha-zona.e2e-spec.ts`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
// Otro tenant del seed — la cuenta "ajena" del test de aislamiento se
// inserta acá, no en Paris.
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
// Tipo sembrado (`seeder.service.ts` → `seedTiposRegla`), mismo id que usa
// `reglas-valor.e2e-spec.ts`: un descuento `directo` solo exige su valor.
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
// Ítem sembrado del tenant Paris, usado también en `calculo-precios.e2e-spec.ts`.
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440281';

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
  lineas: { id: string; itemId: string; cantidad: string }[];
}
interface VentaDetalle {
  totalDescuentos: string;
  detalles: { itemId: string; descuentoAplicado: string }[];
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

describe('Vigencia por fecha — el instante lo decide el pedido (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let ds: DataSource;
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

  /** Abre una cuenta nueva en la mesa del spec y le agrega UNA línea del ítem dado. */
  async function abrirCuentaCon(itemId: string): Promise<CuentaDetalle> {
    const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    await post(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId,
      cantidad: '1',
    });
    return cuenta;
  }

  /** Cierra sin cobrar (pagos vacíos): alcanza para leer los totales congelados. */
  async function cerrarSinCobrar(cuentaId: string): Promise<string> {
    const cierre = await post<{ ventaId: string }>(
      `/api/cuentas/${cuentaId}/cerrar`,
      { garzonId: garzon.id, pin: garzon.pin, pagos: [] },
    );
    return cierre.ventaId;
  }

  async function detalleVenta(ventaId: string): Promise<VentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as VentaDetalle;
  }

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
    token = await login(app);
    ds = app.get(DataSource);

    const marca = Date.now();

    // ⚠️ Garzón PROPIO, no el del seed. La sesión es única por garzón y el
    // estado se filtra de un spec al siguiente (`jest-e2e.json` corre con
    // `maxWorkers: 1`): compartir a Ana rompe el `iniciar` del siguiente spec.
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón vigencia E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón vigencia E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa vigencia',
      })
    ).id;

    // Cerrar una cuenta genera una venta `canal='fisico'`, que exige caja
    // abierta. Caja propia del spec: no cobra nada de las otras suites y no
    // deja un cajón ocupado para la siguiente.
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
        comentario: 'Apertura E2E vigencia-cuenta',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar: si un paso falla, los que siguen igual tienen
    // que correr — lo que dejen sin limpiar contamina las suites siguientes. El
    // `close` va en un `finally` y la aserción DESPUÉS.
    //
    // ⚠️ Acá el `expect([200, 201]).toContain(conteo.status)` estaba **adentro**
    // de la limpieza y antes del `close`: si el conteo no cuadraba, tiraba ahí
    // mismo, la caja quedaba sin cerrar Y la app de Nest viva con su `@Cron`
    // escribiéndole a la base durante las suites siguientes. Es la trampa exacta
    // que documenta `docs/agent/pendientes.md` § 1. Molde:
    // `caja-testigo.e2e-spec.ts`.
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

      // Ventas sin pagos: el conteo en 0 debería cuadrar. Si no, cerrar con
      // motivo — mismo patrón de dos fases que `salones-comanda.e2e-spec.ts`.
      await limpiar('cerrar caja', async () => {
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${token}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
        if (![200, 201].includes(conteo.status)) return conteo.status;
        if ((conteo.body as { estado?: string }).estado !== 'en_conciliacion') {
          return 200;
        }
        // Sin aserción: este helper DEVUELVE el status en vez de afirmarlo (mirá
        // el `return conteo.status` de arriba), y quien lo llama decide.
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${token}`);
        // status-tolerante: el helper DEVUELVE el status en vez de afirmarlo; decide el llamador
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

  it('un `cuentaId` inexistente es 400, no un silencioso "entonces ahora"', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
        cuentaId: '550e8400-e29b-41d4-a716-4466554409ff',
      });
    expect(res.status).toBe(400);
  });

  it('un `cuentaId` real pero de OTRO tenant es 400: el filtro es tenant_id, no solo la PK', async () => {
    // Cuenta REAL, pero de Falabella. Si `instanteDeVigencia` filtrara solo
    // por `cuenta_id` (sin `AND tenant_id = $2`), esta fila resolvería igual
    // y el 400 nunca saldría — el mismo 400 de arriba, pero por el motivo
    // equivocado. Se inserta por SQL directo: no hace falta levantar
    // salón/mesa/garzón/caja de Falabella solo para tener una fila que
    // `instanteDeVigencia` no necesita más que por su `tenant_id`. `mesa_id`
    // no tiene FK real en el esquema (columna simple en `Cuenta`, sin
    // `@ManyToOne`), así que un UUID inventado no rompe el INSERT.
    const filas: { cuenta_id: string }[] = await ds.query(
      `INSERT INTO cuentas (tenant_id, mesa_id, numero, estado, abierta_el)
       VALUES ($1, $2, 9999, 'abierta', now())
       RETURNING cuenta_id`,
      [FALABELLA_TENANT_ID, randomUUID()],
    );
    const cuentaAjenaId = filas[0].cuenta_id;

    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`) // token de Paris, NO de Falabella
      .send({
        lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
        cuentaId: cuentaAjenaId,
      });
    expect(res.status).toBe(400);
  });

  describe('lo pedido con el descuento vigente lo conserva; lo pedido fuera, no', () => {
    let descuentoId: string;
    let itemId: string;

    beforeAll(async () => {
      // Ventana de vigencia YA VENCIDA respecto de "ahora" (la suite corre
      // 2026-08-24 en adelante): si el service siguiera resolviendo "ahora"
      // como en la Task 3, este descuento NUNCA se aplicaría más.
      const marca = Date.now();
      descuentoId = (
        await post<IdResponse>('/api/descuentos', {
          nombre: `Promo vigencia E2E ${marca}`,
          tipoReglaId: TIPO_DESCUENTO_DIRECTO,
          modo: 'porcentaje',
          valorPorcentaje: '0.20',
          fechaInicio: '2026-08-15',
          fechaFin: '2026-08-20',
        })
      ).id;

      // Ítem propio con el descuento asociado por defecto (`descuentosIds`):
      // `cerrarCuenta` arma sus líneas SIN `descuentoIds` explícito, así que
      // lo que aplica es lo que el ítem trae por defecto
      // (`ItemsService.cargarReglasPorIds`). `tipo: 'servicio'` de propósito:
      // sin fila en `item_producto`, cerrar la cuenta no exige stock.
      itemId = (
        await post<IdResponse>('/api/items', {
          nombre: `Servicio vigencia E2E ${marca}`,
          tipo: 'servicio',
          precioBase: '10000',
          monedaId: CLP_MONEDA_ID,
          descuentosIds: [descuentoId],
        })
      ).id;
    });

    it('con la cuenta abierta AHORA (fuera de la ventana del descuento), no lo lleva', async () => {
      // Ancla negativa: sin este control, "aplica el descuento" podría estar
      // pasando porque el descuento se cuela por cualquier otro motivo, no
      // porque el instante venga de la cuenta.
      const cuenta = await abrirCuentaCon(itemId);
      const venta = await detalleVenta(await cerrarSinCobrar(cuenta.id));

      expect(Number(venta.totalDescuentos)).toBe(0);
      const linea = venta.detalles.find((d) => d.itemId === itemId);
      expect(linea).toBeDefined();
      expect(Number(linea!.descuentoAplicado)).toBe(0);
    });

    it('la línea PEDIDA con el descuento vigente lo lleva aunque venza antes de cobrar', async () => {
      // ⚠️ **Este test cambió de premisa el 2026-08-31, y el cambio es de regla,
      // no de fixture.** Antes backdateaba `cuentas.abierta_el` y afirmaba que
      // el instante lo decidía **la apertura de la cuenta**. Desde que la línea
      // congela sus reglas al pedirse (owner: *lo pedido se cobra como se
      // pidió*), el instante lo decide **cuándo se pidió la línea**, que es más
      // fino y es lo que el owner describió con su escena de las cervezas: las
      // pedidas antes de las 20:00 no llevan el 2x1 y las de 20:15 sí, aunque
      // sea la misma mesa.
      //
      // La consecuencia práctica: una cuenta abierta hace una semana con una
      // línea pedida hoy ya **no** lleva la promo de la semana pasada. Esa
      // combinación era la que el test viejo fabricaba por SQL.
      //
      // Y el caso real —pedir con la promo viva, cobrar después de que venció—
      // ahora se arma **sin tocar el reloj**: se pide con la ventana abierta y
      // se la vence antes de cobrar.
      const resAbrir = await request(app.getHttpServer())
        .patch(`/api/descuentos/${descuentoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ fechaInicio: '2026-08-15', fechaFin: '2099-12-31' });
      expect(resAbrir.status).toBe(200);

      const cuenta = await abrirCuentaCon(itemId);

      const resVencer = await request(app.getHttpServer())
        .patch(`/api/descuentos/${descuentoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ fechaInicio: '2026-08-15', fechaFin: '2026-08-20' });
      expect(resVencer.status).toBe(200);

      const venta = await detalleVenta(await cerrarSinCobrar(cuenta.id));

      // 20% de 10000 = 2000. El total de la venta también sube de precio con
      // impuesto, así que se afirma sobre `descuentoAplicado`, que no lo
      // arrastra.
      expect(Number(venta.totalDescuentos)).toBeGreaterThan(0);
      const linea = venta.detalles.find((d) => d.itemId === itemId);
      expect(linea).toBeDefined();
      expect(Number(linea!.descuentoAplicado)).toBeCloseTo(2000, 4);
    });

    it('y una cuenta VIEJA con una línea pedida hoy NO lo lleva', async () => {
      // El reverso del anterior, y lo que cambió de verdad: acá el reloj sí se
      // controla, para dejar la cuenta abierta dentro de la ventana con la línea
      // pedida fuera. Antes esto llevaba descuento (mandaba la apertura); ahora
      // no (manda el pedido).
      const cuenta = await abrirCuentaCon(itemId);
      await ds.query(
        `UPDATE cuentas SET abierta_el = '2026-08-17T12:00:00Z' WHERE cuenta_id = $1`,
        [cuenta.id],
      );

      const venta = await detalleVenta(await cerrarSinCobrar(cuenta.id));

      expect(Number(venta.totalDescuentos)).toBe(0);
      const linea = venta.detalles.find((d) => d.itemId === itemId);
      expect(Number(linea!.descuentoAplicado)).toBe(0);
    });
  });
});
