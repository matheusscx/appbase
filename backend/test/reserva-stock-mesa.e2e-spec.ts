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
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: nombreUnico(nombre),
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock,
        costo: '100',
      })
    ).id;
  }

  async function crearReceta(
    nombre: string,
    ingredienteId: string,
    cantidad: string,
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
          unidadCodigo: 'unidad',
          bloqueante: true,
        },
      ],
    });
    return { id, nombre: nombreFinal };
  }

  async function abrirCuenta(): Promise<string> {
    const { id } = await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    cuentasAbiertas.push(id);
    return id;
  }

  async function agregarLinea(
    cuentaId: string,
    itemId: string,
    cantidad: string,
  ): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/lineas`, { itemId, cantidad });
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
      const ingredienteId = await crearIngrediente('Insumo reserva', '10');
      const receta = await crearReceta('Receta reserva', ingredienteId, '2');

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
});
