import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Db } from '../src/common/db/db.service';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import {
  cafDePrueba,
  certificadoDePrueba,
} from '../src/modules/dte/__fixtures__/credenciales-prueba';
import {
  partesMultipart,
  SiiFalso,
} from '../src/modules/dte/__fixtures__/sii-falso';
import { ColaDteService } from '../src/modules/dte/cola-dte.service';
import { DteError } from '../src/modules/dte/dte.types';
import { emitirBoleta } from '../src/modules/dte/envio-boleta';
import { FoliosService } from '../src/modules/dte/folios.service';
import { ConsultarEnviosJob } from '../src/modules/dte/jobs/consultar-envios.job';
import { EnviarBoletasJob } from '../src/modules/dte/jobs/enviar-boletas.job';
import { SiiBoletaCliente } from '../src/modules/dte/sii-boleta.cliente';

/**
 * Cola de envío al SII: `encolar` guarda la boleta firmada como `pendiente`, dentro de la
 * transacción de la venta, y `EnviarBoletasJob.enviarLotes` las manda al SII.
 *
 * El cliente del SII le pega a un SII falso (`SiiFalso`): las cuatro URLs de configuración se
 * apuntan a él por `process.env` antes de crear la app (el cliente las lee con `ConfigService`
 * en cada pedido). Los jobs automáticos están apagados en los e2e (`DTE_COLA_AUTOMATICA=false`,
 * en `setup-env.ts`): cada test llama a `enviarLotes` a mano.
 *
 * La razón social emisora es propia de este archivo ('Emisor e2e cola'): el spec la crea, la marca
 * preferida y limpia sus CAF, certificados y documentos, de modo que correr dos veces da lo mismo.
 * La marca de preferida no se puede sacar por la API, así que el `afterAll` la baja por SQL.
 * Cada test parte de los CAF que él mismo carga (`reiniciar`), nunca de lo que dejó el anterior.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
const NOMBRE = 'Emisor e2e cola';
const RUT = '76.555.444-6';
const RUT_SII = '76555444-6';
const AHORA = new Date('2026-10-14T16:07:00Z');
const AHORA_CHILE = '2026-10-14T13:07:00';

interface TokenResponse {
  access_token: string;
}
interface RazonSocialResponse {
  id: string;
  nombre: string;
}
interface CafResponse {
  id: string;
}
interface FilaDocumento {
  documento_id: string;
  tenant_id: string;
  caf_id: string;
  razon_social_id: string;
  tipo: number;
  folio: number;
  ambiente: string;
  rut_emisor: string;
  xml: string;
  estado: string;
  envio_id: string | null;
  intentos: number;
  ultimo_error: string | null;
  emitido_el: Date;
  proximo_intento_el: Date;
  detalle_sii: unknown;
}
interface FilaEnvio {
  envio_id: string;
  trackid: string | null;
  estado_sii: string | null;
  enviado_el: Date | null;
  consultar_desde: Date | null;
  reservado_hasta: Date | null;
  ultimo_error: string | null;
  eliminado_el: Date | null;
}

const URLS_SII = [
  'SII_BOLETA_API_CERTIFICACION',
  'SII_BOLETA_ENVIO_CERTIFICACION',
  'SII_BOLETA_API_PRODUCCION',
  'SII_BOLETA_ENVIO_PRODUCCION',
] as const;

describe('Cola de envío al SII (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let db: Db;
  let folios: FoliosService;
  let cola: ColaDteService;
  let token: string;
  let razonSocialId: string;
  let desde: Date;
  let falso: SiiFalso;
  let job: EnviarBoletasJob;
  let consulta: ConsultarEnviosJob;
  let cliente: SiiBoletaCliente;
  const urlsAntes: Record<string, string | undefined> = {};

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
  async function emisora(tk: string): Promise<string> {
    const lista = await request(app.getHttpServer())
      .get('/api/tenants/razones-sociales')
      .set('Authorization', `Bearer ${tk}`);
    expect(lista.status).toBe(200);
    let razon = (lista.body as RazonSocialResponse[]).find(
      (r) => r.nombre === NOMBRE,
    );
    if (!razon) {
      const creada = await request(app.getHttpServer())
        .post('/api/tenants/razones-sociales')
        .set('Authorization', `Bearer ${tk}`)
        .send({
          nombre: NOMBRE,
          rut: RUT,
          direccion: 'Av. Prueba 123',
          habilitado: true,
        });
      expect(creada.status).toBe(201);
      razon = creada.body as RazonSocialResponse;
    }
    const preferida = await request(app.getHttpServer())
      .patch(`/api/tenants/razones-sociales/${razon.id}/preferida`)
      .set('Authorization', `Bearer ${tk}`);
    expect(preferida.status).toBe(200);
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
    return razon.id;
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

  /** Lo que una corrida anterior (o este mismo spec) dejó en la razón social propia. */
  async function limpiar() {
    await ds.query(
      `UPDATE dte_envios SET eliminado_el = now()
        WHERE razon_social_id IN (SELECT razon_social_id FROM razones_sociales WHERE nombre = $1)
          AND eliminado_el IS NULL`,
      [NOMBRE],
    );
    await ds.query(
      `UPDATE dte_documentos SET eliminado_el = now()
        WHERE razon_social_id IN (SELECT razon_social_id FROM razones_sociales WHERE nombre = $1)
          AND eliminado_el IS NULL`,
      [NOMBRE],
    );
    await ds.query(
      `UPDATE dte_cafs SET eliminado_el = now()
        WHERE razon_social_id IN (SELECT razon_social_id FROM razones_sociales WHERE nombre = $1)
          AND eliminado_el IS NULL`,
      [NOMBRE],
    );
  }

  async function limpiarCertificados() {
    await ds.query(
      `UPDATE dte_certificados
          SET credencial_cifrada = NULL, reemplazado_el = COALESCE(reemplazado_el, now())
        WHERE razon_social_id IN (SELECT razon_social_id FROM razones_sociales WHERE nombre = $1)
          AND (credencial_cifrada IS NOT NULL OR reemplazado_el IS NULL)`,
      [NOMBRE],
    );
  }

  /** Deja un único CAF 39 (4007 a 4031) y sin documentos: cada test parte de cero. */
  async function reiniciar(hasta = 4031): Promise<CafResponse> {
    await limpiar();
    // `limpiar` da de baja los envíos del test anterior; `envios()` mira solo los de este.
    const [{ ahora }] = await ds.query<{ ahora: Date }[]>(
      `SELECT clock_timestamp() AS ahora`,
    );
    desde = ahora;
    return subirCaf(token, RUT_SII, 39, 4007, hasta);
  }

  /** Dentro de la transacción de la venta: toma el folio y firma la boleta con él. */
  async function firmarBoleta() {
    const { cafId, folio } = await folios.tomarFolio(PARIS_TENANT_ID, 39);
    const cred = await folios.credencialesParaFirmar(
      PARIS_TENANT_ID,
      cafId,
      AHORA,
    );
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
      AHORA_CHILE,
    );
    return { boleta, cafId, folio };
  }

  /** El camino de la venta: folio, boleta firmada y cola, todo en la misma transacción. */
  const venderYEncolar = (alFinal?: () => void) =>
    db.transaccion(async () => {
      const { boleta, cafId, folio } = await firmarBoleta();
      const { documentoId } = await cola.encolar(
        PARIS_TENANT_ID,
        boleta,
        cafId,
      );
      alFinal?.();
      return { documentoId, boleta, cafId, folio };
    });

  /** Una boleta ya firmada, con su transacción cerrada y sin fila: el folio volvió y sigue libre. */
  async function boletaSinEncolar() {
    const caf = await reiniciar();
    const { boleta } = await db
      .transaccion(async () => {
        const firmada = await firmarBoleta();
        throw Object.assign(new Error('descartar'), { firmada });
      })
      .catch(
        (e: { firmada: Awaited<ReturnType<typeof firmarBoleta>> }) => e.firmada,
      );
    return { boleta, caf };
  }

  const documentos = () =>
    ds.query<FilaDocumento[]>(
      `SELECT * FROM dte_documentos WHERE razon_social_id = $1 AND eliminado_el IS NULL ORDER BY folio`,
      [razonSocialId],
    );

  /** `n` ventas seguidas, cada una con su transacción: n boletas pendientes. */
  async function vender(n: number) {
    for (let i = 0; i < n; i++) await venderYEncolar();
  }

  // Las boletas esperan 5 minutos a juntar un lote. Para no esperarlos se corre `emitido_el`
  // 6 minutos atrás por SQL: es el reloj de la base, y no hay otra forma de moverlo.
  const envejecer = () =>
    ds.query(
      `UPDATE dte_documentos SET emitido_el = now() - interval '6 minutes'
        WHERE razon_social_id = $1 AND estado = 'pendiente' AND eliminado_el IS NULL`,
      [razonSocialId],
    );

  // Una boleta devuelta a la cola espera su turno (`proximo_intento_el`); para el reintento
  // inmediato se adelanta el reloj de esa espera.
  const sinEspera = () =>
    ds.query(
      `UPDATE dte_documentos SET proximo_intento_el = now()
        WHERE razon_social_id = $1 AND estado = 'pendiente' AND eliminado_el IS NULL`,
      [razonSocialId],
    );

  /** Los envíos de este test, también los dados de baja: esos son parte de lo que se mide. */
  const envios = () =>
    ds.query<FilaEnvio[]>(
      `SELECT * FROM dte_envios WHERE razon_social_id = $1 AND creado_el >= $2 ORDER BY creado_el`,
      [razonSocialId, desde],
    );

  /** Los sobres que el SII falso recibió, como texto (latin1: 1 byte = 1 carácter). */
  const sobres = () =>
    falso
      .pedidosDe('envio')
      .map((p) => partesMultipart(p).archivo.contenido.toString('latin1'));
  const foliosDe = (sobre: string) =>
    [...sobre.matchAll(/<Folio>(\d+)<\/Folio>/g)].map((m) => Number(m[1]));
  const foliosEnviados = () => sobres().flatMap(foliosDe);

  const ejecucionesDelJob = async (nombre = 'enviar-boletas') => {
    const [{ n }] = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM cron_ejecuciones WHERE job = $1`,
      [nombre],
    );
    return n;
  };

  /** Corre `fn` con los jobs automáticos encendidos o apagados, y deja el valor como estaba. */
  const conAutomatica = async (valor: string, fn: () => Promise<void>) => {
    const antes = process.env.DTE_COLA_AUTOMATICA;
    process.env.DTE_COLA_AUTOMATICA = valor;
    try {
      await fn();
    } finally {
      if (antes === undefined) delete process.env.DTE_COLA_AUTOMATICA;
      else process.env.DTE_COLA_AUTOMATICA = antes;
    }
  };

  /** La pausa por límite del SII es del cliente, que es uno solo en la app: se limpia entre tests. */
  const levantarPausa = () => Object.assign(cliente, { pausa: 0 });

  beforeAll(async () => {
    falso = await SiiFalso.iniciar();
    for (const nombre of URLS_SII) {
      urlsAntes[nombre] = process.env[nombre];
      process.env[nombre] = `${falso.url}/${nombre.toLowerCase()}`;
    }
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
    cola = app.get(ColaDteService);
    job = app.get(EnviarBoletasJob);
    consulta = app.get(ConsultarEnviosJob);
    cliente = app.get(SiiBoletaCliente);

    token = await loginParis();
    razonSocialId = await emisora(token);

    await limpiar();
    await limpiarCertificados();
    await subirCertificado(token);
  }, 60000);

  beforeEach(() => {
    falso.reiniciar();
    levantarPausa();
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    // Acumular y afirmar DESPUÉS de `app.close()`: un expect que tira antes de cerrar deja el
    // pool abierto y jest no termina nunca.
    const fallos: string[] = [];
    try {
      await limpiar();
      await limpiarCertificados();
      // No hay una ruta que des-marque la preferida, y las otras suites no esperan una.
      await ds.query(
        `UPDATE razones_sociales SET preferida = false WHERE razon_social_id = $1`,
        [razonSocialId],
      );
      const vivos: { n: string }[] = await ds.query(
        `SELECT (SELECT count(*) FROM dte_cafs WHERE razon_social_id = $1 AND eliminado_el IS NULL)
              + (SELECT count(*) FROM dte_envios WHERE razon_social_id = $1 AND eliminado_el IS NULL)
              + (SELECT count(*) FROM dte_documentos WHERE razon_social_id = $1 AND eliminado_el IS NULL) AS n`,
        [razonSocialId],
      );
      if (Number(vivos[0].n) !== 0)
        fallos.push('quedaron CAF, envíos o documentos');
    } finally {
      await app.close();
      await falso.cerrar();
      for (const nombre of URLS_SII) {
        if (urlsAntes[nombre] === undefined) delete process.env[nombre];
        else process.env[nombre] = urlsAntes[nombre];
      }
    }
    expect(fallos).toEqual([]);
  });

  it('la venta confirma: queda una fila pendiente con la boleta tal como se firmó', async () => {
    const caf = await reiniciar();

    const { documentoId, boleta } = await venderYEncolar();

    const filas = await documentos();
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila.documento_id).toBe(documentoId);
    expect(fila).toMatchObject({
      tenant_id: PARIS_TENANT_ID,
      razon_social_id: razonSocialId,
      caf_id: caf.id,
      tipo: 39,
      folio: 4007,
      ambiente: 'certificacion',
      rut_emisor: RUT_SII,
      estado: 'pendiente',
      envio_id: null,
      intentos: 0,
      ultimo_error: null,
    });
    // El documento legal: el <DTE> firmado, sin tocar (incluida la Ñ del emisor).
    expect(fila.xml).toBe(boleta.xml);
    // Lista para enviarse ya, no dentro de un rato.
    expect(fila.proximo_intento_el.getTime()).toBeLessThanOrEqual(Date.now());
    expect(fila.emitido_el.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('la venta se cae después de encolar: no queda la fila, y el folio vuelve', async () => {
    await reiniciar();

    await expect(
      venderYEncolar(() => {
        throw new Error('venta caída');
      }),
    ).rejects.toThrow('venta caída');

    expect(await documentos()).toEqual([]);
    // El rollback devolvió el folio: el siguiente es el mismo.
    const { folio } = await venderYEncolar();
    expect(folio).toBe(4007);
    expect(await documentos()).toHaveLength(1);
  });

  it('el mismo folio dos veces: error de unicidad, sin fila duplicada', async () => {
    await reiniciar();
    const { boleta, cafId } = await venderYEncolar();

    const error = await db
      .transaccion(() => cola.encolar(PARIS_TENANT_ID, boleta, cafId))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DteError);
    expect(JSON.stringify(error)).toContain('uq_dte_documentos_folio');
    expect(await documentos()).toHaveLength(1);
  });

  it('un CAF de otro tenant no sirve: SIN_FOLIOS, y no queda fila', async () => {
    const { boleta, caf } = await boletaSinEncolar();

    const otroTenant = '550e8400-e29b-41d4-a716-446655440040';
    const error = await db
      .transaccion(() => cola.encolar(otroTenant, boleta, caf.id))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DteError);
    expect((error as DteError).codigo).toBe('SIN_FOLIOS');
    expect(await documentos()).toEqual([]);
  });

  it('un CAF dado de baja no sirve: SIN_FOLIOS, y no queda fila', async () => {
    const { boleta, caf } = await boletaSinEncolar();
    await ds.query(
      `UPDATE dte_cafs SET eliminado_el = now() WHERE caf_id = $1`,
      [caf.id],
    );

    const error = await db
      .transaccion(() => cola.encolar(PARIS_TENANT_ID, boleta, caf.id))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DteError);
    expect((error as DteError).codigo).toBe('SIN_FOLIOS');
    expect(await documentos()).toEqual([]);
  });

  it('una boleta de otro RUT que el del CAF: ENVIO_OTRO_EMISOR, y no queda fila', async () => {
    const { boleta, caf } = await boletaSinEncolar();

    const error = await db
      .transaccion(() =>
        cola.encolar(
          PARIS_TENANT_ID,
          { ...boleta, rutEmisor: '78787878-4' },
          caf.id,
        ),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DteError);
    expect((error as DteError).codigo).toBe('ENVIO_OTRO_EMISOR');
    expect(await documentos()).toEqual([]);
  });

  it('fuera de una transacción tira, y no deja fila', async () => {
    const { boleta, caf } = await boletaSinEncolar();

    await expect(cola.encolar(PARIS_TENANT_ID, boleta, caf.id)).rejects.toThrow(
      /dentro de db\.transaccion/,
    );
    expect(await documentos()).toEqual([]);
  });

  describe('envío al SII (EnviarBoletasJob)', () => {
    it('la regla del lote: seis boletas recién emitidas esperan; a los 5 minutos salen en un sobre', async () => {
      await reiniciar();
      await vender(6);

      const antes = await job.enviarLotes();

      expect(antes).toContain('0 sobres enviados');
      // Ni siquiera se le pidió un token al SII.
      expect(falso.pedidos).toEqual([]);
      expect((await documentos()).map((d) => d.estado)).toEqual(
        Array(6).fill('pendiente'),
      );

      await envejecer();
      const despues = await job.enviarLotes();

      expect(despues).toContain('1 sobres enviados');
      expect(sobres()).toHaveLength(1);
      expect(foliosEnviados()).toEqual([4007, 4008, 4009, 4010, 4011, 4012]);
      expect((await documentos()).map((d) => d.estado)).toEqual(
        Array(6).fill('enviado'),
      );
    });

    it('con 50 boletas recién emitidas sale sin esperar; la 51 queda para el próximo lote', async () => {
      await reiniciar(4100);
      await vender(51);

      await job.enviarLotes();

      expect(sobres()).toHaveLength(1);
      expect(foliosEnviados()).toHaveLength(50);
      const estados = (await documentos()).map((d) => d.estado);
      expect(estados.filter((e) => e === 'enviado')).toHaveLength(50);
      expect(estados.filter((e) => e === 'pendiente')).toHaveLength(1);
    });

    it('ok: el envío queda con el trackid, la consulta a +10 min y las boletas enviadas', async () => {
      await reiniciar();
      const { documentoId } = await venderYEncolar();
      await venderYEncolar();
      await envejecer();

      await job.enviarLotes();

      const [envio] = await envios();
      expect(envio).toMatchObject({
        trackid: '1014',
        estado_sii: 'REC',
        reservado_hasta: null,
        ultimo_error: null,
        eliminado_el: null,
      });
      const [{ diferencia, lejos }] = await ds.query<
        { diferencia: number; lejos: number }[]
      >(
        `SELECT extract(epoch FROM consultar_desde - enviado_el)::int AS diferencia,
                abs(extract(epoch FROM now() - enviado_el))::int AS lejos
           FROM dte_envios WHERE envio_id = $1`,
        [envio.envio_id],
      );
      expect(diferencia).toBe(10 * 60);
      expect(lejos).toBeLessThan(60);
      const filas = await documentos();
      expect(filas.map((d) => [d.estado, d.envio_id, d.intentos])).toEqual([
        ['enviado', envio.envio_id, 0],
        ['enviado', envio.envio_id, 0],
      ]);
      expect(filas[0].documento_id).toBe(documentoId);
    });

    it('lo que llega al SII es el sobre con las boletas y lo manda con el RUT de la empresa', async () => {
      await reiniciar();
      await vender(2);
      await envejecer();

      await job.enviarLotes();

      const [pedido] = falso.pedidosDe('envio');
      const partes = partesMultipart(pedido);
      expect(partes.rutCompany.contenido.toString()).toBe('76555444');
      expect(partes.dvCompany.contenido.toString()).toBe('6');
      const sobre = partes.archivo.contenido.toString('latin1');
      expect(sobre).toContain('<EnvioBOLETA');
      expect(sobre.match(/<DTE /g)).toHaveLength(2);
      expect(sobre).toContain('<RutEmisor>76555444-6</RutEmisor>');
    });

    it('transitorio (500): las boletas vuelven a pendiente con intentos 1 y +30 s, y el envío se da de baja', async () => {
      await reiniciar();
      await vender(3);
      await envejecer();
      falso.responder('envio', { status: 500 });

      const mensaje = await job.enviarLotes();

      expect(mensaje).toContain('3 boletas devueltas');
      const filas = await documentos();
      expect(filas).toHaveLength(3);
      for (const f of filas) {
        expect(f).toMatchObject({
          estado: 'pendiente',
          envio_id: null,
          intentos: 1,
        });
        expect(f.ultimo_error).toContain('500');
      }
      const [{ espera }] = await ds.query<{ espera: number }[]>(
        `SELECT DISTINCT round(extract(epoch FROM proximo_intento_el - actualizado_el))::int AS espera
           FROM dte_documentos WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
        [razonSocialId],
      );
      expect(espera).toBe(30);
      const todos = await envios();
      expect(todos).toHaveLength(1);
      expect(todos[0].trackid).toBeNull();
      expect(todos[0].reservado_hasta).toBeNull();
      expect(todos[0].ultimo_error).toContain('500');
      expect(todos[0].eliminado_el).not.toBeNull();

      // Respeta la espera: un segundo intento inmediato no le pega al SII.
      await job.enviarLotes();
      expect(sobres()).toHaveLength(1);

      // Pasada la espera, sale (y el SII ya contesta bien).
      await sinEspera();
      await job.enviarLotes();
      expect(sobres()).toHaveLength(2);
      expect((await documentos()).map((d) => d.estado)).toEqual([
        'enviado',
        'enviado',
        'enviado',
      ]);
    });

    it('la espera es por boleta: con 0, 3 y 4 intentos previos esperan 30 s, 5 min y 10 min', async () => {
      await reiniciar();
      await vender(3);
      await envejecer();
      await ds.query(
        `UPDATE dte_documentos SET intentos = CASE folio WHEN 4007 THEN 0 WHEN 4008 THEN 3 ELSE 4 END
          WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
        [razonSocialId],
      );
      falso.responder('envio', { status: 503 });

      await job.enviarLotes();

      const filas = await ds.query<
        { folio: number; intentos: number; espera: number }[]
      >(
        `SELECT folio, intentos, round(extract(epoch FROM proximo_intento_el - actualizado_el))::int AS espera
           FROM dte_documentos WHERE razon_social_id = $1 AND eliminado_el IS NULL ORDER BY folio`,
        [razonSocialId],
      );
      expect(filas).toEqual([
        { folio: 4007, intentos: 1, espera: 30 },
        { folio: 4008, intentos: 4, espera: 300 },
        { folio: 4009, intentos: 5, espera: 600 },
      ]);
    });

    it('400: las boletas quedan rechazadas con el origen "envio" y no se reintentan', async () => {
      await reiniciar();
      await vender(2);
      await envejecer();
      falso.responder('envio', { status: 400, cuerpo: 'Sobre mal formado' });

      const mensaje = await job.enviarLotes();

      expect(mensaje).toContain('2 rechazadas');
      const filas = await documentos();
      for (const f of filas) {
        expect(f.estado).toBe('rechazado');
        expect(f.detalle_sii).toEqual({
          origen: 'envio',
          mensaje: 'Sobre mal formado',
        });
      }
      // El sobre sí lo vio el SII: queda vivo, con el error, sin reserva.
      const [envio] = await envios();
      expect(envio).toMatchObject({
        trackid: null,
        reservado_hasta: null,
        ultimo_error: 'Sobre mal formado',
        eliminado_el: null,
      });

      await sinEspera();
      await job.enviarLotes();
      expect(sobres()).toHaveLength(1);
    });

    it('401 del SII: es un reintento con espera, nunca un rechazo', async () => {
      await reiniciar();
      await vender(2);
      await envejecer();
      // 401 en el envío, y de nuevo en el reintento con un token nuevo.
      falso.responder('envio', { status: 401 }, { status: 401 });

      await job.enviarLotes();

      const filas = await documentos();
      expect(filas.map((d) => [d.estado, d.intentos])).toEqual([
        ['pendiente', 1],
        ['pendiente', 1],
      ]);
    });

    it('certificado anulado entre la venta y el envío: las boletas no se rechazan, quedan pendientes con el motivo', async () => {
      await reiniciar();
      await vender(2);
      await envejecer();
      await limpiarCertificados();
      try {
        const mensaje = await job.enviarLotes();

        expect(mensaje).toContain('2 boletas devueltas');
        expect(falso.pedidos).toEqual([]);
        const filas = await documentos();
        for (const f of filas) {
          expect(f).toMatchObject({
            estado: 'pendiente',
            envio_id: null,
            intentos: 1,
          });
          expect(f.ultimo_error).toContain('certificado digital');
        }
        expect(filas[0].detalle_sii).toBeNull();
      } finally {
        await subirCertificado(token);
      }

      // Con el certificado vigente otra vez, el siguiente lote sale solo.
      await sinEspera();
      await job.enviarLotes();
      expect(foliosEnviados()).toEqual([4007, 4008]);
    });

    it('certificado vencido a la hora del envío: vuelve a pendiente con el motivo', async () => {
      await reiniciar();
      await vender(1);
      await envejecer();

      // El certificado de prueba vence en 2036: con el reloj en 2040, para el job ya venció.
      await job.enviarLotes(new Date('2040-01-01T12:00:00Z'));

      const [fila] = await documentos();
      expect(fila.estado).toBe('pendiente');
      expect(fila.ultimo_error).toContain('vencido');
      expect(falso.pedidos).toEqual([]);
    });

    it('reserva vencida: un proceso caído con el sobre en vuelo no pierde las boletas', async () => {
      await reiniciar();
      await vender(3);
      await envejecer();
      // El proceso "se cae" justo al llamar al SII: el job propaga el error y no anota nada.
      jest
        .spyOn(cliente, 'enviar')
        .mockRejectedValueOnce(new Error('proceso caído'));
      await expect(job.enviarLotes()).rejects.toThrow('proceso caído');

      const [reservado] = await envios();
      expect(reservado.trackid).toBeNull();
      expect(reservado.reservado_hasta).not.toBeNull();
      const enVuelo = await documentos();
      expect(enVuelo.map((d) => d.estado)).toEqual([
        'enviado',
        'enviado',
        'enviado',
      ]);
      expect(enVuelo.every((d) => d.envio_id === reservado.envio_id)).toBe(
        true,
      );

      // Mientras la reserva vale, nadie más toca esas boletas.
      await job.enviarLotes();
      expect(falso.pedidosDe('envio')).toHaveLength(0);

      // Pasan los 5 minutos de la reserva (se corre su reloj, el de la base).
      await ds.query(
        `UPDATE dte_envios SET reservado_hasta = now() - interval '1 minute' WHERE envio_id = $1`,
        [reservado.envio_id],
      );
      const mensaje = await job.enviarLotes();

      expect(mensaje).toContain('3 de reservas vencidas');
      expect(foliosEnviados()).toEqual([4007, 4008, 4009]);
      const todos = await envios();
      expect(todos).toHaveLength(2);
      expect(todos[0].eliminado_el).not.toBeNull();
      expect(todos[1]).toMatchObject({ trackid: '1014', eliminado_el: null });
      expect((await documentos()).map((d) => d.envio_id)).toEqual([
        todos[1].envio_id,
        todos[1].envio_id,
        todos[1].envio_id,
      ]);
    });

    it('un sobre lento que vuelve tarde no pisa las boletas que otro lote ya reservó y mandó', async () => {
      await reiniciar();
      await vender(2);
      await envejecer();
      // El lote A llama al SII y tarda: mientras tanto su reserva vence, y el lote B toma las
      // mismas boletas y las manda bien. Cuando A por fin recibe su error, ya no son suyas.
      jest.spyOn(cliente, 'enviar').mockImplementationOnce(async () => {
        await ds.query(
          `UPDATE dte_envios SET reservado_hasta = now() - interval '1 minute'
            WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
          [razonSocialId],
        );
        await job.enviarLotes();
        return { tipo: 'transitorio', mensaje: 'respondió tarde' };
      });

      await job.enviarLotes();

      const todos = await envios();
      const vivo = todos.find((e) => e.eliminado_el === null);
      expect(vivo?.trackid).toBe('1014');
      const filas = await documentos();
      expect(filas.map((d) => [d.estado, d.envio_id, d.intentos])).toEqual([
        ['enviado', vivo?.envio_id, 0],
        ['enviado', vivo?.envio_id, 0],
      ]);
      expect(sobres()).toHaveLength(1);
    });

    it('un sobre lento que el SII sí recibió, pero cuya reserva ya venció: no se escribe sobre el envío dado de baja', async () => {
      await reiniciar();
      await vender(2);
      await envejecer();
      jest.spyOn(cliente, 'enviar').mockImplementationOnce(async () => {
        await ds.query(
          `UPDATE dte_envios SET reservado_hasta = now() - interval '1 minute'
            WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
          [razonSocialId],
        );
        await job.enviarLotes();
        return {
          tipo: 'ok',
          datos: { trackid: '999', estado: 'REC' },
          reintentarEnMs: null,
        };
      });

      await expect(job.enviarLotes()).resolves.toContain('sobres enviados');

      const [muerto, vivo] = await envios();
      // El envío lento ya estaba dado de baja: su trackid no se anota (las boletas ya vuelven
      // a salir en el otro sobre).
      expect(muerto.eliminado_el).not.toBeNull();
      expect(muerto.trackid).toBeNull();
      expect(vivo).toMatchObject({ trackid: '1014', eliminado_el: null });
      expect((await documentos()).map((d) => d.envio_id)).toEqual([
        vivo.envio_id,
        vivo.envio_id,
      ]);
    });

    it('405 del SII: las boletas vuelven y el siguiente lote ni siquiera le pega al SII', async () => {
      await reiniciar();
      await vender(2);
      await envejecer();
      falso.responder('envio', {
        status: 405,
        headers: { 'x-ratelimit-reset': '120' },
      });

      const primero = await job.enviarLotes();

      expect(primero).toContain('2 boletas devueltas');
      expect(cliente.pausadoHasta()).toBeGreaterThan(Date.now() + 100_000);
      // El envío que recibió el 405 cuenta como un intento.
      expect((await documentos()).map((d) => d.intentos)).toEqual([1, 1]);

      await sinEspera();
      const segundo = await job.enviarLotes();

      expect(segundo).toContain('espaciar');
      expect(falso.pedidosDe('envio')).toHaveLength(1);
      const filas = await documentos();
      expect(filas.map((d) => [d.estado, d.envio_id, d.intentos])).toEqual([
        ['pendiente', null, 1],
        ['pendiente', null, 1],
      ]);
      expect(await envios()).toHaveLength(1);
    });

    describe('dos instancias del backend', () => {
      it('una instancia que retiene dos boletas no frena a la otra: sale con las libres, y las retenidas salen después', async () => {
        await reiniciar();
        await vender(4);
        await envejecer();

        const qr = ds.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        let corrida: Promise<string> | undefined;
        try {
          // La otra instancia está reservando las dos más antiguas.
          const retenidas: unknown[] = await qr.query(
            `SELECT documento_id FROM dte_documentos
              WHERE razon_social_id = $1 AND folio IN (4007, 4008) AND eliminado_el IS NULL
                FOR UPDATE`,
            [razonSocialId],
          );
          expect(retenidas).toHaveLength(2);

          corrida = job.enviarLotes();
          // Tiene que terminar con la compuerta todavía tomada: no esperarla.
          let corte: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              corrida,
              new Promise<never>((_, no) => {
                corte = setTimeout(
                  () =>
                    no(
                      new Error(
                        'enviarLotes se quedó esperando las filas retenidas',
                      ),
                    ),
                  8000,
                );
              }),
            ]);
          } finally {
            clearTimeout(corte);
          }

          expect(foliosEnviados()).toEqual([4009, 4010]);
          expect(sobres()).toHaveLength(1);
        } finally {
          await qr.rollbackTransaction();
          await qr.release();
          await corrida?.catch(() => undefined);
        }

        await job.enviarLotes();

        expect(sobres()).toHaveLength(2);
        expect(foliosDe(sobres()[1])).toEqual([4007, 4008]);
        expect([...foliosEnviados()].sort()).toEqual([4007, 4008, 4009, 4010]);
        const vivos = (await envios()).filter((e) => e.eliminado_el === null);
        expect(vivos).toHaveLength(2);
        expect(vivos.every((e) => e.trackid === '1014')).toBe(true);
        const filas = await documentos();
        expect(filas.every((d) => d.estado === 'enviado')).toBe(true);
        expect(new Set(filas.map((d) => d.envio_id)).size).toBe(2);
      });

      it('dos lotes a la vez sobre las mismas 4 boletas: ninguna sale en dos sobres', async () => {
        await reiniciar();
        await vender(4);
        await envejecer();

        await Promise.all([job.enviarLotes(), job.enviarLotes()]);

        expect([...foliosEnviados()].sort()).toEqual([4007, 4008, 4009, 4010]);
        const filas = await documentos();
        expect(filas.every((d) => d.estado === 'enviado')).toBe(true);
        const vivos = (await envios()).filter((e) => e.eliminado_el === null);
        expect(vivos).toHaveLength(sobres().length);
      });
    });

    describe('el tick', () => {
      it('apagado (DTE_COLA_AUTOMATICA=false): con trabajo pendiente no manda ni escribe en cron_ejecuciones', async () => {
        await reiniciar();
        await vender(2);
        await envejecer();
        const antes = await ejecucionesDelJob();

        await conAutomatica('false', () => job.tick());

        expect(await ejecucionesDelJob()).toBe(antes);
        expect(falso.pedidos).toEqual([]);
        expect((await documentos()).map((d) => d.estado)).toEqual([
          'pendiente',
          'pendiente',
        ]);
      });

      it('encendido pero sin trabajo, o con boletas que aún esperan su lote: no escribe en cron_ejecuciones', async () => {
        await reiniciar();
        const antes = await ejecucionesDelJob();

        await conAutomatica('true', () => job.tick());
        expect(await ejecucionesDelJob()).toBe(antes);

        await vender(2);
        await conAutomatica('true', () => job.tick());
        expect(await ejecucionesDelJob()).toBe(antes);
        expect(falso.pedidos).toEqual([]);
      });

      it('encendido y con una reserva vencida (sin lote listo): registra la corrida y devuelve las boletas', async () => {
        await reiniciar();
        await vender(2);
        await envejecer();
        // Un proceso que se cae con el sobre en vuelo deja la reserva puesta...
        jest
          .spyOn(cliente, 'enviar')
          .mockRejectedValueOnce(new Error('proceso caído'));
        await expect(job.enviarLotes()).rejects.toThrow('proceso caído');
        // ...que vence con el reloj de la base. Las boletas se vuelven a "frescas" (recién
        // emitidas, menos de 50): lo único que le da trabajo al tick es la reserva vencida.
        await ds.query(
          `UPDATE dte_envios SET reservado_hasta = now() - interval '1 minute'
            WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
          [razonSocialId],
        );
        await ds.query(
          `UPDATE dte_documentos SET emitido_el = now()
            WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
          [razonSocialId],
        );
        const antes = await ejecucionesDelJob();

        await conAutomatica('true', () => job.tick());

        expect(await ejecucionesDelJob()).toBe(antes + 1);
        const filas = await documentos();
        expect(filas.map((d) => [d.estado, d.envio_id])).toEqual([
          ['pendiente', null],
          ['pendiente', null],
        ]);
        expect(falso.pedidosDe('envio')).toHaveLength(0);
      });

      it('encendido y con un lote listo: registra la corrida y manda el sobre', async () => {
        await reiniciar();
        await vender(2);
        await envejecer();
        const antes = await ejecucionesDelJob();

        await conAutomatica('true', () => job.tick());

        expect(await ejecucionesDelJob()).toBe(antes + 1);
        const [ultima] = await ds.query<{ estado: string; detalle: string }[]>(
          `SELECT estado, detalle FROM cron_ejecuciones
            WHERE job = 'enviar-boletas' ORDER BY iniciado_el DESC LIMIT 1`,
        );
        expect(ultima.estado).toBe('ok');
        expect(ultima.detalle).toContain('1 sobres enviados');
        expect(foliosEnviados()).toEqual([4007, 4008]);
      });
    });
  });

  describe('consulta al SII (ConsultarEnviosJob)', () => {
    /** La respuesta de la consulta del envío, con la forma del OpenAPI. */
    const respuestaConsulta = (datos: Record<string, unknown>) => ({
      headers: { 'content-type': 'application/json' },
      cuerpo: JSON.stringify({
        rut_emisor: RUT_SII,
        rut_envia: '11111111-1',
        trackid: 1014,
        fecha_recepcion: '2026-10-14 10:00:00',
        ...datos,
      }),
    });

    /** Vende `n` boletas, las manda (trackid 1014) y deja la consulta del sobre vencida. */
    async function enviadas(n: number) {
      await reiniciar();
      await vender(n);
      await envejecer();
      await job.enviarLotes();
      await consultaVencida();
      return (await envios())[0];
    }

    // El SII pide esperar 10 minutos tras el envío: para no esperarlos se corre
    // `consultar_desde` al pasado por SQL (es el reloj de la base, y no hay otra forma).
    const consultaVencida = () =>
      ds.query(
        `UPDATE dte_envios SET consultar_desde = now() - interval '1 minute'
          WHERE razon_social_id = $1 AND trackid IS NOT NULL AND eliminado_el IS NULL`,
        [razonSocialId],
      );

    const envio = async () => (await envios())[0];

    /** Segundos entre ahora y `consultar_desde`, para medir el "+5 minutos". */
    const segundosHastaLaConsulta = async () => {
      const [{ s }] = await ds.query<{ s: number }[]>(
        `SELECT extract(epoch FROM consultar_desde - now())::int AS s
           FROM dte_envios WHERE envio_id = $1`,
        [(await envio()).envio_id],
      );
      return s;
    };

    it('de punta a punta: un sobre con una rechazada, una con reparos y dos aceptadas deja a cada boleta en su estado', async () => {
      const sobre = await enviadas(4);
      falso.responder(
        'consulta',
        respuestaConsulta({
          estado: 'EPR',
          detalle_rep_rech: [
            {
              tipo: 39,
              folio: 4008,
              estado: 'RCH',
              descripcion: 'Boleta rechazada',
              error: [
                { seccion: 'Detalle', linea: 12, nivel: 1, codigo: 301 },
                { seccion: 'Totales', linea: 20, nivel: 1, codigo: 305 },
              ],
            },
            {
              tipo: 39,
              folio: 4009,
              estado: 'RPR',
              descripcion: 'Boleta con reparos',
              error: [{ seccion: 'Emisor', linea: 5, nivel: 2, codigo: 120 }],
            },
          ],
        }),
      );

      const mensaje = await consulta.consultar();

      expect(mensaje).toContain('1 envíos con resultado final');
      // Le preguntó por este sobre, con el RUT de la empresa.
      const [pedido] = falso.pedidosDe('consulta');
      expect(pedido.ruta).toBe(
        `/sii_boleta_api_certificacion/boleta.electronica.envio/${RUT_SII}-${sobre.trackid ?? ''}`,
      );
      const filas = await documentos();
      expect(filas.map((d) => [d.folio, d.estado])).toEqual([
        [4007, 'aceptado'],
        [4008, 'rechazado'],
        [4009, 'reparos'],
        [4010, 'aceptado'],
      ]);
      expect(filas[0].detalle_sii).toBeNull();
      expect(filas[3].detalle_sii).toBeNull();
      expect(filas[1].detalle_sii).toMatchObject({
        folio: 4008,
        estado: 'RCH',
        error: [{ codigo: 301 }, { codigo: 305 }],
      });
      expect(filas[2].detalle_sii).toMatchObject({
        folio: 4009,
        estado: 'RPR',
        error: [{ codigo: 120 }],
      });
      const final = await envio();
      expect(final).toMatchObject({
        estado_sii: 'EPR',
        consultar_desde: null,
        ultimo_error: null,
      });
      const [{ respuesta, intentos }] = await ds.query<
        { respuesta: { estado: string }; intentos: number }[]
      >(
        `SELECT respuesta_sii AS respuesta, intentos_consulta AS intentos FROM dte_envios WHERE envio_id = $1`,
        [sobre.envio_id],
      );
      expect(respuesta.estado).toBe('EPR');
      expect(intentos).toBe(1);

      // Ya es final: otra corrida no le vuelve a preguntar al SII.
      await consulta.consultar();
      expect(falso.pedidosDe('consulta')).toHaveLength(1);
    });

    it('un error del SII con folio null (de esquema o de firma) alcanza a todas las boletas del sobre', async () => {
      await enviadas(3);
      falso.responder(
        'consulta',
        respuestaConsulta({
          estado: 'EPR',
          detalle_rep_rech: [
            {
              tipo: null,
              folio: null,
              estado: 'RCH',
              descripcion: 'Error de firma',
            },
          ],
        }),
      );

      await consulta.consultar();

      const filas = await documentos();
      expect(filas.map((d) => d.estado)).toEqual([
        'rechazado',
        'rechazado',
        'rechazado',
      ]);
      expect(filas[1].detalle_sii).toMatchObject({
        folio: null,
        descripcion: 'Error de firma',
      });
    });

    it('la respuesta del SII llega sin validar: folio y tipo como texto calzan, y un código desconocido no acepta ni rechaza', async () => {
      await enviadas(3);
      falso.responder(
        'consulta',
        respuestaConsulta({
          estado: 'EPR',
          detalle_rep_rech: [
            { tipo: '39', folio: '4008', estado: 'RCH' },
            { tipo: 39, folio: 4009, estado: 'XYZ' },
          ],
        }),
      );

      await consulta.consultar();

      const filas = await documentos();
      // La 4009 no cambia (queda enviada, atrasada a la vista, hasta que alguien la revise) y
      // la 4007, sin entrada propia, tampoco se acepta por silencio: el SII dijo algo ilegible.
      expect(filas.map((d) => [d.folio, d.estado])).toEqual([
        [4007, 'enviado'],
        [4008, 'rechazado'],
        [4009, 'enviado'],
      ]);
      const e = await envio();
      expect(e.estado_sii).toBe('EPR');
      expect(e.ultimo_error).toContain('código desconocido (XYZ)');
    });

    it('detalle_rep_rech que no es una lista: ninguna boleta se acepta y el envío lleva el aviso', async () => {
      await enviadas(2);
      falso.responder(
        'consulta',
        respuestaConsulta({
          estado: 'EPR',
          detalle_rep_rech: { folio: 4007, estado: 'RCH' },
        }),
      );

      await consulta.consultar();

      expect((await documentos()).map((d) => d.estado)).toEqual([
        'enviado',
        'enviado',
      ]);
      expect(await envio()).toMatchObject({
        estado_sii: 'EPR',
        consultar_desde: null,
      });
      expect((await envio()).ultimo_error).toContain(
        'formato que no se entiende',
      );
    });

    it('un código del sobre desconocido: se sigue consultando cada 5 minutos, con el aviso hasta que el SII diga algo conocido', async () => {
      await enviadas(1);
      falso.responder('consulta', respuestaConsulta({ estado: 'XYZ' }));

      await consulta.consultar();

      expect(await envio()).toMatchObject({
        estado_sii: 'XYZ',
        ultimo_error: 'El SII devolvió el código XYZ; se sigue consultando',
      });
      const segundos = await segundosHastaLaConsulta();
      expect(segundos).toBeGreaterThan(290);
      expect(segundos).toBeLessThanOrEqual(300);
      expect((await documentos())[0].estado).toBe('enviado');

      // Un estado conocido que sigue en proceso limpia el aviso.
      await consultaVencida();
      falso.responder('consulta', respuestaConsulta({ estado: 'PRD' }));
      await consulta.consultar();
      expect(await envio()).toMatchObject({
        estado_sii: 'PRD',
        ultimo_error: null,
      });
    });

    it('el SII rechaza el sobre entero (RSC): todas rechazadas con el origen "sobre"', async () => {
      await enviadas(2);
      falso.responder('consulta', respuestaConsulta({ estado: 'RSC' }));

      await consulta.consultar();

      const filas = await documentos();
      expect(filas.map((d) => d.estado)).toEqual(['rechazado', 'rechazado']);
      expect(filas[0].detalle_sii).toEqual({
        origen: 'sobre',
        estado: 'RSC',
        descripcion: null,
      });
      expect((await envio()).estado_sii).toBe('RSC');
    });

    it('un envío con estado final no se consulta aunque su consultar_desde haya vencido', async () => {
      await enviadas(1);
      // Estado que la propia corrida no produce (un resultado final deja `consultar_desde` en
      // NULL): se arma por SQL para fijar que la cola mira también el estado del SII.
      await ds.query(
        `UPDATE dte_envios SET estado_sii = 'EPR'
          WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
        [razonSocialId],
      );

      await expect(consulta.consultar()).resolves.toContain('Sin envíos');

      expect(falso.pedidosDe('consulta')).toHaveLength(0);
    });

    it('una boleta que ya tiene estado final no se toca', async () => {
      await enviadas(2);
      // Alguien la dejó aceptada antes de que llegara el resultado del sobre.
      await ds.query(
        `UPDATE dte_documentos SET estado = 'aceptado'
          WHERE razon_social_id = $1 AND folio = 4007 AND eliminado_el IS NULL`,
        [razonSocialId],
      );
      falso.responder('consulta', respuestaConsulta({ estado: 'RSC' }));

      await consulta.consultar();

      const filas = await documentos();
      expect(filas.map((d) => [d.folio, d.estado])).toEqual([
        [4007, 'aceptado'],
        [4008, 'rechazado'],
      ]);
      expect(filas[0].detalle_sii).toBeNull();
    });

    it('RPT: el envío termina con el aviso y las boletas siguen enviadas', async () => {
      await enviadas(2);
      falso.responder('consulta', respuestaConsulta({ estado: 'RPT' }));

      await consulta.consultar();

      expect(await envio()).toMatchObject({
        estado_sii: 'RPT',
        consultar_desde: null,
        ultimo_error: 'El SII ya tenía este envío (RPT)',
      });
      expect((await documentos()).map((d) => d.estado)).toEqual([
        'enviado',
        'enviado',
      ]);
      await consulta.consultar();
      expect(falso.pedidosDe('consulta')).toHaveLength(1);
    });

    it('PRD (en proceso): las boletas siguen enviadas y se vuelve a consultar en 5 minutos', async () => {
      await enviadas(2);
      falso.responder('consulta', respuestaConsulta({ estado: 'PRD' }));

      const mensaje = await consulta.consultar();

      expect(mensaje).toContain('1 siguen en proceso');
      expect(await envio()).toMatchObject({
        estado_sii: 'PRD',
        ultimo_error: null,
      });
      const segundos = await segundosHastaLaConsulta();
      expect(segundos).toBeGreaterThan(290);
      expect(segundos).toBeLessThanOrEqual(300);
      expect((await documentos()).map((d) => d.estado)).toEqual([
        'enviado',
        'enviado',
      ]);
      // Todavía no vence: ahora no le pregunta.
      await consulta.consultar();
      expect(falso.pedidosDe('consulta')).toHaveLength(1);
    });

    it('si el SII pide esperar más (X-Retry-After), se espera eso', async () => {
      await enviadas(1);
      falso.responder('consulta', {
        ...respuestaConsulta({ estado: 'PRD' }),
        headers: {
          'content-type': 'application/json',
          'x-retry-after': '900',
        },
      });

      await consulta.consultar();

      const segundos = await segundosHastaLaConsulta();
      expect(segundos).toBeGreaterThan(890);
      expect(segundos).toBeLessThanOrEqual(900);
    });

    it('404 antes de las 24 h: se vuelve a consultar en 5 minutos', async () => {
      await enviadas(1);
      falso.responder('consulta', { status: 404 });

      await consulta.consultar();

      expect((await envio()).trackid).not.toBeNull();
      const segundos = await segundosHastaLaConsulta();
      expect(segundos).toBeGreaterThan(290);
      expect(segundos).toBeLessThanOrEqual(300);
      expect((await documentos())[0].estado).toBe('enviado');
    });

    it('404 a las 25 h del envío: queda con el error, sale de la consulta y la boleta sigue enviada', async () => {
      await enviadas(1);
      await ds.query(
        `UPDATE dte_envios SET enviado_el = now() - interval '25 hours'
          WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
        [razonSocialId],
      );
      falso.responder('consulta', { status: 404 });

      await consulta.consultar();

      expect(await envio()).toMatchObject({
        consultar_desde: null,
        ultimo_error: 'El SII no encuentra el envío',
      });
      expect((await documentos())[0].estado).toBe('enviado');
      // Fuera de la consulta: no hay nada que tomar.
      await expect(consulta.consultar()).resolves.toContain('Sin envíos');
      expect(falso.pedidosDe('consulta')).toHaveLength(1);
    });

    it('500 del SII: anota el error y reintenta en 5 minutos sin tocar el estado', async () => {
      await enviadas(1);
      falso.responder('consulta', { status: 500 });

      await consulta.consultar();

      const e = await envio();
      expect(e.ultimo_error).toEqual(expect.any(String));
      expect(e.estado_sii).toBe('REC');
      expect((await segundosHastaLaConsulta()) > 290).toBe(true);
      expect((await documentos())[0].estado).toBe('enviado');
    });

    it('certificado anulado: el envío queda con el motivo y no le pega al SII', async () => {
      await enviadas(1);
      await limpiarCertificados();
      try {
        await consulta.consultar();

        expect(falso.pedidosDe('consulta')).toHaveLength(0);
        expect((await envio()).ultimo_error).toContain('certificado digital');
        expect((await segundosHastaLaConsulta()) > 290).toBe(true);
        expect((await documentos())[0].estado).toBe('enviado');
      } finally {
        await subirCertificado(token);
      }
      // Con el certificado vigente otra vez, la siguiente corrida consulta y limpia el aviso.
      await consultaVencida();
      await consulta.consultar();
      expect((await envio()).estado_sii).toBe('EPR');
      expect((await envio()).ultimo_error).toBeNull();
    });

    it('un envío en consulta está reservado: otra instancia no lo consulta mientras tanto', async () => {
      await enviadas(1);
      let soltar: (() => void) | undefined;
      const original = cliente.consultarEnvio.bind(cliente);
      jest
        .spyOn(cliente, 'consultarEnvio')
        .mockImplementationOnce(async (...a) => {
          await new Promise<void>((ok) => (soltar = ok));
          return original(...a);
        });

      // La instancia A reservó el envío y está esperando al SII.
      const lenta = consulta.consultar();
      while (!soltar) await new Promise((r) => setTimeout(r, 20));
      // La instancia B corre ahora: no hay nada que tomar.
      await expect(consulta.consultar()).resolves.toContain('Sin envíos');
      expect(falso.pedidosDe('consulta')).toHaveLength(0);

      soltar();
      await lenta;
      expect(falso.pedidosDe('consulta')).toHaveLength(1);
      expect((await envio()).estado_sii).toBe('EPR');
    });

    it('405 del SII: pausa la consulta, y la siguiente corrida ni reserva ni le pega', async () => {
      await enviadas(1);
      falso.responder('consulta', {
        status: 405,
        headers: { 'x-ratelimit-reset': '120' },
      });

      await consulta.consultar();

      expect(cliente.pausadoHasta()).toBeGreaterThan(Date.now() + 100_000);
      await consultaVencida();
      const segundo = await consulta.consultar();

      expect(segundo).toContain('espaciar');
      expect(falso.pedidosDe('consulta')).toHaveLength(1);
      // No reservó: la consulta sigue vencida.
      expect((await segundosHastaLaConsulta()) < 0).toBe(true);
    });

    it('una boleta enviada hace 61 minutos se lee atrasada; la de 59, la aceptada y la dada de baja, no', async () => {
      await reiniciar();
      await vender(4);
      await envejecer();
      await job.enviarLotes();
      const poner = (folio: number, minutos: number, estado = 'enviado') =>
        ds.query(
          `UPDATE dte_documentos SET emitido_el = now() - ($3::int * interval '1 minute'), estado = $4
            WHERE razon_social_id = $1 AND folio = $2 AND eliminado_el IS NULL`,
          [razonSocialId, folio, minutos, estado],
        );
      await poner(4007, 61);
      await poner(4008, 59);
      await poner(4009, 90, 'aceptado');
      await poner(4010, 90);
      await ds.query(
        `UPDATE dte_documentos SET eliminado_el = now()
          WHERE razon_social_id = $1 AND folio = 4010 AND eliminado_el IS NULL`,
        [razonSocialId],
      );

      // La definición de "atrasada" (emision-electronica.md, § Envío al SII): no es una columna,
      // se calcula al leer. Esta consulta la fija para el subproyecto 4.
      const atrasadas = await ds.query<{ folio: number }[]>(
        `SELECT folio FROM dte_documentos
          WHERE razon_social_id = $1 AND eliminado_el IS NULL
            AND estado IN ('pendiente','enviado') AND emitido_el < now() - interval '1 hour'
          ORDER BY folio`,
        [razonSocialId],
      );
      expect(atrasadas.map((d) => d.folio)).toEqual([4007]);
    });

    describe('el tick', () => {
      it('apagado (DTE_COLA_AUTOMATICA=false): con un envío listo no consulta ni escribe en cron_ejecuciones', async () => {
        await enviadas(1);
        const antes = await ejecucionesDelJob('consultar-envios');

        await conAutomatica('false', () => consulta.tick());

        expect(await ejecucionesDelJob('consultar-envios')).toBe(antes);
        expect(falso.pedidosDe('consulta')).toHaveLength(0);
      });

      it('encendido pero con la consulta todavía sin vencer: no escribe en cron_ejecuciones', async () => {
        await enviadas(1);
        await ds.query(
          `UPDATE dte_envios SET consultar_desde = now() + interval '5 minutes'
            WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
          [razonSocialId],
        );
        const antes = await ejecucionesDelJob('consultar-envios');

        await conAutomatica('true', () => consulta.tick());

        expect(await ejecucionesDelJob('consultar-envios')).toBe(antes);
        expect(falso.pedidosDe('consulta')).toHaveLength(0);
      });

      it('encendido y con un envío con la consulta vencida: registra la corrida y consulta', async () => {
        await enviadas(1);
        const antes = await ejecucionesDelJob('consultar-envios');

        await conAutomatica('true', () => consulta.tick());

        expect(await ejecucionesDelJob('consultar-envios')).toBe(antes + 1);
        const [ultima] = await ds.query<{ estado: string; detalle: string }[]>(
          `SELECT estado, detalle FROM cron_ejecuciones
            WHERE job = 'consultar-envios' ORDER BY iniciado_el DESC LIMIT 1`,
        );
        expect(ultima.estado).toBe('ok');
        expect(ultima.detalle).toContain('1 envíos con resultado final');
        expect((await envio()).estado_sii).toBe('EPR');
      });
    });
  });
});
