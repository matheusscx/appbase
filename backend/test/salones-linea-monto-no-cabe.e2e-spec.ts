import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';

/**
 * El precio de una línea de cuenta que no cabe en `NUMERIC(18,4)` es 400 en
 * `POST /cuentas/:id/lineas`, no un 500 del `INSERT` (2026-10-09). Medido el
 * 2026-10-08: una receta en CLP con `precioBase` 99.999.999.999.999 y un extra
 * de $1 daba 500, porque `precio_unitario` y `precio_unitario_origen` llegaban
 * a 100.000.000.000.000. El cierre ya lo rechazaba con 400 (guard del motor);
 * esto es el mismo criterio en la puerta que congela el precio.
 *
 * Los casos de rechazo miran que no quedó **ninguna** fila en `cuenta_lineas`
 * (sin filtrar `eliminado_el`: una fila borrada también sería una escritura), y
 * cada uno trae su control que sí entra, con el precio un peso más abajo: el
 * mismo plato, el mismo extra, sin desbordar.
 *
 * El caso de la moneda cubre el segundo monto: el origen cabe y el convertido a
 * la moneda oficial no (USD a 2).
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const USD_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440005';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const TECHO = '100.000.000.000.000';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}

describe('El precio de una línea de cuenta que no cabe es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let garzon: { id: string; pin: string };
  let mesaId: string;
  let cuentaId: string;
  let extraId: string;
  /** La tasa del USD antes del spec (puede ser `null`); `undefined` = no se tocó. */
  let usdOriginal: string | null | undefined;
  const marca = randomUUID().slice(0, 8);

  function enviar(ruta: string, body: object) {
    return request(app.getHttpServer())
      .post(`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await enviar(ruta, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  async function crearReceta(
    nombre: string,
    precioBase: string,
    monedaId: string,
  ): Promise<string> {
    return (
      await crear('items', {
        nombre,
        precioBase,
        monedaId,
        tipo: 'receta',
        clasificacionTributaria: 'exento',
        ingredientes: [
          {
            ingredienteItemId: extraId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: false,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            precioExtra: '1',
          },
        ],
      })
    ).id;
  }

  const pedirConExtra = (itemId: string) =>
    enviar(`cuentas/${cuentaId}/lineas`, {
      itemId,
      cantidad: '1',
      personalizacion: { extras: [{ ingredienteItemId: extraId }] },
    });

  async function lineasDe(itemId: string): Promise<number> {
    const filas: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM cuenta_lineas WHERE item_id = $1`,
      [itemId],
    );
    return Number(filas[0].n);
  }

  function mensajes(res: { status: number; body: unknown }): string[] {
    expect(res.status).toBe(400);
    return [(res.body as { message?: string | string[] }).message ?? []].flat();
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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

    extraId = (
      await crear('items', {
        nombre: `Queso línea al tope E2E ${marca}`,
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
      })
    ).id;

    // Garzón PROPIO: la sesión es única por garzón y las suites comparten seed.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón línea al tope E2E ${marca}`,
    });
    await crear('sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón línea al tope E2E ${marca}`,
    });
    mesaId = (await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa tope' }))
      .id;
    cuentaId = (
      await crear(`mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      })
    ).id;

    // USD a 2: con ese factor el origen puede caber y el convertido no.
    const [usd]: { valor_del_dia: string | null }[] = await ds.query(
      `SELECT valor_del_dia::text FROM tenant_moneda
        WHERE tenant_id = $1 AND moneda_id = $2 AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID, USD_MONEDA_ID],
    );
    usdOriginal = usd?.valor_del_dia ?? null;
    const patch = await request(app.getHttpServer())
      .patch(`/api/monedas/${USD_MONEDA_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorDelDia: '2' });
    expect(patch.status).toBe(200);
  }, 60000);

  afterAll(async () => {
    try {
      if (usdOriginal !== undefined) {
        await request(app.getHttpServer())
          .patch(`/api/monedas/${USD_MONEDA_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ valorDelDia: usdOriginal });
      }
      await enviar(`cuentas/${cuentaId}/cancelar`, {});
      await enviar('sesiones-garzon/cerrar', {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
    } finally {
      await app.close();
    }
  });

  it('el precio base al tope más un extra de $1: 400 y ninguna línea escrita', async () => {
    const nombre = `Receta al tope E2E ${marca}`;
    const recetaId = await crearReceta(nombre, '99999999999999', CLP_MONEDA_ID);

    const res = await pedirConExtra(recetaId);

    expect(mensajes(res)).toEqual([
      `«${nombre}» cuesta ${TECHO} en su moneda, y el sistema no puede guardar ` +
        `montos de ${TECHO} o más: revisá el precio y los extras`,
    ]);
    expect(await lineasDe(recetaId)).toBe(0);
  });

  it('control: el mismo plato un peso más barato, con el mismo extra, se pide', async () => {
    const recetaId = await crearReceta(
      `Receta bajo el tope E2E ${marca}`,
      '99999999999998',
      CLP_MONEDA_ID,
    );

    const res = await pedirConExtra(recetaId);

    expect(res.status).toBe(201);
    const filas: { precio_unitario: string; precio_unitario_origen: string }[] =
      await ds.query(
        `SELECT precio_unitario::text, precio_unitario_origen::text
           FROM cuenta_lineas WHERE item_id = $1`,
        [recetaId],
      );
    expect(filas).toEqual([
      {
        precio_unitario: '99999999999999.0000',
        precio_unitario_origen: '99999999999999.0000',
      },
    ]);
  });

  it('el origen cabe y el precio convertido a la moneda oficial no: 400', async () => {
    // 60.000.000.000.000 USD × 2 = 120.000.000.000.000 CLP; el extra de $1 se
    // suma en la moneda del ítem (el extra va en la del ítem, no se convierte aparte).
    const nombre = `Receta USD al tope E2E ${marca}`;
    const recetaId = await crearReceta(nombre, '60000000000000', USD_MONEDA_ID);

    const res = await pedirConExtra(recetaId);

    const msj = mensajes(res);
    expect(msj).toHaveLength(1);
    expect(msj[0]).toMatch(
      new RegExp(
        `^«${nombre}» da \\$1\\d\\d\\.\\d{3}\\.\\d{3}\\.\\d{3}\\.\\d{3}, y el sistema ` +
          `no puede guardar montos de \\$${TECHO.replace(/\./g, '\\.')} o más: ` +
          `revisá el precio y los extras$`,
      ),
    );
    expect(await lineasDe(recetaId)).toBe(0);
  });

  it('control: el precio convertido que sí cabe se pide', async () => {
    const recetaId = await crearReceta(
      `Receta USD bajo el tope E2E ${marca}`,
      '40000000000000',
      USD_MONEDA_ID,
    );

    const res = await pedirConExtra(recetaId);

    expect(res.status).toBe(201);
    expect(await lineasDe(recetaId)).toBe(1);
  });
});
