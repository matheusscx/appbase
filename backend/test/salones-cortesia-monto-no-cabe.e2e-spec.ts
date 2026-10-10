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
 * Una cortesía cuyos baldes fiscales no caben en `NUMERIC(18,4)` es 400, no un
 * 500 del `INSERT` en `cuenta_linea_anulaciones` (2026-10-09). Cada unidad de la
 * línea cabe —`agregarLinea` ya revisa el precio unitario—, pero la cortesía
 * congela la base de la **cantidad anulada**: 2 × 99.999.999.999.999 da una
 * base exenta de 199.999.999.999.998, que Postgres rechazaba con `numeric field
 * overflow`. Medido el 2026-10-09 por las dos rutas que tasan una cortesía:
 * anular la línea y cancelar la cuenta con motivo.
 *
 * Los rechazos miran que no quedó nada escrito: ni la anulación, ni el consumo
 * de stock, ni la línea tocada (sin filtrar `eliminado_el`: una fila borrada
 * también sería una escritura). Cada uno trae su control con la misma línea y
 * una unidad, que sí cabe.
 *
 * El caso con IVA incluido fija el criterio: se mira lo que se GUARDA (la base y
 * el IVA), no la carta, que no se persiste. Una carta de 110.000.000.000.000
 * con IVA incluido deja una base de 92.436.974.789.916 y un IVA de
 * 17.563.025.210.084, y los dos caben.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Operar` + `Salones:Anular`: el rol que anula en el local. */
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };

const TECHO = '100.000.000.000.000';
const AL_TOPE = '99999999999999';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
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

describe('Una cortesía cuyos baldes no caben es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let garzon: { id: string; pin: string };
  let mesaId: string;
  let catCocinaId: string;
  let motivoCortesiaId: string;
  let motivoNoElaboradoId: string;
  const cuentasAbiertas: string[] = [];
  const marca = randomUUID().slice(0, 8);

  function enviar(ruta: string, body: object, token = tokenAdmin) {
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

  function mensajes(res: { status: number; body: unknown }): string[] {
    expect(res.status).toBe(400);
    return [(res.body as { message?: string | string[] }).message ?? []].flat();
  }

  async function crearProducto(
    nombre: string,
    precioBase: string,
    clasificacionTributaria: 'afecto' | 'exento',
  ): Promise<string> {
    return (
      await crear('items', {
        nombre,
        tipo: 'producto',
        precioBase,
        precioIncluyeImpuesto: true,
        clasificacionTributaria,
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '50',
        costo: '100',
        categoriaId: catCocinaId,
      })
    ).id;
  }

  /** Abre una cuenta con la línea y la despacha entera: lo anulable es lo enviado. */
  async function cuentaDespachadaCon(
    itemId: string,
    cantidad: string,
  ): Promise<{ cuentaId: string; lineaId: string }> {
    const cuenta = await crear(`mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    cuentasAbiertas.push(cuenta.id);
    await crear(`cuentas/${cuenta.id}/lineas`, { itemId, cantidad });
    await crear(`cuentas/${cuenta.id}/comanda/reclamar`, {});
    const [linea]: { cuenta_linea_id: string; cantidad_enviada: string }[] =
      await ds.query(
        `SELECT cuenta_linea_id, cantidad_enviada::text FROM cuenta_lineas
          WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
        [cuenta.id],
      );
    expect(Number(linea.cantidad_enviada)).toBe(Number(cantidad));
    return { cuentaId: cuenta.id, lineaId: linea.cuenta_linea_id };
  }

  const anular = (cuentaId: string, lineaId: string, cantidad: string) =>
    enviar(
      `cuentas/${cuentaId}/lineas/${lineaId}/anular`,
      { cantidad, motivoBajaId: motivoCortesiaId },
      tokenEncargado,
    );

  const cancelarConCortesia = (cuentaId: string) =>
    enviar(
      `cuentas/${cuentaId}/cancelar-con-motivo`,
      { motivoBajaId: motivoCortesiaId },
      tokenEncargado,
    );

  /** Todo lo que una anulación escribe: su fila, el stock y la línea misma. */
  async function escrito(cuentaId: string, itemId: string) {
    const [fila]: {
      anulaciones: string;
      movimientos: string;
      lineas: string;
    }[] = await ds.query(
      `SELECT
           (SELECT count(*) FROM cuenta_linea_anulaciones WHERE cuenta_id = $1) AS anulaciones,
           (SELECT count(*) FROM movimientos_inventario WHERE item_id = $2) AS movimientos,
           (SELECT string_agg(cantidad::text || '/' || cantidad_enviada::text
                              || '/' || (eliminado_el IS NULL)::text, ',')
              FROM cuenta_lineas WHERE cuenta_id = $1) AS lineas`,
      [cuentaId, itemId],
    );
    return fila;
  }

  async function baldesDe(cuentaId: string) {
    const filas: {
      monto_afecto: string;
      monto_exento: string;
      monto_impuestos: string;
    }[] = await ds.query(
      // Sin `eliminado_el`: la cuenta es de este spec y nada borra sus
      // anulaciones; una borrada también contaría como escrita.
      `SELECT monto_afecto::text, monto_exento::text, monto_impuestos::text
         FROM cuenta_linea_anulaciones WHERE cuenta_id = $1`,
      [cuentaId],
    );
    return filas;
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

    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenEncargado = await entrar(app, ENCARGADO.email, ENCARGADO.pass);

    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(motivos.status).toBe(200);
    const lista = motivos.body as { id: string; tipo: string }[];
    motivoCortesiaId = lista.find((m) => m.tipo === 'cortesia')!.id;
    motivoNoElaboradoId = lista.find((m) => m.tipo === 'no_elaborado')!.id;

    // Ruteo a cocina: sin impresora, reclamar la comanda no avanza
    // `cantidad_enviada` y no habría nada despachado que anular.
    const cocinaId = (
      await crear('impresoras', {
        nombre: `Cocina cortesía tope E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-cortesia-tope-e2e-${marca}`,
      })
    ).id;
    catCocinaId = (
      await crear('categorias', {
        nombre: `Cocina cortesía tope E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;

    // Garzón PROPIO: la sesión es única por garzón y las suites comparten seed.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón cortesía tope E2E ${marca}`,
    });
    await crear('sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón cortesía tope E2E ${marca}`,
    });
    mesaId = (
      await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa cortesía' })
    ).id;
  }, 60000);

  afterAll(async () => {
    try {
      // `no_elaborado` no tasa baldes: cancela sin pasar por el tope.
      for (const cuentaId of cuentasAbiertas) {
        await enviar(
          `cuentas/${cuentaId}/cancelar-con-motivo`,
          { motivoBajaId: motivoNoElaboradoId },
          tokenEncargado,
        );
      }
      await enviar('sesiones-garzon/cerrar', {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
    } finally {
      await app.close();
    }
  });

  describe('anular la línea como cortesía', () => {
    it('dos unidades al tope: 400 con la base, y nada escrito', async () => {
      const nombre = `Exento al tope E2E ${marca}`;
      const itemId = await crearProducto(nombre, AL_TOPE, 'exento');
      const { cuentaId, lineaId } = await cuentaDespachadaCon(itemId, '2');
      const antes = await escrito(cuentaId, itemId);

      expect(mensajes(await anular(cuentaId, lineaId, '2'))).toEqual([
        `La cortesía de «${nombre}» da $199.999.999.999.998, y el sistema no ` +
          `puede guardar montos de $${TECHO} o más: anulá menos unidades por vez`,
      ]);
      expect(await escrito(cuentaId, itemId)).toEqual(antes);

      // Control: la misma línea, de a una unidad, se anula.
      expect((await anular(cuentaId, lineaId, '1')).status).toBe(201);
      expect(await baldesDe(cuentaId)).toEqual([
        {
          monto_afecto: '0.0000',
          monto_exento: '99999999999999.0000',
          monto_impuestos: '0.0000',
        },
      ]);
    });

    it('afecto: la base neta que no cabe es 400, aunque el IVA sí quepa', async () => {
      const nombre = `Afecto al tope E2E ${marca}`;
      // 2 × 99.999.999.999.999 con IVA incluido: base 168.067.226.890.755.
      const itemId = await crearProducto(nombre, AL_TOPE, 'afecto');
      const { cuentaId, lineaId } = await cuentaDespachadaCon(itemId, '2');
      const antes = await escrito(cuentaId, itemId);

      expect(mensajes(await anular(cuentaId, lineaId, '2'))).toEqual([
        `La cortesía de «${nombre}» da $168.067.226.890.755, y el sistema no ` +
          `puede guardar montos de $${TECHO} o más: anulá menos unidades por vez`,
      ]);
      expect(await escrito(cuentaId, itemId)).toEqual(antes);
    });

    it('control: una carta que no cabe con base e IVA que sí caben se anula', async () => {
      // 2 × 55.000.000.000.000 = 110.000.000.000.000 con IVA incluido.
      const itemId = await crearProducto(
        `Afecto carta grande E2E ${marca}`,
        '55000000000000',
        'afecto',
      );
      const { cuentaId, lineaId } = await cuentaDespachadaCon(itemId, '2');

      expect((await anular(cuentaId, lineaId, '2')).status).toBe(201);
      cuentasAbiertas.splice(cuentasAbiertas.indexOf(cuentaId), 1);
      expect(await baldesDe(cuentaId)).toEqual([
        {
          monto_afecto: '92436974789916.0000',
          monto_exento: '0.0000',
          monto_impuestos: '17563025210084.0000',
        },
      ]);
    });
  });

  describe('cancelar la cuenta con motivo cortesía', () => {
    it('dos unidades despachadas al tope: 400, la cuenta sigue abierta y nada escrito', async () => {
      const nombre = `Exento cancelar tope E2E ${marca}`;
      const itemId = await crearProducto(nombre, AL_TOPE, 'exento');
      const { cuentaId } = await cuentaDespachadaCon(itemId, '2');
      const antes = await escrito(cuentaId, itemId);

      expect(mensajes(await cancelarConCortesia(cuentaId))).toEqual([
        `La cortesía de «${nombre}» da $199.999.999.999.998, y el sistema no ` +
          `puede guardar montos de $${TECHO} o más: anulá menos unidades por vez`,
      ]);
      expect(await escrito(cuentaId, itemId)).toEqual(antes);
      // Sin `eliminado_el`: lo que se mira es el estado de la fila, borrada o no.
      const [cuenta]: { estado: string }[] = await ds.query(
        `SELECT estado FROM cuentas WHERE cuenta_id = $1`,
        [cuentaId],
      );
      expect(cuenta.estado).toBe('abierta');
    });

    it('control: con una unidad despachada la cuenta se cancela como cortesía', async () => {
      const itemId = await crearProducto(
        `Exento cancelar uno E2E ${marca}`,
        AL_TOPE,
        'exento',
      );
      const { cuentaId } = await cuentaDespachadaCon(itemId, '1');

      expect((await cancelarConCortesia(cuentaId)).status).toBe(201);
      cuentasAbiertas.splice(cuentasAbiertas.indexOf(cuentaId), 1);
      expect(await baldesDe(cuentaId)).toEqual([
        {
          monto_afecto: '0.0000',
          monto_exento: '99999999999999.0000',
          monto_impuestos: '0.0000',
        },
      ]);
    });
  });
});
