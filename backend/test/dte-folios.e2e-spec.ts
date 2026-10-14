import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Db } from '../src/common/db/db.service';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import {
  cafDePrueba,
  certificadoDePrueba,
} from '../src/modules/dte/__fixtures__/credenciales-prueba';
import { DteError } from '../src/modules/dte/dte.types';
import {
  armarEnvioBoleta,
  emitirBoleta,
} from '../src/modules/dte/envio-boleta';
import { FoliosService } from '../src/modules/dte/folios.service';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * Folios del emisor: `tomarFolio` (el próximo folio sin repetir ni saltear) y
 * `credencialesParaFirmar` (lo que el motor necesita para emitir con ese folio).
 *
 * Las razones sociales emisoras son propias de este archivo ('Emisor e2e folios' en Paris y
 * 'Emisor e2e folios otro tenant' en el segundo tenant): el spec las crea, las marca preferidas
 * y limpia sus CAF y certificados, de modo que correr dos veces da lo mismo. La marca de
 * preferida no se puede sacar por la API, así que el `afterAll` la baja por SQL.
 *
 * Cada test parte de los CAF que él mismo carga (`reiniciarCafs`), nunca de lo que dejó el
 * anterior.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const OTRO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
const NOMBRE = 'Emisor e2e folios';
const RUT = '78.787.878-4';
const RUT_SII = '78787878-4';
const NOMBRE_OTRA = 'Emisor e2e folios otra';
const RUT_OTRA = '76.111.111-6';
const NOMBRE_AJENA = 'Emisor e2e folios otro tenant';
const RUT_AJENA = '79.797.979-1';
const RUT_AJENA_SII = '79797979-1';
const AHORA = new Date('2026-10-14T16:07:00Z');

interface TokenResponse {
  access_token: string;
}
interface RazonSocialResponse {
  id: string;
  nombre: string;
}
interface CafResponse {
  id: string;
  desde: number;
  hasta: number;
}
interface PerfilResponse {
  cafs: CafResponse[];
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Folios del emisor (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let db: Db;
  let folios: FoliosService;
  let token: string;
  let tokenOtroTenant: string;
  let razonSocialId: string;
  let otraRazonSocialId: string;
  let ajenaRazonSocialId: string;

  async function loginParis(): Promise<string> {
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

  /** Crea la razón social por nombre (o la reusa), la marca preferida y le deja el perfil completo. */
  async function emisora(
    tk: string,
    nombre: string,
    rut: string,
    perfil: boolean,
  ): Promise<string> {
    const lista = await request(app.getHttpServer())
      .get('/api/tenants/razones-sociales')
      .set('Authorization', `Bearer ${tk}`);
    expect(lista.status).toBe(200);
    let razon = (lista.body as RazonSocialResponse[]).find(
      (r) => r.nombre === nombre,
    );
    if (!razon) {
      const creada = await request(app.getHttpServer())
        .post('/api/tenants/razones-sociales')
        .set('Authorization', `Bearer ${tk}`)
        .send({
          nombre,
          rut,
          direccion: 'Av. Prueba 123',
          habilitado: true,
        });
      expect(creada.status).toBe(201);
      razon = creada.body as RazonSocialResponse;
    }
    const id = razon.id;
    if (perfil) {
      await marcarPreferida(tk, id);
      const datos = await request(app.getHttpServer())
        .patch('/api/dte/perfil')
        .set('Authorization', `Bearer ${tk}`)
        .send({
          giro: 'Panadería',
          comuna: 'Ñuñoa',
          ambienteSii: 'certificacion',
          fechaResolucion: '2026-09-30',
          numeroResolucion: 0,
        });
      expect(datos.status).toBe(200);
    }
    return id;
  }

  async function marcarPreferida(tk: string, id: string): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch(`/api/tenants/razones-sociales/${id}/preferida`)
      .set('Authorization', `Bearer ${tk}`);
    expect(res.status).toBe(200);
  }

  async function subirCertificado(tk: string): Promise<void> {
    const cert = certificadoDePrueba();
    const res = await request(app.getHttpServer())
      .post('/api/dte/certificado')
      .set('Authorization', `Bearer ${tk}`)
      .send({ pfxBase64: cert.pfx.toString('base64'), clave: cert.clave });
    expect(res.status).toBe(201);
  }

  /** Un CAF por la API, como lo manda la pantalla (el archivo del SII es latin1). */
  async function subirCaf(
    tk: string,
    rut: string,
    tipo: number,
    desde: number,
    hasta: number,
  ): Promise<CafResponse> {
    const xml = cafDePrueba({ rut, tipo, desde, hasta });
    const res = await request(app.getHttpServer())
      .post('/api/dte/cafs')
      .set('Authorization', `Bearer ${tk}`)
      .send({ xmlBase64: Buffer.from(xml, 'latin1').toString('base64') });
    expect(res.status).toBe(201);
    return res.body as CafResponse;
  }

  /**
   * Deja la emisora de Paris con los CAF 39 que el test pide. Los de mayor rango se suben primero
   * a propósito: sin un `ORDER BY desde`, el orden de las filas en la tabla elegiría el CAF
   * equivocado.
   */
  async function reiniciarCafs(
    rangos: [number, number][] = [
      [6013, 6040],
      [4007, 4031],
    ],
  ): Promise<CafResponse[]> {
    await limpiarCafs();
    const subidos: CafResponse[] = [];
    for (const [desde, hasta] of rangos)
      subidos.push(await subirCaf(token, RUT_SII, 39, desde, hasta));
    return subidos;
  }

  /** Lo que una corrida anterior (o este mismo spec) dejó cargado en las razones sociales propias. */
  async function limpiarCafs() {
    await ds.query(
      `UPDATE dte_cafs SET eliminado_el = now()
        WHERE razon_social_id IN (SELECT razon_social_id FROM razones_sociales WHERE nombre = ANY($1))
          AND eliminado_el IS NULL`,
      [[NOMBRE, NOMBRE_OTRA, NOMBRE_AJENA]],
    );
  }

  async function limpiarCertificados() {
    await ds.query(
      `UPDATE dte_certificados
          SET credencial_cifrada = NULL, reemplazado_el = COALESCE(reemplazado_el, now())
        WHERE razon_social_id IN (SELECT razon_social_id FROM razones_sociales WHERE nombre = ANY($1))
          AND (credencial_cifrada IS NOT NULL OR reemplazado_el IS NULL)`,
      [[NOMBRE, NOMBRE_OTRA, NOMBRE_AJENA]],
    );
  }

  /** El camino de verdad: el folio sale dentro de la transacción de quien lo pide. */
  const tomar = (tipo: 39 | 41 = 39, tenant = PARIS_TENANT_ID) =>
    db.transaccion(() => folios.tomarFolio(tenant, tipo));

  /**
   * Una transacción propia agota `cafAgotado` y NO cierra; se pide un folio, se espera a que la
   * base diga que el pedido está frenado por ella, se corre `mientrasEspera` y recién ahí se
   * cierra la transacción. Devuelve el folio que salió.
   *
   * La espera es por `pg_blocking_pids`, no por un rato fijo: en un CI lento el pedido puede
   * tardar más en llegar, y con una espera ciega el test pasaría sin haber esperado nada.
   */
  async function tomarMientrasSeAgota(
    cafAgotado: string,
    mientrasEspera?: () => Promise<unknown>,
  ): Promise<{ cafId: string; folio: number }> {
    const qr = ds.createQueryRunner();
    let pendiente: Promise<{ cafId: string; folio: number }> | undefined;
    let frenadas = 0;
    try {
      await qr.connect();
      await qr.startTransaction();
      await qr.query(
        `UPDATE dte_cafs SET siguiente_folio = hasta + 1 WHERE caf_id = $1`,
        [cafAgotado],
      );
      const [{ pid }]: { pid: number }[] = await qr.query(
        `SELECT pg_backend_pid() AS pid`,
      );

      pendiente = tomar();
      // Que no quede sin atender si el test cae antes de esperarla.
      pendiente.catch(() => undefined);

      const limite = Date.now() + 10_000;
      while (Date.now() < limite) {
        const [{ n }] = await ds.query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE $1 = ANY(pg_blocking_pids(pid))`,
          [pid],
        );
        frenadas = n;
        if (frenadas > 0) break;
        await dormir(25);
      }
      expect(frenadas).toBeGreaterThanOrEqual(1);

      if (mientrasEspera) await mientrasEspera();
      await qr.commitTransaction();
    } finally {
      // Sea cual sea el camino (aun si el commit tiró), la transacción no puede quedar abierta.
      try {
        if (qr.isTransactionActive) await qr.rollbackTransaction();
      } finally {
        await qr.release();
      }
      if (pendiente) await pendiente.catch(() => undefined);
    }
    return pendiente;
  }

  async function codigoDe(promesa: Promise<unknown>): Promise<string> {
    try {
      await promesa;
    } catch (e) {
      if (e instanceof DteError) return e.codigo;
      throw e;
    }
    throw new Error('no tiró');
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
    db = app.get(Db);
    folios = app.get(FoliosService);

    token = await loginParis();
    tokenOtroTenant = await loginSegundoTenant(app);

    // La otra y la ajena se crean antes que la propia: marcar preferida es lo último que se hace
    // en Paris, y deja a 'Emisor e2e folios' como la emisora.
    otraRazonSocialId = await emisora(token, NOMBRE_OTRA, RUT_OTRA, false);
    ajenaRazonSocialId = await emisora(
      tokenOtroTenant,
      NOMBRE_AJENA,
      RUT_AJENA,
      true,
    );
    razonSocialId = await emisora(token, NOMBRE, RUT, true);

    await limpiarCafs();
    await limpiarCertificados();
    await subirCertificado(token);
    await subirCertificado(tokenOtroTenant);
  }, 60000);

  afterAll(async () => {
    // Acumular y afirmar DESPUÉS de `app.close()`: un expect que tira antes de cerrar deja el
    // pool abierto y jest no termina nunca.
    const fallos: string[] = [];
    try {
      await limpiarCafs();
      await limpiarCertificados();
      // No hay una ruta que des-marque la preferida, y las otras suites no esperan una.
      await ds.query(
        `UPDATE razones_sociales SET preferida = false WHERE razon_social_id = ANY($1)`,
        [[razonSocialId, otraRazonSocialId, ajenaRazonSocialId]],
      );
      const vivas: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM dte_cafs
          WHERE razon_social_id = ANY($1) AND eliminado_el IS NULL`,
        [[razonSocialId, otraRazonSocialId, ajenaRazonSocialId]],
      );
      if (Number(vivas[0].n) !== 0) fallos.push('quedaron CAF vivos');
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('20 cajas a la vez toman 20 folios distintos, sin saltear: de 4007 a 4026', async () => {
    const [{ id: cafA }] = (await reiniciarCafs()).slice(-1);

    // Cada transacción retiene su folio un momento antes de cerrar: así las demás tienen que
    // esperarla de verdad en la base, y el test no depende de que el pool las vaya turnando.
    // Un cliente aparte (fuera del pool, que está tomado por las transacciones) mide cuántas
    // sesiones llegaron a estar frenadas por otra.
    const sonda = new Client({ connectionString: process.env.DATABASE_URL });
    await sonda.connect();
    let frenadasMax = 0;
    let midiendo = true;
    const medir = (async () => {
      while (midiendo) {
        const r = await sonda.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE cardinality(pg_blocking_pids(pid)) > 0`,
        );
        frenadasMax = Math.max(frenadasMax, (r.rows as { n: number }[])[0].n);
        await dormir(5);
      }
    })();

    let tomados: { cafId: string; folio: number }[];
    try {
      tomados = await Promise.all(
        Array.from({ length: 20 }, () =>
          db.transaccion(async () => {
            const t = await folios.tomarFolio(PARIS_TENANT_ID, 39);
            await dormir(30);
            return t;
          }),
        ),
      );
    } finally {
      midiendo = false;
      await medir;
      await sonda.end();
    }

    const numeros = tomados.map((t) => t.folio);
    expect(new Set(numeros).size).toBe(20);
    expect([...numeros].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => 4007 + i),
    );
    expect(tomados.every((t) => t.cafId === cafA)).toBe(true);
    // Hubo espera real entre ellas: sin ella, "20 distintos" podría ser solo el turno del pool.
    expect(frenadasMax).toBeGreaterThanOrEqual(1);

    const filas: { siguiente_folio: number }[] = await ds.query(
      `SELECT siguiente_folio FROM dte_cafs WHERE caf_id = $1`,
      [cafA],
    );
    expect(filas[0].siguiente_folio).toBe(4027);
  });

  it('si la venta se cae, el folio vuelve: el siguiente es el mismo, sin hueco', async () => {
    await reiniciarCafs();

    let dentro = 0;
    await expect(
      db.transaccion(async () => {
        dentro = (await folios.tomarFolio(PARIS_TENANT_ID, 39)).folio;
        throw new Error('venta caída');
      }),
    ).rejects.toThrow('venta caída');

    expect(dentro).toBe(4007);
    expect((await tomar()).folio).toBe(4007);
    expect((await tomar()).folio).toBe(4008);
  });

  it('con el CAF agotado pasa al siguiente: el próximo es el 6013', async () => {
    const [, cafA] = await reiniciarCafs();
    const [cafB] = await ds.query<{ caf_id: string }[]>(
      `SELECT caf_id FROM dte_cafs WHERE razon_social_id = $1 AND desde = 6013 AND eliminado_el IS NULL`,
      [razonSocialId],
    );

    for (let esperado = 4007; esperado <= 4031; esperado++) {
      const t = await tomar();
      expect(t).toEqual({ cafId: cafA.id, folio: esperado });
    }
    expect(await tomar()).toEqual({ cafId: cafB.caf_id, folio: 6013 });
    expect((await tomar()).folio).toBe(6014);
  });

  it('un CAF agotado mientras otra caja esperaba su bloqueo: sigue con el CAF siguiente', async () => {
    // A tiene un solo folio y B tiene más. Otra transacción agota A y NO cierra; la caja pide
    // folio y queda esperando el bloqueo de A. Cuando A se confirma agotado, el pedido ya no la
    // cumple y Postgres salta a la siguiente fila que veía (B): un solo intento alcanza.
    const [, cafA] = await reiniciarCafs([
      [6013, 6040],
      [4007, 4007],
    ]);

    const t = await tomarMientrasSeAgota(cafA.id);

    expect(t.folio).toBe(6013);
    expect(t.cafId).not.toBe(cafA.id);
  });

  it('un CAF cargado mientras la caja esperaba el bloqueo del agotado: lo ve en el segundo intento', async () => {
    // Acá no hay B cuando la caja pide folio: la sentencia arranca viendo solo a A. Mientras
    // espera su bloqueo se carga B (desde la pantalla de CAF) y A se confirma agotado. La
    // sentencia, con su foto vieja, sale vacía aunque ya haya folios: el segundo intento, con
    // una foto nueva, ve a B. Con un solo intento la caja diría "no quedan folios" teniéndolos.
    const [cafA] = await reiniciarCafs([[4007, 4007]]);

    const t = await tomarMientrasSeAgota(cafA.id, () =>
      subirCaf(token, RUT_SII, 39, 6013, 6040),
    );

    expect(t.folio).toBe(6013);
    expect(t.cafId).not.toBe(cafA.id);
  });

  it('sale el CAF de menor rango aunque el plan no lo entregue ordenado', async () => {
    // El índice único de `desde` entrega las filas ya ordenadas, y eso tapa un `ORDER BY` que
    // faltara. Con los índices apagados el plan lee la tabla en el orden en que se cargó, y el
    // CAF de mayor rango se subió primero.
    const [, cafA] = await reiniciarCafs();

    const t = await db.transaccion(async () => {
      await db.query(`SET LOCAL enable_indexscan = off`);
      await db.query(`SET LOCAL enable_indexonlyscan = off`);
      await db.query(`SET LOCAL enable_bitmapscan = off`);
      await db.query(`SET LOCAL enable_mergejoin = off`);
      return folios.tomarFolio(PARIS_TENANT_ID, 39);
    });

    expect(t).toEqual({ cafId: cafA.id, folio: 4007 });
  });

  it('sin folios cargados es SIN_FOLIOS, con un mensaje para el dueño del local', async () => {
    await limpiarCafs();

    const error = await tomar().catch((e) => e);
    expect(error).toBeInstanceOf(DteError);
    expect((error as DteError).codigo).toBe('SIN_FOLIOS');
    expect((error as DteError).message).toContain('No quedan folios');
  });

  it('los CAF de otro tipo no se mezclan: el 41 no sale de un CAF 39', async () => {
    await reiniciarCafs();

    expect(await codigoDe(tomar(41))).toBe('SIN_FOLIOS');
  });

  it('otro tenant: cada uno toma de sus CAF, y el CAF de uno no le sirve al otro', async () => {
    await reiniciarCafs();
    const cafAjeno = await subirCaf(tokenOtroTenant, RUT_AJENA_SII, 41, 1, 50);

    // El otro tenant toma de lo suyo...
    expect(await tomar(41, OTRO_TENANT_ID)).toEqual({
      cafId: cafAjeno.id,
      folio: 1,
    });
    // ...y Paris, sin CAF 41 propio, no puede tomar el de él.
    expect(await codigoDe(tomar(41, PARIS_TENANT_ID))).toBe('SIN_FOLIOS');
    // Ni usarlo para firmar.
    expect(
      await codigoDe(
        folios.credencialesParaFirmar(PARIS_TENANT_ID, cafAjeno.id, AHORA),
      ),
    ).toBe('SIN_FOLIOS');

    const perfil = await request(app.getHttpServer())
      .get('/api/dte/perfil')
      .set('Authorization', `Bearer ${token}`);
    expect(perfil.status).toBe(200);
    expect((perfil.body as PerfilResponse).cafs.map((c) => c.id)).not.toContain(
      cafAjeno.id,
    );
    // Y tomar los folios de Paris no movió los del otro.
    expect((await tomar(41, OTRO_TENANT_ID)).folio).toBe(2);
    expect((await tomar(39)).folio).toBe(4007);
  });

  it('otro ambiente: en producción no salen los CAF de certificación, y viceversa', async () => {
    await reiniciarCafs();
    const cambiar = async (ambienteSii: string) => {
      const res = await request(app.getHttpServer())
        .patch('/api/dte/perfil')
        .set('Authorization', `Bearer ${token}`)
        .send({ ambienteSii });
      expect(res.status).toBe(200);
    };

    await cambiar('produccion');
    try {
      expect(await codigoDe(tomar())).toBe('SIN_FOLIOS');

      const enProduccion = await subirCaf(token, RUT_SII, 39, 9001, 9010);
      expect(await tomar()).toEqual({ cafId: enProduccion.id, folio: 9001 });
    } finally {
      await cambiar('certificacion');
    }

    // De vuelta en certificación: los de certificación, intactos.
    expect((await tomar()).folio).toBe(4007);
  });

  it('solo toma de la razón social preferida: si es otra la preferida, no hay folios', async () => {
    await reiniciarCafs();

    await marcarPreferida(token, otraRazonSocialId);
    try {
      expect(await codigoDe(tomar())).toBe('SIN_FOLIOS');
    } finally {
      await marcarPreferida(token, razonSocialId);
    }
    expect((await tomar()).folio).toBe(4007);
  });

  it('no toma de una razón social deshabilitada ni borrada', async () => {
    await reiniciarCafs();
    try {
      await ds.query(
        `UPDATE razones_sociales SET habilitado = false WHERE razon_social_id = $1`,
        [razonSocialId],
      );
      expect(await codigoDe(tomar())).toBe('SIN_FOLIOS');
    } finally {
      await ds.query(
        `UPDATE razones_sociales SET habilitado = true WHERE razon_social_id = $1`,
        [razonSocialId],
      );
    }
    try {
      await ds.query(
        `UPDATE razones_sociales SET eliminado_el = now() WHERE razon_social_id = $1`,
        [razonSocialId],
      );
      expect(await codigoDe(tomar())).toBe('SIN_FOLIOS');
    } finally {
      await ds.query(
        `UPDATE razones_sociales SET eliminado_el = NULL WHERE razon_social_id = $1`,
        [razonSocialId],
      );
    }
    expect((await tomar()).folio).toBe(4007);
  });

  it('un CAF borrado no entrega folios', async () => {
    const [, cafA] = await reiniciarCafs();
    await ds.query(
      `UPDATE dte_cafs SET eliminado_el = now() WHERE caf_id = $1`,
      [cafA.id],
    );

    // Salta al otro CAF vivo (6013), nunca al borrado.
    expect((await tomar()).folio).toBe(6013);
  });

  it('sin transacción activa rechaza, y no gasta ningún folio', async () => {
    await reiniciarCafs();

    await expect(folios.tomarFolio(PARIS_TENANT_ID, 39)).rejects.toThrow(
      /dentro de db\.transaccion/,
    );
    const filas: { siguiente_folio: number }[] = await ds.query(
      `SELECT siguiente_folio FROM dte_cafs
        WHERE razon_social_id = $1 AND desde = 4007 AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    expect(filas[0].siguiente_folio).toBe(4007);
  });

  it('credencialesParaFirmar: con el folio tomado, el motor emite y arma el envío', async () => {
    await reiniciarCafs();
    const { cafId, folio } = await tomar();
    expect(folio).toBe(4007);

    const cred = await folios.credencialesParaFirmar(
      PARIS_TENANT_ID,
      cafId,
      AHORA,
    );
    expect(cred.caratula).toEqual({
      rutEmisor: RUT_SII,
      rutReceptor: '60803000-K',
      fchResol: '2026-09-30',
      nroResol: 0,
    });
    expect(cred.emisor).toEqual({
      rut: RUT_SII,
      razonSocial: NOMBRE,
      giro: 'Panadería',
      direccion: 'Av. Prueba 123',
      comuna: 'Ñuñoa',
    });

    const ahora = '2026-10-14T13:07:00';
    const boleta = emitirBoleta(
      {
        tipo: 39,
        folio,
        fechaEmision: '2026-10-14',
        emisor: cred.emisor,
        proveedorSoftware: { rut: '77777777-7', razonSocial: 'Venka SpA' },
        superaUmbralIdentificacion: false,
        lineas: [
          {
            nombre: 'Café',
            cantidad: '1',
            precioUnitario: '4990',
            monto: '4990',
            exenta: false,
          },
        ],
        ajustesGlobales: [],
        montos: {
          neto: '4193',
          exento: '0',
          iva: '797',
          total: '4990',
          adicionales: '0',
        },
      },
      { caf: cred.caf, certificado: cred.certificado },
      ahora,
    );
    expect(boleta.folio).toBe(4007);

    const envio = armarEnvioBoleta(
      [boleta],
      cred.caratula,
      cred.certificado,
      ahora,
    );
    expect(envio).toContain(`<RUTEmisor>${RUT_SII}</RUTEmisor>`);
    expect(envio).toContain('<FchResol>2026-09-30</FchResol>');
    expect(envio).toContain('<Folio>4007</Folio>');
  });

  it('credencialesParaFirmar: si el ambiente cambió después de tomar el folio, no firma con el CAF del otro', async () => {
    await reiniciarCafs();
    const cambiarAmbiente = (ambiente: string) =>
      ds.query(
        `UPDATE razones_sociales SET ambiente_sii = $2 WHERE razon_social_id = $1`,
        [razonSocialId, ambiente],
      );

    try {
      const codigo = await codigoDe(
        db.transaccion(async () => {
          const { cafId } = await folios.tomarFolio(PARIS_TENANT_ID, 39);
          // Otra conexión (el pool, fuera de esta transacción) confirma el cambio de ambiente.
          await cambiarAmbiente('produccion');
          return folios.credencialesParaFirmar(PARIS_TENANT_ID, cafId, AHORA);
        }),
      );
      expect(codigo).toBe('AMBIENTE_DISTINTO');
    } finally {
      await cambiarAmbiente('certificacion');
    }
    // La transacción se deshizo: el folio volvió.
    expect((await tomar()).folio).toBe(4007);
  });

  it('credencialesParaFirmar dice qué falta: perfil incompleto, sin certificado', async () => {
    const [, cafA] = await reiniciarCafs();

    try {
      await ds.query(
        `UPDATE razones_sociales SET giro = NULL WHERE razon_social_id = $1`,
        [razonSocialId],
      );
      const error = await folios
        .credencialesParaFirmar(PARIS_TENANT_ID, cafA.id, AHORA)
        .catch((e) => e);
      expect((error as DteError).codigo).toBe('PERFIL_INCOMPLETO');
      expect((error as DteError).message).toContain('el giro');
    } finally {
      await ds.query(
        `UPDATE razones_sociales SET giro = 'Panadería' WHERE razon_social_id = $1`,
        [razonSocialId],
      );
    }

    try {
      await limpiarCertificados();
      expect(
        await codigoDe(
          folios.credencialesParaFirmar(PARIS_TENANT_ID, cafA.id, AHORA),
        ),
      ).toBe('SIN_CERTIFICADO');
    } finally {
      await subirCertificado(token);
    }
    await expect(
      folios.credencialesParaFirmar(PARIS_TENANT_ID, cafA.id, AHORA),
    ).resolves.toBeDefined();
  });
});
