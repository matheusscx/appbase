import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { normalizarRut } from '../src/common/utils/rut.util';
import {
  cafDePrueba,
  certificadoDePrueba,
} from '../src/modules/dte/__fixtures__/credenciales-prueba';
import { CifradoDteService } from '../src/modules/dte/cifrado-dte.service';
import { correrCarrera } from './helpers/carrera';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * Perfil fiscal del emisor por API: `GET`/`PATCH /dte/perfil`, `POST /dte/certificado` y
 * `POST`/`DELETE /dte/cafs`.
 *
 * La razón social emisora es propia de este archivo ('Emisor e2e perfil fiscal'): el spec la
 * crea, la marca preferida y limpia sus CAF y certificados, de modo que correr dos veces da lo
 * mismo. Lo único que no se puede deshacer por la API es la marca de preferida (no hay una
 * ruta que la saque), así que el `afterAll` la baja por SQL: las otras suites no esperan una.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };
const NOMBRE_EMISORA = 'Emisor e2e perfil fiscal';
const RUT_EMISORA = '77.777.777-7';
const CLAVE_EQUIVOCADA = 'clave-que-no-es-9137';

/** Nada de esto puede salir en una respuesta: es la llave del certificado o su blob cifrado. */
const PROHIBIDOS = [
  'credencial_cifrada',
  'credencialCifrada',
  'llavePrivadaPem',
  'PRIVATE KEY',
  'xml_cifrado',
  'xmlCifrado',
  'RSASK',
];

interface TokenResponse {
  access_token: string;
}
interface RazonSocialResponse {
  id: string;
  nombre: string;
  habilitado: boolean;
}
interface CafResponse {
  id: string;
  tipo: number;
  ambiente: string;
  desde: number;
  hasta: number;
  usados: number;
  restantes: number;
  borrable: boolean;
}
interface PerfilResponse {
  emisor: { rut: string; nombre: string; giro: string | null } | null;
  certificado: {
    id: string;
    rutFirmante: string;
    nombreFirmante: string;
    venceEl: string;
  } | null;
  cafs: CafResponse[];
  faltantes: { codigo: string }[];
  avisos: { codigo: string }[];
}

describe('Perfil fiscal del emisor (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let razonSocialId: string;
  /** Los textos crudos de todas las respuestas: ninguna puede traer la llave. */
  const respuestas: string[] = [];

  async function loginComo(
    usuario: { email: string; pass: string },
    tenantId: string,
  ): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: usuario.email, password: usuario.pass });
    expect(login.status).toBe(200);
    const tenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId });
    expect(tenant.status).toBe(200);
    return (tenant.body as TokenResponse).access_token;
  }

  /** La respuesta cruda; el texto se guarda para revisar al final que no filtró la llave. */
  async function llamar(
    metodo: 'get' | 'patch' | 'post' | 'delete',
    url: string,
    conToken: string,
    body?: Record<string, unknown>,
  ) {
    const req = request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${conToken}`);
    const res = await (body === undefined ? req : req.send(body));
    respuestas.push(res.text);
    return res;
  }

  /** El CAF de la emisora, en base64 como lo manda la pantalla (el archivo del SII es latin1). */
  function cafBase64(opciones: Parameters<typeof cafDePrueba>[0]): {
    xml: string;
    xmlBase64: string;
  } {
    const xml = cafDePrueba(opciones);
    return { xml, xmlBase64: Buffer.from(xml, 'latin1').toString('base64') };
  }

  /** Lo que una corrida anterior (o esta) dejó cargado en la razón social propia. */
  async function limpiarCargas() {
    await ds.query(
      `UPDATE dte_cafs SET eliminado_el = now()
        WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    await ds.query(
      `UPDATE dte_certificados
          SET credencial_cifrada = NULL, reemplazado_el = COALESCE(reemplazado_el, now())
        WHERE razon_social_id = $1 AND (credencial_cifrada IS NOT NULL OR reemplazado_el IS NULL)`,
      [razonSocialId],
    );
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

    token = await loginComo(ADMIN, PARIS_TENANT_ID);

    const lista = await request(app.getHttpServer())
      .get('/api/tenants/razones-sociales')
      .set('Authorization', `Bearer ${token}`);
    expect(lista.status).toBe(200);
    let razon = (lista.body as RazonSocialResponse[]).find(
      (r) => r.nombre === NOMBRE_EMISORA,
    );
    if (!razon) {
      const creada = await request(app.getHttpServer())
        .post('/api/tenants/razones-sociales')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: NOMBRE_EMISORA,
          rut: RUT_EMISORA,
          direccion: 'Av. Prueba 123',
          habilitado: true,
        });
      expect(creada.status).toBe(201);
      razon = creada.body as RazonSocialResponse;
    }
    razonSocialId = razon.id;

    const preferida = await request(app.getHttpServer())
      .patch(`/api/tenants/razones-sociales/${razonSocialId}/preferida`)
      .set('Authorization', `Bearer ${token}`);
    expect(preferida.status).toBe(200);

    await limpiarCargas();
    await ds.query(
      `UPDATE razones_sociales
          SET giro = NULL, comuna = NULL, ambiente_sii = NULL,
              fecha_resolucion = NULL, numero_resolucion = NULL
        WHERE razon_social_id = $1`,
      [razonSocialId],
    );
  }, 60000);

  afterAll(async () => {
    // Acumular y afirmar DESPUÉS de `app.close()`: un expect que tira antes de cerrar deja el
    // pool abierto y jest no termina nunca.
    const fallos: string[] = [];
    try {
      await limpiarCargas();
      // No hay una ruta que des-marque la preferida (`PATCH …/preferida` solo marca), y las
      // otras suites no esperan que el tenant tenga una.
      await ds.query(
        `UPDATE razones_sociales SET preferida = false WHERE razon_social_id = $1`,
        [razonSocialId],
      );
      for (const texto of respuestas) {
        for (const prohibido of PROHIBIDOS) {
          if (texto.includes(prohibido))
            fallos.push(
              `una respuesta trae "${prohibido}": ${texto.slice(0, 200)}`,
            );
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('GET /dte/perfil: la emisora y todo lo que le falta', async () => {
    const res = await llamar('get', '/api/dte/perfil', token);
    expect(res.status).toBe(200);
    const perfil = res.body as PerfilResponse;

    expect(normalizarRut(perfil.emisor!.rut)).toBe('77777777-7');
    expect(perfil.emisor!.nombre).toBe(NOMBRE_EMISORA);
    expect(perfil.certificado).toBeNull();
    expect(perfil.cafs).toEqual([]);
    expect(perfil.faltantes.map((f) => f.codigo)).toEqual([
      'SIN_GIRO',
      'SIN_COMUNA',
      'SIN_AMBIENTE',
      'SIN_RESOLUCION',
      'SIN_CERTIFICADO',
      'SIN_FOLIOS_39',
    ]);
  });

  it('PATCH /dte/perfil: guarda los datos y el GET ya no los pide', async () => {
    const datos = {
      giro: 'Restaurante',
      comuna: 'Ñuñoa',
      ambienteSii: 'certificacion',
      fechaResolucion: '2026-09-30',
      numeroResolucion: 0,
    };
    const res = await llamar('patch', '/api/dte/perfil', token, datos);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(datos);

    const perfil = await llamar('get', '/api/dte/perfil', token);
    expect(perfil.status).toBe(200);
    expect((perfil.body as PerfilResponse).emisor!.giro).toBe('Restaurante');
    expect(
      (perfil.body as PerfilResponse).faltantes.map((f) => f.codigo),
    ).toEqual(['SIN_CERTIFICADO', 'SIN_FOLIOS_39']);
  });

  it('PATCH /dte/perfil rechaza lo que el SII no admite', async () => {
    for (const malo of [
      { giro: null },
      { comuna: null },
      { ambienteSii: 'otro' },
      { fechaResolucion: '30-09-2026' },
      { numeroResolucion: -1 },
      { numeroResolucion: 2147483648 },
      { giro: 'x'.repeat(81) },
    ]) {
      const res = await llamar('patch', '/api/dte/perfil', token, malo);
      expect({ malo, status: res.status }).toEqual({ malo, status: 400 });
    }
    // Pasa el DTO pero no es un día del calendario: lo frena el service.
    const febrero = await llamar('patch', '/api/dte/perfil', token, {
      fechaResolucion: '2026-02-30',
    });
    expect(febrero.status).toBe(400);
    // Un tab pasa el DTO y lo frena el motor: no cabe en el campo del SII.
    const tab = await llamar('patch', '/api/dte/perfil', token, {
      giro: 'Café\tbar',
    });
    expect(tab.status).toBe(400);
  });

  it('POST /dte/certificado: lo guarda y una segunda subida anula el anterior', async () => {
    const primero = certificadoDePrueba({ nombre: 'Ana Pérez' });
    const res1 = await llamar('post', '/api/dte/certificado', token, {
      pfxBase64: primero.pfx.toString('base64'),
      clave: primero.clave,
    });
    expect(res1.status).toBe(201);
    const cert1 = res1.body as {
      id: string;
      rutFirmante: string;
      nombreFirmante: string;
    };
    expect(cert1.rutFirmante).toBe(primero.rut);
    expect(cert1.nombreFirmante).toBe('Ana Pérez');

    const segundo = certificadoDePrueba({ nombre: 'Luis Soto' });
    const res2 = await llamar('post', '/api/dte/certificado', token, {
      pfxBase64: segundo.pfx.toString('base64'),
      clave: segundo.clave,
    });
    expect(res2.status).toBe(201);
    const cert2 = res2.body as { id: string };
    expect(cert2.id).not.toBe(cert1.id);

    const anulado: {
      credencial_cifrada: string | null;
      reemplazado_el: Date | null;
    }[] = await ds.query(
      `SELECT credencial_cifrada, reemplazado_el FROM dte_certificados WHERE certificado_id = $1`,
      [cert1.id],
    );
    expect(anulado).toHaveLength(1);
    expect(anulado[0].reemplazado_el).not.toBeNull();
    expect(anulado[0].credencial_cifrada).toBeNull();

    const vigente: { credencial_cifrada: string }[] = await ds.query(
      `SELECT credencial_cifrada FROM dte_certificados
        WHERE razon_social_id = $1 AND reemplazado_el IS NULL AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    expect(vigente).toHaveLength(1);
    // Cifrado de verdad: la llave no queda en claro en la base.
    expect(vigente[0].credencial_cifrada).toMatch(/^v1:/);
    expect(vigente[0].credencial_cifrada).not.toContain('PRIVATE KEY');

    const perfil = await llamar('get', '/api/dte/perfil', token);
    expect(perfil.status).toBe(200);
    const cuerpo = perfil.body as PerfilResponse;
    expect(cuerpo.certificado!.id).toBe(cert2.id);
    expect(cuerpo.certificado!.nombreFirmante).toBe('Luis Soto');
    expect(cuerpo.faltantes.map((f) => f.codigo)).toEqual(['SIN_FOLIOS_39']);
  });

  it('POST /dte/certificado con la clave equivocada: 400 sin la clave en la respuesta', async () => {
    const cert = certificadoDePrueba();
    const res = await llamar('post', '/api/dte/certificado', token, {
      pfxBase64: cert.pfx.toString('base64'),
      clave: CLAVE_EQUIVOCADA,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(CLAVE_EQUIVOCADA);
  });

  it('POST /dte/certificado rechaza el vencido y lo que no es un archivo', async () => {
    const vencido = certificadoDePrueba({
      venceEl: new Date('2026-05-04T10:17:00Z'),
    });
    const resVencido = await llamar('post', '/api/dte/certificado', token, {
      pfxBase64: vencido.pfx.toString('base64'),
      clave: vencido.clave,
    });
    expect(resVencido.status).toBe(400);
    expect(JSON.stringify(resVencido.body)).toContain('04-05-2026');

    const noBase64 = await llamar('post', '/api/dte/certificado', token, {
      pfxBase64: '¡esto no es base64!',
      clave: '',
    });
    expect(noBase64.status).toBe(400);

    // Base64 válido pero no es un .pfx.
    const basura = await llamar('post', '/api/dte/certificado', token, {
      pfxBase64: Buffer.from('no soy un pfx').toString('base64'),
      clave: '',
    });
    expect(basura.status).toBe(400);
  });

  it('POST /dte/cafs: un 39 válido se guarda, cifrado, y el GET ya no pide folios', async () => {
    const { xml, xmlBase64 } = cafBase64({
      rut: '77777777-7',
      tipo: 39,
      desde: 2041,
      hasta: 2077,
    });
    const res = await llamar('post', '/api/dte/cafs', token, { xmlBase64 });
    expect(res.status).toBe(201);
    const caf = res.body as CafResponse;
    expect(caf).toMatchObject({
      tipo: 39,
      ambiente: 'certificacion',
      desde: 2041,
      hasta: 2077,
      usados: 0,
      restantes: 37,
      borrable: true,
    });

    const filas: { xml_cifrado: string; siguiente_folio: number }[] =
      await ds.query(
        `SELECT xml_cifrado, siguiente_folio FROM dte_cafs WHERE caf_id = $1`,
        [caf.id],
      );
    expect(filas).toHaveLength(1);
    expect(filas[0].siguiente_folio).toBe(2041);
    // Cifrado de verdad: la llave del CAF no queda en claro, y se recupera tal cual.
    expect(filas[0].xml_cifrado).toMatch(/^v1:/);
    expect(filas[0].xml_cifrado).not.toContain('RSASK');
    expect(app.get(CifradoDteService).descifrar(filas[0].xml_cifrado)).toBe(
      xml,
    );

    const perfil = await llamar('get', '/api/dte/perfil', token);
    expect(perfil.status).toBe(200);
    const cuerpo = perfil.body as PerfilResponse;
    expect(cuerpo.faltantes.map((f) => f.codigo)).not.toContain(
      'SIN_FOLIOS_39',
    );
    expect(cuerpo.cafs.map((c) => c.id)).toContain(caf.id);
  });

  it('POST /dte/cafs: un CAF al estilo Windows (latin1, CRLF, tildes y Ñ) se guarda y se recupera igual', async () => {
    const { xml, xmlBase64 } = cafBase64({
      rut: '77777777-7',
      tipo: 41,
      desde: 3011,
      hasta: 3412,
      razonSocial: 'PANADERÍA ÑUÑOA',
      windows: true,
    });
    // Los bytes de la Ñ en el archivo son los de latin1 (0xD1), no los de utf8 (0xC3 0x91).
    expect(Buffer.from(xmlBase64, 'base64').includes(0xd1)).toBe(true);

    const res = await llamar('post', '/api/dte/cafs', token, { xmlBase64 });
    expect(res.status).toBe(201);
    const caf = res.body as CafResponse;
    expect(caf).toMatchObject({ tipo: 41, desde: 3011, hasta: 3412 });

    const filas: { xml_cifrado: string }[] = await ds.query(
      `SELECT xml_cifrado FROM dte_cafs WHERE caf_id = $1`,
      [caf.id],
    );
    const guardado = app.get(CifradoDteService).descifrar(filas[0].xml_cifrado);
    expect(guardado).toBe(xml);
    expect(guardado).toContain('PANADERÍA ÑUÑOA');
    expect(guardado).toContain('\r\n');
  });

  it('POST /dte/cafs rechaza el de otro RUT, el que no es boleta y el que no es un CAF', async () => {
    const otroRut = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '76543210-3',
        tipo: 39,
        desde: 4001,
        hasta: 4050,
      }).xmlBase64,
    });
    expect(otroRut.status).toBe(400);
    expect(JSON.stringify(otroRut.body)).toContain('del RUT');

    // El motor (`leerCaf`) no mira el tipo: el 400 sale del service, con su mensaje.
    const factura = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 33,
        desde: 4001,
        hasta: 4050,
      }).xmlBase64,
    });
    expect(factura.status).toBe(400);
    expect(JSON.stringify(factura.body)).toContain('solo se cargan boletas');

    const basura = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: Buffer.from('<AUTORIZACION></AUTORIZACION>').toString(
        'base64',
      ),
    });
    expect(basura.status).toBe(400);
    expect(JSON.stringify(basura.body)).toContain('El CAF no es válido');

    const noBase64 = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: '¡esto no es base64!',
    });
    expect(noBase64.status).toBe(400);

    const filas: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM dte_cafs
        WHERE razon_social_id = $1 AND eliminado_el IS NULL AND desde = 4001`,
      [razonSocialId],
    );
    expect(Number(filas[0].n)).toBe(0);
  });

  it('POST /dte/cafs: un rango que se solapa con uno cargado es 400', async () => {
    // El 39 de 2041 a 2077 ya está cargado (test de arriba).
    const res = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 39,
        desde: 2070,
        hasta: 2090,
      }).xmlBase64,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('ya están cargados');
  });

  it('POST /dte/cafs: el mismo archivo en dos clics a la vez entra una sola vez', async () => {
    const { xmlBase64 } = cafBase64({
      rut: '77777777-7',
      tipo: 39,
      desde: 5003,
      hasta: 5104,
    });
    const [a, b] = await Promise.all([
      llamar('post', '/api/dte/cafs', token, { xmlBase64 }),
      llamar('post', '/api/dte/cafs', token, { xmlBase64 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const rechazada = a.status === 400 ? a : b;
    expect(rechazada.status).toBe(400);
    expect(JSON.stringify(rechazada.body)).toContain('ya están cargados');

    const filas: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM dte_cafs
        WHERE razon_social_id = $1 AND tipo = 39 AND desde = 5003 AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    expect(Number(filas[0].n)).toBe(1);
  });

  it('POST /dte/cafs espera a quien tiene tomada la razón social (el candado que serializa los clics)', async () => {
    // El doble clic de arriba sale bien aunque no haya candado si un clic le gana al otro por
    // unos milisegundos. Acá la carrera es forzada: alguien retiene la fila de la razón social,
    // se dispara la subida y se mide (con `pg_blocking_pids`) que quedó frenada en la base.
    const { esperando, respuestas } = await correrCarrera(
      ds,
      [
        `SELECT 1 FROM razones_sociales WHERE razon_social_id = $1 FOR UPDATE`,
        [razonSocialId],
      ],
      [
        () =>
          llamar('post', '/api/dte/cafs', token, {
            xmlBase64: cafBase64({
              rut: '77777777-7',
              tipo: 41,
              desde: 9501,
              hasta: 9510,
            }).xmlBase64,
          }),
      ],
    );
    expect(esperando).toBeGreaterThanOrEqual(1);
    expect(respuestas[0].status).toBe(201);
  });

  it('POST /dte/cafs: un rango contiguo al cargado (2078-2090 tras 2041-2077) no se solapa', async () => {
    const res = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 39,
        desde: 2078,
        hasta: 2090,
      }).xmlBase64,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ desde: 2078, hasta: 2090, restantes: 13 });
  });

  it('POST /dte/cafs: el SII numera cada ambiente aparte, así que producción puede repetir el rango de certificación', async () => {
    // El 39 de 2041 a 2077 de certificación ya está cargado (y en el test de solape, 2070-2090
    // en certificación se rechaza). En producción el mismo rango es otro CAF.
    const cambiar = (ambienteSii: string) =>
      llamar('patch', '/api/dte/perfil', token, { ambienteSii });
    const xmlBase64 = cafBase64({
      rut: '77777777-7',
      tipo: 39,
      desde: 2041,
      hasta: 2077,
    }).xmlBase64;
    const enProduccion = await cambiar('produccion');
    expect(enProduccion.status).toBe(200);
    try {
      const res = await llamar('post', '/api/dte/cafs', token, { xmlBase64 });
      expect(res.status).toBe(201);
      const caf = res.body as CafResponse;
      expect(caf).toMatchObject({
        ambiente: 'produccion',
        desde: 2041,
        hasta: 2077,
      });
      // Y dentro de producción el solape sigue valiendo.
      const repetido = await llamar('post', '/api/dte/cafs', token, {
        xmlBase64,
      });
      expect(repetido.status).toBe(400);
      expect(JSON.stringify(repetido.body)).toContain('ya están cargados');

      // Se deja como estaba: sin ese CAF de producción.
      const borrado = await llamar('delete', `/api/dte/cafs/${caf.id}`, token);
      expect(borrado.status).toBe(200);
    } finally {
      const vuelta = await cambiar('certificacion');
      expect(vuelta.status).toBe(200);
    }
  });

  it('DELETE /dte/cafs/:id: un CAF sin usar se quita y deja de aparecer', async () => {
    const creado = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 39,
        desde: 7001,
        hasta: 7010,
      }).xmlBase64,
    });
    expect(creado.status).toBe(201);
    const { id } = creado.body as CafResponse;

    const res = await llamar('delete', `/api/dte/cafs/${id}`, token);
    expect(res.status).toBe(200);
    expect(res.text).toBe('');

    const perfil = await llamar('get', '/api/dte/perfil', token);
    expect(perfil.status).toBe(200);
    expect((perfil.body as PerfilResponse).cafs.map((c) => c.id)).not.toContain(
      id,
    );
    // Borrado lógico: la fila sigue, marcada.
    const filas: { eliminado_el: Date | null }[] = await ds.query(
      `SELECT eliminado_el FROM dte_cafs WHERE caf_id = $1`,
      [id],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].eliminado_el).not.toBeNull();

    // Ya borrado: para la API no existe.
    const otraVez = await llamar('delete', `/api/dte/cafs/${id}`, token);
    expect(otraVez.status).toBe(404);

    // Y su rango quedó libre para cargarlo de nuevo.
    const recargado = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 39,
        desde: 7001,
        hasta: 7010,
      }).xmlBase64,
    });
    expect(recargado.status).toBe(201);
  });

  it('DELETE /dte/cafs/:id: el id de otro tenant es 404 y el CAF sigue', async () => {
    const creado = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 39,
        desde: 8001,
        hasta: 8010,
      }).xmlBase64,
    });
    expect(creado.status).toBe(201);
    const { id } = creado.body as CafResponse;

    const tokenOtro = await loginSegundoTenant(app);
    const res = await llamar('delete', `/api/dte/cafs/${id}`, tokenOtro);
    expect(res.status).toBe(404);

    const filas: { eliminado_el: Date | null }[] = await ds.query(
      `SELECT eliminado_el FROM dte_cafs WHERE caf_id = $1`,
      [id],
    );
    expect(filas[0].eliminado_el).toBeNull();

    const inexistente = await llamar(
      'delete',
      '/api/dte/cafs/00000000-0000-4000-8000-000000000000',
      token,
    );
    expect(inexistente.status).toBe(404);
    const noUuid = await llamar('delete', '/api/dte/cafs/no-es-uuid', token);
    expect(noUuid.status).toBe(400);
  });

  it('DELETE /dte/cafs/:id: un CAF que ya entregó un folio no se puede quitar', async () => {
    const creado = await llamar('post', '/api/dte/cafs', token, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 39,
        desde: 6001,
        hasta: 6050,
      }).xmlBase64,
    });
    expect(creado.status).toBe(201);
    const { id } = creado.body as CafResponse;

    // Tomar folios es la tarea 7 (todavía no hay endpoint que lo haga): acá solo se prueba la
    // regla del borrado, así que se simula que ya salió el primero.
    await ds.query(
      `UPDATE dte_cafs SET siguiente_folio = desde + 1 WHERE caf_id = $1`,
      [id],
    );

    const res = await llamar('delete', `/api/dte/cafs/${id}`, token);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('ya entregó folios');

    const perfil = await llamar('get', '/api/dte/perfil', token);
    expect(perfil.status).toBe(200);
    const caf = (perfil.body as PerfilResponse).cafs.find((c) => c.id === id)!;
    expect(caf).toMatchObject({ usados: 1, restantes: 49, borrable: false });
  });

  it('un usuario que no es admin recibe 403 en todas las rutas', async () => {
    const tokenEncargado = await loginComo(ENCARGADO, PARIS_TENANT_ID);
    const cert = certificadoDePrueba();

    const get = await llamar('get', '/api/dte/perfil', tokenEncargado);
    expect(get.status).toBe(403);
    const patch = await llamar('patch', '/api/dte/perfil', tokenEncargado, {
      giro: 'Intento',
    });
    expect(patch.status).toBe(403);
    const post = await llamar('post', '/api/dte/certificado', tokenEncargado, {
      pfxBase64: cert.pfx.toString('base64'),
      clave: cert.clave,
    });
    expect(post.status).toBe(403);
    const caf = await llamar('post', '/api/dte/cafs', tokenEncargado, {
      xmlBase64: cafBase64({
        rut: '77777777-7',
        tipo: 39,
        desde: 9001,
        hasta: 9010,
      }).xmlBase64,
    });
    expect(caf.status).toBe(403);
    const borrar = await llamar(
      'delete',
      '/api/dte/cafs/00000000-0000-4000-8000-000000000000',
      tokenEncargado,
    );
    expect(borrar.status).toBe(403);
  });

  it('otro tenant no ve el perfil de este', async () => {
    const tokenOtro = await loginSegundoTenant(app);

    const res = await llamar('get', '/api/dte/perfil', tokenOtro);
    expect(res.status).toBe(200);
    const perfil = res.body as PerfilResponse;
    if (perfil.emisor !== null)
      expect(normalizarRut(perfil.emisor.rut)).not.toBe('77777777-7');
    expect(perfil.certificado?.nombreFirmante).not.toBe('Luis Soto');
  });
});
