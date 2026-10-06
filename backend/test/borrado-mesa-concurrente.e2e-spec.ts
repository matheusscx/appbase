import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { correrCarrera } from './helpers/carrera';

/**
 * Borrar una mesa (o su salón) mientras se abre una cuenta en ella.
 *
 * `eliminarMesa` y `eliminarSalon` deciden con un conteo de cuentas abiertas, y
 * ese conteo solo es confiable si la apertura no puede estar a mitad de camino
 * sin que el borrado la espere. Sin el lock, la apertura que ya tomó la mesa
 * todavía no commiteó: el conteo da 0, el borrado espera en su `UPDATE mesas`,
 * la apertura commitea y el borrado pasa. Queda una cuenta abierta sobre una
 * mesa borrada, y lo que esa cuenta pide deja de estar apartado: la consulta de
 * lo apartado (`InventarioService.bloquearUnidadesParaSalida`) une `mesas` vivas
 * para nombrar la mesa en el 400, así que otra mesa puede pedir la misma unidad
 * —y el POS venderla—, mientras el selector (`vendibles`) ya no la ofrece.
 *
 * La compuerta retiene la fila de la mesa: la apertura llega primero y queda
 * primera en la cola de esa fila; el borrado llega después. Al soltar, la
 * apertura toma la mesa y commitea, y recién ahí sigue el borrado. Es el orden
 * que rompía; el otro (el borrado commitea primero) ya rechazaba la apertura,
 * porque su `FOR UPDATE … eliminado_el IS NULL` re-evalúa la fila al despertar.
 *
 * El caso 3 es el costado de ese lock: `eliminarSalon` toma varias mesas, y
 * `guardarLayout` escribe las mismas filas una por una. Si no comparten el
 * orden se abrazan (`40P01`); comparten el de `mesa_id`.
 *
 * Producto, salón, mesas y garzón son propios de este archivo: el stock del seed
 * se agota entre corridas locales y la sesión del garzón es única.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
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
}
interface Respuesta {
  status: number;
  body: { id?: string; message?: string | string[] };
}

describe('Borrar una mesa mientras se abre una cuenta en ella (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let localId: string;
  let garzon: { id: string; pin: string };
  const cuentasAbiertas: string[] = [];

  const nombreUnico = (base: string) =>
    `${base} borrado-mesa E2E ${Date.now()}-${Math.random()}`;

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
    token = (tenant.body as TokenResponse).access_token;

    const local: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = local[0].ubicacion_id;

    garzon = await crear<{ id: string; pin: string }>('/api/garzones', {
      nombre: nombreUnico('Garzón'),
    });
    await crear('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
  }, 60000);

  afterAll(async () => {
    // Acumular y afirmar DESPUÉS de `app.close()`: un expect que tira antes de
    // cerrar deja el pool abierto y jest no termina nunca. Una cuenta abierta
    // que sobrevive sigue apartando sus unidades.
    const fallos: string[] = [];
    try {
      for (const cuentaId of cuentasAbiertas) {
        const res = await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        if (![200, 201].includes(res.status)) {
          fallos.push(`cancelar cuenta ${cuentaId} → ${res.status}`);
        }
      }
      if (garzon) {
        const res = await request(app.getHttpServer())
          .post('/api/sesiones-garzon/cerrar')
          .set('Authorization', `Bearer ${token}`)
          .send({ garzonId: garzon.id, pin: garzon.pin });
        if (![200, 201].includes(res.status)) {
          fallos.push(`cerrar sesión del garzón → ${res.status}`);
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  async function crear<T>(url: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** La respuesta cruda: el test afirma el status de cada una. */
  async function intentar(
    metodo: 'post' | 'delete',
    url: string,
    body: Record<string, unknown> = {},
  ): Promise<Respuesta> {
    const res = await request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    // status-tolerante: devuelve el status en vez de afirmarlo; en las carreras el 200 y el 400 son el resultado que el test mide, y cada llamador afirma el suyo
    return { status: res.status, body: res.body as Respuesta['body'] };
  }

  const mensajeDe = (res: Respuesta): string => {
    const m = res.body.message;
    return Array.isArray(m) ? m.join(' ') : (m ?? '');
  };

  const abrirCuenta = (mesaId: string) =>
    intentar('post', `/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    }).then((res) => {
      if (res.status === 201 && res.body.id) cuentasAbiertas.push(res.body.id);
      return res;
    });

  const pedir = (cuentaId: string, itemId: string, unidadId: string) =>
    intentar('post', `/api/cuentas/${cuentaId}/lineas`, {
      itemId,
      cantidad: '1',
      unidadIds: [unidadId],
    });

  /** Un salón con dos mesas: la que se borra y la de al lado. */
  async function salonConDosMesas() {
    const salonId = (
      await crear<IdResponse>('/api/salones', { nombre: nombreUnico('Salón') })
    ).id;
    const mesa = async (nombre: string) =>
      (await crear<IdResponse>(`/api/salones/${salonId}/mesas`, { nombre })).id;
    const nombreA = nombreUnico('Mesa A');
    return {
      salonId,
      mesaA: { id: await mesa(nombreA), nombre: nombreA },
      mesaB: await mesa(nombreUnico('Mesa B')),
    };
  }

  /**
   * Un producto con serie con dos unidades en el local. Dos y no una: con una
   * sola, la mesa de al lado rebota antes por la reserva de stock
   * (`validarStockAlPedir`), que no une `mesas`, y el test no llegaría a lo
   * apartado (medido).
   */
  async function productoConDosUnidades() {
    const itemId = (
      await crear<IdResponse>('/api/items', {
        nombre: nombreUnico('Celular'),
        tipo: 'producto',
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        modoInventario: 'serie',
      })
    ).id;
    const entrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '2',
        series: [
          { serie: nombreUnico('IMEI'), condicion: 'nuevo' },
          { serie: nombreUnico('IMEI'), condicion: 'usado' },
        ],
      });
    expect(entrada.status).toBe(200);
    const unidades = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(unidades.status).toBe(200);
    const [unidad] = unidades.body as UnidadResponse[];
    return { itemId, unidad };
  }

  async function vendibles(itemId: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades?vendibles=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as UnidadResponse[]).map((u) => u.id);
  }

  async function mesaBorrada(mesaId: string): Promise<boolean> {
    const filas: { eliminado_el: Date | null }[] = await ds.query(
      `SELECT eliminado_el FROM mesas WHERE mesa_id = $1`,
      [mesaId],
    );
    return filas[0].eliminado_el !== null;
  }

  /**
   * La apertura primero, el borrado después, los dos frenados por la fila de
   * la mesa. `esperando: 2` es la prueba de que hubo carrera: con menos, uno de
   * los dos corrió en serie y el test mediría otra cosa.
   */
  async function abrirMientrasSeBorra(
    mesaId: string,
    borrar: () => Promise<Respuesta>,
  ) {
    const {
      esperando,
      respuestas: [apertura, borrado],
    } = await correrCarrera(
      ds,
      [`SELECT mesa_id FROM mesas WHERE mesa_id = $1 FOR UPDATE`, [mesaId]],
      [() => abrirCuenta(mesaId), borrar],
      { escalonarMs: 800 },
    );
    return { esperando, apertura, borrado };
  }

  /**
   * Lo que la carrera ponía en juego: la unidad que pide la cuenta recién
   * abierta queda apartada para la mesa de al lado, y el selector coincide.
   */
  async function laUnidadQuedaApartada(
    cuentaId: string,
    mesa: { id: string; nombre: string },
    mesaB: string,
  ) {
    const { itemId, unidad } = await productoConDosUnidades();
    const pedido = await pedir(cuentaId, itemId, unidad.id);
    expect(pedido.status).toBe(201);
    expect(await vendibles(itemId)).not.toContain(unidad.id);

    const cuentaB = await abrirCuenta(mesaB);
    expect(cuentaB.status).toBe(201);
    const otraMesa = await pedir(cuentaB.body.id!, itemId, unidad.id);
    expect(otraMesa.status).toBe(400);
    expect(mensajeDe(otraMesa)).toBe(
      `La unidad ${unidad.serie} está apartada en la cuenta de ${mesa.nombre}`,
    );
  }

  it('1. borrar la mesa: el borrado espera a la apertura y rebota con 400; la unidad que pide esa cuenta queda apartada', async () => {
    const { mesaA, mesaB } = await salonConDosMesas();

    const { esperando, apertura, borrado } = await abrirMientrasSeBorra(
      mesaA.id,
      () => intentar('delete', `/api/mesas/${mesaA.id}`),
    );

    expect(esperando).toBe(2);
    expect(apertura.status).toBe(201);
    expect(borrado.status).toBe(400);
    expect(mensajeDe(borrado)).toBe(
      'No se puede eliminar una mesa con cuentas abiertas',
    );
    expect(await mesaBorrada(mesaA.id)).toBe(false);

    await laUnidadQuedaApartada(apertura.body.id!, mesaA, mesaB);
  });

  it('2. borrar el salón: el mismo par, sobre todas sus mesas', async () => {
    const { salonId, mesaA, mesaB } = await salonConDosMesas();

    const { esperando, apertura, borrado } = await abrirMientrasSeBorra(
      mesaA.id,
      () => intentar('delete', `/api/salones/${salonId}`),
    );

    expect(esperando).toBe(2);
    expect(apertura.status).toBe(201);
    expect(borrado.status).toBe(400);
    expect(mensajeDe(borrado)).toBe(
      'No se puede eliminar un salón con cuentas abiertas',
    );
    expect(await mesaBorrada(mesaA.id)).toBe(false);

    await laUnidadQuedaApartada(apertura.body.id!, mesaA, mesaB);
  });

  it('3. guardar el plano mientras se borra el salón: los dos toman las mesas en orden de mesa_id y no se abrazan', async () => {
    // La pantalla manda las mesas en orden de nombre, que no tiene nada que ver
    // con el de `mesa_id`. Acá van al revés del id: es el orden que cerraba el
    // ciclo contra el `ORDER BY mesa_id FOR UPDATE` de `eliminarSalon` —el plano
    // retenía la primera que mandó y esperaba la última, que el borrado ya había
    // tomado primero— y Postgres mataba al borrado con `40P01` (un 500).
    const salonId = (
      await crear<IdResponse>('/api/salones', { nombre: nombreUnico('Salón') })
    ).id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (
          await crear<IdResponse>(`/api/salones/${salonId}/mesas`, {
            nombre: nombreUnico(`Mesa ${i}`),
          })
        ).id,
      );
    }
    const [primera, delMedio, ultima] = [...ids].sort();

    const {
      esperando,
      respuestas: [plano, borrado],
    } = await correrCarrera(
      ds,
      // La del medio: el plano ya tomó la última y espera acá; el borrado toma
      // la primera y espera acá también.
      [`SELECT mesa_id FROM mesas WHERE mesa_id = $1 FOR UPDATE`, [delMedio]],
      [
        () =>
          request(app.getHttpServer())
            .patch(`/api/salones/${salonId}/layout`)
            .set('Authorization', `Bearer ${token}`)
            .send({
              mesas: [ultima, delMedio, primera].map((mesaId) => ({
                mesaId,
                posX: 0.5,
                posY: 0.5,
              })),
            })
            .then((r) => ({
              status: r.status,
              body: r.body as Respuesta['body'],
            })),
        () => intentar('delete', `/api/salones/${salonId}`),
      ],
      { escalonarMs: 800 },
    );

    expect(esperando).toBe(2);
    expect(plano.status).toBe(200);
    expect(borrado.status).toBe(200);
    for (const id of ids) expect(await mesaBorrada(id)).toBe(true);
  });
});
