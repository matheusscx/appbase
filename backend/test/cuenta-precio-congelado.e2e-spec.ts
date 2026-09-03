import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
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
// Tipo sembrado (`seedTiposRegla`): un descuento `directo` solo exige su valor.
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';

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
interface VentaDetalle {
  totalFinal: string;
  totalDescuentos: string;
  detalles: {
    itemId: string;
    precioUnitario: string;
    precioUnitarioOrigen: string;
    tasaCambio: string;
    descuentoAplicado: string;
    personalizacion: unknown;
  }[];
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

  async function crearDescuento(
    nombre: string,
    valorPorcentaje: string,
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/descuentos', {
        nombre: `${nombre} ${Date.now()}`,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'porcentaje',
        valorPorcentaje,
        nivel: 'linea',
      })
    ).id;
  }

  async function asociarDescuento(
    itemId: string,
    descuentoId: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ descuentosIds: [descuentoId] });
    expect(res.status).toBe(200);
  }

  async function desasociarDescuentos(itemId: string): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ descuentosIds: [] });
    expect(res.status).toBe(200);
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

  async function crearIngrediente(nombre: string): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${nombre} ${Date.now()}`,
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '100',
      })
    ).id;
  }

  async function crearReceta(
    nombre: string,
    ingredienteId: string,
    gruposModificadores: unknown[] = [],
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${nombre} ${Date.now()}`,
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: ingredienteId,
            cantidad: '1',
            unidadCodigoPresentacion: undefined,
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        ...(gruposModificadores.length ? { gruposModificadores } : {}),
      })
    ).id;
  }

  async function crearGrupo(nombre: string, itemId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `${nombre} ${Date.now()}`,
        opciones: [{ itemId, cantidad: '1', precioExtra: '300' }],
      });
    expect(res.status).toBe(201);
    return (res.body as { grupoModificadorId: string }).grupoModificadorId;
  }

  /**
   * La precuenta, por el mismo camino que la pantalla: manda `cuentaId` y las
   * líneas armadas del catálogo vivo. El servidor tiene que ignorar esas líneas.
   *
   * ⚠️ **La personalización va en el body a propósito.** Sin ella `calcular` ni
   * siquiera intenta resolver el combo, así que devuelve 201 también en el mundo
   * roto y la aserción no cierra nada: medido, con el arreglo desactivado los
   * tests que la omitían seguían pasando. La pantalla manda el snapshot
   * remapeado, y es lo que producía el 400.
   */
  async function precuenta(
    cuentaId: string,
    lineas: unknown[],
  ): Promise<{ status: number; totalFinal?: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({ cuentaId, lineas });
    return {
      status: res.status,
      totalFinal: (res.body as { totales?: { totalFinal: string } }).totales
        ?.totalFinal,
    };
  }

  /** Cierra sin cobrar (pagos vacíos): alcanza para leer los totales congelados. */
  async function cerrar(cuentaId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: garzon.pin, pagos: [] });
    expect(res.status).toBe(201);
    return (res.body as { ventaId: string }).ventaId;
  }

  async function venta(ventaId: string): Promise<VentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as VentaDetalle;
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
        // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
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

  it('5. la escena del owner: sale un descuento con la mesa sentada y el próximo pedido es OTRA línea', async () => {
    // *"Me siento y pido una hamburguesa a $5.000. Sale un descuento para la
    // misma hamburguesa. Si me pido otra, esa sí sale con el descuento."*
    // (owner, 2026-08-30). El precio de lista NO se mueve, así que el primer
    // término del criterio —el precio congelado— no ve nada: lo que distingue
    // las dos líneas son las reglas congeladas.
    const itemId = await crearProducto('Hamburguesa del owner', '5000');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    const descuentoId = await crearDescuento('Promo hamburguesa', '0.20');
    await asociarDescuento(itemId, descuentoId);

    await agregarLinea(cuentaId, itemId);

    const { lineas } = await detalle(cuentaId);
    expect(lineas).toHaveLength(2);
    // Las dos al mismo precio de lista: lo que las separa es el descuento.
    for (const l of lineas) {
      expect(l.precioUnitario).toBe('5000.0000');
      expect(l.cantidad).toBe('1.0000');
    }

    await cancelar(cuentaId);
  });

  it('6. sacar el descuento también parte la línea, y volver a ponerlo la reúne', async () => {
    // Las dos direcciones del mismo término, y el control de que la huella no
    // es "cambió algo" sino "cambió a QUÉ": con el descuento puesto de nuevo, el
    // tercer pedido vuelve a fusionarse con el segundo.
    const itemId = await crearProducto('Papas del owner', '2000');
    const descuentoId = await crearDescuento('Promo papas', '0.10');
    await asociarDescuento(itemId, descuentoId);

    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    await desasociarDescuentos(itemId);
    await agregarLinea(cuentaId, itemId);

    await asociarDescuento(itemId, descuentoId);
    await agregarLinea(cuentaId, itemId);

    const { lineas } = await detalle(cuentaId);
    // Con descuento: la 1ª y la 3ª, fusionadas. Sin descuento: la 2ª, sola.
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.cantidad).sort()).toEqual(['1.0000', '2.0000']);

    await cancelar(cuentaId);
  });

  it('7. AL COBRAR se usa el precio congelado, no el de la carta de hoy', async () => {
    // La mitad que hace que todo lo anterior sirva. Hasta el 2026-08-31
    // `cerrarCuenta` desarmaba la línea y el motor la re-tasaba contra el
    // catálogo vivo: la mesa pagaba $6.000 por algo que pidió a $5.000.
    const itemId = await crearProducto('Lomito del cobro', '5000');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    await repreciar(itemId, '6000');

    const detalleVenta = await venta(await cerrar(cuentaId));
    const linea = detalleVenta.detalles.find((d) => d.itemId === itemId);
    expect(linea?.precioUnitario).toBe('5000.0000');
  });

  it('8. AL COBRAR el descuento es el congelado: uno nuevo no alcanza a la mesa sentada', async () => {
    // *"Poner un 20% con la mesa sentada no le llega a esa mesa"* (owner).
    const itemId = await crearProducto('Ceviche del cobro', '10000');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    const descuentoId = await crearDescuento('Promo ceviche', '0.20');
    await asociarDescuento(itemId, descuentoId);

    const detalleVenta = await venta(await cerrar(cuentaId));
    expect(detalleVenta.detalles[0].descuentoAplicado).toBe('0.0000');
  });

  it('9. AL COBRAR el descuento que SÍ regía se aplica, aunque después se saque', async () => {
    // La otra dirección, y el control del anterior: sin él, un guard que
    // simplemente ignorara los descuentos pasaría el test 8 y estaría mal.
    const itemId = await crearProducto('Machas del cobro', '10000');
    const descuentoId = await crearDescuento('Promo machas', '0.20');
    await asociarDescuento(itemId, descuentoId);

    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    await desasociarDescuentos(itemId);

    const detalleVenta = await venta(await cerrar(cuentaId));
    expect(detalleVenta.detalles[0].descuentoAplicado).toBe('2000.0000');
  });

  it('10. la venta guarda un precio COHERENTE: origen × tasa = lo cobrado', async () => {
    // `venta_detalles` guarda las tres cosas —precio en la moneda del ítem, tasa
    // y precio final— y son la trazabilidad de por qué se cobró eso. Congelar
    // solo el final las deja contradiciéndose: el ítem en USD repreciado daría
    // un origen de hoy contra un final de ayer. En CLP (tasa 1) no se ve, así
    // que el caso va en USD a propósito.
    const itemId = await crearProducto('Malbec del cobro', '10', USD_MONEDA_ID);
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    await repreciar(itemId, '20');

    const detalleVenta = await venta(await cerrar(cuentaId));
    const d = detalleVenta.detalles[0];
    expect(d.precioUnitario).toBe('9500.0000');
    expect(
      new Decimal(d.precioUnitarioOrigen).times(d.tasaCambio).toFixed(4),
    ).toBe(d.precioUnitario);
  });

  it('11. si cambia la TASA de cambio, la mesa igual paga lo congelado', async () => {
    // El caso que hace falta el precio congelado y no solo el origen: con la
    // tasa de hoy, convertir el origen congelado da lo mismo y el congelado
    // parece redundante. Cambiando la tasa deja de serlo — y sin este test un
    // mutante que ignore `precioUnitario` sobrevive (medido).
    const itemId = await crearProducto('Whisky del cobro', '10', USD_MONEDA_ID);
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    const resTasa = await request(app.getHttpServer())
      .patch(`/api/monedas/${USD_MONEDA_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorDelDia: '1900' });
    expect(resTasa.status).toBe(200);

    try {
      const d = (await venta(await cerrar(cuentaId))).detalles[0];
      // 10 USD × 950 (la tasa de cuando pidió), no × 1900.
      expect(d.precioUnitario).toBe('9500.0000');
      expect(d.tasaCambio).toBe('950.000000');
      expect(
        new Decimal(d.precioUnitarioOrigen).times(d.tasaCambio).toFixed(4),
      ).toBe(d.precioUnitario);
    } finally {
      // La tasa es del tenant y la comparten todas las suites: dejarla movida
      // rompe cualquier spec que convierta USD después de ésta.
      const restaurar = await request(app.getHttpServer())
        .patch(`/api/monedas/${USD_MONEDA_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ valorDelDia: '950' });
      expect(restaurar.status).toBe(200);
    }
  });

  it('12. la PRECUENTA muestra exactamente lo que se va a cobrar', async () => {
    // El bug que aparece si el cobro se congela y la pantalla no: el garzón ve
    // un total y la venta guarda otro. Medido antes del arreglo: la precuenta
    // decía 7.140 y la venta 5.950 para la misma mesa, y el cajero le cobraba
    // al cliente el de la pantalla.
    const itemId = await crearProducto('Pastel del cobro', '5000');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    await repreciar(itemId, '6000');

    // El body que arma la pantalla: las líneas salen del catálogo vivo, así que
    // mandan el precio nuevo. El servidor tiene que ignorarlas.
    const resPrecuenta = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({ cuentaId, lineas: [{ itemId, cantidad: '1' }] });
    expect(resPrecuenta.status).toBe(201);
    const precuenta = resPrecuenta.body as {
      totales: { totalFinal: string };
      lineas: { precioUnitario: string }[];
    };
    expect(precuenta.lineas[0].precioUnitario).toBe('5000.0000');

    const detalleVenta = await venta(await cerrar(cuentaId));
    expect(detalleVenta.detalles[0].precioUnitario).toBe('5000.0000');
    // Y el total de punta a punta, que es lo que el cliente paga.
    // Comparación numérica y no de string: la previsualización devuelve 6
    // decimales y la venta persiste 4 — diferencia de formato preexistente, no
    // de plata.
    expect(
      new Decimal(detalleVenta.totalFinal).eq(precuenta.totales.totalFinal),
    ).toBe(true);
  });

  it('13. subirle el valor al descuento también parte la línea', async () => {
    // El tercer escenario del plan, y el que prueba que se congela el VALOR y no
    // el id: la regla es la misma —mismo id, mismo nombre, sigue asociada— y lo
    // único que cambió es cuánto descuenta.
    const itemId = await crearProducto('Completo del owner', '3500');
    const descuentoId = await crearDescuento('Promo completo', '0.20');
    await asociarDescuento(itemId, descuentoId);

    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId);

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${descuentoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorPorcentaje: '0.30' });
    expect(res.status).toBe(200);

    await agregarLinea(cuentaId, itemId);

    const { lineas } = await detalle(cuentaId);
    expect(lineas).toHaveLength(2);
    for (const l of lineas) expect(l.cantidad).toBe('1.0000');

    await cancelar(cuentaId);
  });

  it('14. la mesa se cobra aunque le agreguen un grupo OBLIGATORIO al plato', async () => {
    // El agujero medido el 2026-08-30: `PATCH /items/:id` asociando un grupo con
    // `min: 1` devuelve 200, y a partir de ahí toda línea abierta de ese plato
    // deja de poder tasarse ("El grupo X requiere elegir entre 1 y 1 unidades").
    // La mesa quedaba incobrable y nadie se enteraba hasta el cobro.
    const ingredienteId = await crearIngrediente('Pan incobrable');
    const recetaId = await crearReceta('Hamburguesa incobrable', ingredienteId);

    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, recetaId);

    const opcionId = await crearProducto('Punto de cocción', '0');
    const grupoId = await crearGrupo('Punto incobrable', opcionId);
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        gruposModificadores: [{ grupoModificadorId: grupoId, min: 1, max: 1 }],
      });
    expect(resPatch.status).toBe(200);

    // Y la PANTALLA también: si la precuenta se rompiera, el garzón no podría ni
    // abrir el cobro —`abrirCobro()` gatea en el cálculo— y la mesa seguiría
    // trabada aunque el cierre funcione por API.
    //
    // ⚠️ En ESTE caso la precuenta nunca estuvo rota: sin extras ni grupos
    // elegidos, `puedeCostar` saltea el resolver y no llega a validar el grupo
    // obligatorio, así que devolvía 201 igual. Es un control de que no se rompa,
    // no el candado del arreglo — ése es el test 15, cuyo combo sí re-resolvía.
    expect(
      (
        await precuenta(cuentaId, [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: { omitidos: [], extras: [] },
          },
        ])
      ).status,
    ).toBe(201);

    const detalleVenta = await venta(await cerrar(cuentaId));
    expect(detalleVenta.detalles[0].precioUnitario).toBe('4000.0000');
  });

  it('15. y aunque le saquen al combo el componente que la línea personalizó', async () => {
    // El otro agujero medido: `PATCH /items/:id` con `componentes` sacando el
    // componente que la línea eligió → "El componente no pertenece a este combo
    // o no admite grupos" al re-tasar.
    const ingredienteId = await crearIngrediente('Pan combo incobrable');
    const opcionId = await crearProducto('Salsa combo', '0');
    const grupoId = await crearGrupo('Salsa combo grupo', opcionId);
    const recetaId = await crearReceta(
      'Hamburguesa combo incobrable',
      ingredienteId,
      [{ grupoModificadorId: grupoId, min: 1, max: 1 }],
    );
    const bebidaId = await crearProducto('Bebida combo', '1000');
    const comboId = (
      await post<IdResponse>('/api/items', {
        nombre: `Combo incobrable ${Date.now()}`,
        precioBase: '6000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: recetaId, cantidad: '1', bloqueante: true },
          { componenteItemId: bebidaId, cantidad: '1', bloqueante: true },
        ],
      })
    ).id;

    const cuentaId = await abrirCuenta();
    await post(`/api/cuentas/${cuentaId}/lineas`, {
      itemId: comboId,
      cantidad: '1',
      personalizacion: {
        componentes: [
          {
            componenteItemId: recetaId,
            unidad: 1,
            grupos: [
              { grupoId, opciones: [{ itemId: opcionId, unidades: 1 }] },
            ],
          },
        ],
      },
    });

    const resPatch = await request(app.getHttpServer())
      .patch(`/api/items/${comboId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        componentes: [
          { componenteItemId: bebidaId, cantidad: '1', bloqueante: true },
        ],
      });
    expect(resPatch.status).toBe(200);

    expect(
      // El body que arma la pantalla de verdad: el snapshot remapeado. Es lo
      // que producía el 400 antes del arreglo.
      (
        await precuenta(cuentaId, [
          {
            itemId: comboId,
            cantidad: '1',
            personalizacion: {
              omitidos: [],
              extras: [],
              componentes: [
                {
                  componenteItemId: recetaId,
                  unidad: 1,
                  grupos: [
                    { grupoId, opciones: [{ itemId: opcionId, unidades: 1 }] },
                  ],
                },
              ],
            },
          },
        ])
      ).status,
    ).toBe(201);

    // Se cobra —antes era un 400 para la cuenta entera— y con el precio que se
    // congeló: 6.000 del combo + 300 de la salsa que el cliente eligió. La
    // opción sigue cobrándose aunque su componente ya no esté en el combo, que
    // es exactamente lo que "lo pedido se cobra como se pidió" quiere decir.
    const detalleVenta = await venta(await cerrar(cuentaId));
    expect(detalleVenta.detalles[0].precioUnitario).toBe('6300.0000');
    // Y el snapshot llegó ENTERO, medido por su efecto: la salsa que el cliente
    // eligió se descontó del stock. Si la personalización se hubiera vuelto a
    // resolver, ese componente ya no está en el combo y la opción no se
    // consumiría — sin esta aserción, el test pasaba solo por el precio
    // congelado y un mutante que re-resolviera sobrevivía (medido).
    const resSalsa = await request(app.getHttpServer())
      .get(`/api/items/${opcionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resSalsa.status).toBe(200);
    expect((resSalsa.body as { stock: string }).stock).toBe('99.0000');
  });

  it('16. una línea BORRADA de la cuenta no se previsualiza ni se cobra', async () => {
    // El candado del `eliminado_el IS NULL` de la consulta que arma la precuenta
    // desde la cuenta. Sin ese filtro vuelve exactamente la divergencia que este
    // frente mató: medido con el filtro sacado, la precuenta daba 3.570 y la
    // venta 1.190. El código lo tiene; esto impide que alguien lo saque.
    const itemId = await crearProducto('Sopaipilla borrada', '1000');
    const cuentaId = await abrirCuenta();
    await agregarLinea(cuentaId, itemId, '2');

    const { lineas } = await detalle(cuentaId);
    const resQuitar = await request(app.getHttpServer())
      .delete(`/api/cuentas/${cuentaId}/lineas/${lineas[0].id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resQuitar.status).toBe(200);

    const otroId = await crearProducto('Sopaipilla viva', '1000');
    await agregarLinea(cuentaId, otroId);

    const pre = await precuenta(cuentaId, [{ itemId: otroId, cantidad: '1' }]);
    expect(pre.status).toBe(201);

    const detalleVenta = await venta(await cerrar(cuentaId));
    expect(detalleVenta.detalles).toHaveLength(1);
    expect(new Decimal(detalleVenta.totalFinal).eq(pre.totalFinal!)).toBe(true);
  });

  it('17. fusionar dos cuentas no mezcla precios congelados distintos', async () => {
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

  it('18. fusionar tampoco mezcla reglas congeladas distintas', async () => {
    // El tercer término, por la puerta de la fusión. Los dos criterios de merge
    // tienen que moverse juntos: cuando el precio entró, esta puerta quedó
    // afuera y hubo que volver.
    const itemId = await crearProducto('Chorrillana del owner', '8000');

    const cuentaA = await abrirCuenta();
    await agregarLinea(cuentaA, itemId);

    const descuentoId = await crearDescuento('Promo chorrillana', '0.15');
    await asociarDescuento(itemId, descuentoId);

    const cuentaB = await abrirCuenta();
    await agregarLinea(cuentaB, itemId);

    const fusionada = await post<CuentaDetalle>(
      `/api/mesas/${mesaId}/cuentas/fusionar`,
      { cuentaIds: [cuentaA, cuentaB] },
    );

    expect(fusionada.lineas).toHaveLength(2);
    for (const l of fusionada.lineas) {
      expect(l.precioUnitario).toBe('8000.0000');
      expect(l.cantidad).toBe('1.0000');
    }

    await cancelar(fusionada.id);
  });

  it('19. fusionar SÍ junta las líneas que comparten precio congelado', async () => {
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
