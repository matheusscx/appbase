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
import { ColaDteService } from '../src/modules/dte/cola-dte.service';
import { DteError } from '../src/modules/dte/dte.types';
import { emitirBoleta } from '../src/modules/dte/envio-boleta';
import { FoliosService } from '../src/modules/dte/folios.service';

/**
 * Cola de envío al SII: `encolar` guarda la boleta firmada como `pendiente`, dentro de la
 * transacción de la venta.
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
}

describe('Cola de envío al SII (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let db: Db;
  let folios: FoliosService;
  let cola: ColaDteService;
  let token: string;
  let razonSocialId: string;

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
  async function reiniciar(): Promise<CafResponse> {
    await limpiar();
    return subirCaf(token, RUT_SII, 39, 4007, 4031);
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
    cola = app.get(ColaDteService);

    token = await loginParis();
    razonSocialId = await emisora(token);

    await limpiar();
    await limpiarCertificados();
    await subirCertificado(token);
  }, 60000);

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
              + (SELECT count(*) FROM dte_documentos WHERE razon_social_id = $1 AND eliminado_el IS NULL) AS n`,
        [razonSocialId],
      );
      if (Number(vivos[0].n) !== 0) fallos.push('quedaron CAF o documentos');
    } finally {
      await app.close();
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
});
