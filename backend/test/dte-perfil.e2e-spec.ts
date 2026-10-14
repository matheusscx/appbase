import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { normalizarRut } from '../src/common/utils/rut.util';
import { certificadoDePrueba } from '../src/modules/dte/__fixtures__/credenciales-prueba';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * Perfil fiscal del emisor por API: `GET`/`PATCH /dte/perfil` y `POST /dte/certificado`.
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
];

interface TokenResponse {
  access_token: string;
}
interface RazonSocialResponse {
  id: string;
  nombre: string;
  habilitado: boolean;
}
interface PerfilResponse {
  emisor: { rut: string; nombre: string; giro: string | null } | null;
  certificado: {
    id: string;
    rutFirmante: string;
    nombreFirmante: string;
    venceEl: string;
  } | null;
  cafs: unknown[];
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
    metodo: 'get' | 'patch' | 'post',
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

  it('un usuario que no es admin recibe 403 en las tres rutas', async () => {
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
