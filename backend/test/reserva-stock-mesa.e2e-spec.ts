import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * **Reserva de stock al pedir.** Hasta el 2026-09-01 el sistema no apartaba
 * nada cuando una mesa pedía: dos mesas podían pedir la misma última unidad y
 * el choque estallaba recién al cobrar, con la comida ya servida.
 *
 * Este spec cubre el frente completo; la **Tarea 2** aporta el primer eslabón:
 * `GET /items` deja de mostrar el stock pelado y muestra **lo que todavía se
 * puede pedir** — el stock menos lo que las cuentas `abierta` ya comprometieron.
 *
 * Plan: `docs/superpowers/plans/2026-09-01-reserva-de-stock-al-pedir.md`.
 * Spec:  `docs/superpowers/specs/2026-09-01-reserva-de-stock-al-pedir-design.md`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
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
/** Lo mínimo de `CuentaDetalle` que este spec mira: el id de la línea recién creada. */
interface CuentaDetalleLineas {
  lineas: { id: string; itemId: string; cantidad: string }[];
}
interface FilaItem {
  id: string;
  nombre: string;
  tipo: string;
  /** Lo que hay físicamente (saldo de `movimientos_inventario`). */
  stock: string | null;
  /** Receta y combo: cuántas porciones se pueden armar (entero). */
  disponible: number | null;
  /** Producto e ingrediente: cuánta cantidad queda por pedir (escala de `stock`). */
  stockDisponible: string | null;
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

describe('Reserva de stock al pedir (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let mesaId: string;
  /** Segunda mesa del MISMO salón: la que choca contra la reserva de la otra. */
  let mesaBId: string;
  let garzon: GarzonCreado;
  let cajaId: string;
  /** Cuentas abiertas por los tests, para cancelarlas en el `afterAll`. */
  const cuentasAbiertas: string[] = [];

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

  /**
   * Nombre único por corrida: el stock del seed es acumulativo entre corridas
   * locales repetidas, así que ningún test de este spec mira un ítem sembrado.
   */
  function nombreUnico(base: string): string {
    return `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  async function crearProducto(
    nombre: string,
    stock: string,
  ): Promise<{ id: string; nombre: string }> {
    const nombreFinal = nombreUnico(nombre);
    const { id } = await post<IdResponse>('/api/items', {
      nombre: nombreFinal,
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'unidad',
      stock,
      costo: '100',
    });
    return { id, nombre: nombreFinal };
  }

  async function crearIngrediente(
    nombre: string,
    stock: string,
    unidadMedida = 'unidad',
  ): Promise<{ id: string; nombre: string }> {
    const nombreFinal = nombreUnico(nombre);
    const { id } = await post<IdResponse>('/api/items', {
      nombre: nombreFinal,
      precioBase: '100',
      monedaId: CLP_MONEDA_ID,
      tipo: 'ingrediente',
      unidadMedida,
      stock,
      costo: '100',
    });
    return { id, nombre: nombreFinal };
  }

  async function crearReceta(
    nombre: string,
    ingredienteId: string,
    cantidad: string,
    bloqueante = true,
    unidadCodigo = 'unidad',
  ): Promise<{ id: string; nombre: string }> {
    const nombreFinal = nombreUnico(nombre);
    const { id } = await post<IdResponse>('/api/items', {
      nombre: nombreFinal,
      precioBase: '4000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'receta',
      ingredientes: [
        {
          ingredienteItemId: ingredienteId,
          cantidad,
          unidadCodigo,
          bloqueante,
        },
      ],
    });
    return { id, nombre: nombreFinal };
  }

  async function abrirCuenta(mesa: string = mesaId): Promise<string> {
    const { id } = await post<IdResponse>(`/api/mesas/${mesa}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    cuentasAbiertas.push(id);
    return id;
  }

  /** Devuelve el id de la línea creada: lo necesita el `PATCH` de la Tarea 4. */
  async function agregarLinea(
    cuentaId: string,
    itemId: string,
    cantidad: string,
  ): Promise<string> {
    const detalle = await post<CuentaDetalleLineas>(
      `/api/cuentas/${cuentaId}/lineas`,
      { itemId, cantidad },
    );
    // **Exactamente una**, no la primera: el día que un test agregue dos líneas
    // del mismo ítem sin fusionar, devolver `find` daría el id equivocado y las
    // aserciones que cuelgan de él se apagarían en silencio.
    const lineas = detalle.lineas.filter((l) => l.itemId === itemId);
    expect(lineas).toHaveLength(1);
    return lineas[0].id;
  }

  /** El `POST` de línea crudo: para afirmar sobre un rechazo y su mensaje. */
  async function intentarLinea(
    cuentaId: string,
    itemId: string,
    cantidad: string,
  ): Promise<{ status: number; message: string }> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, cantidad });
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
    };
  }

  /**
   * El `PATCH` de la línea crudo: el bypass que la Tarea 4 cierra. Devuelve
   * status y mensaje para poder afirmar sobre los dos, igual que
   * `intentarLinea`.
   */
  async function intentarActualizarLinea(
    cuentaId: string,
    lineaId: string,
    cantidad: string,
  ): Promise<{ status: number; message: string }> {
    const res = await request(app.getHttpServer())
      .patch(`/api/cuentas/${cuentaId}/lineas/${lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidad });
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
    };
  }

  async function cancelarCuenta(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/cancelar`, {});
  }

  /**
   * Cierra sin cobrar (pagos vacíos). Genera la venta `canal='fisico'` —de ahí
   * la caja abierta del `beforeAll`— y con ella el descuento REAL de stock.
   */
  async function cerrarCuenta(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/cerrar`, {
      garzonId: garzon.id,
      pin: garzon.pin,
      pagos: [],
    });
  }

  /**
   * La fila del ítem tal como la ve el POS: por `GET /items`, con la búsqueda
   * acotada al nombre único del ítem del test.
   */
  async function filaDelCatalogo(
    nombre: string,
    itemId: string,
  ): Promise<FilaItem> {
    const res = await request(app.getHttpServer())
      .get(`/api/items?search=${encodeURIComponent(nombre)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fila = (res.body as { data: FilaItem[] }).data.find(
      (f) => f.id === itemId,
    );
    expect(fila).toBeDefined();
    return fila!;
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

    // ⚠️ Garzón PROPIO, no el del seed: la sesión es única por garzón y seis
    // specs comparten el sembrado (`maxWorkers: 1`).
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón reserva E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón reserva E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa reserva',
      })
    ).id;
    mesaBId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa reserva B',
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
        comentario: 'Apertura E2E reserva de stock',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar, y el `close` en un `finally`: si un paso de
    // limpieza falla, lo que quede sin cerrar contamina las suites siguientes
    // —una cuenta abierta que sobrevive sigue comprometiendo stock—.
    const fallos: string[] = [];
    try {
      for (const cuentaId of cuentasAbiertas) {
        const res = await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        // 400 = ya cancelada por el propio test. Cualquier otra cosa se reporta.
        if (![200, 201, 400].includes(res.status)) {
          fallos.push(`cancelar cuenta ${cuentaId} → ${res.status}`);
        }
      }
      const cerrarSesion = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: garzon.id, pin: garzon.pin });
      if (![200, 201].includes(cerrarSesion.status)) {
        fallos.push(`cerrar sesión del garzón → ${cerrarSesion.status}`);
      }

      // La caja queda abierta y bloquea a la suite siguiente (una física por
      // tenant+usuario). Conteo → si queda en conciliación, cerrar con motivo.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
      if (![200, 201].includes(conteo.status)) {
        fallos.push(`conteo de caja → ${conteo.status}`);
      } else if (
        (conteo.body as { estado?: string }).estado === 'en_conciliacion'
      ) {
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${token}`);
        const motivoId = (motivos.body as { id: string }[])[0]?.id;
        const cierre = await request(app.getHttpServer())
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
          });
        if (![200, 201].includes(cierre.status)) {
          fallos.push(`cerrar caja → ${cierre.status}`);
        }
      }
    } finally {
      await app.close();
    }
    if (fallos.length)
      throw new Error(`Limpieza incompleta: ${fallos.join('; ')}`);
  }, 60000);

  describe('Tarea 2 — lo que se puede pedir descuenta lo que las cuentas abiertas ya pidieron', () => {
    it('un producto con stock 3 que una mesa ya pidió 2 veces queda en stockDisponible 1', async () => {
      const producto = await crearProducto('Producto reserva', '3');

      // Antes de pedir: nadie tomó nada, queda el stock entero.
      const antes = await filaDelCatalogo(producto.nombre, producto.id);
      expect(antes.stockDisponible).toBe('3.0000');
      // `disponible` es el conteo de porciones de una receta o un combo: un
      // producto no tiene porciones y sigue en `null`.
      expect(antes.disponible).toBeNull();

      const cuentaId = await abrirCuenta();
      await agregarLinea(cuentaId, producto.id, '2');

      const despues = await filaDelCatalogo(producto.nombre, producto.id);
      // `stock` NO cambia: sigue siendo lo que hay físicamente, y la venta lo
      // descuenta recién al cerrar la cuenta.
      expect(despues.stock).toBe('3.0000');
      expect(despues.stockDisponible).toBe('1.0000');
    });

    it('cancelar la cuenta libera lo comprometido: vuelve al stock', async () => {
      const producto = await crearProducto('Producto liberado', '5');
      const cuentaId = await abrirCuenta();
      await agregarLinea(cuentaId, producto.id, '4');

      expect(
        (await filaDelCatalogo(producto.nombre, producto.id)).stockDisponible,
      ).toBe('1.0000');

      await cancelarCuenta(cuentaId);

      // Una cancelada no compromete: nunca va a consumir nada.
      expect(
        (await filaDelCatalogo(producto.nombre, producto.id)).stockDisponible,
      ).toBe('5.0000');
    });

    /**
     * La otra mitad del filtro `estado = 'abierta'`, y la que importa de
     * verdad: al CERRAR, la venta descuenta stock **real**. Si la consulta del
     * comprometido siguiera contando esa cuenta, lo pedido se restaría dos
     * veces —una en el kardex y otra como reserva— y el POS mostraría menos
     * mercadería de la que hay.
     *
     * Sin este caso el mutante `c.estado <> 'cancelada'` sobrevive: la rama
     * cancelada la cubre el test de arriba y la cerrada no la cubría nadie.
     */
    it('cerrar la cuenta descuenta stock de verdad, y NO se descuenta dos veces', async () => {
      const producto = await crearProducto('Producto cobrado', '3');
      const cuentaId = await abrirCuenta();
      await agregarLinea(cuentaId, producto.id, '2');

      const abierta = await filaDelCatalogo(producto.nombre, producto.id);
      expect(abierta.stock).toBe('3.0000');
      expect(abierta.stockDisponible).toBe('1.0000');

      await cerrarCuenta(cuentaId);

      const cerrada = await filaDelCatalogo(producto.nombre, producto.id);
      // Ahora sí bajó el stock físico: la venta movió el kardex.
      expect(cerrada.stock).toBe('1.0000');
      // Y lo que se puede pedir es ESE stock, no `1 − 2 = -1`.
      expect(cerrada.stockDisponible).toBe('1.0000');
    });

    it('una receta descuenta lo que las cuentas abiertas comprometieron de su ingrediente', async () => {
      const ingrediente = await crearIngrediente('Insumo reserva', '10');
      const receta = await crearReceta('Receta reserva', ingrediente.id, '2');

      // 10 de insumo / 2 por receta = 5 porciones.
      expect((await filaDelCatalogo(receta.nombre, receta.id)).disponible).toBe(
        5,
      );

      const cuentaId = await abrirCuenta();
      await agregarLinea(cuentaId, receta.id, '3');

      // 3 recetas × 2 = 6 comprometidos → quedan 4 → 2 porciones.
      expect((await filaDelCatalogo(receta.nombre, receta.id)).disponible).toBe(
        2,
      );
    });
  });

  describe('Tarea 3 — pedir de más rebota al PEDIR, no al cobrar', () => {
    /**
     * La sonda que abrió el frente, tal cual. Antes de este guard la mesa B
     * respondía `201` y el choque aparecía recién al **cobrar** —"Stock
     * insuficiente para la salida"—, con la comida servida y la línea ya
     * despachada, o sea imposible de sacar: la mesa quedaba trabada.
     */
    it('la última unidad que la mesa A ya pidió le rebota a la mesa B, nombrando el producto', async () => {
      const producto = await crearProducto('Producto único', '1');

      const cuentaA = await abrirCuenta();
      await agregarLinea(cuentaA, producto.id, '1');

      const cuentaB = await abrirCuenta(mesaBId);
      const rechazo = await intentarLinea(cuentaB, producto.id, '1');

      expect(rechazo.status).toBe(400);
      // Nombra QUÉ faltó: con "no hay stock" el garzón no sabe qué ofrecer.
      expect(rechazo.message).toContain(producto.nombre);

      // Y la línea no se escribió: sigue comprometida UNA sola unidad, la de la
      // mesa A. Si el rechazo hubiera dejado la fila puesta, esto sería -1.
      expect(
        (await filaDelCatalogo(producto.nombre, producto.id)).stockDisponible,
      ).toBe('0.0000');
    });

    /**
     * El caso que justifica que el mensaje lleve nombre propio: lo que falta no
     * es el plato —del plato no hay stock, hay ingredientes— sino UNO de sus
     * insumos. Un plato de seis ingredientes con "no hay stock" no le dice al
     * garzón qué ofrecer en su lugar.
     */
    it('una receta rebota nombrando el INGREDIENTE que faltó, no el plato', async () => {
      const ingrediente = await crearIngrediente('Insumo escaso', '3');
      const receta = await crearReceta('Plato escaso', ingrediente.id, '2');

      const cuentaA = await abrirCuenta();
      await agregarLinea(cuentaA, receta.id, '1'); // toma 2 de 3

      const cuentaB = await abrirCuenta(mesaBId);
      const rechazo = await intentarLinea(cuentaB, receta.id, '1'); // pide 2, queda 1

      expect(rechazo.status).toBe(400);
      expect(rechazo.message).toContain(ingrediente.nombre);
      expect(rechazo.message).not.toContain(receta.nombre);
      // Y dice los dos números que hacen falta para entenderlo, con su unidad:
      // queda 1 de insumo y este plato necesita 2.
      expect(rechazo.message).toContain('quedan 1 unidad');
      expect(rechazo.message).toContain('necesita 2 unidad');
    });
  });

  describe('Tarea 4 — subir la cantidad de una línea también hace cumplir el tope', () => {
    /**
     * El bypass que dejaba abierto el guard del `POST`: se pedía 1, que entra,
     * y se subía a 100 por el `PATCH`, que no pasaba por ningún tope. La mesa
     * terminaba comprometiendo stock que no existe y el choque volvía a
     * estallar al cobrar, que es el modo de falla que este frente vino a
     * eliminar.
     */
    it('subir por encima de lo que queda rebota con 400, y la línea no se mueve', async () => {
      const producto = await crearProducto('Producto que sube', '2');
      const cuentaId = await abrirCuenta();
      const lineaId = await agregarLinea(cuentaId, producto.id, '1');

      const rechazo = await intentarActualizarLinea(cuentaId, lineaId, '3');

      expect(rechazo.status).toBe(400);
      expect(rechazo.message).toContain(producto.nombre);
      // **Los dos números son los del DELTA, y ahí se ve la trampa de esta
      // tarea.** `comprometidoPorItem` ya cuenta esta línea con su cantidad
      // ACTUAL (1), así que lo que se pide de más es `3 − 1 = 2` contra el
      // `2 − 1 = 1` que queda. Validando la cantidad absoluta el mensaje diría
      // "necesita 3": rechazaría igual, pero por la cuenta equivocada.
      expect(rechazo.message).toContain('quedan 1 unidad');
      expect(rechazo.message).toContain('necesita 2 unidad');

      // Y la línea quedó como estaba: sigue comprometiendo 1 de los 2.
      expect(
        (await filaDelCatalogo(producto.nombre, producto.id)).stockDisponible,
      ).toBe('1.0000');
    });

    /**
     * El control del de arriba, y el que hace falsable la cuenta del delta:
     * subir hasta consumir justo lo que queda es legítimo. Validando la
     * cantidad **absoluta** esto daría 400 —contaría dos veces lo que la propia
     * línea ya tenía tomado— y un garzón no podría subir de 1 a 2 con stock 2.
     */
    it('subir hasta justo lo que queda pasa: el delta se compara contra el resto', async () => {
      const producto = await crearProducto('Producto al borde', '2');
      const cuentaId = await abrirCuenta();
      const lineaId = await agregarLinea(cuentaId, producto.id, '1');

      const res = await intentarActualizarLinea(cuentaId, lineaId, '2');

      expect(res.status).toBe(200);
      expect(
        (await filaDelCatalogo(producto.nombre, producto.id)).stockDisponible,
      ).toBe('0.0000');
    });

    /**
     * **El ancla: bajar no valida nada, solo libera.** Sin este caso un guard
     * que corriera en las dos direcciones pasaría los tests de arriba igual, y
     * nadie vería que rompió el camino de corregir un pedido hacia abajo — que
     * es el que el garzón usa cuando el cliente cambia de idea.
     */
    it('bajar la cantidad no valida stock: pasa aunque la línea tenga tomado todo el stock', async () => {
      const producto = await crearProducto('Producto que baja', '2');
      const cuentaId = await abrirCuenta();
      // La línea toma el stock ENTERO: con la cantidad absoluta, cualquier
      // valor nuevo se compararía contra un restante de 0 y rebotaría.
      const lineaId = await agregarLinea(cuentaId, producto.id, '2');

      const res = await intentarActualizarLinea(cuentaId, lineaId, '0.5');

      expect(res.status).toBe(200);
      // Liberó 1,5: eso es lo único que hace bajar una línea.
      expect(
        (await filaDelCatalogo(producto.nombre, producto.id)).stockDisponible,
      ).toBe('1.5000');
    });

    /**
     * **La resta va entre consumos expandidos, no entre cantidades.** La
     * expansión no solo multiplica: después CONVIERTE, y
     * `CatalogService.convertirConMapa` redondea a 4 decimales y **lanza** si lo
     * convertido cae por debajo de esa precisión. Expandir `nueva − vieja` en vez
     * de restar `consumo(nueva) − consumo(vieja)` cruzaba ese escalón y rebotaba
     * una subida legítima con un 400 sobre "precisión de stock" que no tiene nada
     * que ver con lo que hizo el garzón.
     *
     * Los números: insumo stockeado en **kg**, receta que lleva **5 g**, línea en
     * 1, stock de sobra (10 kg). Subirla a 1,005 consume `5,025 g = 0,0050 kg`
     * contra los `0,0050 kg` que ya tenía → neto 0, pasa. Expandiendo la resta,
     * en cambio, `0,005 × 5 g = 0,025 g → 0,0000 kg` y lanza.
     */
    it('subir una fracción de una receta con un insumo en otra unidad no rebota por precisión', async () => {
      const insumo = await crearIngrediente('Insumo en kg', '10', 'kg');
      const receta = await crearReceta(
        'Plato de 5 g',
        insumo.id,
        '5',
        true,
        'g',
      );

      const cuentaId = await abrirCuenta();
      const lineaId = await agregarLinea(cuentaId, receta.id, '1');

      const res = await intentarActualizarLinea(cuentaId, lineaId, '1.005');

      expect(res.status).toBe(200);
      // Y no rebotó por lo que rebotaba antes: el 400 hablaba de precisión.
      expect(res.message).not.toContain('precisión de stock');
    });

    /**
     * La misma ancla, con el escenario que **también** mata al mutante que
     * valida al bajar pasándole el delta (negativo): con el disponible ya en
     * negativo, `−1,5 > −2` y el pedido rebotaría.
     *
     * El disponible negativo no es un caso inventado: lo **no bloqueante** suma
     * al comprometido pero no frena al pedir (spec § 4.2), así que una receta
     * con su insumo en `bloqueante: false` puede pasarse del stock sin que
     * nadie la rechace. Parado ahí, bajar una línea tiene que seguir andando.
     */
    it('bajar libera incluso con el disponible ya en negativo por lo no bloqueante', async () => {
      const insumo = await crearIngrediente('Insumo sobregirado', '2');
      // Primero la línea directa sobre el insumo: con 0 comprometido entra.
      const cuentaDirecta = await abrirCuenta();
      const lineaId = await agregarLinea(cuentaDirecta, insumo.id, '2');

      // Y ahora una receta que lo consume SIN bloquear: suma al comprometido y
      // el tope no la mira, así que el disponible se va a −2.
      const receta = await crearReceta(
        'Plato sin bloquear',
        insumo.id,
        '2',
        false,
      );
      const cuentaReceta = await abrirCuenta(mesaBId);
      await agregarLinea(cuentaReceta, receta.id, '1');
      expect(
        (await filaDelCatalogo(insumo.nombre, insumo.id)).stockDisponible,
      ).toBe('-2.0000');

      const res = await intentarActualizarLinea(cuentaDirecta, lineaId, '0.5');

      expect(res.status).toBe(200);
      expect(
        (await filaDelCatalogo(insumo.nombre, insumo.id)).stockDisponible,
      ).toBe('-0.5000');
    });
  });
});
