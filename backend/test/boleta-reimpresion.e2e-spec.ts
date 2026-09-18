import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * `GET /api/ventas/:id/boleta` — reimprimir la boleta de una venta ya cobrada
 * (Task 2 de
 * `docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`).
 * Mismo permiso que anular (`Ventas:Anular`, el del encargado): el owner
 * eligió no crear un permiso nuevo para la operación sensible del módulo.
 *
 * Salón, mesa y garzón son PROPIOS de este archivo, no del seed: la sesión de
 * garzón es única y varias suites la comparten (`docs/agent/pendientes.md`).
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const OTRO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040'; // Demo Bodega
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/**
 * `Ventas:Leer` + `Ventas:Crear`, SIN `Ventas:Anular` (rol `Vendedor`,
 * `seedVendedorPermisosCaja`): el 403 de este spec.
 */
const VENDEDOR = { email: 'vendedor@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface ItemResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
}
interface VentaCreada {
  id: string;
}
interface CuentaCreada {
  id: string;
}
interface CierreCuenta {
  ventaId: string;
}
interface PersonalizacionDetalleLinea {
  nombre: string;
  tipo: string;
  unidades?: number;
  monto: string;
}
interface BoletaItem {
  descripcion: string;
  cantidad: string;
  cantidadPresentacion: string | null;
  unidadCodigoPresentacion: string | null;
  unidadCodigoBase: string;
  totalLinea: string;
  personalizacionDetalle?: PersonalizacionDetalleLinea[];
}
interface BoletaVentaRes {
  ventaId: string;
  estado: string;
  items: BoletaItem[];
  totales: {
    subtotalNeto: string;
    totalDescuentos: string;
    totalRecargos: string;
    totalImpuestos: string;
    totalFinal: string;
  };
  impuestos: { nombre: string; tasa: string; monto: string }[];
  pagos: { nombre: string; monto: string }[];
  propina: { monto: string } | null;
  customer: {
    nombre: string;
    rut: string | null;
    direccion: string | null;
  } | null;
}

async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

describe('GET /ventas/:id/boleta — reimprimir boleta (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let caja: CajaAbierta;

  let itemBasicoId: string;
  let ventaBasicaId: string;
  let ventaPersonalizadaId: string;
  let paltaNombre: string;
  let ventaOtroTenantId: string;

  let garzon: GarzonCreado;
  let mesaId: string;

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

  async function boleta(ventaId: string, token = tokenAdmin) {
    return request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}/boleta`)
      .set('Authorization', `Bearer ${token}`);
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

    ds = app.get(DataSource);
    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenVendedor = await entrar(app, VENDEDOR.email, VENDEDOR.pass);

    caja = await abrirCaja(app, tokenAdmin, {
      comentario: 'Apertura E2E boleta-reimpresión',
    });

    const marca = Date.now();

    // Venta básica (POS), para 403/200/404: dos líneas de un producto simple,
    // pagada de más en efectivo para no depender del cálculo exacto de IVA.
    itemBasicoId = (
      await post<ItemResponse>('/api/items', {
        nombre: `Item boleta E2E ${marca}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '100',
        costo: '100',
      })
    ).id;
    ventaBasicaId = (
      await post<VentaCreada>('/api/ventas', {
        lineas: [{ itemId: itemBasicoId, cantidad: '2' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      })
    ).id;

    // Receta con un extra permitido, para el caso de personalización que
    // `GET /ventas/:id` no puede dar (su SELECT no trae `personalizacion`).
    const panId = (
      await post<ItemResponse>('/api/items', {
        nombre: `Pan boleta E2E ${marca}`,
        tipo: 'ingrediente',
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '50',
        costo: '200',
      })
    ).id;
    const palta = `Palta boleta E2E ${marca}`;
    paltaNombre = palta;
    const paltaId = (
      await post<ItemResponse>('/api/items', {
        nombre: palta,
        tipo: 'ingrediente',
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'kg',
        stock: '5',
        costo: '4000',
      })
    ).id;
    const recetaId = (
      await post<ItemResponse>('/api/items', {
        nombre: `Hamburguesa boleta E2E ${marca}`,
        tipo: 'receta',
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: paltaId,
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '500',
          },
        ],
      })
    ).id;
    ventaPersonalizadaId = (
      await post<VentaCreada>('/api/ventas', {
        lineas: [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: { extras: [{ ingredienteItemId: paltaId }] },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      })
    ).id;

    // Venta de OTRO tenant (Demo Bodega), por SQL directo: no hay camino de
    // API para crear una venta en un tenant al que este token no pertenece
    // (mismo criterio que `salones-anular-linea.e2e-spec.ts`).
    const filasOtroTenant: { venta_id: string }[] = await ds.query(
      `INSERT INTO ventas (
         tenant_id, moneda_id, canal, estado,
         total_bruto, total_descuentos, total_recargos, total_impuestos, total_final
       ) VALUES ($1, $2, 'fisico', 'pagada', '1000', '0', '0', '0', '1000')
       RETURNING venta_id`,
      [OTRO_TENANT_ID, CLP_MONEDA_ID],
    );
    ventaOtroTenantId = filasOtroTenant[0].venta_id;

    // Salón/mesa/garzón propios, solo para la venta cerrada SIN propina: el
    // caso de personalización y el básico ya se cubrieron por POS arriba, sin
    // necesitar una cuenta de salón.
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón boleta E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón boleta E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa boleta',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // La venta de OTRO_TENANT (Demo Bodega) queda ahí a propósito: es una fila
    // suelta de un tenant ajeno, sin estado que cuadrar (ni caja ni sesión de
    // garzón), mismo criterio que otros fixtures de "otro tenant" en el resto
    // de la suite e2e — no vale la pena tumbar la limpieza propia por esto.

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
              .set('Authorization', `Bearer ${tokenAdmin}`)
              .send({ garzonId: garzon.id, pin: garzon.pin })
          ).status,
      );

      await limpiar('cerrar caja', async () => {
        await cerrarCaja(app, tokenAdmin, caja);
        return 201;
      });
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('un usuario con Ventas:Leer y sin Ventas:Anular recibe 403', async () => {
    // La primera aserción es la que hace hablar a la segunda: sin ella, este
    // 403 saldría igual si el rol perdiera el módulo `Ventas` entero o el
    // token no sirviera, y el test seguiría en verde probando otra cosa.
    //
    // ⚠️ Ronda de corrección 1: acá había un `GET /api/ventas/:id` (findOne)
    // esperando 200, y con el vendedor daba 404 — no por el permiso, sino
    // porque `findOne` (igual que `armarBoleta` desde esta ronda) tiene
    // ALCANCE por caja (`resolverAlcanceDerivadoDeCaja`, eje `Cajas:Leer`, no
    // `Ventas:Leer`): la venta se cobró con la caja del admin, y el vendedor
    // no la ve. Pedía algo que el alcance prohíbe, no algo que el permiso
    // prohíbe. `GET /api/ventas` (listar) sí sirve: no depende de una venta
    // puntual, así que el alcance por caja no lo tumba, y deja a la vista que
    // el vendedor SÍ atraviesa el guard del módulo — lo único que le falta es
    // `Ventas:Anular`.
    const listar = await request(app.getHttpServer())
      .get('/api/ventas')
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(listar.status).toBe(200);

    const res = await boleta(ventaBasicaId, tokenVendedor);
    expect(res.status).toBe(403);
  });

  it('el admin recibe 200 con líneas, totales, impuestos y pagos', async () => {
    const res = await boleta(ventaBasicaId, tokenAdmin);
    expect(res.status).toBe(200);
    const cuerpo = res.body as BoletaVentaRes;

    expect(cuerpo.ventaId).toBe(ventaBasicaId);
    expect(cuerpo.estado).toBe('pagada');
    expect(cuerpo.items.length).toBeGreaterThan(0);
    expect(cuerpo.items[0].totalLinea).toBeTruthy();
    expect(Number(cuerpo.totales.totalFinal)).toBeGreaterThan(0);
    // El ítem se creó sin `clasificacionTributaria` (default: no exento), así
    // que el motor le deriva el IVA del país — invariante 5 de `CLAUDE.md`:
    // "exento" es un estado fiscal explícito, nunca la ausencia de impuesto.
    expect(Number(cuerpo.totales.totalImpuestos)).toBeGreaterThan(0);
    expect(cuerpo.impuestos.length).toBeGreaterThan(0);
    expect(cuerpo.pagos.length).toBeGreaterThan(0);
    // `ventaBasicaId` se cobró sin `customer` (línea ~180): `null`, no un
    // objeto vacío — el contraste con la venta CON cliente, más abajo.
    expect(cuerpo.customer).toBeNull();
  });

  /**
   * Solo se reimprime una venta pagada o anulada (owner, 2026-09-18): la que
   * todavía no se cobró del todo saldría con los pagos incompletos y sin nada
   * que diga que sigue abierta. La anulada sí, y el papel la marca `ANULADA`
   * (`ticket-builder.ts`) con el `estado` que esta ruta devuelve.
   */
  describe('según el estado de la venta', () => {
    async function ventaSinCobrar(pagos: Record<string, unknown>[]) {
      return await post<VentaCreada & { estado: string }>('/api/ventas', {
        lineas: [{ itemId: itemBasicoId, cantidad: '1' }],
        pagos,
      });
    }

    it('una venta pendiente (sin pagos) da 400', async () => {
      const venta = await ventaSinCobrar([]);
      expect(venta.estado).toBe('pendiente');

      const res = await boleta(venta.id);
      expect(res.status).toBe(400);
    });

    it('una venta pagada a medias da 400', async () => {
      const venta = await ventaSinCobrar([
        { metodoPagoId: EFECTIVO_ID, monto: '100.0000' },
      ]);
      expect(venta.estado).toBe('pagada_parcial');

      const res = await boleta(venta.id);
      expect(res.status).toBe(400);
    });

    it('una venta anulada se reimprime, con estado cancelada', async () => {
      const venta = await ventaSinCobrar([]);
      await post(`/api/ventas/${venta.id}/anular`, {
        motivo: 'Anulada para el e2e de reimpresión',
      });

      const res = await boleta(venta.id);
      expect(res.status).toBe(200);
      expect((res.body as BoletaVentaRes).estado).toBe('cancelada');
    });
  });

  it('una venta de OTRO tenant da 404', async () => {
    const res = await boleta(ventaOtroTenantId, tokenAdmin);
    expect(res.status).toBe(404);
  });

  it('un plato personalizado trae su personalizacionDetalle (GET /ventas/:id no puede darlo)', async () => {
    const res = await boleta(ventaPersonalizadaId, tokenAdmin);
    expect(res.status).toBe(200);
    const cuerpo = res.body as BoletaVentaRes;

    const item = cuerpo.items.find(
      (i) => i.personalizacionDetalle && i.personalizacionDetalle.length > 0,
    );
    expect(item).toBeDefined();
    expect(item!.personalizacionDetalle).toEqual([
      {
        nombre: paltaNombre,
        tipo: 'extra',
        unidades: 1,
        monto: '500',
      },
    ]);
  });

  /**
   * Caso agregado fuera del brief original (Task 2, obligatorio): `cerrarCuenta`
   * crea SIEMPRE la fila de `venta_propina` (`estado = 'sin_propina'` cuando no
   * hubo propina, `venta-propina.service.ts:47-49`), y `armarBoleta` la
   * descarta con `AND estado = 'pagada'`. Ese filtro no tiene control en los
   * unit (el mock despacha por nombre de tabla, no ejecuta el `WHERE`): este es
   * su único control real, contra Postgres de verdad.
   */
  it('una venta de salón SIN propina: `propina` es null', async () => {
    const cuenta = await post<CuentaCreada>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    await post(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId: itemBasicoId,
      cantidad: '1',
    });

    const cierre = await post<CierreCuenta>(
      `/api/cuentas/${cuenta.id}/cerrar`,
      {
        garzonId: garzon.id,
        pin: garzon.pin,
        // Sin `propinaMonto`: default 0 → `venta_propina.estado = 'sin_propina'`.
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      },
    );

    const res = await boleta(cierre.ventaId, tokenAdmin);
    expect(res.status).toBe(200);
    expect((res.body as BoletaVentaRes).propina).toBeNull();
  });

  /**
   * Task 3 (`docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`):
   * el cierre de cuenta suma `boleta` a su respuesta, armada con el mismo
   * `armarBoleta` que esta ruta, dentro de la transacción del cobro. La
   * prueba que importa es la segunda aserción: cerrar y reimprimir tienen que
   * dar el MISMO papel para la misma venta, o la reimpresión miente.
   */
  it('el cierre de una cuenta con dos líneas devuelve la boleta, igual a la de GET /ventas/:id/boleta', async () => {
    const itemSegundoId = (
      await post<ItemResponse>('/api/items', {
        nombre: `Item boleta E2E dos líneas ${Date.now()}`,
        tipo: 'producto',
        precioBase: '2000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '50',
        costo: '500',
      })
    ).id;

    const cuenta = await post<CuentaCreada>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    await post(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId: itemBasicoId,
      cantidad: '2',
    });
    await post(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId: itemSegundoId,
      cantidad: '1',
    });

    const cierre = await post<{ ventaId: string; boleta: BoletaVentaRes }>(
      `/api/cuentas/${cuenta.id}/cerrar`,
      {
        garzonId: garzon.id,
        pin: garzon.pin,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      },
    );

    expect(cierre.boleta.ventaId).toBe(cierre.ventaId);
    expect(cierre.boleta.items).toHaveLength(2);
    expect(Number(cierre.boleta.totales.totalFinal)).toBeGreaterThan(0);

    const res = await boleta(cierre.ventaId, tokenAdmin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(cierre.boleta);
  });

  /**
   * El agujero que encontró la revisión de toda la rama: `BoletaVenta` no
   * llevaba ningún dato del cliente, así que el POS imprimía nombre/RUT/
   * dirección al cobrar (desde el formulario, en memoria) y la reimpresión
   * los perdía — el papel COPIA mentía respecto al original. Gemelo del test
   * de arriba ("cierre de una cuenta... igual a GET"), pero con `customer`:
   * ese test comparaba dos boletas SIN cliente y por eso no lo cazó.
   */
  it('una venta con cliente por POS: el payload del cobro trae el cliente, igual al de GET /ventas/:id/boleta', async () => {
    const venta = await post<VentaCreada & { boleta: BoletaVentaRes }>(
      '/api/ventas',
      {
        lineas: [{ itemId: itemBasicoId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
        customer: {
          nombre: `Cliente boleta E2E ${Date.now()}`,
          rut: '11.111.111-1',
          direccion: 'Calle Falsa 123',
        },
      },
    );

    expect(venta.boleta.customer).toEqual({
      nombre: expect.stringContaining('Cliente boleta E2E'),
      rut: '11.111.111-1',
      direccion: 'Calle Falsa 123',
    });

    const res = await boleta(venta.id, tokenAdmin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(venta.boleta);
  });

  /**
   * Ronda de corrección 1: nada probaba el CABLEADO de la cantidad de un
   * pesable en el camino nuevo. `armarBoleta` reenvía `cantidad` (canónica),
   * `cantidadPresentacion`, `unidadCodigoPresentacion` y `unidadCodigoBase`
   * desde `venta_detalles` — cuatro columnas, y cruzar dos sin que nada lo
   * note es exactamente cómo un plato de 0,3 kg salió impreso como "0" en
   * este repo. Los cuatro valores de acá son deliberadamente DISTINTOS entre
   * sí (0,7 / 700 / 'g' / 'kg') para que ningún swap entre columnas pase
   * inadvertido.
   */
  it('una línea pesable (kg, pedida en g) trae los cuatro campos de cantidad sin cruzar', async () => {
    const itemKgId = (
      await post<ItemResponse>('/api/items', {
        nombre: `Item boleta E2E pesable ${Date.now()}`,
        tipo: 'producto',
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'kg',
        stock: '50',
        costo: '2000',
      })
    ).id;

    const cuenta = await post<CuentaCreada>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    // Canónico en kg (base del ítem) distinto de la presentación en g, que a
    // su vez es distinta de las dos unidades — mismo patrón que
    // `salones-fusion.e2e-spec.ts` ("Unidad base kg: cargar 500 g deja
    // canónico 0,5 y presentación 500 g").
    await post(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId: itemKgId,
      cantidad: '0.7',
      cantidadPresentacion: '700',
      unidadCodigoPresentacion: 'g',
    });

    const cierre = await post<{ ventaId: string; boleta: BoletaVentaRes }>(
      `/api/cuentas/${cuenta.id}/cerrar`,
      {
        garzonId: garzon.id,
        pin: garzon.pin,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      },
    );

    expect(cierre.boleta.items).toHaveLength(1);
    const linea = cierre.boleta.items[0];
    // Los cuatro campos, uno por uno: si `armarBoleta` mandara
    // `unidadCodigoBase` donde va `unidadCodigoPresentacion` (o `cantidad`
    // donde va `cantidadPresentacion`), alguna de estas cuatro aserciones —
    // nunca las cuatro por la misma razón— rompería.
    expect(linea.cantidad).toBe('0.7000');
    expect(linea.cantidadPresentacion).toBe('700.0000');
    expect(linea.unidadCodigoPresentacion).toBe('g');
    expect(linea.unidadCodigoBase).toBe('kg');
  });
});
