import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * `cuenta_linea_reparto` (Task 1, spec
 * `docs/superpowers/specs/2026-09-27-porcentaje-anulaciones-por-garzon-design.md`
 * § 3): cuántas unidades de cada línea entraron con cada garzón responsable.
 * No cierra cuentas: no necesita caja.
 *
 * Garzones, salón, mesa e ítems son PROPIOS de este archivo (no del seed): la
 * sesión de garzón es única y varias suites la comparten
 * (`docs/agent/pendientes.md`).
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Operar` + `Salones:Anular` (seedRolEncargadoSalon). */
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };

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
interface MotivoBajaItem {
  id: string;
  nombre: string;
  tipo: string;
}
interface CuentaLineaDetalle {
  id: string;
  itemId: string;
  cantidad: string;
  cantidadEnviada: string;
}
interface CuentaAnulacionDetalle {
  id: string;
  itemId: string;
}
interface CuentaDetalle {
  id: string;
  numero: number;
  estado: string;
  lineas: CuentaLineaDetalle[];
  anulaciones: CuentaAnulacionDetalle[];
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

describe('Salones — el reparto de cada línea (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let mesaId: string;
  let garzon1: GarzonCreado;
  let garzon2: GarzonCreado;
  let motivoMermaId: string;
  let motivoCortesiaId: string;
  let catCocinaId: string;
  let marca: number;

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

  async function crearItem(
    nombre: string,
    precioBase: string,
  ): Promise<string> {
    const item = await post<IdResponse>('/api/items', {
      nombre: `${nombre} E2E ${marca}`,
      tipo: 'producto',
      precioBase,
      monedaId: CLP_MONEDA_ID,
      unidadMedida: 'unidad',
      stock: '1000',
      categoriaId: catCocinaId,
    });
    return item.id;
  }

  async function abrirCuenta(garzon: GarzonCreado): Promise<CuentaDetalle> {
    return post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
  }

  async function agregarLinea(
    cuentaId: string,
    itemId: string,
    cantidad: string,
  ): Promise<CuentaDetalle> {
    return post<CuentaDetalle>(`/api/cuentas/${cuentaId}/lineas`, {
      itemId,
      cantidad,
    });
  }

  async function despachar(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/comanda/reclamar`, {});
  }

  async function anularLinea(
    cuentaId: string,
    lineaId: string,
    body: { cantidad: string; motivoBajaId: string },
  ): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas/${lineaId}/anular`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as CuentaDetalle;
  }

  async function cancelarConMotivo(
    cuentaId: string,
    motivoBajaId: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar-con-motivo`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ motivoBajaId });
    expect(res.status).toBe(201);
  }

  async function cancelar(cuentaId: string): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({});
    expect(res.status).toBe(201);
  }

  async function fusionar(cuentaIds: string[]): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/cuentas/fusionar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ cuentaIds });
    expect(res.status).toBe(201);
    return res.body as CuentaDetalle;
  }

  async function transferir(cuentaId: string, a: GarzonCreado): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/transferir`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId: a.id, pin: a.pin });
    expect(res.status).toBe(201);
  }

  async function patchCantidad(
    cuentaId: string,
    lineaId: string,
    cantidad: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch(`/api/cuentas/${cuentaId}/lineas/${lineaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ cantidad });
    expect(res.status).toBe(200);
  }

  async function reparto(
    cuentaId: string,
  ): Promise<
    { item_id: string; garzon_id: string | null; cantidad: string }[]
  > {
    return ds.query(
      `SELECT cl.item_id, r.garzon_id, r.cantidad::text AS cantidad
         FROM cuenta_linea_reparto r
         JOIN cuenta_lineas cl ON cl.cuenta_linea_id = r.cuenta_linea_id AND cl.eliminado_el IS NULL
        WHERE cl.cuenta_id = $1 AND r.eliminado_el IS NULL AND r.cantidad > 0
        ORDER BY cl.item_id, r.garzon_id`,
      [cuentaId],
    );
  }

  /** Σ reparto vivo = cantidad, para toda línea viva de la cuenta (spec § 3.2). */
  async function assertInvariante(cuentaId: string): Promise<void> {
    const rotas: unknown[] = await ds.query(
      `SELECT cl.cuenta_linea_id, cl.cantidad, COALESCE(SUM(r.cantidad), 0) AS suma
         FROM cuenta_lineas cl
         LEFT JOIN cuenta_linea_reparto r ON r.cuenta_linea_id = cl.cuenta_linea_id AND r.eliminado_el IS NULL
        WHERE cl.cuenta_id = $1 AND cl.eliminado_el IS NULL
        GROUP BY cl.cuenta_linea_id, cl.cantidad
       HAVING cl.cantidad <> COALESCE(SUM(r.cantidad), 0)`,
      [cuentaId],
    );
    expect(rotas).toEqual([]);
  }

  /** Agrupa filas de `reparto()` por ítem, ordenadas por `garzon_id` (comparación estable para el `toEqual`). */
  function agrupar(
    filas: { item_id: string; garzon_id: string | null; cantidad: string }[],
  ): Record<string, { garzon_id: string | null; cantidad: string }[]> {
    const out: Record<
      string,
      { garzon_id: string | null; cantidad: string }[]
    > = {};
    for (const f of filas) {
      (out[f.item_id] ??= []).push({
        garzon_id: f.garzon_id,
        cantidad: f.cantidad,
      });
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) =>
        (a.garzon_id ?? '').localeCompare(b.garzon_id ?? ''),
      );
    }
    return out;
  }

  /** Mismo orden que `agrupar`, para construir el lado esperado del `toEqual`. */
  function pares(
    ...items: [string | null, string][]
  ): { garzon_id: string | null; cantidad: string }[] {
    return items
      .map(([garzon_id, cantidad]) => ({ garzon_id, cantidad }))
      .sort((a, b) => (a.garzon_id ?? '').localeCompare(b.garzon_id ?? ''));
  }

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
    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenEncargado = await entrar(app, ENCARGADO.email, ENCARGADO.pass);

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resMotivos.status).toBe(200);
    const motivos = resMotivos.body as MotivoBajaItem[];
    motivoMermaId = motivos.find((m) => m.tipo === 'merma')!.id;
    motivoCortesiaId = motivos.find((m) => m.tipo === 'cortesia')!.id;
    expect(motivoMermaId).toBeTruthy();
    expect(motivoCortesiaId).toBeTruthy();

    marca = Date.now();

    // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
    // `cantidadEnviada` — mismo molde que `salones-anulaciones-reporte.e2e-spec.ts`.
    const cocinaId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina reparto-linea E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-reparto-linea-e2e-${marca}`,
      })
    ).id;
    catCocinaId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Cocina reparto-linea E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;

    // Garzones PROPIOS: la sesión es única por garzón.
    garzon1 = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón reparto-linea-1 E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon1.id,
      pin: garzon1.pin,
      turnoId: TURNO_MANANA_ID,
    });
    garzon2 = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón reparto-linea-2 E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon2.id,
      pin: garzon2.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón reparto-linea E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa reparto-linea',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    const limpiar = async (que: string, ejecutar: () => Promise<number>) => {
      try {
        const status = await ejecutar();
        if (![200, 201].includes(status)) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };

    try {
      await limpiar(
        'cerrar sesión garzón 1',
        async () =>
          (
            await request(app.getHttpServer())
              .post('/api/sesiones-garzon/cerrar')
              .set('Authorization', `Bearer ${tokenAdmin}`)
              .send({ garzonId: garzon1.id, pin: garzon1.pin })
          ).status,
      );
      await limpiar(
        'cerrar sesión garzón 2',
        async () =>
          (
            await request(app.getHttpServer())
              .post('/api/sesiones-garzon/cerrar')
              .set('Authorization', `Bearer ${tokenAdmin}`)
              .send({ garzonId: garzon2.id, pin: garzon2.pin })
          ).status,
      );
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('línea nueva: una fila, del responsable, con la cantidad pedida', async () => {
    const item = await crearItem('Reparto línea nueva', '5000');
    const cuenta = await abrirCuenta(garzon1);
    await agregarLinea(cuenta.id, item, '2');

    await assertInvariante(cuenta.id);
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '2.0000']),
    });

    await cancelar(cuenta.id);
  });

  it('el "+" después de transferir es del NUEVO responsable, no del creador de la línea', async () => {
    const item = await crearItem('Reparto mas tras transferir', '3000');
    const cuenta = await abrirCuenta(garzon1);
    const detalle = await agregarLinea(cuenta.id, item, '2');
    const lineaId = detalle.lineas.find((l) => l.itemId === item)!.id;

    await transferir(cuenta.id, garzon2);
    await patchCantidad(cuenta.id, lineaId, '3');

    await assertInvariante(cuenta.id);
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '2.0000'], [garzon2.id, '1.0000']),
    });

    await cancelar(cuenta.id);
  });

  it('sumar desde el catálogo después de transferir se une a la línea existente y reparte entre los dos', async () => {
    const item = await crearItem('Reparto sumar tras transferir', '4500');
    const cuenta = await abrirCuenta(garzon1);
    await agregarLinea(cuenta.id, item, '1');

    await transferir(cuenta.id, garzon2);
    const detalle = await agregarLinea(cuenta.id, item, '1');

    const lineasDelItem = detalle.lineas.filter((l) => l.itemId === item);
    expect(lineasDelItem).toHaveLength(1);

    await assertInvariante(cuenta.id);
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '1.0000'], [garzon2.id, '1.0000']),
    });

    await cancelar(cuenta.id);
  });

  it('bajar la cantidad descuenta primero del responsable vigente y después de la fila más reciente', async () => {
    const item = await crearItem('Reparto bajar cantidad', '2200');
    const cuenta = await abrirCuenta(garzon1);
    const detalle = await agregarLinea(cuenta.id, item, '3');
    const lineaId = detalle.lineas.find((l) => l.itemId === item)!.id;

    await transferir(cuenta.id, garzon2);
    await patchCantidad(cuenta.id, lineaId, '4');
    await patchCantidad(cuenta.id, lineaId, '2');

    await assertInvariante(cuenta.id);
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '2.0000']),
    });

    await cancelar(cuenta.id);
  });

  it('anular después de transferir descuenta del responsable vigente, y la anulación queda con su garzón', async () => {
    const item = await crearItem('Reparto anular tras transferir', '1800');
    const cuenta = await abrirCuenta(garzon1);
    const detalle = await agregarLinea(cuenta.id, item, '2');
    const lineaId = detalle.lineas.find((l) => l.itemId === item)!.id;

    await despachar(cuenta.id);
    await transferir(cuenta.id, garzon2);
    const tras = await anularLinea(cuenta.id, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });

    await assertInvariante(cuenta.id);
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '1.0000']),
    });

    const anulacionId = tras.anulaciones.find((a) => a.itemId === item)!.id;
    const filaAnulacion: { garzon_id: string | null }[] = await ds.query(
      `SELECT garzon_id FROM cuenta_linea_anulaciones WHERE cuenta_linea_anulacion_id = $1`,
      [anulacionId],
    );
    expect(filaAnulacion[0].garzon_id).toBe(garzon2.id);

    // Queda 1 despachado a cocina: la ruta simple de cancelar lo rechaza.
    await cancelarConMotivo(cuenta.id, motivoCortesiaId);
  });

  // Ronda de fix 1 (domain review, hallazgo de cobertura): en los dos tests de
  // arriba la fila del responsable vigente ES la más reciente, así que un
  // `descontarReparto` que solo mirara `creado_el` (sin la prioridad del
  // responsable) daría el mismo resultado — no discriminan la regla. Los dos
  // tests de abajo separan las reglas a propósito: el responsable vigente
  // vuelve a tener la fila MÁS VIEJA (se transfiere y se vuelve a transferir),
  // así que por sola recencia el resultado sería otro (anotado en cada test).
  it('bajar la cantidad sale del responsable vigente aunque su fila sea la más vieja', async () => {
    const item = await crearItem(
      'Reparto bajar, responsable mas viejo',
      '1500',
    );
    const cuenta = await abrirCuenta(garzon1);
    const detalle = await agregarLinea(cuenta.id, item, '2');
    const lineaId = detalle.lineas.find((l) => l.itemId === item)!.id;
    await assertInvariante(cuenta.id);

    await transferir(cuenta.id, garzon2);
    await patchCantidad(cuenta.id, lineaId, '3');
    await assertInvariante(cuenta.id);
    // Antes de bajar: G1 (fila vieja) = 2, G2 (fila nueva) = 1.
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '2.0000'], [garzon2.id, '1.0000']),
    });

    // El responsable vuelve a ser G1 (la fila más VIEJA), y baja la cantidad.
    await transferir(cuenta.id, garzon1);
    await patchCantidad(cuenta.id, lineaId, '2');

    await assertInvariante(cuenta.id);
    // Por responsable: sale de G1 (2 → 1), G2 queda intacto → [G1: 1, G2: 1].
    // Por sola recencia habría salido de G2 (la fila más reciente) → [G1: 2].
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '1.0000'], [garzon2.id, '1.0000']),
    });

    await cancelar(cuenta.id);
  });

  it('anular sale del responsable vigente aunque su fila sea la más vieja', async () => {
    const item = await crearItem(
      'Reparto anular, responsable mas viejo',
      '1700',
    );
    const cuenta = await abrirCuenta(garzon1);
    const detalle = await agregarLinea(cuenta.id, item, '2');
    const lineaId = detalle.lineas.find((l) => l.itemId === item)!.id;
    await assertInvariante(cuenta.id);

    await transferir(cuenta.id, garzon2);
    await patchCantidad(cuenta.id, lineaId, '3');
    await assertInvariante(cuenta.id);
    // Antes de anular: G1 (fila vieja) = 2, G2 (fila nueva) = 1.
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '2.0000'], [garzon2.id, '1.0000']),
    });

    await despachar(cuenta.id);
    // El responsable vuelve a ser G1 (la fila más VIEJA), y anula.
    await transferir(cuenta.id, garzon1);
    await anularLinea(cuenta.id, lineaId, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });

    await assertInvariante(cuenta.id);
    // Por responsable: sale de G1 (2 → 1), G2 queda intacto → [G1: 1, G2: 1].
    // Por sola recencia habría salido de G2 (la fila más reciente) → [G1: 2].
    expect(agrupar(await reparto(cuenta.id))).toEqual({
      [item]: pares([garzon1.id, '1.0000'], [garzon2.id, '1.0000']),
    });

    // Queda 2 despachado a cocina: la ruta simple de cancelar lo rechaza.
    await cancelarConMotivo(cuenta.id, motivoCortesiaId);
  });

  it('anular la cantidad entera borra la línea, y reparto() no la devuelve', async () => {
    const item = await crearItem('Reparto anular linea entera', '900');
    const cuenta = await abrirCuenta(garzon1);
    const detalle = await agregarLinea(cuenta.id, item, '2');
    const lineaId = detalle.lineas.find((l) => l.itemId === item)!.id;

    await despachar(cuenta.id);
    await anularLinea(cuenta.id, lineaId, {
      cantidad: '2',
      motivoBajaId: motivoMermaId,
    });

    // Sin líneas vivas, `anularLinea` ya cancela la cuenta: no hace falta
    // cerrarla acá.
    expect(await reparto(cuenta.id)).toEqual([]);
  });

  it('la fusión mueve el reparto con la línea: se junta por garzón y ninguna fila viva cuelga de una línea borrada', async () => {
    const itemX = await crearItem('Reparto fusion X', '3300');
    const itemY = await crearItem('Reparto fusion Y', '2700');

    const cuentaA = await abrirCuenta(garzon1);
    await agregarLinea(cuentaA.id, itemX, '2');

    const cuentaB = await abrirCuenta(garzon2);
    await agregarLinea(cuentaB.id, itemX, '1');
    await agregarLinea(cuentaB.id, itemY, '1');

    const destino = await fusionar([cuentaA.id, cuentaB.id]);
    // `cuentaA` se abrió primero, así que quedó con el número más bajo y es
    // la que `fusionarCuentas` toma como destino.
    expect(destino.id).toBe(cuentaA.id);

    await assertInvariante(destino.id);
    expect(agrupar(await reparto(destino.id))).toEqual({
      [itemX]: pares([garzon1.id, '2.0000'], [garzon2.id, '1.0000']),
      [itemY]: pares([garzon2.id, '1.0000']),
    });

    const colgadas: unknown[] = await ds.query(
      `SELECT r.cuenta_linea_reparto_id FROM cuenta_linea_reparto r
         JOIN cuenta_lineas cl ON cl.cuenta_linea_id = r.cuenta_linea_id
        WHERE cl.eliminado_el IS NOT NULL AND r.eliminado_el IS NULL AND r.cantidad > 0
          AND cl.cuenta_id = ANY($1)`,
      [[cuentaA.id, cuentaB.id]],
    );
    expect(colgadas).toEqual([]);

    await cancelar(destino.id);
  });
});
