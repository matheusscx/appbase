import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * **Tarea 15 (bodegas y traslados): el rechazo por falta de stock dice dónde
 * está la mercadería.** Hasta esta tarea, el 400 de `validarStockAlPedir`
 * (el pre-chequeo del salón) y el del chokepoint de inventario al cobrar
 * directo por POS nombraban el ítem que faltó, pero no decían si había stock
 * en otra ubicación — el garzón/cajero no sabía si mandar a alguien a la
 * bodega o si simplemente no había.
 *
 * Este spec mide el mensaje REAL (no lo inventa) en dos chokepoints:
 *  - `ItemsService.validarStockAlPedir` (agregar una línea a una cuenta de
 *    salón), vía `POST /cuentas/:id/lineas`.
 *  - El tope al cobrar directo por POS (`ventas.service.ts` →
 *    `registrarMovimiento`), vía `POST /ventas`.
 *
 * Documentación viva del frente: `docs/features/bodegas-y-traslados.md`.
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
interface Ubicacion {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
  activo: boolean;
}
interface MotivoTraslado {
  id: string;
  nombre: string;
}
interface ErrorStockBody {
  message: string;
  itemId?: string;
  itemNombre?: string;
  faltante?: string;
  ubicaciones?: { ubicacionId: string; nombre: string; stock: string }[];
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

describe('El 400 de stock insuficiente dice dónde está la mercadería (e2e, Tarea 15)', () => {
  let app: INestApplication<App>;
  let token: string;
  let localId: string;
  let bodegaId: string;
  let bodegaNombre: string;
  let motivoTrasladoId: string;
  let garzon: GarzonCreado;
  let salonId: string;
  let mesaId: string;
  let cajaId: string;
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
      unidadMedida: 'kg',
      stock,
      costo: '100',
    });
    return { id, nombre: nombreFinal };
  }

  /** Traslada TODO lo que hay en el local a la bodega: deja el local en 0. */
  async function trasladarTodoALaBodega(itemId: string, cantidad: string) {
    await post('/api/traslados', {
      origenId: localId,
      destinoId: bodegaId,
      motivoTrasladoId,
      lineas: [{ itemId, cantidad }],
    });
  }

  /** El `POST` de línea crudo: para leer el 400 completo (message + datos sueltos). */
  async function intentarLinea(
    cuentaId: string,
    itemId: string,
    cantidad: string,
  ): Promise<{ status: number; body: ErrorStockBody }> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, cantidad });
    // Los cuatro llamadores de este helper prueban el rechazo por stock: si
    // el POST no rebota con 400, `res.body` no tiene la forma de
    // `ErrorStockBody` y el cast de abajo mentiría en silencio.
    expect(res.status).toBe(400);
    return { status: res.status, body: res.body as ErrorStockBody };
  }

  async function abrirCuenta(): Promise<string> {
    const { id } = await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    cuentasAbiertas.push(id);
    return id;
  }

  /** El `POST /ventas` crudo, venta directa de POS: para leer el 400 del cobro. */
  async function intentarVentaDirecta(
    itemId: string,
    cantidad: string,
  ): Promise<{ status: number; body: ErrorStockBody }> {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad }] });
    // Mismo criterio que `intentarLinea`: el único llamador prueba el
    // rechazo por stock, así que el 400 es parte del contrato del helper.
    expect(res.status).toBe(400);
    return { status: res.status, body: res.body as ErrorStockBody };
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

    const ubicaciones = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(ubicaciones.status).toBe(200);
    const filas = ubicaciones.body as Ubicacion[];
    localId = filas.find((u) => u.tipo === 'local')!.id;

    // ⚠️ **Bodega PROPIA, no la primera que devuelva el listado.** Hasta el
    // 2026-09-07 esta línea era `filas.find((u) => u.tipo === 'bodega')!`, y
    // eso ataba el spec a lo que hubieran dejado las suites anteriores: el
    // listado ordena `tipo ASC, nombre ASC` **e incluye las desactivadas**, así
    // que si la primera por nombre resultaba ser la "Bodega apagada E2E" que
    // deja `traslados.e2e-spec.ts`, los cuatro `POST /traslados` de acá
    // rebotaban con 400 *"está desactivada: no puede recibir un traslado"* y
    // los cuatro casos fallaban de una. Pasó en CI (`5118d89a`) y se reprodujo
    // local plantando una bodega inactiva que ordene primero: mismo 4-de-5.
    // El orden entre suites no es el mismo en las dos máquinas —jest reordena
    // por el caché de tiempos, que CI no tiene—, así que el verde local no
    // decía nada sobre el de CI.
    const bodega = await post<{ id: string; nombre: string }>(
      '/api/ubicaciones',
      {
        nombre: `Bodega stock-insuficiente E2E ${Date.now()}`,
        tipo: 'bodega',
      },
    );
    bodegaId = bodega.id;
    bodegaNombre = bodega.nombre;

    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-traslado?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    expect(motivos.status).toBe(200);
    motivoTrasladoId = (motivos.body as MotivoTraslado[])[0].id;

    const marca = Date.now();
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón stock-ubicación E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón stock-ubicación E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa stock-ubicación',
      })
    ).id;

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
        comentario: 'Apertura E2E stock-ubicación',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    try {
      for (const cuentaId of cuentasAbiertas) {
        const res = await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
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
        // status-tolerante: red de limpieza, acumula el fallo en `fallos`
        // (vía el `cierre` de abajo, que va a rebotar sin `motivoId`) en vez
        // de afirmar acá — mismo criterio que `reserva-stock-mesa.e2e-spec.ts`.
        const motivoId =
          motivos.status === 200
            ? (motivos.body as { id: string }[])[0]?.id
            : undefined;
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

  describe('Al pedir (salón) — ItemsService.validarStockAlPedir', () => {
    it('0 en el local y 10 en la bodega: el 400 nombra el ítem Y dónde está lo que falta', async () => {
      const producto = await crearProducto('Carne stock-ubicación', '10');
      await trasladarTodoALaBodega(producto.id, '10');

      const cuentaId = await abrirCuenta();
      const { status, body } = await intentarLinea(cuentaId, producto.id, '5');

      console.log(
        '[MEDIDO] validarStockAlPedir 400 body:',
        JSON.stringify(body),
      );

      expect(status).toBe(400);
      expect(body.message).toContain(producto.nombre);
      expect(body.message.toLowerCase()).toContain('local');
      expect(body.message).toContain(bodegaNombre);
      expect(body.message).toContain('10');
      expect(body.itemId).toBe(producto.id);
      expect(body.itemNombre).toBe(producto.nombre);
      expect(body.faltante).toBe('5');
      expect(body.ubicaciones).toBeDefined();
      expect(body.ubicaciones).toHaveLength(1);
      expect(body.ubicaciones![0]).toMatchObject({
        ubicacionId: bodegaId,
        nombre: bodegaNombre,
        stock: '10.0000',
      });
    });

    it('con stock PARCIAL en el local (3 de 10), `faltante` es la brecha real (2), no lo pedido (5)', async () => {
      const producto = await crearProducto(
        'Carne parcial stock-ubicación',
        '10',
      );
      // Deja 3 en el local y manda 7 a la bodega.
      await trasladarTodoALaBodega(producto.id, '7');

      const cuentaId = await abrirCuenta();
      const { status, body } = await intentarLinea(cuentaId, producto.id, '5');

      expect(status).toBe(400);
      // `restante` (lo que queda en el local) se sigue mostrando tal cual,
      // mismo criterio que ya regía antes de esta tarea.
      expect(body.message).toContain('quedan 3');
      expect(body.faltante).toBe('2');
      // Solo la bodega: el local (con 3, > 0) NO es una "otra ubicación" de
      // sí mismo. Si el filtro `u.tipo = 'bodega'` se perdiera, el local
      // aparecería acá también —tiene stock > 0— y este `toHaveLength`
      // lo caza donde `[0]` solo (que igual sería la bodega, por venir
      // ordenada por stock DESC) no lo hace.
      expect(body.ubicaciones).toHaveLength(1);
      expect(body.ubicaciones![0]).toMatchObject({
        ubicacionId: bodegaId,
        stock: '7.0000',
      });
    });

    it('sin stock en ninguna parte, no inventa una bodega', async () => {
      const producto = await crearProducto('Sin stock en ninguna parte', '0');

      const cuentaId = await abrirCuenta();
      const { status, body } = await intentarLinea(cuentaId, producto.id, '5');

      console.log(
        '[MEDIDO] validarStockAlPedir 400 body (sin stock en ninguna parte):',
        JSON.stringify(body),
      );

      expect(status).toBe(400);
      expect(body.message).toContain(producto.nombre);
      expect(body.message).not.toContain(bodegaNombre);
      expect(body.ubicaciones).toEqual([]);
    });

    it('la bodega tiene una fila pero en CERO (se vació y volvió): tampoco se ofrece', async () => {
      // A diferencia del test de arriba —donde la bodega nunca tuvo fila—,
      // acá la bodega SÍ tiene fila en `stock_ubicacion`, en 0: se llenó y se
      // vació de nuevo. Es el caso que discrimina el filtro `su.stock > 0`
      // de uno que solo mirara "existe la fila".
      const producto = await crearProducto('Carne bodega vaciada', '10');
      await trasladarTodoALaBodega(producto.id, '10'); // local 0, bodega 10
      await post('/api/traslados', {
        origenId: bodegaId,
        destinoId: localId,
        motivoTrasladoId,
        lineas: [{ itemId: producto.id, cantidad: '10' }],
      }); // local 10, bodega 0 (con fila)

      const cuentaId = await abrirCuenta();
      const { status, body } = await intentarLinea(cuentaId, producto.id, '15');

      expect(status).toBe(400);
      expect(body.message).not.toContain(bodegaNombre);
      expect(body.ubicaciones).toEqual([]);
    });
  });

  describe('Al cobrar directo por POS — el chokepoint de inventario', () => {
    it('0 en el local y 10 en la bodega: el 400 del cobro también dice dónde está', async () => {
      const producto = await crearProducto('Carne cobro directo', '10');
      await trasladarTodoALaBodega(producto.id, '10');

      const { status, body } = await intentarVentaDirecta(producto.id, '5');

      console.log('[MEDIDO] tope al cobrar 400 body:', JSON.stringify(body));

      expect(status).toBe(400);
      expect(body.message).toContain(producto.nombre);
      expect(body.message).toContain(bodegaNombre);
      expect(body.itemId).toBe(producto.id);
      expect(body.itemNombre).toBe(producto.nombre);
      expect(body.faltante).toBe('5');
      expect(body.ubicaciones).toHaveLength(1);
      expect(body.ubicaciones![0]).toMatchObject({
        ubicacionId: bodegaId,
        nombre: bodegaNombre,
        stock: '10.0000',
      });
    });
  });
});
