import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * **La tarjeta de cada cuenta de la mesa dice cuánto lleva** (auditoría UX
 * 02.12, decisión del owner 2026-10-17).
 *
 * `GET /mesas/:id/cuentas` trae `totalFinal` por cuenta, calculado por el motor
 * de precios en un lote. La regla que este spec fija es la identidad: ese número
 * es **exactamente** el que da `POST /calculo-precios/calcular` con `cuentaId`
 * —el de la cuenta abierta y el del cobro—, no una aproximación. Si la lista
 * llegara a calcular por su cuenta, estos casos se separarían en cuanto una
 * cuenta tenga un descuento o el catálogo cambie después de pedir.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
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
interface CuentaDeLaLista {
  id: string;
  totalFinal?: string | null;
  lineas: { itemId: string; cantidad: string }[];
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

describe('Total de cada cuenta en la lista de la mesa (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let mesaId: string;
  let garzon: GarzonCreado;
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

  async function crearProducto(
    nombre: string,
    precioBase: string,
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${nombre} ${Date.now()}`,
        precioBase,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '1',
      })
    ).id;
  }

  async function conDescuento(
    itemId: string,
    valorPorcentaje: string,
  ): Promise<void> {
    const descuentoId = (
      await post<IdResponse>('/api/descuentos', {
        nombre: `Desc lista E2E ${Date.now()}`,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'porcentaje',
        valorPorcentaje,
        nivel: 'linea',
      })
    ).id;
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ descuentosIds: [descuentoId] });
    expect(res.status).toBe(200);
  }

  async function abrirCuentaCon(
    lineas: { itemId: string; cantidad: string }[],
  ): Promise<string> {
    const id = (
      await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      })
    ).id;
    cuentasAbiertas.push(id);
    for (const l of lineas) await post(`/api/cuentas/${id}/lineas`, l);
    return id;
  }

  async function lista(): Promise<CuentaDeLaLista[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as CuentaDeLaLista[];
  }

  /** El total de la cuenta calculada SOLA: lo que muestra la cuenta abierta. */
  async function totalDeCalcularSola(cuentaId: string): Promise<string> {
    // Lo mismo que manda la pantalla (`cuentaToCalcularInput`): `cuentaId` y las líneas de la
    // cuenta. El DTO exige al menos una; con `cuentaId` el servidor usa las líneas congeladas.
    const cuenta = (await lista()).find((c) => c.id === cuentaId)!;
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cuentaId,
        lineas: cuenta.lineas.map((l) => ({
          itemId: l.itemId,
          cantidad: l.cantidad,
        })),
      });
    expect(res.status).toBe(201);
    return (res.body as { totales: { totalFinal: string } }).totales.totalFinal;
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
    ds = moduleFixture.get(DataSource);
    token = await login(app);

    const marca = Date.now();

    // ⚠️ Garzón PROPIO, no el del seed: la sesión es única por garzón y el
    // estado se filtra de un spec al siguiente (`maxWorkers: 1`).
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón total lista E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón total lista E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa total lista',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar, y el `close` en un `finally`: lo que quede sin
    // cerrar contamina las suites siguientes.
    const fallos: string[] = [];
    try {
      for (const id of cuentasAbiertas) {
        const res = await request(app.getHttpServer())
          .post(`/api/cuentas/${id}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        if (![200, 201].includes(res.status)) {
          fallos.push(`cancelar ${id} → ${res.status}`);
        }
      }
      const cierre = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: garzon.id, pin: garzon.pin });
      if (![200, 201].includes(cierre.status)) {
        fallos.push(`cerrar sesión del garzón → ${cierre.status}`);
      }
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('1. dos cuentas de una mesa: cada total es el de calcularla sola, también con descuento y con el catálogo cambiado después de pedir', async () => {
    const cervezaId = await crearProducto('Cerveza lista', '3000');
    const pizzaId = await crearProducto('Pizza lista', '8000');
    await conDescuento(pizzaId, '0.10');

    const cuentaA = await abrirCuentaCon([
      { itemId: cervezaId, cantidad: '2' },
    ]);
    const cuentaB = await abrirCuentaCon([
      { itemId: pizzaId, cantidad: '1' },
      { itemId: cervezaId, cantidad: '1' },
    ]);

    // Lo pedido se cobra como se pidió: repreciar la carta no mueve la mesa, y
    // la lista tampoco puede enterarse.
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${cervezaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ precioBase: '4500' });
    expect(res.status).toBe(200);

    const cuentas = await lista();
    const delA = cuentas.find((c) => c.id === cuentaA)!;
    const delB = cuentas.find((c) => c.id === cuentaB)!;

    expect(delA.totalFinal).toBe(await totalDeCalcularSola(cuentaA));
    expect(delB.totalFinal).toBe(await totalDeCalcularSola(cuentaB));
    // Y no son un número cualquiera: A son dos cervezas pedidas a 3.000 (más
    // impuestos), no a los 4.500 con que quedó la carta después.
    expect(Number(delA.totalFinal)).toBeGreaterThanOrEqual(6000);
    expect(Number(delA.totalFinal)).toBeLessThan(2 * 4500);
    expect(Number(delB.totalFinal)).toBeLessThan(
      (8000 + 3000) * 1.19, // el 10% de la pizza lo baja
    );
    expect(delA.totalFinal).not.toBe(delB.totalFinal);
  });

  it('2. una cuenta con un ítem borrado sale con total null y las demás conservan el suyo', async () => {
    const sanoId = await crearProducto('Sano lista', '2000');
    const roto = await crearProducto('Descartable lista', '1000');
    const cuentaSana = await abrirCuentaCon([
      { itemId: sanoId, cantidad: '1' },
    ]);
    const cuentaRota = await abrirCuentaCon([{ itemId: roto, cantidad: '1' }]);

    // ⚠️ Por SQL y no por `DELETE /items/:id`: ese endpoint se niega mientras el
    // ítem esté en una línea viva de una cuenta abierta, así que por la API no hay
    // camino a este estado. Lo que se verifica es la conducta de la lista ante él
    // (la misma que fija `salones-anular-linea` para anular); se restaura al final.
    await ds.query(`UPDATE items SET eliminado_el = NOW() WHERE item_id = $1`, [
      roto,
    ]);
    try {
      const cuentas = await lista();
      expect(cuentas.find((c) => c.id === cuentaRota)!.totalFinal).toBeNull();
      expect(cuentas.find((c) => c.id === cuentaSana)!.totalFinal).toBe(
        await totalDeCalcularSola(cuentaSana),
      );
    } finally {
      await ds.query(
        `UPDATE items SET eliminado_el = NULL WHERE item_id = $1`,
        [roto],
      );
    }
  });

  it('3. un tenant ajeno no lee la lista de la mesa ni sus totales', async () => {
    const tokenAjeno = await loginSegundoTenant(app);

    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${tokenAjeno}`);

    // 403 si el otro tenant no opera salones, 404 si los opera: en ninguno de los dos ve la mesa.
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('totalFinal');
  });
});
