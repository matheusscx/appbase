import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import {
  cafDePrueba,
  certificadoDePrueba,
} from '../src/modules/dte/__fixtures__/credenciales-prueba';
import { ColaDteService } from '../src/modules/dte/cola-dte.service';
import { CredencialesService } from '../src/modules/pasarela/services/credenciales.service';
import { InscripcionesService } from '../src/modules/pasarela/services/inscripciones.service';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { TenantPasarelaService } from '../src/modules/pasarela/services/tenant-pasarela.service';
import { VentasService } from '../src/modules/ventas/ventas.service';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * La venta emite la boleta electrónica (spec `2026-10-14-boleta-desde-la-venta`, § 4): al final
 * de la transacción de la venta, detrás de un savepoint. Un `DteError` deja el documento
 * `sin_emitir` y la venta entra; cualquier otro error la tumba, con su folio.
 *
 * La razón social emisora es propia de este archivo ('Emisor e2e boleta venta'): la crea, la marca
 * preferida y le carga certificado y CAF. El `afterAll` deja a Paris como lo encontró —emisión
 * apagada, esa razón social sin marca de preferida, CAF, certificado y documentos de la cola dados
 * de baja— porque lo comparten `dte-cola` (que manda a su SII falso todo `pendiente` que
 * encuentre) y `dte-folios`. Las ventas que crea se quedan: son ventas normales.
 *
 * Cada test parte de sus propios CAF (`reiniciar`): un 39 de 5001 a 5200 y un 41 de 6001 a 6050.
 * Los folios que se leen son los de la base (`siguiente_folio`), no lo que cuenta la respuesta.
 *
 * Callback de la tienda y alta de suscripción corren de verdad (con el proveedor de pago
 * simulado por `jest.spyOn` sobre los servicios de la app, que `restoreAllMocks` suelta).
 */
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
const NOMBRE = 'Emisor e2e boleta venta';
const RUT = '76.777.888-0';
const RUT_SII = '76777888-0';
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const FACTURA_ID = '550e8400-e29b-41d4-a716-446655440146';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
// "Promo del total $5.000": descuento de nivel VENTA, monto fijo (seed).
const DESCUENTO_FIJO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440360';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const PLAN_MENSUAL_DEMO = '550e8400-e29b-41d4-a716-446655440352';

const CAF39 = { desde: 5001, hasta: 5200 };
const CAF41 = { desde: 6001, hasta: 6050 };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface BoletaElectronica {
  tipo: number;
  folio: number;
  monto: string;
  cubreTodo: boolean;
  ambiente: string;
  resolucion: { numero: number; fecha: string };
  emisor: {
    rut: string;
    razonSocial: string;
    giro: string;
    direccion: string;
    comuna: string;
  };
}
interface BoletaRes {
  boletaElectronica: BoletaElectronica | null;
  boletaSinEmitir: { mensaje: string } | null;
}
interface VentaRes {
  id: string;
  estado: string;
  boleta: BoletaRes;
}
interface FilaVentaDoc {
  documento_id: string;
  emisor: string;
  estado_envio: string | null;
  dte_documento_id: string | null;
  emision_error_codigo: string | null;
  emision_error: string | null;
  monto: string;
}
interface FilaDte {
  documento_id: string;
  tipo: number;
  folio: number;
  estado: string;
  xml: string;
}

describe('La venta emite la boleta electrónica (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let razonSocialId: string;
  let caja: CajaAbierta;
  let itemAfecto: string; // 5.000 con IVA incluido
  let itemExento: string; // 3.000 exento
  let itemKg: string; // 8.000 el kg, a granel
  let garzon: { id: string; pin: string };
  let mesaId: string;
  const marca = Date.now();

  // ---- API -------------------------------------------------------------------------------

  const llamar = (
    metodo: 'get' | 'post' | 'patch',
    ruta: string,
    body?: object,
    clave?: string,
  ) => {
    const r = request(app.getHttpServer())[metodo](`/api/${ruta}`);
    r.set('Authorization', `Bearer ${token}`);
    if (clave) r.set('Idempotency-Key', clave);
    return body ? r.send(body) : r;
  };

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await llamar('post', ruta, body, randomUUID());
    expect(res.status).toBe(201);
    return res.body as T;
  }

  async function loginParis(): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(ADMIN);
    expect(login.status).toBe(200);
    const tenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(tenant.status).toBe(200);
    return (tenant.body as TokenResponse).access_token;
  }

  /** Crea la razón social por nombre (o la reusa), la marca preferida y le deja el perfil completo. */
  async function emisora(): Promise<string> {
    const lista = await llamar('get', 'tenants/razones-sociales');
    expect(lista.status).toBe(200);
    let razon = (lista.body as { id: string; nombre: string }[]).find(
      (r) => r.nombre === NOMBRE,
    );
    if (!razon) {
      const creada = await llamar('post', 'tenants/razones-sociales', {
        nombre: NOMBRE,
        rut: RUT,
        direccion: 'Av. Prueba 123',
        habilitado: true,
      });
      expect(creada.status).toBe(201);
      razon = creada.body as { id: string; nombre: string };
    }
    const preferida = await llamar(
      'patch',
      `tenants/razones-sociales/${razon.id}/preferida`,
    );
    expect(preferida.status).toBe(200);
    const datos = await llamar('patch', 'dte/perfil', {
      giro: 'Panadería',
      comuna: 'Ñuñoa',
      ambienteSii: 'certificacion',
      fechaResolucion: '2026-09-30',
      numeroResolucion: 0,
    });
    expect(datos.status).toBe(200);
    return razon.id;
  }

  async function subirCertificado(): Promise<void> {
    const cert = certificadoDePrueba();
    const res = await llamar('post', 'dte/certificado', {
      pfxBase64: cert.pfx.toString('base64'),
      clave: cert.clave,
    });
    expect(res.status).toBe(201);
  }

  async function subirCaf(
    tipo: number,
    rango: { desde: number; hasta: number },
  ): Promise<void> {
    const xml = cafDePrueba({ rut: RUT_SII, tipo, ...rango });
    const res = await llamar('post', 'dte/cafs', {
      xmlBase64: Buffer.from(xml, 'latin1').toString('base64'),
    });
    expect(res.status).toBe(201);
  }

  const emision = async (activa: boolean) => {
    const res = await llamar('patch', 'dte/emision', { activa });
    expect(res.status).toBe(200);
  };

  // ---- Base ------------------------------------------------------------------------------

  /** Lo que una corrida anterior (o este mismo spec) dejó en la razón social propia. */
  async function limpiar() {
    for (const tabla of ['dte_envios', 'dte_documentos', 'dte_cafs']) {
      await ds.query(
        `UPDATE ${tabla} SET eliminado_el = now()
          WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
        [razonSocialId],
      );
    }
  }

  async function limpiarCertificados() {
    await ds.query(
      `UPDATE dte_certificados
          SET credencial_cifrada = NULL, reemplazado_el = COALESCE(reemplazado_el, now())
        WHERE razon_social_id = $1
          AND (credencial_cifrada IS NOT NULL OR reemplazado_el IS NULL)`,
      [razonSocialId],
    );
  }

  /** CAF propios nuevos, sin documentos, y la emisión prendida: cada test parte de cero. */
  async function reiniciar(emisionPrendida = true): Promise<void> {
    await limpiar();
    await subirCaf(39, CAF39);
    await subirCaf(41, CAF41);
    await emision(emisionPrendida);
  }

  const siguienteFolio = async (tipo = 39): Promise<number> => {
    const [fila] = await ds.query<{ siguiente_folio: number }[]>(
      `SELECT siguiente_folio FROM dte_cafs
        WHERE razon_social_id = $1 AND tipo = $2 AND eliminado_el IS NULL`,
      [razonSocialId, tipo],
    );
    return fila.siguiente_folio;
  };

  const colaDte = () =>
    ds.query<FilaDte[]>(
      `SELECT documento_id, tipo, folio, estado, xml FROM dte_documentos
        WHERE razon_social_id = $1 AND eliminado_el IS NULL ORDER BY folio`,
      [razonSocialId],
    );

  const documentosDe = (ventaId: string) =>
    ds.query<FilaVentaDoc[]>(
      `SELECT documento_id, emisor, estado_envio, dte_documento_id,
              emision_error_codigo, emision_error, monto
         FROM venta_documentos
        WHERE venta_id = $1 AND eliminado_el IS NULL ORDER BY creado_el, documento_id`,
      [ventaId],
    );

  const boletaDelSistema = async (ventaId: string): Promise<FilaVentaDoc> => {
    const docs = (await documentosDe(ventaId)).filter(
      (d) => d.emisor === 'sistema',
    );
    expect(docs).toHaveLength(1);
    return docs[0];
  };

  const xmlDe = async (ventaId: string): Promise<string> => {
    const { dte_documento_id } = await boletaDelSistema(ventaId);
    expect(dte_documento_id).not.toBeNull();
    const [fila] = await ds.query<{ xml: string }[]>(
      `SELECT xml FROM dte_documentos WHERE documento_id = $1`,
      [dte_documento_id],
    );
    return fila.xml;
  };

  const contarVentas = async (): Promise<number> => {
    const [fila] = await ds.query<{ n: string }[]>(
      `SELECT count(*) AS n FROM ventas WHERE tenant_id = $1`,
      [TENANT_ID],
    );
    return Number(fila.n);
  };

  const patchMetodo = async (metodoPagoId: string, emisor: string) => {
    const res = await llamar('patch', `metodos-pago/${metodoPagoId}`, {
      emisor,
    });
    expect(res.status).toBe(200);
  };
  const patchFacturador = async (facturador: string) => {
    const res = await llamar('patch', 'tenants/me', { facturador });
    expect(res.status).toBe(200);
  };

  // ---- Ventas ----------------------------------------------------------------------------

  const EFECTIVO_SOBRADO = [
    { metodoPagoId: EFECTIVO_ID, monto: '100000.0000' },
  ];

  /** `POST /ventas` del POS; devuelve la respuesta entera para mirar el status. */
  const vender = (body: Record<string, unknown>, clave = randomUUID()) =>
    llamar('post', 'ventas', { pagos: EFECTIVO_SOBRADO, ...body }, clave);

  async function venderOk(body: Record<string, unknown>): Promise<VentaRes> {
    const res = await vender(body);
    expect(res.status).toBe(201);
    return res.body as VentaRes;
  }

  /** Una cuenta de la mesa propia con las líneas dadas, lista para cerrar. */
  async function cuentaCon(
    lineas: { itemId: string; cantidad: string }[],
  ): Promise<string> {
    const cuenta = await crear(`mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    for (const l of lineas) await crear(`cuentas/${cuenta.id}/lineas`, l);
    return cuenta.id;
  }

  const cerrarCuenta = (cuentaId: string, pagos: object[]) =>
    llamar(
      'post',
      `cuentas/${cuentaId}/cerrar`,
      { garzonId: garzon.id, pin: garzon.pin, pagos },
      randomUUID(),
    );

  const estadoCuenta = async (cuentaId: string) => {
    const [fila] = await ds.query<
      { estado: string; venta_id: string | null }[]
    >(`SELECT estado, venta_id FROM cuentas WHERE cuenta_id = $1`, [cuentaId]);
    return fila;
  };

  const crearItem = (
    nombre: string,
    precioBase: string,
    extra: Record<string, unknown> = {},
  ) =>
    crear('items', {
      nombre: `${nombre} E2E boleta ${marca} ${randomUUID().slice(0, 4)}`,
      precioBase,
      monedaId: CLP,
      tipo: 'servicio',
      ...extra,
    }).then((r) => r.id);

  const crearDescuento = (valorPorcentaje: string) =>
    crear('descuentos', {
      nombre: `Boleta E2E ${randomUUID()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      activo: true,
      modo: 'porcentaje',
      valorPorcentaje,
    }).then((r) => r.id);

  // ---- Ciclo de vida ---------------------------------------------------------------------

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

    token = await loginParis();
    razonSocialId = await emisora();
    await limpiar();
    await limpiarCertificados();
    await subirCertificado();

    // Ítems propios: los servicios no mueven stock, y el stock del seed lo comparten todas las
    // suites. El granel es un producto, con su propio stock.
    itemAfecto = await crearItem('Afecto 5000', '5000', {
      precioIncluyeImpuesto: true,
    });
    itemExento = await crearItem('Exento 3000', '3000', {
      clasificacionTributaria: 'exento',
    });
    itemKg = await crearItem('Granel kg', '8000', {
      tipo: 'producto',
      unidadMedida: 'kg',
      stock: '100',
      costo: '2000',
    });

    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E boleta desde la venta',
    });

    // Garzón, salón y mesa propios: la sesión de un garzón es única y otras suites la comparten.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón boleta venta E2E ${marca}`,
    });
    await crear('sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón boleta venta E2E ${marca}`,
    });
    mesaId = (
      await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa boleta venta' })
    ).id;
  }, 90000);

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    // Acumular y afirmar DESPUÉS de `app.close()`: un expect que tira antes de cerrar deja el
    // pool abierto y jest no termina nunca.
    const fallos: string[] = [];
    const intentar = async (que: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        fallos.push(`${que}: ${(e as Error).message}`);
      }
    };
    try {
      // Lo primero: apagar la emisión y devolver los medios y el facturador al seed.
      await intentar('apagar la emisión', async () => {
        const res = await llamar('patch', 'dte/emision', { activa: false });
        if (res.status !== 200) throw new Error(`status ${res.status}`);
      });
      await intentar('facturador', () => patchFacturador('sistema'));
      await intentar('débito', () => patchMetodo(DEBITO_ID, 'sistema'));
      await intentar('crédito', () => patchMetodo(CREDITO_ID, 'sistema'));
      await intentar('limpiar la cola y los CAF', limpiar);
      await intentar('limpiar certificados', limpiarCertificados);
      // No hay una ruta que des-marque la preferida, y las otras suites no esperan una.
      await intentar('preferida', () =>
        ds.query(
          `UPDATE razones_sociales SET preferida = false WHERE razon_social_id = $1`,
          [razonSocialId],
        ),
      );
      await intentar('sesión del garzón', async () => {
        const res = await llamar('post', 'sesiones-garzon/cerrar', {
          garzonId: garzon.id,
          pin: garzon.pin,
        });
        if (![200, 201].includes(res.status))
          throw new Error(`status ${res.status}`);
      });
      await intentar('cerrar caja', () => cerrarCaja(app, token, caja));

      // Paris como se encontró: lo comparten dte-cola y dte-folios.
      const [estado] = await ds.query<{ emite: boolean; facturador: string }[]>(
        `SELECT emite_boleta_electronica AS emite, facturador FROM tenants WHERE tenant_id = $1`,
        [TENANT_ID],
      );
      if (estado.emite) fallos.push('quedó la emisión prendida');
      if (estado.facturador !== 'sistema') fallos.push('quedó otro facturador');
      const [vivos] = await ds.query<{ n: string }[]>(
        `SELECT (SELECT count(*) FROM dte_cafs WHERE razon_social_id = $1 AND eliminado_el IS NULL)
              + (SELECT count(*) FROM dte_envios WHERE razon_social_id = $1 AND eliminado_el IS NULL)
              + (SELECT count(*) FROM dte_documentos WHERE razon_social_id = $1 AND eliminado_el IS NULL)
              + (SELECT count(*) FROM dte_certificados WHERE razon_social_id = $1
                  AND credencial_cifrada IS NOT NULL) AS n`,
        [razonSocialId],
      );
      if (Number(vivos.n) !== 0)
        fallos.push('quedaron CAF, certificados, envíos o documentos');
      const [preferida] = await ds.query<{ preferida: boolean }[]>(
        `SELECT preferida FROM razones_sociales WHERE razon_social_id = $1`,
        [razonSocialId],
      );
      if (preferida.preferida) fallos.push('quedó la razón social preferida');
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  // ---- El POS ----------------------------------------------------------------------------

  it('POS: la respuesta trae el folio, el documento queda emitido y la boleta en la cola', async () => {
    await reiniciar();

    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    expect(venta.estado).toBe('pagada');
    expect(venta.boleta.boletaSinEmitir).toBeNull();
    expect(venta.boleta.boletaElectronica).toEqual({
      tipo: 39,
      folio: CAF39.desde,
      monto: '5000.0000',
      cubreTodo: true,
      ambiente: 'certificacion',
      resolucion: { numero: 0, fecha: '2026-09-30' },
      emisor: {
        rut: RUT_SII,
        razonSocial: NOMBRE,
        giro: 'Panadería',
        direccion: 'Av. Prueba 123',
        comuna: 'Ñuñoa',
      },
    });

    const doc = await boletaDelSistema(venta.id);
    expect(doc).toMatchObject({
      estado_envio: 'emitido',
      emision_error_codigo: null,
      emision_error: null,
    });
    const cola = await colaDte();
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({
      documento_id: doc.dte_documento_id,
      tipo: 39,
      folio: CAF39.desde,
      estado: 'pendiente',
    });
    expect(await siguienteFolio()).toBe(CAF39.desde + 1);
  });

  it('el IVA de la línea sale de ventas_impuestos: una línea afecta sin descuento no lleva DescuentoMonto ni RecargoMonto', async () => {
    // Si el JOIN a `impuestos` fallara y la tasa saliera 0, el precio unitario quedaría en el
    // neto y la diferencia con el total de la línea aparecería como RecargoMonto: el motor
    // acepta la boleta igual (la igualdad cierra por construcción), así que la prueba es esta.
    await reiniciar();

    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    const xml = await xmlDe(venta.id);
    expect(xml).toContain('<PrcItem>');
    expect(xml).not.toContain('<DescuentoMonto>');
    expect(xml).not.toContain('<RecargoMonto>');
    expect(xml).toContain('<MntTotal>5000</MntTotal>');
    expect(xml).toContain('<TipoDTE>39</TipoDTE>');
    expect(xml).toContain(`<Folio>${CAF39.desde.toString()}</Folio>`);
    expect(xml).toContain(`<RUTEmisor>${RUT_SII}</RUTEmisor>`);
  });

  it('el mismo cobro con la misma clave devuelve el mismo folio y consume uno solo', async () => {
    await reiniciar();
    const clave = randomUUID();
    const cuerpo = { lineas: [{ itemId: itemAfecto, cantidad: '1' }] };

    const primera = await vender(cuerpo, clave);
    const segunda = await vender(cuerpo, clave);

    expect([primera.status, segunda.status]).toEqual([201, 201]);
    const a = primera.body as VentaRes;
    const b = segunda.body as VentaRes;
    expect(b.id).toBe(a.id);
    expect(b.boleta.boletaElectronica?.folio).toBe(CAF39.desde);
    expect(b.boleta.boletaElectronica).toEqual(a.boleta.boletaElectronica);
    expect(await siguienteFolio()).toBe(CAF39.desde + 1);
    expect(await colaDte()).toHaveLength(1);
  });

  it('con el interruptor apagado la boleta queda armada: sin folio, sin fila en la cola y boletaElectronica null', async () => {
    await reiniciar(false);

    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    expect(venta.boleta.boletaElectronica).toBeNull();
    expect(venta.boleta.boletaSinEmitir).toBeNull();
    expect(await boletaDelSistema(venta.id)).toMatchObject({
      estado_envio: 'armado',
      dte_documento_id: null,
    });
    expect(await colaDte()).toEqual([]);
    expect(await siguienteFolio()).toBe(CAF39.desde);
  });

  it('una factura del sistema queda armada aunque el interruptor esté prendido', async () => {
    await reiniciar();

    const venta = await venderOk({
      tipoDocumentoId: FACTURA_ID,
      customer: {
        nombre: 'Comercial Andes SpA',
        rut: '76.123.456-0',
        giro: 'Venta de artículos de ferretería',
        direccion: 'Av. Matta 1234',
        comuna: 'Santiago',
      },
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    expect(venta.boleta.boletaElectronica).toBeNull();
    expect(await boletaDelSistema(venta.id)).toMatchObject({
      estado_envio: 'armado',
    });
    expect(await colaDte()).toEqual([]);
    expect(await siguienteFolio()).toBe(CAF39.desde);
  });

  it('lo que debe un comercio con facturador externo lo documenta el de afuera: el sistema no emite', async () => {
    await reiniciar();
    await patchFacturador('externo');
    try {
      // Sin pagos la deuda se documenta según el facturador (el efectivo, en cambio, lo
      // documenta siempre el sistema, que es el emisor de ese medio).
      const venta = await venderOk({
        lineas: [{ itemId: itemAfecto, cantidad: '1' }],
        pagos: [],
      });

      expect(venta.boleta.boletaElectronica).toBeNull();
      expect((await documentosDe(venta.id)).map((d) => d.emisor)).toEqual([
        'externo',
      ]);
      expect(await colaDte()).toEqual([]);
      expect(await siguienteFolio()).toBe(CAF39.desde);
    } finally {
      await patchFacturador('sistema');
    }
  });

  it('todo exento sale como boleta exenta (41) con el folio de su CAF', async () => {
    await reiniciar();

    const venta = await venderOk({
      lineas: [{ itemId: itemExento, cantidad: '1' }],
    });

    expect(venta.boleta.boletaElectronica).toMatchObject({
      tipo: 41,
      folio: CAF41.desde,
      monto: '3000.0000',
    });
    expect(await siguienteFolio(41)).toBe(CAF41.desde + 1);
    expect(await siguienteFolio(39)).toBe(CAF39.desde);
  });

  it('sin folios: la venta entra (201), el documento queda sin_emitir con SIN_FOLIOS y no se mueve nada', async () => {
    await reiniciar();
    // Agotar el CAF por SQL equivale a haber vendido sus 200 folios, sin hacerlo.
    await ds.query(
      `UPDATE dte_cafs SET siguiente_folio = hasta + 1
        WHERE razon_social_id = $1 AND tipo = 39 AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    const antes = await siguienteFolio();

    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    expect(venta.estado).toBe('pagada');
    expect(venta.boleta.boletaElectronica).toBeNull();
    expect(venta.boleta.boletaSinEmitir?.mensaje).toContain(
      'No quedan folios de tipo 39',
    );
    expect(await boletaDelSistema(venta.id)).toMatchObject({
      estado_envio: 'sin_emitir',
      dte_documento_id: null,
      emision_error_codigo: 'SIN_FOLIOS',
    });
    expect(await colaDte()).toEqual([]);
    expect(await siguienteFolio()).toBe(antes);
  });

  it('un DteError DESPUÉS de tomar el folio (sin certificado): la venta entra, sin_emitir, y el folio ya tomado vuelve', async () => {
    await reiniciar();
    // `tomarFolio` sale bien y consume el 5001; `credencialesParaFirmar` falla recién después.
    // Sin el savepoint el folio quedaría consumido en la transacción que sí se confirma: un
    // hueco que habría que anular ante el SII.
    await limpiarCertificados();
    try {
      const venta = await venderOk({
        lineas: [{ itemId: itemAfecto, cantidad: '1' }],
      });

      expect(venta.boleta.boletaElectronica).toBeNull();
      expect(venta.boleta.boletaSinEmitir?.mensaje).toContain('certificado');
      expect(await boletaDelSistema(venta.id)).toMatchObject({
        estado_envio: 'sin_emitir',
        emision_error_codigo: 'SIN_CERTIFICADO',
      });
      expect(await colaDte()).toEqual([]);
      expect(await siguienteFolio()).toBe(CAF39.desde);
    } finally {
      await subirCertificado();
    }
  });

  it('un error que no es de la emisión (la cola se cae) tumba la venta: no se traga como sin_emitir', async () => {
    await reiniciar();
    jest
      .spyOn(app.get(ColaDteService), 'encolar')
      .mockRejectedValueOnce(new Error('cola caída'));
    const ventasAntes = await contarVentas();

    const res = await vender({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    expect(res.status).toBe(500);
    expect(await contarVentas()).toBe(ventasAntes);
    expect(await colaDte()).toEqual([]);
    expect(await siguienteFolio()).toBe(CAF39.desde);
  });

  it('una venta que se cae DESPUÉS de emitir: 500, ni venta ni boleta en la cola, y el folio vuelve', async () => {
    await reiniciar();
    const ventas = app.get(VentasService);
    // `armarBoleta` corre después de la emisión, en la misma transacción.
    jest
      .spyOn(ventas, 'armarBoleta')
      .mockRejectedValueOnce(new Error('falla de prueba'));
    const ventasAntes = await contarVentas();
    const clave = randomUUID();
    const cuerpo = { lineas: [{ itemId: itemAfecto, cantidad: '1' }] };

    const caida = await vender(cuerpo, clave);

    expect(caida.status).toBe(500);
    expect(await contarVentas()).toBe(ventasAntes);
    expect(await colaDte()).toEqual([]);
    expect(await siguienteFolio()).toBe(CAF39.desde);

    // El reintento con la misma clave (el reclamo también volvió) toma ESE folio.
    const reintento = await vender(cuerpo, clave);
    expect(reintento.status).toBe(201);
    expect((reintento.body as VentaRes).boleta.boletaElectronica?.folio).toBe(
      CAF39.desde,
    );
    expect(await siguienteFolio()).toBe(CAF39.desde + 1);
  });

  it('10 ventas en paralelo: 10 folios distintos y consecutivos, y 10 boletas en la cola', async () => {
    await reiniciar();

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () =>
        vender({ lineas: [{ itemId: itemAfecto, cantidad: '1' }] }),
      ),
    );

    expect(respuestas.map((r) => r.status)).toEqual(Array(10).fill(201));
    const folios = respuestas
      .map((r) => (r.body as VentaRes).boleta.boletaElectronica?.folio)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(folios).toEqual(
      Array.from({ length: 10 }, (_, i) => CAF39.desde + i),
    );
    expect((await colaDte()).map((d) => d.folio)).toEqual(folios);
    expect(await siguienteFolio()).toBe(CAF39.desde + 10);
  }, 60000);

  // ---- Lo que la regla del motor hace difícil --------------------------------------------

  it('una venta que dos descuentos dejan en $0 sale emitida por $0, con el descuento (Review Focus 1)', async () => {
    await reiniciar();
    const itemCero = await crearItem('Cero 5000', '5000', {
      precioIncluyeImpuesto: true,
      descuentosIds: [await crearDescuento('0.6'), await crearDescuento('0.6')],
    });

    const venta = await venderOk({
      lineas: [{ itemId: itemCero, cantidad: '1' }],
      pagos: [],
    });

    expect(venta.estado).toBe('pagada');
    expect(venta.boleta.boletaElectronica).toMatchObject({
      tipo: 39,
      folio: CAF39.desde,
      monto: '0.0000',
    });
    expect(await boletaDelSistema(venta.id)).toMatchObject({
      estado_envio: 'emitido',
    });
    const xml = await xmlDe(venta.id);
    expect(xml).toContain('<MntTotal>0</MntTotal>');
    expect(xml).toContain('<DescuentoMonto>');
  });

  it('descuento de línea + descuento de venta + una línea a granel (0,375 kg): la boleta sale (Review Focus 2)', async () => {
    await reiniciar();
    const itemConDescuento = await crearItem('Con descuento 10000', '10000', {
      precioIncluyeImpuesto: true,
      descuentosIds: [await crearDescuento('0.1')],
    });

    const venta = await venderOk({
      lineas: [
        { itemId: itemConDescuento, cantidad: '1' },
        { itemId: itemKg, cantidad: '0.375' },
      ],
      descuentosVentaIds: [DESCUENTO_FIJO_VENTA_ID],
    });

    expect(venta.boleta.boletaSinEmitir).toBeNull();
    expect(venta.boleta.boletaElectronica).toMatchObject({
      tipo: 39,
      folio: CAF39.desde,
    });
    // 9.000 + 3.000 − 5.000 de descuento de venta.
    expect(venta.boleta.boletaElectronica?.cubreTodo).toBe(true);
    const xml = await xmlDe(venta.id);
    expect(xml).toMatch(/<QtyItem>0\.375/);
    expect(xml).toContain('<DescuentoMonto>');
  });

  it('pago mixto con un medio de la máquina: la boleta del sistema cubre el saldo, con la línea "Saldo de la venta"', async () => {
    await reiniciar();
    await patchMetodo(CREDITO_ID, 'maquina');
    try {
      // 10.000: 4.000 en efectivo (lo documenta el sistema) y 6.000 con la máquina.
      const venta = await venderOk({
        lineas: [{ itemId: itemAfecto, cantidad: '2' }],
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '4000' },
          { metodoPagoId: CREDITO_ID, monto: '6000' },
        ],
      });

      expect(venta.boleta.boletaElectronica).toMatchObject({
        folio: CAF39.desde,
        monto: '4000.0000',
        cubreTodo: false,
      });
      const xml = await xmlDe(venta.id);
      expect(xml).toContain('<NmbItem>Saldo de la venta</NmbItem>');
      expect(xml).toContain('<MntTotal>4000</MntTotal>');
      // El voucher de la máquina no es una boleta nuestra: un solo folio.
      expect(await colaDte()).toHaveLength(1);
      expect(
        (await documentosDe(venta.id)).map((d) => d.emisor).sort(),
      ).toEqual(['maquina', 'sistema']);
    } finally {
      await patchMetodo(CREDITO_ID, 'sistema');
    }
  });

  it('sobre el umbral de 135 UF con pago mixto: el MedioPago es el del pago de ESA boleta (efectivo), no el mayor de la venta', async () => {
    await reiniciar();
    await patchMetodo(CREDITO_ID, 'maquina');
    try {
      // 1.100 × 5.000 = 5.500.000, sobre el umbral de 2026 (5.363.274,60). El pago de la máquina
      // (4.000.000, medio 2) es el MAYOR de la venta; el efectivo (1.500.000, medio 1) es el
      // único pago de la boleta del sistema. Si los pagos se leyeran por venta y no por
      // documento, o se colara el de la máquina, saldría MedioPago 2.
      const venta = await venderOk({
        lineas: [{ itemId: itemAfecto, cantidad: '1100' }],
        customer: { nombre: 'Cliente Grande', rut: '11.111.111-1' },
        pagos: [
          { metodoPagoId: CREDITO_ID, monto: '4000000' },
          { metodoPagoId: EFECTIVO_ID, monto: '1500000' },
        ],
      });

      expect(venta.boleta.boletaSinEmitir).toBeNull();
      expect(venta.boleta.boletaElectronica).toMatchObject({
        folio: CAF39.desde,
        monto: '1500000.0000',
        cubreTodo: false,
      });
      const xml = await xmlDe(venta.id);
      expect(xml).toContain('<MedioPago>1</MedioPago>');
      expect(xml).toContain('<RUTRecep>11111111-1</RUTRecep>');
      expect(xml).toContain('<NmbItem>Saldo de la venta</NmbItem>');
      expect(xml).toContain('<MntTotal>1500000</MntTotal>');
    } finally {
      await patchMetodo(CREDITO_ID, 'sistema');
    }
  });

  // ---- Cierre de mesa --------------------------------------------------------------------

  it('cierre de mesa con folios: la cuenta cierra y la boleta sale emitida', async () => {
    await reiniciar();
    const cuentaId = await cuentaCon([{ itemId: itemAfecto, cantidad: '1' }]);

    const res = await cerrarCuenta(cuentaId, EFECTIVO_SOBRADO);

    expect(res.status).toBe(201);
    const cierre = res.body as { ventaId: string; boleta: BoletaRes };
    expect(cierre.boleta.boletaElectronica?.folio).toBe(CAF39.desde);
    expect(await boletaDelSistema(cierre.ventaId)).toMatchObject({
      estado_envio: 'emitido',
    });
    expect((await estadoCuenta(cuentaId)).estado).toBe('cerrada');
  });

  it('cierre de mesa con el CAF agotado: la cuenta queda cerrada, la venta creada y la boleta sin emitir (Review Focus 3)', async () => {
    await reiniciar();
    await ds.query(
      `UPDATE dte_cafs SET siguiente_folio = hasta + 1
        WHERE razon_social_id = $1 AND tipo = 39 AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    const cuentaId = await cuentaCon([{ itemId: itemAfecto, cantidad: '1' }]);

    const res = await cerrarCuenta(cuentaId, EFECTIVO_SOBRADO);

    expect(res.status).toBe(201);
    const cierre = res.body as { ventaId: string; boleta: BoletaRes };
    expect(cierre.boleta.boletaElectronica).toBeNull();
    expect(cierre.boleta.boletaSinEmitir?.mensaje).toContain(
      'No quedan folios',
    );
    const cuenta = await estadoCuenta(cuentaId);
    expect(cuenta).toEqual({ estado: 'cerrada', venta_id: cierre.ventaId });
    expect(await boletaDelSistema(cierre.ventaId)).toMatchObject({
      estado_envio: 'sin_emitir',
      emision_error_codigo: 'SIN_FOLIOS',
    });
  });

  it('la mesa que paga una parte: la boleta del sistema por lo no pagado se emite igual al cerrar (Review Focus 4)', async () => {
    await reiniciar();
    await patchMetodo(DEBITO_ID, 'maquina');
    try {
      const cuentaId = await cuentaCon([{ itemId: itemAfecto, cantidad: '2' }]);

      // 10.000 de cuenta; paga 4.000 con la máquina y debe 6.000.
      const res = await cerrarCuenta(cuentaId, [
        { metodoPagoId: DEBITO_ID, monto: '4000' },
      ]);

      expect(res.status).toBe(201);
      const cierre = res.body as {
        ventaId: string;
        boleta: BoletaRes;
      };
      const [venta] = await ds.query<{ estado: string }[]>(
        `SELECT estado FROM ventas WHERE venta_id = $1`,
        [cierre.ventaId],
      );
      expect(venta.estado).toBe('pagada_parcial');
      expect(cierre.boleta.boletaElectronica).toMatchObject({
        folio: CAF39.desde,
        monto: '6000.0000',
        cubreTodo: false,
      });
      expect(await xmlDe(cierre.ventaId)).toContain(
        '<NmbItem>Saldo de la venta</NmbItem>',
      );
    } finally {
      await patchMetodo(DEBITO_ID, 'sistema');
    }
  });

  // ---- Tienda online y suscripciones -----------------------------------------------------

  it('el callback de la tienda online crea la venta con su boleta emitida', async () => {
    await reiniciar();
    const factory = app.get(ProviderFactory);
    jest.spyOn(factory, 'getPagoRedirect').mockReturnValue({
      iniciarPago: (_cred: unknown, p: { codigoOrden: string }) =>
        Promise.resolve({
          tokenExterno: `tok-boleta-${p.codigoOrden}`,
          urlRedireccion: 'https://webpay.falso/iniciar',
          aprobada: true,
          codigoRespuesta: null,
          request: {},
          response: {},
        }),
      confirmarPago: () =>
        Promise.resolve({
          aprobada: true,
          codigoRespuesta: '0',
          codigoAutorizacion: '1213',
          identificadorTransaccionExterno: null,
          tipoPago: 'VN',
          numeroCuotas: 0,
          montoCuota: null,
          tarjetaUltimos4: '6623',
          request: {},
          response: {},
        }),
    } as never);

    const pagar = await llamar('post', 'online/pagar', {
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });
    expect(pagar.status).toBe(201);
    const { ordenId } = pagar.body as { ordenId: string };
    const [orden] = await ds.query<{ token_proveedor: string }[]>(
      `SELECT token_proveedor FROM pasarela_ordenes WHERE orden_id = $1`,
      [ordenId],
    );
    const retorno = await request(app.getHttpServer()).get(
      `/api/pasarela/retorno/pago?token_ws=${orden.token_proveedor}`,
    );
    expect(retorno.status).toBe(302);

    const [conciliada] = await ds.query<
      { estado: string; venta_id: string | null }[]
    >(`SELECT estado, venta_id FROM pasarela_ordenes WHERE orden_id = $1`, [
      ordenId,
    ]);
    expect(conciliada.estado).toBe('conciliada');
    expect(conciliada.venta_id).not.toBeNull();
    expect(await boletaDelSistema(conciliada.venta_id!)).toMatchObject({
      estado_envio: 'emitido',
    });
    expect((await colaDte()).map((d) => d.folio)).toEqual([CAF39.desde]);
  });

  it('el alta de una suscripción crea la venta inicial con su boleta emitida', async () => {
    await reiniciar();
    const proveedor = {
      autorizarCobro: () =>
        Promise.resolve({
          aprobada: true,
          codigoRespuesta: '0',
          codigoAutorizacion: '1213',
          identificadorTransaccionExterno: null,
          tipoPago: 'VN',
          numeroCuotas: 0,
          montoCuota: null,
          tarjetaUltimos4: '6623',
          request: {},
          response: {},
        }),
      consultarEstado: () => Promise.reject(new Error('no se consulta')),
    };
    const factory = app.get(ProviderFactory);
    jest.spyOn(factory, 'getTokenizado').mockReturnValue(proveedor as never);
    jest.spyOn(factory, 'getReembolsable').mockReturnValue(proveedor as never);
    const tbkUser = app
      .get(CredencialesService)
      .cifrarTexto('tbk-user-e2e-boleta');
    jest
      .spyOn(app.get(InscripcionesService), 'resolverMedioDeUsuario')
      .mockResolvedValue({ marca: 'Visa', ultimos4: '6623' } as never);
    jest
      .spyOn(app.get(InscripcionesService), 'resolverParaCobro')
      .mockImplementation(((
        _t: string,
        inscripcionId: string,
        pagadorRef: string,
      ) =>
        Promise.resolve({
          inscripcionId,
          pagadorRef,
          identificadorUsuarioExterno: 'cliente-e2e',
          identificadorExterno: tbkUser,
        })) as never);
    const pasarela = app.get(TenantPasarelaService);
    jest.spyOn(pasarela, 'resolverConfiguracionActiva').mockResolvedValue({
      tenantPasarela: { tenantPasarelaId: randomUUID() },
      pasarela: { codigo: 'oneclick' },
      cred: {},
    } as never);
    jest.spyOn(pasarela, 'resolverPorId').mockResolvedValue({
      pasarela: { codigo: 'oneclick' },
      cred: {},
    } as never);

    const res = await llamar(
      'post',
      'suscripciones',
      { itemId: PLAN_MENSUAL_DEMO, diaMes: 5, inscripcionId: randomUUID() },
      randomUUID(),
    );

    expect(res.status).toBe(201);
    const { ventaInicialId } = res.body as { ventaInicialId: string };
    expect(await boletaDelSistema(ventaInicialId)).toMatchObject({
      estado_envio: 'emitido',
    });
    expect((await colaDte()).map((d) => d.folio)).toEqual([CAF39.desde]);
  });

  // ---- Reimpresión -----------------------------------------------------------------------

  it('GET /ventas/:id/boleta de una venta emitida devuelve la misma boletaElectronica que el cobro', async () => {
    await reiniciar();
    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    const res = await llamar('get', `ventas/${venta.id}/boleta`);

    expect(res.status).toBe(200);
    const reimpresa = res.body as BoletaRes;
    expect(reimpresa.boletaElectronica).toEqual(venta.boleta.boletaElectronica);
    expect(reimpresa.boletaElectronica?.folio).toBe(CAF39.desde);
    expect(reimpresa.boletaSinEmitir).toBeNull();
  });

  it('GET /ventas/:id/boleta de una venta sin emitir trae el motivo', async () => {
    await reiniciar();
    await ds.query(
      `UPDATE dte_cafs SET siguiente_folio = hasta + 1
        WHERE razon_social_id = $1 AND tipo = 39 AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    const res = await llamar('get', `ventas/${venta.id}/boleta`);

    expect(res.status).toBe(200);
    const reimpresa = res.body as BoletaRes;
    expect(reimpresa.boletaElectronica).toBeNull();
    expect(reimpresa.boletaSinEmitir).toEqual(venta.boleta.boletaSinEmitir);
  });
});
