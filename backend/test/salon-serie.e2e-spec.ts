import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * El garzón elige qué unidad con número de serie sale, al pedir
 * (`docs/features/inventario-serializado.md`, § «Lo apartado por una cuenta abierta»).
 *
 * La escena: dos celulares iguales en el local, uno nuevo y otro usado. La mesa
 * 4 pide el usado. Mientras esa cuenta siga abierta, esa unidad es de ella: la
 * mesa 5 no la puede pedir, el POS no la puede vender, y el selector de la
 * pantalla ya no la ofrece. Al cerrar la cuenta se vende; si la línea se quita o
 * la cuenta se cancela, vuelve a estar libre.
 *
 * Todo con filas reales creadas por la API (producto, series, mesas, cuentas):
 * una unidad "apartada" es un hecho DERIVADO de las líneas de cuentas abiertas,
 * y un mock del chokepoint no lo ve.
 *
 * Producto, mesas y garzón son PROPIOS de este archivo: el stock del seed se
 * agota entre corridas locales y el garzón "Ana" se pisa con otras seis suites.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface UnidadResponse {
  id: string;
  serie: string;
  estado: string;
  condicion: string;
}
interface LineaDetalle {
  id: string;
  itemId: string;
  cantidad: string;
  unidades: { id: string; serie: string; condicion: string }[];
}
interface CuentaDetalle {
  id: string;
  estado: string;
  lineas: LineaDetalle[];
  anulaciones: { cantidad: string; motivoTipo: string }[];
}
interface MotivoBaja {
  id: string;
  tipo: string;
}
interface Respuesta<T> {
  status: number;
  body: T;
}
interface ErrorResponse {
  message: string;
}

async function entrar(app: INestApplication<App>): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN.email, password: ADMIN.pass });
  expect(login.status).toBe(200);
  const tenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(tenant.status).toBe(200);
  return (tenant.body as TokenResponse).access_token;
}

describe('Salones — el garzón elige la unidad con serie (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta;
  let localId: string;
  let garzon: { id: string; pin: string };
  let salonId: string;
  let mesaA: { id: string; nombre: string };
  let mesaB: { id: string; nombre: string };
  /** Categoría ruteada a una impresora de comanda: sin ella nada se despacha. */
  let categoriaCocinaId: string;
  let motivoMermaId: string;
  let motivoNoElaboradoId: string;
  const cuentasAbiertas: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    ds = app.get(DataSource);
    token = await entrar(app);
    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E salon-serie',
    });

    const local: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = local[0].ubicacion_id;

    const marca = Date.now();
    garzon = await crear<{ id: string; pin: string }>('/api/garzones', {
      nombre: `Garzón salon-serie E2E ${marca}`,
    });
    await crear('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    salonId = (
      await crear<IdResponse>('/api/salones', {
        nombre: `Salón salon-serie E2E ${marca}`,
      })
    ).id;
    mesaA = {
      id: (
        await crear<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: `Mesa A salon-serie ${marca}`,
        })
      ).id,
      nombre: `Mesa A salon-serie ${marca}`,
    };
    mesaB = {
      id: (
        await crear<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: `Mesa B salon-serie ${marca}`,
        })
      ).id,
      nombre: `Mesa B salon-serie ${marca}`,
    };

    const cocina = await crear<IdResponse>('/api/impresoras', {
      nombre: `Cocina salon-serie E2E ${marca}`,
      rol: 'comanda',
      tipoConexion: 'sistema',
      nombreCola: `cola-salon-serie-e2e-${marca}`,
    });
    categoriaCocinaId = (
      await crear<IdResponse>('/api/categorias', {
        nombre: `Cocina salon-serie E2E ${marca}`,
        impresoraId: cocina.id,
      })
    ).id;

    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`);
    expect(motivos.status).toBe(200);
    const lista = motivos.body as MotivoBaja[];
    motivoMermaId = lista.find((m) => m.tipo === 'merma')!.id;
    motivoNoElaboradoId = lista.find((m) => m.tipo === 'no_elaborado')!.id;
  }, 60000);

  afterAll(async () => {
    try {
      // Una cuenta abierta que sobrevive sigue apartando sus unidades y le
      // ensucia el seed a la suite siguiente. Con algo despachado la ruta
      // simple la rechaza: ahí se cancela con motivo.
      for (const cuentaId of cuentasAbiertas) {
        const simple = await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        if (simple.status === 400) {
          await request(app.getHttpServer())
            .post(`/api/cuentas/${cuentaId}/cancelar-con-motivo`)
            .set('Authorization', `Bearer ${token}`)
            .send({ motivoBajaId: motivoNoElaboradoId });
        }
      }
      await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: garzon.id, pin: garzon.pin });
      await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  async function crear<T>(url: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** La respuesta cruda: status y cuerpo, para afirmar sobre los dos. */
  async function intentar<T>(
    metodo: 'post' | 'patch' | 'delete',
    url: string,
    body: Record<string, unknown> = {},
    cabeceras: Record<string, string> = {},
  ): Promise<Respuesta<T>> {
    const res = await request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${token}`)
      .set(cabeceras)
      .send(body);
    // status-tolerante: devuelve el status en vez de afirmarlo; cada llamador afirma el suyo
    return { status: res.status, body: res.body as T };
  }

  const mensajeDe = (res: Respuesta<unknown>): string => {
    const m = (res.body as { message?: string | string[] }).message;
    return Array.isArray(m) ? m.join(' ') : (m ?? '');
  };

  async function abrirCuenta(mesaId: string): Promise<string> {
    const cuenta = await crear<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    cuentasAbiertas.push(cuenta.id);
    return cuenta.id;
  }

  const pedir = (
    cuentaId: string,
    itemId: string,
    unidadIds: string[] | undefined,
    cantidad: string = String(unidadIds?.length ?? 1),
  ) =>
    intentar<CuentaDetalle>('post', `/api/cuentas/${cuentaId}/lineas`, {
      itemId,
      cantidad,
      ...(unidadIds ? { unidadIds } : {}),
    });

  const corregir = (
    cuentaId: string,
    lineaId: string,
    body: Record<string, unknown>,
  ) =>
    intentar<CuentaDetalle>(
      'patch',
      `/api/cuentas/${cuentaId}/lineas/${lineaId}`,
      body,
    );

  const quitar = (cuentaId: string, lineaId: string) =>
    intentar<CuentaDetalle>(
      'delete',
      `/api/cuentas/${cuentaId}/lineas/${lineaId}`,
    );

  async function cerrarCuenta(cuentaId: string): Promise<string> {
    const res = await intentar<{ ventaId: string }>(
      'post',
      `/api/cuentas/${cuentaId}/cerrar`,
      { garzonId: garzon.id, pin: garzon.pin, pagos: [] },
      // El cobro exige su clave de idempotencia: cada intento manda la suya.
      { 'Idempotency-Key': randomUUID() },
    );
    expect(res.status).toBe(201);
    return res.body.ventaId;
  }

  async function crearProducto(
    modoInventario: 'serie' | 'cantidad',
    nombre: string,
    conCocina = false,
  ): Promise<string> {
    const { id } = await crear<IdResponse>('/api/items', {
      nombre,
      tipo: 'producto',
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      modoInventario,
      ...(conCocina ? { categoriaId: categoriaCocinaId } : {}),
      ...(modoInventario === 'cantidad' ? { stock: '5', costo: '100' } : {}),
    });
    return id;
  }

  async function unidadesDe(itemId: string): Promise<UnidadResponse[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as UnidadResponse[];
  }

  async function vendibles(itemId: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades?vendibles=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as UnidadResponse[]).map((u) => u.id);
  }

  /**
   * Un producto serie con tres celulares en el local: nuevo, usado y
   * reacondicionado. `conCocina` lo rutea a la comanda, para poder despacharlo.
   */
  async function productoConTresUnidades(conCocina = false) {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const nombre = `Celular salon-serie E2E ${sufijo}`;
    const itemId = await crearProducto('serie', nombre, conCocina);
    const entrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '3',
        series: [
          { serie: `IMEI-NUEVO-${sufijo}`, condicion: 'nuevo' },
          { serie: `IMEI-USADO-${sufijo}`, condicion: 'usado' },
          { serie: `IMEI-REACOND-${sufijo}`, condicion: 'reacondicionado' },
        ],
      });
    expect(entrada.status).toBe(200);
    const unidades = await unidadesDe(itemId);
    const de = (c: string) => unidades.find((u) => u.condicion === c)!;
    return {
      itemId,
      nombre,
      nuevo: de('nuevo'),
      usado: de('usado'),
      reacond: de('reacondicionado'),
    };
  }

  /** La venta del POS, con las unidades que se elijan. */
  function venderPorPos(itemId: string, unidadIds: string[]) {
    return request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        lineas: [{ itemId, cantidad: String(unidadIds.length), unidadIds }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      })
      .then((r) => ({ status: r.status, body: r.body as unknown }));
  }

  const estadoDe = async (itemId: string, unidadId: string) =>
    (await unidadesDe(itemId)).find((u) => u.id === unidadId)?.estado;

  // ── Pedir con unidad ──

  it('pedir un producto con serie guarda la unidad elegida y el detalle la muestra', async () => {
    const { itemId, usado } = await productoConTresUnidades();
    const cuentaId = await abrirCuenta(mesaA.id);

    const res = await pedir(cuentaId, itemId, [usado.id]);

    expect(res.status).toBe(201);
    expect(res.body.lineas).toHaveLength(1);
    expect(Number(res.body.lineas[0].cantidad)).toBe(1);
    expect(res.body.lineas[0].unidades).toEqual([
      { id: usado.id, serie: usado.serie, condicion: 'usado' },
    ]);
    // Apartada, no vendida: la unidad sigue `disponible` hasta que se cierra.
    expect(await estadoDe(itemId, usado.id)).toBe('disponible');
  });

  it('pedir dos veces el mismo producto fusiona la línea y suma las unidades', async () => {
    const { itemId, usado, nuevo } = await productoConTresUnidades();
    const cuentaId = await abrirCuenta(mesaA.id);
    expect((await pedir(cuentaId, itemId, [usado.id])).status).toBe(201);

    const res = await pedir(cuentaId, itemId, [nuevo.id]);

    expect(res.status).toBe(201);
    expect(res.body.lineas).toHaveLength(1);
    expect(Number(res.body.lineas[0].cantidad)).toBe(2);
    expect(res.body.lineas[0].unidades.map((u) => u.id).sort()).toEqual(
      [usado.id, nuevo.id].sort(),
    );
  });

  it('sin unidadIds, con una cantidad que no coincide o con una repetida: 400 y nada se aparta', async () => {
    const { itemId, nombre, usado } = await productoConTresUnidades();
    const cuentaId = await abrirCuenta(mesaA.id);

    const sin = await pedir(cuentaId, itemId, undefined, '1');
    expect(sin.status).toBe(400);
    expect(mensajeDe(sin)).toBe(
      `Elegí qué unidades salen: «${nombre}» tiene número de serie`,
    );

    const noCoincide = await pedir(cuentaId, itemId, [usado.id], '2');
    expect(noCoincide.status).toBe(400);
    expect(mensajeDe(noCoincide)).toBe(
      `«${nombre}»: la cantidad (2) no coincide con las unidades elegidas (1)`,
    );

    const repetida = await pedir(cuentaId, itemId, [usado.id, usado.id]);
    expect(repetida.status).toBe(400);
    expect(mensajeDe(repetida)).toBe('Una unidad viene repetida');

    expect(await vendibles(itemId)).toContain(usado.id);
  });

  it('unidadIds en un producto sin serie: 400', async () => {
    const { usado } = await productoConTresUnidades();
    const nombre = `Producto cantidad salon-serie E2E ${Date.now()}`;
    const cantidadId = await crearProducto('cantidad', nombre);
    const cuentaId = await abrirCuenta(mesaA.id);

    const res = await pedir(cuentaId, cantidadId, [usado.id]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}» no tiene número de serie: no lleva unidades`,
    );
  });

  // ── La unidad apartada ──

  it('una unidad pedida en la mesa A no se puede pedir en la mesa B: 400 nombrando la mesa A', async () => {
    const { itemId, usado } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const cuentaB = await abrirCuenta(mesaB.id);
    expect((await pedir(cuentaA, itemId, [usado.id])).status).toBe(201);

    const res = await pedir(cuentaB, itemId, [usado.id]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `La unidad ${usado.serie} está apartada en la cuenta de ${mesaA.nombre}`,
    );
  });

  it('la misma cuenta tampoco puede pedir dos veces la misma unidad', async () => {
    const { itemId, usado, reacond } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    expect((await pedir(cuentaA, itemId, [usado.id])).status).toBe(201);

    const res = await pedir(cuentaA, itemId, [usado.id]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `La unidad ${usado.serie} está apartada en la cuenta de ${mesaA.nombre}`,
    );
    // La línea sigue con su unidad, una sola vez.
    const detalle = await pedir(cuentaA, itemId, [reacond.id]);
    expect(detalle.status).toBe(201);
    expect(detalle.body.lineas[0].unidades.map((u) => u.id).sort()).toEqual(
      [usado.id, reacond.id].sort(),
    );
  });

  it('una unidad apartada por una mesa no se puede vender por POS, y deja de ofrecerse', async () => {
    const { itemId, usado, nuevo } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    expect((await pedir(cuentaA, itemId, [usado.id])).status).toBe(201);

    const res = await venderPorPos(itemId, [usado.id]);

    expect(res.status).toBe(400);
    expect((res.body as ErrorResponse).message).toBe(
      `La unidad ${usado.serie} está apartada en la cuenta de ${mesaA.nombre}`,
    );
    expect(await estadoDe(itemId, usado.id)).toBe('disponible');
    const ofrecidas = await vendibles(itemId);
    expect(ofrecidas).not.toContain(usado.id);
    expect(ofrecidas).toContain(nuevo.id);
    // Las otras siguen vendiéndose normalmente.
    expect((await venderPorPos(itemId, [nuevo.id])).status).toBe(201);
  });

  it('cerrar la cuenta vende la unidad apartada y el detalle de la venta la muestra', async () => {
    const { itemId, usado, nuevo } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    expect((await pedir(cuentaA, itemId, [usado.id])).status).toBe(201);

    const ventaId = await cerrarCuenta(cuentaA);

    expect(await estadoDe(itemId, usado.id)).toBe('vendido');
    expect(await estadoDe(itemId, nuevo.id)).toBe('disponible');
    const detalle = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detalle.status).toBe(200);
    const [linea] = (
      detalle.body as {
        detalles: { unidades: { serie: string; condicion: string }[] }[];
      }
    ).detalles;
    expect(linea.unidades).toEqual([
      { serie: usado.serie, condicion: 'usado' },
    ]);
  });

  // ── La unidad vuelve a estar libre ──

  it('cancelar la cuenta sin despachar libera la unidad: se ofrece y se puede vender por POS', async () => {
    const { itemId, usado } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    expect((await pedir(cuentaA, itemId, [usado.id])).status).toBe(201);
    expect(await vendibles(itemId)).not.toContain(usado.id);

    const cancelada = await intentar(
      'post',
      `/api/cuentas/${cuentaA}/cancelar`,
    );
    expect(cancelada.status).toBe(201);

    expect(await vendibles(itemId)).toContain(usado.id);
    expect((await venderPorPos(itemId, [usado.id])).status).toBe(201);
    expect(await estadoDe(itemId, usado.id)).toBe('vendido');
  });

  it('quitar la línea libera la unidad: se ofrece, se puede pedir en otra mesa y se puede vender', async () => {
    const { itemId, usado } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const cuentaB = await abrirCuenta(mesaB.id);
    const pedida = await pedir(cuentaA, itemId, [usado.id]);
    expect(pedida.status).toBe(201);
    expect(await vendibles(itemId)).not.toContain(usado.id);

    const quitada = await quitar(cuentaA, pedida.body.lineas[0].id);
    expect(quitada.status).toBe(200);

    expect(await vendibles(itemId)).toContain(usado.id);
    expect((await pedir(cuentaB, itemId, [usado.id])).status).toBe(201);
  });

  it('quitar la línea y vender por POS: la unidad sale', async () => {
    const { itemId, usado } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const pedida = await pedir(cuentaA, itemId, [usado.id]);
    expect(pedida.status).toBe(201);
    expect((await quitar(cuentaA, pedida.body.lineas[0].id)).status).toBe(200);

    expect((await venderPorPos(itemId, [usado.id])).status).toBe(201);
    expect(await estadoDe(itemId, usado.id)).toBe('vendido');
  });

  // ── Corregir la línea ──

  it('cambiar las unidades por PATCH: la cantidad se deriva, las que salen se liberan y las que entran se apartan', async () => {
    const { itemId, nuevo, usado, reacond } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const pedida = await pedir(cuentaA, itemId, [nuevo.id, usado.id]);
    expect(pedida.status).toBe(201);
    const lineaId = pedida.body.lineas[0].id;

    // Sale `usado`, entra `reacond`; `nuevo` se queda.
    const res = await corregir(cuentaA, lineaId, {
      unidadIds: [nuevo.id, reacond.id],
    });

    expect(res.status).toBe(200);
    expect(Number(res.body.lineas[0].cantidad)).toBe(2);
    expect(res.body.lineas[0].unidades.map((u) => u.id).sort()).toEqual(
      [nuevo.id, reacond.id].sort(),
    );
    const ofrecidas = await vendibles(itemId);
    expect(ofrecidas).toContain(usado.id);
    expect(ofrecidas).not.toContain(reacond.id);
    expect(ofrecidas).not.toContain(nuevo.id);
  });

  it('bajar las unidades por PATCH baja la cantidad y subirlas la sube', async () => {
    const { itemId, nuevo, usado } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const pedida = await pedir(cuentaA, itemId, [nuevo.id, usado.id]);
    expect(pedida.status).toBe(201);
    const lineaId = pedida.body.lineas[0].id;

    const baja = await corregir(cuentaA, lineaId, { unidadIds: [usado.id] });
    expect(baja.status).toBe(200);
    expect(Number(baja.body.lineas[0].cantidad)).toBe(1);
    expect(await vendibles(itemId)).toContain(nuevo.id);

    const sube = await corregir(cuentaA, lineaId, {
      unidadIds: [usado.id, nuevo.id],
    });
    expect(sube.status).toBe(200);
    expect(Number(sube.body.lineas[0].cantidad)).toBe(2);
    expect(await vendibles(itemId)).not.toContain(nuevo.id);
  });

  it('un PATCH con una unidad apartada por otra mesa responde 400 y la línea queda como estaba', async () => {
    const { itemId, nuevo, usado } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const cuentaB = await abrirCuenta(mesaB.id);
    const enA = await pedir(cuentaA, itemId, [usado.id]);
    const enB = await pedir(cuentaB, itemId, [nuevo.id]);
    expect(enA.status).toBe(201);
    expect(enB.status).toBe(201);

    const res = await corregir(cuentaB, enB.body.lineas[0].id, {
      unidadIds: [usado.id],
    });

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `La unidad ${usado.serie} está apartada en la cuenta de ${mesaA.nombre}`,
    );
    const siguen = await pedir(cuentaB, itemId, [nuevo.id]);
    // `nuevo` sigue apartada por la línea de la mesa B (no se soltó).
    expect(siguen.status).toBe(400);
  });

  it('un PATCH con cantidad sola en una línea con serie: 400 pidiendo cambiar las unidades', async () => {
    const { itemId, nombre, nuevo } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const pedida = await pedir(cuentaA, itemId, [nuevo.id]);
    expect(pedida.status).toBe(201);

    const res = await corregir(cuentaA, pedida.body.lineas[0].id, {
      cantidad: '2',
    });

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `Cambiá las unidades de «${nombre}», no la cantidad`,
    );
  });

  it('un PATCH sin cantidad ni unidades: 400, nunca 500', async () => {
    const { itemId, nuevo } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const conSerie = await pedir(cuentaA, itemId, [nuevo.id]);
    expect(conSerie.status).toBe(201);
    const nombre = `Producto cantidad PATCH salon-serie E2E ${Date.now()}`;
    const cantidadId = await crearProducto('cantidad', nombre);
    const comun = await pedir(cuentaA, cantidadId, undefined, '1');
    expect(comun.status).toBe(201);

    const vacioSerie = await corregir(cuentaA, conSerie.body.lineas[0].id, {});
    const vacioComun = await corregir(
      cuentaA,
      comun.body.lineas.find((l) => l.itemId === cantidadId)!.id,
      {},
    );

    expect(vacioSerie.status).toBe(400);
    expect(vacioComun.status).toBe(400);
    expect(mensajeDe(vacioComun)).toBe(`Indicá la cantidad de «${nombre}»`);
  });

  it('un PATCH con null en lugar del campo que corresponde: 400, nunca 500', async () => {
    // `@IsOptional()` del DTO deja pasar el `null` del JSON hasta el service.
    const { itemId, nuevo } = await productoConTresUnidades();
    const cuentaA = await abrirCuenta(mesaA.id);
    const conSerie = await pedir(cuentaA, itemId, [nuevo.id]);
    expect(conSerie.status).toBe(201);
    const nombre = `Producto cantidad PATCH3 salon-serie E2E ${Date.now()}`;
    const cantidadId = await crearProducto('cantidad', nombre);
    const comun = await pedir(cuentaA, cantidadId, undefined, '1');
    expect(comun.status).toBe(201);

    const unidadesNull = await corregir(cuentaA, conSerie.body.lineas[0].id, {
      unidadIds: null,
    });
    const cantidadNull = await corregir(
      cuentaA,
      comun.body.lineas.find((l) => l.itemId === cantidadId)!.id,
      { cantidad: null },
    );

    expect(unidadesNull.status).toBe(400);
    expect(cantidadNull.status).toBe(400);
    expect(mensajeDe(cantidadNull)).toBe(`Indicá la cantidad de «${nombre}»`);
  });

  it('un PATCH con unidadIds en una línea sin serie: 400', async () => {
    const { nuevo } = await productoConTresUnidades();
    const nombre = `Producto cantidad PATCH2 salon-serie E2E ${Date.now()}`;
    const cantidadId = await crearProducto('cantidad', nombre);
    const cuentaA = await abrirCuenta(mesaA.id);
    const comun = await pedir(cuentaA, cantidadId, undefined, '1');
    expect(comun.status).toBe(201);

    const res = await corregir(cuentaA, comun.body.lineas[0].id, {
      cantidad: '2',
      unidadIds: [nuevo.id],
    });

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}» no tiene número de serie: no lleva unidades`,
    );
  });

  // ── Fusionar ──

  it('fusionar dos cuentas junta las unidades de la línea y cerrar vende todas', async () => {
    const { itemId, nuevo, usado, reacond } = await productoConTresUnidades();
    const mesa = (
      await crear<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: `Mesa fusión salon-serie ${Date.now()}`,
      })
    ).id;
    const cuenta1 = await abrirCuenta(mesa);
    const cuenta2 = await abrirCuenta(mesa);
    expect((await pedir(cuenta1, itemId, [nuevo.id])).status).toBe(201);
    expect((await pedir(cuenta2, itemId, [usado.id, reacond.id])).status).toBe(
      201,
    );

    const fusion = await intentar<CuentaDetalle>(
      'post',
      `/api/mesas/${mesa}/cuentas/fusionar`,
      { cuentaIds: [cuenta1, cuenta2] },
    );

    expect(fusion.status).toBe(201);
    expect(fusion.body.lineas).toHaveLength(1);
    expect(Number(fusion.body.lineas[0].cantidad)).toBe(3);
    expect(fusion.body.lineas[0].unidades.map((u) => u.id).sort()).toEqual(
      [nuevo.id, usado.id, reacond.id].sort(),
    );
    // Siguen apartadas por la cuenta de destino: ni POS ni otra mesa las toman.
    expect(await vendibles(itemId)).toEqual([]);

    await cerrarCuenta(cuenta1);

    for (const u of [nuevo, usado, reacond]) {
      expect(await estadoDe(itemId, u.id)).toBe('vendido');
    }
  });

  it('fusionar una cuenta cuya línea no tiene par la muda con sus unidades', async () => {
    const a = await productoConTresUnidades();
    const b = await productoConTresUnidades();
    const mesa = (
      await crear<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: `Mesa fusión2 salon-serie ${Date.now()}`,
      })
    ).id;
    const cuenta1 = await abrirCuenta(mesa);
    const cuenta2 = await abrirCuenta(mesa);
    expect((await pedir(cuenta1, a.itemId, [a.nuevo.id])).status).toBe(201);
    expect((await pedir(cuenta2, b.itemId, [b.usado.id])).status).toBe(201);

    const fusion = await intentar<CuentaDetalle>(
      'post',
      `/api/mesas/${mesa}/cuentas/fusionar`,
      { cuentaIds: [cuenta1, cuenta2] },
    );

    expect(fusion.status).toBe(201);
    expect(fusion.body.lineas).toHaveLength(2);
    const deB = fusion.body.lineas.find((l) => l.itemId === b.itemId)!;
    expect(deB.unidades.map((u) => u.id)).toEqual([b.usado.id]);
    expect(await vendibles(b.itemId)).not.toContain(b.usado.id);
  });

  // ── Anular lo despachado ──

  const despachar = (cuentaId: string) =>
    intentar('post', `/api/cuentas/${cuentaId}/comanda/reclamar`);

  const anular = (
    cuentaId: string,
    lineaId: string,
    body: Record<string, unknown>,
  ) =>
    intentar<CuentaDetalle>(
      'post',
      `/api/cuentas/${cuentaId}/lineas/${lineaId}/anular`,
      body,
    );

  const cancelarConMotivo = (cuentaId: string, motivoBajaId: string) =>
    intentar<CuentaDetalle>(
      'post',
      `/api/cuentas/${cuentaId}/cancelar-con-motivo`,
      { motivoBajaId },
    );

  const detalleDe = async (cuentaId: string, mesaId: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as CuentaDetalle[]).find((c) => c.id === cuentaId)!;
  };

  /** Dos celulares pedidos y despachados en la mesa A: la línea es 2/2. */
  async function dosDespachados(producto: {
    itemId: string;
    usado: UnidadResponse;
    nuevo: UnidadResponse;
  }) {
    const cuentaId = await abrirCuenta(mesaA.id);
    const pedida = await pedir(cuentaId, producto.itemId, [
      producto.usado.id,
      producto.nuevo.id,
    ]);
    expect(pedida.status).toBe(201);
    expect((await despachar(cuentaId)).status).toBe(201);
    return { cuentaId, lineaId: pedida.body.lineas[0].id };
  }

  it('anular con merma una de dos unidades despachadas: esa queda de baja y la otra sigue en la línea', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId, lineaId } = await dosDespachados(p);

    const res = await anular(cuentaId, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
      unidadIds: [p.usado.id],
    });

    expect(res.status).toBe(201);
    expect(res.body.lineas[0].unidades.map((u) => u.id)).toEqual([p.nuevo.id]);
    expect(Number(res.body.lineas[0].cantidad)).toBe(1);
    expect(res.body.anulaciones).toHaveLength(1);
    expect(await estadoDe(p.itemId, p.usado.id)).toBe('baja');
    // La que quedó en la línea sigue apartada: ni vendible ni de baja.
    expect(await estadoDe(p.itemId, p.nuevo.id)).toBe('disponible');
    expect(await vendibles(p.itemId)).toEqual([p.reacond.id]);
  });

  it('anular con "no elaborado" no mueve stock: la unidad vuelve a ofrecerse', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId, lineaId } = await dosDespachados(p);

    const res = await anular(cuentaId, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoNoElaboradoId,
      unidadIds: [p.usado.id],
    });

    expect(res.status).toBe(201);
    expect(res.body.lineas[0].unidades.map((u) => u.id)).toEqual([p.nuevo.id]);
    expect(await estadoDe(p.itemId, p.usado.id)).toBe('disponible');
    expect(await vendibles(p.itemId)).toContain(p.usado.id);
  });

  it('anular sin unidadIds, con una que la línea no tiene o con otra cantidad: 400 y nada cambia', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId, lineaId } = await dosDespachados(p);
    const pedido = `Elegí cuáles unidades de «${p.nombre}» se anulan`;

    const sin = await anular(cuentaId, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
    });
    expect(sin.status).toBe(400);
    expect(mensajeDe(sin)).toBe(pedido);

    const ajena = await anular(cuentaId, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
      unidadIds: [p.reacond.id],
    });
    expect(ajena.status).toBe(400);
    expect(mensajeDe(ajena)).toBe(pedido);

    const otraCantidad = await anular(cuentaId, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
      unidadIds: [p.usado.id, p.nuevo.id],
    });
    expect(otraCantidad.status).toBe(400);
    expect(mensajeDe(otraCantidad)).toBe(pedido);

    const repetida = await anular(cuentaId, lineaId, {
      cantidad: '2',
      motivoBajaId: motivoMermaId,
      unidadIds: [p.usado.id, p.usado.id],
    });
    expect(repetida.status).toBe(400);
    expect(mensajeDe(repetida)).toBe(pedido);

    const cuenta = await detalleDe(cuentaId, mesaA.id);
    expect(cuenta.anulaciones).toHaveLength(0);
    expect(cuenta.lineas[0].unidades).toHaveLength(2);
    expect(await estadoDe(p.itemId, p.usado.id)).toBe('disponible');
  });

  it('si el chokepoint rechaza una unidad nombrada, la anulación aborta y no queda a medias', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId, lineaId } = await dosDespachados(p);
    // Una unidad apartada que ya no está disponible es una invariante rota:
    // por la API no se llega ahí, así que se arma con SQL a propósito.
    await ds.query(
      `UPDATE item_unidad SET estado = 'baja' WHERE unidad_id = $1`,
      [p.usado.id],
    );

    const res = await anular(cuentaId, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
      unidadIds: [p.usado.id],
    });

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toContain('no está disponible');
    const cuenta = await detalleDe(cuentaId, mesaA.id);
    expect(cuenta.anulaciones).toHaveLength(0);
    expect(cuenta.lineas[0].unidades).toHaveLength(2);
  });

  it('cancelar con motivo una línea despachada entera: todas sus unidades quedan de baja', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId } = await dosDespachados(p);

    const res = await cancelarConMotivo(cuentaId, motivoMermaId);

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('cancelada');
    expect(await estadoDe(p.itemId, p.usado.id)).toBe('baja');
    expect(await estadoDe(p.itemId, p.nuevo.id)).toBe('baja');
    expect(await vendibles(p.itemId)).toEqual([p.reacond.id]);
  });

  it('cancelar con motivo: lo despachado se da de baja y lo que nunca salió a cocina se libera', async () => {
    const despachado = await productoConTresUnidades(true);
    const pendiente = await productoConTresUnidades(true);
    const cuentaId = await abrirCuenta(mesaA.id);
    expect(
      (await pedir(cuentaId, despachado.itemId, [despachado.usado.id])).status,
    ).toBe(201);
    expect((await despachar(cuentaId)).status).toBe(201);
    // Pedida DESPUÉS de despachar: su línea tiene cantidad_enviada = 0.
    expect(
      (await pedir(cuentaId, pendiente.itemId, [pendiente.usado.id])).status,
    ).toBe(201);

    const res = await cancelarConMotivo(cuentaId, motivoMermaId);

    expect(res.status).toBe(201);
    expect(await estadoDe(despachado.itemId, despachado.usado.id)).toBe('baja');
    expect(await estadoDe(pendiente.itemId, pendiente.usado.id)).toBe(
      'disponible',
    );
    expect(await vendibles(pendiente.itemId)).toContain(pendiente.usado.id);
  });

  it('cancelar con "no elaborado" una línea despachada a medias: no hay cuál elegir, se cancela y todas las unidades se liberan', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId } = await dosDespachados(p);
    expect((await pedir(cuentaId, p.itemId, [p.reacond.id])).status).toBe(201);

    const res = await cancelarConMotivo(cuentaId, motivoNoElaboradoId);

    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('cancelada');
    for (const u of [p.usado, p.nuevo, p.reacond]) {
      expect(await estadoDe(p.itemId, u.id)).toBe('disponible');
    }
    expect((await vendibles(p.itemId)).sort()).toEqual(
      [p.usado.id, p.nuevo.id, p.reacond.id].sort(),
    );
    const mermas: { n: string }[] = await ds.query(
      `SELECT count(*)::text AS n FROM movimientos_inventario
        WHERE tenant_id = $1 AND item_id = $2 AND motivo = 'merma'`,
      [PARIS_TENANT_ID, p.itemId],
    );
    expect(mermas[0].n).toBe('0');
  });

  it('cancelar con motivo con la línea despachada a medias: 400 pidiendo anular primero, y nada cambia', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId } = await dosDespachados(p);
    // La tercera se pide después del despacho: la línea queda 3/2.
    expect((await pedir(cuentaId, p.itemId, [p.reacond.id])).status).toBe(201);

    const res = await cancelarConMotivo(cuentaId, motivoMermaId);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `Anulá primero «${p.nombre}» eligiendo cuál salió`,
    );
    const cuenta = await detalleDe(cuentaId, mesaA.id);
    expect(cuenta.estado).toBe('abierta');
    expect(cuenta.anulaciones).toHaveLength(0);
    expect(cuenta.lineas[0].unidades).toHaveLength(3);
    for (const u of [p.usado, p.nuevo, p.reacond]) {
      expect(await estadoDe(p.itemId, u.id)).toBe('disponible');
    }
  });

  // ── Corregir una línea ya despachada ──

  const mandaAAnular = (nombre: string) =>
    `Ya se despachó «${nombre}»: para sacar o cambiar una unidad, anulala`;

  it('cambiar una unidad de una línea despachada: 400, la que está en la mesa sigue apartada y el POS no la vende', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId, lineaId } = await dosDespachados(p);

    // Los dos celulares están en la mesa: se intenta cambiar el usado por el reacondicionado.
    const res = await corregir(cuentaId, lineaId, {
      unidadIds: [p.nuevo.id, p.reacond.id],
    });

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(mandaAAnular(p.nombre));
    const cuenta = await detalleDe(cuentaId, mesaA.id);
    expect(cuenta.lineas[0].unidades.map((u) => u.id).sort()).toEqual(
      [p.usado.id, p.nuevo.id].sort(),
    );
    expect(await vendibles(p.itemId)).toEqual([p.reacond.id]);
    const pos = await venderPorPos(p.itemId, [p.usado.id]);
    expect(pos.status).toBe(400);
    expect((pos.body as ErrorResponse).message).toBe(
      `La unidad ${p.usado.serie} está apartada en la cuenta de ${mesaA.nombre}`,
    );
    expect(await estadoDe(p.itemId, p.usado.id)).toBe('disponible');
  });

  it('sacar una unidad de una línea despachada, entera o a medias: 400 mandando a anular, y nada cambia', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId, lineaId } = await dosDespachados(p);

    const entera = await corregir(cuentaId, lineaId, {
      unidadIds: [p.nuevo.id],
    });
    expect(entera.status).toBe(400);
    expect(mensajeDe(entera)).toBe(mandaAAnular(p.nombre));

    // La tercera se pide después del despacho y se fusiona: la línea queda 3/2.
    // Sacar justo la que no salió tampoco se puede: no se sabe cuál salió.
    expect((await pedir(cuentaId, p.itemId, [p.reacond.id])).status).toBe(201);
    const aMedias = await corregir(cuentaId, lineaId, {
      unidadIds: [p.usado.id, p.nuevo.id],
    });
    expect(aMedias.status).toBe(400);
    expect(mensajeDe(aMedias)).toBe(mandaAAnular(p.nombre));

    const cuenta = await detalleDe(cuentaId, mesaA.id);
    expect(Number(cuenta.lineas[0].cantidad)).toBe(3);
    expect(cuenta.lineas[0].unidades).toHaveLength(3);
    expect(await vendibles(p.itemId)).toEqual([]);
  });

  it('agregar una unidad a una línea despachada sí se puede: las que estaban se quedan', async () => {
    const p = await productoConTresUnidades(true);
    const { cuentaId, lineaId } = await dosDespachados(p);

    const res = await corregir(cuentaId, lineaId, {
      unidadIds: [p.usado.id, p.nuevo.id, p.reacond.id],
    });

    expect(res.status).toBe(200);
    expect(Number(res.body.lineas[0].cantidad)).toBe(3);
    expect(await vendibles(p.itemId)).toEqual([]);
  });
});
