import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
/** Turno de la mañana del seed, el mismo que usa `salones-anular-linea`. */
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
interface CuentaDetalle {
  id: string;
  lineas: { id: string; itemId: string }[];
}
interface VarianzaFilaResp {
  itemId: string;
  medible: boolean;
  teorico: string | null;
  merma: string | null;
  cortesia: string | null;
  sinExplicacion: string | null;
  otros: string | null;
}

/**
 * La **clasificación** de cada movimiento en su bucket, contra Postgres real.
 *
 * ⛔ **Es el único lugar donde esto se puede probar.** El spec unitario
 * (`varianza.service.spec.ts`) tiene `Db` mockeado, así que el mock devuelve los
 * buckets **ya clasificados** y la lógica del `FILTER (WHERE …)` nunca se
 * ejerce: medido el 2026-09-20, mutar el filtro de `merma` para que se comiera
 * también la cortesía dejó los 18 unitarios en verde. Lo que aquellos cubren es
 * el mapeo y el formato; lo que se clasifica se prueba acá.
 *
 * El caso con más riesgo es **merma contra cortesía**: las dos escriben el mismo
 * `motivo='merma'` en el kardex (`items.service.ts`, `resolverContexto`) y solo
 * las separa `motivo_baja.tipo`. Por eso la cortesía se genera por su camino
 * real —anular una línea despachada en una mesa— y no por `/api/mermas`, que
 * rechaza a propósito todo motivo que no sea de tipo `merma`.
 *
 * Va en un archivo aparte del e2e de la ventana porque necesita el andamiaje
 * completo de salones (impresora, categoría, garzón propio, salón, mesa y caja
 * abierta), que allá sería peso muerto.
 */
describe('Reporte de varianza — clasificación de buckets (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let localId: string;
  let motivoMermaId: string;
  let motivoCortesiaId: string;
  let motivoDiferenciaId: string;
  let categoriaId: string;
  let garzon: GarzonCreado;
  let mesaId: string;
  let caja: CajaAbierta;

  async function post<T>(url: string, body: object): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
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

    const resUbic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(resUbic.status).toBe(200);
    localId = (resUbic.body as { id: string; tipo: string }[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    const motivos = resMotivos.body as { id: string; tipo: string }[];
    motivoMermaId = motivos.find((m) => m.tipo === 'merma')!.id;
    motivoCortesiaId = motivos.find((m) => m.tipo === 'cortesia')!.id;

    const resDif = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    expect(resDif.status).toBe(200);
    motivoDiferenciaId = (resDif.body as { id: string }[])[0].id;

    const marca = Date.now();

    // Sin impresora, `reclamarComanda` nunca avanza `cantidadEnviada` y el
    // tope de la anulación —lo despachado— queda siempre en cero.
    const impresoraId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina varianza E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-varianza-e2e-${marca}`,
      })
    ).id;
    categoriaId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Cocina varianza E2E ${marca}`,
        impresoraId,
      })
    ).id;

    // ⚠️ Garzón PROPIO: la sesión es única por garzón y varias specs comparten
    // el del seed (`docs/agent/pendientes.md`).
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón varianza E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón varianza E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa varianza',
      })
    ).id;

    // Vender por el POS y cerrar una cuenta generan ventas `canal='fisico'`,
    // que exigen caja abierta.
    caja = await abrirCaja(app, token, {
      saldoInicial: '0.0000',
      comentario: 'Apertura E2E varianza buckets',
    });
  }, 90000);

  /**
   * ⛔ **La caja se CIERRA, y no es higiene opcional.** Solo puede haber una
   * abierta por tenant+usuario, así que dejarla viva rompe a toda suite
   * posterior que abra la suya — medido el 2026-09-20: este teardown faltaba y
   * cayeron **17 suites**, ninguna con relación aparente con varianza. El
   * síntoma no apunta acá: son 409 y 400 crípticos repartidos por el resto de
   * la corrida.
   *
   * `cerrarCaja` del helper compartido y no un `POST` a mano: asegura las dos
   * fases —conteo y, si descuadra, cierre con motivo— y afirma sobre cada
   * status, así que un cierre roto se ve en esta suite y no en la siguiente.
   */
  afterAll(async () => {
    try {
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  async function crearProducto(stock: string): Promise<string> {
    const item = await post<IdResponse>('/api/items', {
      nombre: `Varianza buckets E2E ${Date.now()}-${Math.random()}`,
      tipo: 'producto',
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      unidadMedida: 'unidad',
      stock,
      costo: '100',
      categoriaId,
    });
    return item.id;
  }

  async function contarYAplicar(
    itemId: string,
    cantidadContada: string,
  ): Promise<void> {
    const recuento = await post<IdResponse>('/api/recuentos', {
      ubicacionId: localId,
      itemIds: [itemId],
    });

    const resDetalle = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuento.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const lineaId = (
      resDetalle.body as { lineas: { lineaId: string; itemId: string }[] }
    ).lineas.find((l) => l.itemId === itemId)!.lineaId;

    const resConteo = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuento.id}/lineas/${lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada, motivoDiferenciaId });
    expect(resConteo.status).toBe(200);

    await post(`/api/recuentos/${recuento.id}/aplicar`, {});
  }

  /**
   * Vende por el POS. **Siempre sin pagos**, o sea la venta queda `pendiente`.
   *
   * ⛔ **Nunca con pago en efectivo, y el motivo costó una corrida entera.** El
   * `afterAll` cierra la caja con `cerrarCaja`, que cuenta EXACTAMENTE el saldo
   * inicial; una venta cobrada en efectivo la descuadra, el cierre falla dentro
   * del teardown y **la caja queda abierta**. Como solo puede haber una por
   * tenant+usuario, eso rompe a toda suite posterior que abra la suya — medido
   * el 2026-09-20: 17 suites caídas con 409 y 400 crípticos, ninguna
   * relacionada con varianza.
   *
   * Para lo que este spec mide, el pago es irrelevante: **el stock se descuenta
   * al crear la venta**, no al cobrarla. Y de yapa toda venta queda
   * `pendiente`, que es el único estado anulable.
   *
   * La caja igual tiene que estar abierta: una venta `canal='fisico'` la exige.
   */
  async function vender(itemId: string, cantidad: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad }] });
    expect(res.status).toBe(201);
    return (res.body as IdResponse).id;
  }

  /** Anula una línea despachada con el motivo dado: el camino real de la cortesía. */
  async function anularEnMesa(
    itemId: string,
    cantidad: string,
    motivoBajaId: string,
  ): Promise<void> {
    const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    await post(`/api/cuentas/${cuenta.id}/lineas`, { itemId, cantidad });
    await post(`/api/cuentas/${cuenta.id}/comanda/reclamar`, {});

    const resCuentas = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(resCuentas.status).toBe(200);
    const detalle = (resCuentas.body as CuentaDetalle[]).find(
      (c) => c.id === cuenta.id,
    )!;
    const lineaId = detalle.lineas.find((l) => l.itemId === itemId)!.id;

    const resAnular = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuenta.id}/lineas/${lineaId}/anular`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidad, motivoBajaId });
    expect(resAnular.status).toBe(201);
  }

  async function filaDe(itemId: string): Promise<VarianzaFilaResp> {
    const res = await request(app.getHttpServer())
      .get(`/api/reportes/varianza?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fila = (res.body as { data: VarianzaFilaResp[] }).data.find(
      (f) => f.itemId === itemId,
    );
    expect(fila).toBeDefined();
    return fila!;
  }

  /**
   * El teórico son las salidas `motivo='venta'`: lo que el sistema descontó al
   * vender. En un producto simple es la cantidad vendida; en una receta serían
   * sus ingredientes, con la receta vigente en ese momento.
   */
  it('una venta va al teórico y no a los otros buckets', async () => {
    const itemId = await crearProducto('300');
    await contarYAplicar(itemId, '300');

    await vender(itemId, '9');

    await contarYAplicar(itemId, '291');

    const fila = await filaDe(itemId);

    expect(fila.teorico).toBe('9.0000');
    expect(fila.merma).toBe('0.0000');
    expect(fila.cortesia).toBe('0.0000');
    expect(fila.sinExplicacion).toBe('0.0000');
  });

  /**
   * ⛔ **El teórico es NETO.** Cancelar una venta repone los ingredientes al
   * kardex con `motivo='anulacion'`, así que esa entrada tiene que **restar**
   * del teórico. Si no restara, el reporte diría que se consumió algo que
   * volvió al stock.
   *
   * Las cantidades discriminan: se venden 11 y se cancelan 4. Con la resta el
   * teórico es 11; sin ella sería 15. Con dos cantidades iguales el bug pasaría
   * el test.
   */
  it('una venta cancelada resta del teórico, no suma', async () => {
    const itemId = await crearProducto('300');
    await contarYAplicar(itemId, '300');

    await vender(itemId, '11');
    const ventaCancelable = await vender(itemId, '4');

    const resAnular = await request(app.getHttpServer())
      .post(`/api/ventas/${ventaCancelable}/anular`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivo: 'E2E varianza: teórico neto' });
    expect(resAnular.status).toBe(201);

    await contarYAplicar(itemId, '289'); // 300 - 11

    const fila = await filaDe(itemId);

    expect(fila.teorico).toBe('11.0000');
    expect(fila.sinExplicacion).toBe('0.0000');
  });

  /**
   * ⛔ **El test que el unitario no puede dar.** Merma y cortesía escriben el
   * MISMO `motivo='merma'`; si el `FILTER` por `motivo_baja.tipo` se rompe, los
   * dos números se mezclan y nadie se entera.
   *
   * Las cantidades son **distintas y primas entre sí** (3 y 7): con las dos en
   * el mismo valor, un bug que las sume al lado equivocado pasaría el test.
   */
  it('separa merma de cortesía aunque las dos sean motivo=merma en el kardex', async () => {
    const itemId = await crearProducto('200');
    await contarYAplicar(itemId, '200'); // borde inicial, delta cero

    await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        ubicacionId: localId,
        cantidad: '3',
        motivoBajaId: motivoMermaId,
        comentario: 'Merma E2E varianza',
      })
      .expect(201);

    await anularEnMesa(itemId, '7', motivoCortesiaId);

    await contarYAplicar(itemId, '190'); // borde final

    const fila = await filaDe(itemId);

    expect(fila.medible).toBe(true);
    expect(fila.merma).toBe('3.0000');
    expect(fila.cortesia).toBe('7.0000');
  });

  /**
   * ⛔ **La identidad de la spec § 5.4, corriendo contra Postgres real.** Con los
   * dos bordes apoyados en conteos aplicados, el consumo calculado por SALDOS y
   * el calculado por BUCKETS son la misma cuenta, así que «Otros» vale cero.
   *
   * El escenario mezcla de todo a propósito —compra, venta, venta cancelada,
   * merma, cortesía y un faltante descubierto al contar—, porque un cero con un
   * solo tipo de movimiento no prueba que la identidad cierre: prueba que casi
   * no hay nada que sumar.
   */
  it('con movimientos de todos los tipos, la identidad cierra y Otros da cero', async () => {
    const itemId = await crearProducto('200');
    await contarYAplicar(itemId, '200');

    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '30',
        costoUnitario: '100',
      })
      .expect(200);

    await vender(itemId, '17');
    const cancelable = await vender(itemId, '5');
    await request(app.getHttpServer())
      .post(`/api/ventas/${cancelable}/anular`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivo: 'E2E identidad' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        ubicacionId: localId,
        cantidad: '3',
        motivoBajaId: motivoMermaId,
        comentario: 'Merma E2E identidad',
      })
      .expect(201);

    await anularEnMesa(itemId, '2', motivoCortesiaId);

    // 200 + 30 − 17 − 3 − 2 = 208 en el libro; se cuentan 204 → faltan 4.
    await contarYAplicar(itemId, '204');

    const fila = await filaDe(itemId);

    expect(fila.medible).toBe(true);
    expect(fila.teorico).toBe('17.0000');
    expect(fila.merma).toBe('3.0000');
    expect(fila.cortesia).toBe('2.0000');
    expect(fila.sinExplicacion).toBe('4.0000');
    expect(fila.otros).toBe('0.0000');
  });

  /**
   * ⛔ **El caso que «Otros» existe para detectar: un movimiento que ningún
   * bucket clasifica.**
   *
   * `ajuste_manual` no es consumo —no lo captura teórico, merma, cortesía ni
   * recuento— ni abastecimiento (no está en `MOTIVOS_ABASTECIMIENTO`). Mueve
   * stock igual, así que corre el saldo del borde final y el residuo lo hace
   * visible por su cantidad exacta.
   *
   * ⚠️ **Se monta por la API real**, con el mismo `PATCH /items/:id/stock` que
   * este archivo ya usa para las compras: `AjusteStockDto` acepta
   * `['compra','devolucion','ajuste_manual','inventario_inicial']` y
   * `ItemsService.ajustarStock` pasa el motivo tal cual al kardex, que actualiza
   * `stock_ubicacion` dentro de su choke-point. Nada de SQL directo, ninguna
   * invariante tocada.
   *
   * 📌 Y esto importa en producción, no solo como test: **todo tenant que use
   * "Ajustar stock" dentro de una ventana va a ver «Otros» distinto de cero**.
   * Es la conducta correcta —el reporte avisa que hay algo que no sabe
   * explicar— y este test es lo que la fija.
   */
  it('un ajuste manual no lo clasifica ningún bucket y aparece entero en Otros', async () => {
    const itemId = await crearProducto('100');
    await contarYAplicar(itemId, '100');

    await vender(itemId, '10');

    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'salida',
        motivo: 'ajuste_manual',
        ubicacionId: localId,
        cantidad: '6',
        comentario: 'Ajuste que ningún bucket clasifica',
      })
      .expect(200);

    await contarYAplicar(itemId, '84'); // 100 − 10 − 6, sin diferencia

    const fila = await filaDe(itemId);

    expect(fila.teorico).toBe('10.0000');
    expect(fila.merma).toBe('0.0000');
    expect(fila.cortesia).toBe('0.0000');
    expect(fila.sinExplicacion).toBe('0.0000');
    expect(fila.otros).toBe('6.0000');
  });

  /**
   * ⛔ **Una `devolucion` MANUAL no es una venta revertida, y no puede bajar el
   * teórico.** El mismo `PATCH /items/:id/stock` acepta `motivo: 'devolucion'`
   * sin ninguna venta detrás. Antes de este arreglo, el teórico restaba **toda**
   * entrada `devolucion`/`anulacion` sin mirar el origen, así que un ajuste
   * manual hacía bajar el consumo teórico —o lo ponía en negativo— como si
   * hubiera revertido una venta que nunca existió.
   *
   * El filtro es `venta_id IS NOT NULL`: las tres escrituras que vienen de una
   * venta lo llevan (`cancelarUnaVez` y las dos de nota de crédito), y
   * `ajustarStock` no lo pasa nunca. Con eso, la devolución manual deja de
   * ensuciar el teórico y cae donde corresponde: en «Otros».
   *
   * Los números discriminan: se venden 12 y entran 4 por devolución manual. Con
   * el filtro, teórico 12 y otros −4. Sin el filtro, teórico 8 y otros 0 — el
   * bug pasaría inadvertido porque «Otros» seguiría en cero.
   */
  it('una devolución manual sin venta no baja el teórico: cae en Otros', async () => {
    const itemId = await crearProducto('100');
    await contarYAplicar(itemId, '100');

    await vender(itemId, '12');

    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'devolucion',
        ubicacionId: localId,
        cantidad: '4',
        comentario: 'Devolución manual, sin venta detrás',
      })
      .expect(200);

    await contarYAplicar(itemId, '92'); // 100 − 12 + 4

    const fila = await filaDe(itemId);

    expect(fila.teorico).toBe('12.0000');
    expect(fila.sinExplicacion).toBe('0.0000');
    expect(fila.otros).toBe('-4.0000');
  });

  /**
   * ⛔ **Un motivo EN USO no se puede borrar: el sistema lo impide.**
   * `MotivosBajaService.remove` mira `movimientos_inventario` y
   * `cuenta_linea_anulaciones` antes de borrar y devuelve 400 *"el motivo está
   * en uso en movimientos de merma o en anulaciones de plato"*.
   *
   * Esto importa para el reporte: significa que **un movimiento nunca puede
   * quedar apuntando a un `motivo_baja` borrado**, así que la pregunta de si
   * `SQL_BUCKETS` debe filtrar `eliminado_el` en ese `JOIN` no tiene
   * consecuencia observable — el caso es inalcanzable por la API.
   *
   * Se deja el test porque esa garantía es lo que sostiene la decisión, y si
   * algún día se afloja el borrado (un borrado en cascada, un `--force`), acá se
   * ve: la merma pasada empezaría a caerse del reporte en silencio.
   */
  it('el sistema impide borrar un motivo en uso, así que ninguna merma queda huérfana', async () => {
    const itemId = await crearProducto('120');
    await contarYAplicar(itemId, '120');

    const motivoPropio = await post<IdResponse>('/api/motivos-baja', {
      nombre: `Motivo borrable varianza ${Date.now()}`,
      tipo: 'merma',
    });

    await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        ubicacionId: localId,
        cantidad: '13',
        motivoBajaId: motivoPropio.id,
        comentario: 'Merma con motivo que se intenta borrar',
      })
      .expect(201);

    const resBorrar = await request(app.getHttpServer())
      .delete(`/api/motivos-baja/${motivoPropio.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resBorrar.status).toBe(400);
    expect(JSON.stringify(resBorrar.body)).toContain('en uso');

    await contarYAplicar(itemId, '107');

    const fila = await filaDe(itemId);

    expect(fila.merma).toBe('13.0000');
    expect(fila.cortesia).toBe('0.0000');
    expect(fila.sinExplicacion).toBe('0.0000');
  });

  /**
   * Un **sobrante** es una entrada de recuento: encontraste MÁS de lo que el
   * sistema creía, así que el consumo real fue MENOR. `sinExplicacion` tiene que
   * salir **negativo**; un valor absoluto lo convertiría en una pérdida que no
   * existió.
   */
  it('un sobrante deja sinExplicacion negativo', async () => {
    const itemId = await crearProducto('100');
    await contarYAplicar(itemId, '100'); // borde inicial, delta cero
    await contarYAplicar(itemId, '105'); // sobrante de 5

    const fila = await filaDe(itemId);

    expect(fila.medible).toBe(true);
    expect(fila.sinExplicacion).toBe('-5.0000');
  });

  /**
   * Un faltante descubierto al contar es el bucket "sin explicación" en
   * positivo, y **no** tiene que ensuciar merma ni cortesía.
   */
  it('un faltante va a sinExplicacion y no a merma', async () => {
    const itemId = await crearProducto('80');
    await contarYAplicar(itemId, '80');
    await contarYAplicar(itemId, '74'); // faltante de 6

    const fila = await filaDe(itemId);

    expect(fila.sinExplicacion).toBe('6.0000');
    expect(fila.merma).toBe('0.0000');
    expect(fila.cortesia).toBe('0.0000');
  });

  /**
   * ⚠️ **Lo que NO entra en ningún bucket.** Una compra dentro de la ventana es
   * abastecimiento: los dos conteos que la cierran ya la absorben. Si apareciera
   * en el teórico o en "sin explicación", el reporte estaría contando como
   * consumo algo que entró.
   */
  it('una compra dentro de la ventana no entra en ningún bucket', async () => {
    const itemId = await crearProducto('50');
    await contarYAplicar(itemId, '50');

    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '20',
        costoUnitario: '100',
      })
      .expect(200);

    await contarYAplicar(itemId, '70'); // 50 + 20, sin diferencia

    const fila = await filaDe(itemId);

    expect(fila.teorico).toBe('0.0000');
    expect(fila.merma).toBe('0.0000');
    expect(fila.cortesia).toBe('0.0000');
    expect(fila.sinExplicacion).toBe('0.0000');
  });
});
