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
 * Emitir después (spec § 5, § 8.1): el botón `POST /dte/emitir-pendientes`, la lista
 * `GET /dte/boletas-sin-emitir` y el aviso del cajero `GET /dte/estado-emision`. Esos casos parten
 * de `reiniciarLimpio`: el botón emite TODAS las `sin_emitir` del tenant, y las que dejaron los
 * otros tests (o corridas anteriores) no son de este caso, así que las descarta por SQL.
 *
 * Callback de la tienda y alta de suscripción corren de verdad (con el proveedor de pago
 * simulado por `jest.spyOn` sobre los servicios de la app, que `restoreAllMocks` suelta).
 */
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
/** El vendedor/cajero del seed (rol `Vendedor`): vende, no administra el tenant. */
const CAJERO = { email: 'vendedor@paris.cl', password: 'admin' };
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
// El único miembro sembrado de Falabella es el superadmin, con rol Administrador allá.
const ADMIN_FALABELLA = { email: 'admin@sistema.com', password: 'admin' };
const AVISO_NC =
  'La boleta de esta venta ya se emitió: la nota de crédito ante el SII hazla en su portal por ahora.';
const MOTIVO_ANULAR_EMITIDA =
  'La boleta ya se emitió: se revierte con una nota de crédito, no se anula.';
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

  async function loginComo(
    usuario: {
      email: string;
      password: string;
    },
    tenantId = TENANT_ID,
  ): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(usuario);
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
  const loginParis = () => loginComo(ADMIN);

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

  /** Descarta las `sin_emitir` que hayan quedado (de otros tests o de corridas anteriores). */
  const descartarSinEmitir = () =>
    ds.query(
      // Lo mismo que hace la anulación con un documento armado (`armado_sin_enviar`), sin tocar
      // la venta: así el botón y el conteo del tenant solo ven las ventas del test.
      `UPDATE venta_documentos
          SET descarte = 'armado_sin_enviar', descartado_el = now(), actualizado_el = now()
        WHERE tenant_id = $1 AND estado_envio = 'sin_emitir'
          AND descarte IS NULL AND eliminado_el IS NULL`,
      [TENANT_ID],
    );

  /** `reiniciar` + el tenant sin boletas `sin_emitir` ajenas al test. */
  async function reiniciarLimpio(): Promise<void> {
    await descartarSinEmitir();
    await reiniciar();
  }

  /** Agotar el CAF por SQL equivale a haber vendido sus folios, sin hacerlo. */
  const agotarCaf39 = () =>
    ds.query(
      `UPDATE dte_cafs SET siguiente_folio = hasta + 1
        WHERE razon_social_id = $1 AND tipo = 39 AND eliminado_el IS NULL`,
      [razonSocialId],
    );

  /** Quita los CAF (el agotado) y sube uno nuevo de boletas: lo que hace el admin al "subir un CAF". */
  async function subirCafNuevo(): Promise<void> {
    await limpiar();
    await subirCaf(39, CAF39);
  }

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
      // Las ventas sin emitir de estos tests quedarían vivas en Paris: una suite o un Playwright
      // que prenda la emisión y pulse el botón las procesaría.
      await intentar('descartar las sin emitir', descartarSinEmitir);
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
      const [sinEmitirVivas] = await ds.query<{ n: string }[]>(
        `SELECT count(*) AS n FROM venta_documentos
          WHERE tenant_id = $1 AND estado_envio = 'sin_emitir'
            AND descarte IS NULL AND eliminado_el IS NULL`,
        [TENANT_ID],
      );
      if (Number(sinEmitirVivas.n) !== 0)
        fallos.push('quedaron documentos sin_emitir vivos en Paris');
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

  // ---- Emitir después --------------------------------------------------------------------

  interface PendienteRes {
    ventaId: string;
    fecha: string;
    monto: string;
    codigo: string;
    mensaje: string;
    grupo: 'perfil' | 'boleta';
  }
  interface EstadoEmisionRes {
    activa: boolean;
    avisos: { codigo: string; mensaje: string }[];
    sinEmitir: number;
    conProblemas: number;
  }
  interface DetalleRes {
    documentos: {
      id: string;
      ventaId: string;
      emisor: string;
      estadoEnvio: string | null;
      folio: number | null;
      estadoSii: string | null;
      emisionError: string | null;
      ncElectronicaPendiente: boolean;
      descarte: string | null;
    }[];
  }

  const botonCon = (t: string) =>
    request(app.getHttpServer())
      .post('/api/dte/emitir-pendientes')
      .set('Authorization', `Bearer ${t}`);
  const getCon = (t: string, ruta: string) =>
    request(app.getHttpServer())
      .get(`/api/${ruta}`)
      .set('Authorization', `Bearer ${t}`);
  const detalleDe = async (ventaId: string): Promise<DetalleRes> => {
    const res = await llamar('get', `ventas/${ventaId}`);
    expect(res.status).toBe(200);
    return res.body as DetalleRes;
  };

  /** Ninguna de estas rutas puede devolver un XML, una llave ni un blob cifrado. */
  const sinBlobs = (res: { text: string }) => {
    expect(res.text).not.toMatch(/xml/i);
    expect(res.text).not.toContain('BEGIN');
    expect(res.text).not.toMatch(/cifrad/i);
  };

  const hoyChile = async (): Promise<string> => {
    const [f] = await ds.query<{ d: string }[]>(
      `SELECT to_char(now() AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD') AS d`,
    );
    return f.d;
  };
  const fechaVentaChile = async (ventaId: string): Promise<string> => {
    const [f] = await ds.query<{ d: string }[]>(
      `SELECT to_char(creado_el AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD') AS d
         FROM ventas WHERE venta_id = $1`,
      [ventaId],
    );
    return f.d;
  };

  it('con el CAF agotado la lista trae las 3 ventas; el botón no corta con SIN_FOLIOS (las anota las 3) y, con un CAF nuevo, emite las 3 con la fecha de su venta', async () => {
    await reiniciarLimpio();
    await agotarCaf39();
    const v1 = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });
    const v2 = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '2' }],
    });
    const v3 = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '3' }],
    });
    // La fecha de la boleta es la de la VENTA, no la de hoy: la primera cayó ayer.
    await ds.query(
      `UPDATE ventas SET creado_el = creado_el - interval '1 day' WHERE venta_id = $1`,
      [v1.id],
    );

    const lista = await llamar('get', 'dte/boletas-sin-emitir');
    expect(lista.status).toBe(200);
    sinBlobs(lista);
    const filas = lista.body as PendienteRes[];
    // Del más viejo al más nuevo (por cuándo se armó la boleta).
    expect(filas.map((f) => f.ventaId)).toEqual([v1.id, v2.id, v3.id]);
    expect(filas.map((f) => f.monto)).toEqual([
      '5000.0000',
      '10000.0000',
      '15000.0000',
    ]);
    for (const f of filas) {
      expect(f.codigo).toBe('SIN_FOLIOS');
      expect(f.grupo).toBe('perfil');
      expect(f.mensaje).toContain('No quedan folios de tipo 39');
      expect(Number.isNaN(Date.parse(f.fecha))).toBe(false);
    }

    // Sin folios NO corta (R7): los folios son por tipo y la siguiente puede ser de otro; acá las
    // 3 son del mismo tipo, así que las 3 fallan y las 3 quedan anotadas, en orden.
    const sinCaf = await botonCon(token);
    expect(sinCaf.status).toBe(201);
    sinBlobs(sinCaf);
    expect(sinCaf.body).toEqual({
      emitidas: 0,
      pendientes: 3,
      errores: [v1, v2, v3].map((v) => ({
        ventaId: v.id,
        codigo: 'SIN_FOLIOS',
        mensaje: expect.stringContaining('No quedan folios de tipo 39'),
      })),
    });
    expect(await colaDte()).toEqual([]);

    await subirCafNuevo();
    const emitidas = await botonCon(token);
    expect(emitidas.status).toBe(201);
    sinBlobs(emitidas);
    expect(emitidas.body).toEqual({ emitidas: 3, pendientes: 0, errores: [] });

    for (const [i, v] of [v1, v2, v3].entries()) {
      expect(await boletaDelSistema(v.id)).toMatchObject({
        estado_envio: 'emitido',
        emision_error_codigo: null,
        emision_error: null,
      });
      const xml = await xmlDe(v.id);
      expect(xml).toContain(`<Folio>${(CAF39.desde + i).toString()}</Folio>`);
      expect(xml).toContain(
        `<FchEmis>${await fechaVentaChile(v.id)}</FchEmis>`,
      );
    }
    expect(await fechaVentaChile(v1.id)).not.toBe(await hoyChile());
    expect((await colaDte()).map((d) => d.folio)).toEqual([
      CAF39.desde,
      CAF39.desde + 1,
      CAF39.desde + 2,
    ]);

    // Ya no hay nada: el botón es idempotente.
    const otraVez = await botonCon(token);
    expect(otraVez.status).toBe(201);
    expect(otraVez.body).toEqual({ emitidas: 0, pendientes: 0, errores: [] });
    expect((await getCon(token, 'dte/boletas-sin-emitir')).body).toEqual([]);
  });

  it('SIN_FOLIOS de un tipo no frena al otro: la exenta (sin CAF 41), más vieja, no impide que salgan las dos afectas (R7)', async () => {
    await reiniciarLimpio();
    // Sin ningún CAF: las tres quedan sin emitir por falta de folios, la exenta (41) primero.
    await ds.query(
      `UPDATE dte_cafs SET siguiente_folio = hasta + 1
        WHERE razon_social_id = $1 AND tipo IN (39, 41) AND eliminado_el IS NULL`,
      [razonSocialId],
    );
    const exenta = await venderOk({
      lineas: [{ itemId: itemExento, cantidad: '1' }],
    });
    const a1 = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });
    const a2 = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '2' }],
    });
    for (const v of [exenta, a1, a2]) {
      expect(await boletaDelSistema(v.id)).toMatchObject({
        estado_envio: 'sin_emitir',
        emision_error_codigo: 'SIN_FOLIOS',
      });
    }
    // Solo hay CAF de boletas afectas: el 41 sigue sin folios.
    await subirCafNuevo();

    const res = await botonCon(token);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      emitidas: 2,
      pendientes: 1,
      errores: [
        {
          ventaId: exenta.id,
          codigo: 'SIN_FOLIOS',
          mensaje: expect.stringContaining('tipo 41'),
        },
      ],
    });
    expect((await boletaDelSistema(a1.id)).estado_envio).toBe('emitido');
    expect((await boletaDelSistema(a2.id)).estado_envio).toBe('emitido');
    expect(await boletaDelSistema(exenta.id)).toMatchObject({
      estado_envio: 'sin_emitir',
      emision_error_codigo: 'SIN_FOLIOS',
    });
    expect((await colaDte()).map((d) => [d.tipo, d.folio])).toEqual([
      [39, CAF39.desde],
      [39, CAF39.desde + 1],
    ]);
  });

  it('una boleta con un error propio (un impuesto adicional) no corta: las demás salen y su motivo queda en la lista', async () => {
    await reiniciarLimpio();
    const ila = await crear('impuestos', {
      nombre: `ILA e2e boleta ${randomUUID()}`,
      porcentaje: '0.10',
    });
    const itemIla = await crearItem('Con adicional', '1000', {
      clasificacionTributaria: 'afecto',
      impuestosIds: [ila.id],
    });
    await agotarCaf39();
    // La del impuesto adicional va PRIMERA: si cortara, las otras dos quedarían sin salir.
    const conIla = await venderOk({
      lineas: [{ itemId: itemIla, cantidad: '1' }],
    });
    const v2 = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });
    const v3 = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '2' }],
    });
    await subirCafNuevo();

    const res = await botonCon(token);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      emitidas: 2,
      pendientes: 1,
      errores: [
        {
          ventaId: conIla.id,
          codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO',
          mensaje: expect.any(String),
        },
      ],
    });
    expect((await boletaDelSistema(v2.id)).estado_envio).toBe('emitido');
    expect((await boletaDelSistema(v3.id)).estado_envio).toBe('emitido');
    expect(await boletaDelSistema(conIla.id)).toMatchObject({
      estado_envio: 'sin_emitir',
      emision_error_codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO',
    });
    // Los dos folios que salieron son consecutivos: el error de la primera no consumió ninguno.
    expect((await colaDte()).map((d) => d.folio)).toEqual([
      CAF39.desde,
      CAF39.desde + 1,
    ]);

    const lista = (await getCon(token, 'dte/boletas-sin-emitir'))
      .body as PendienteRes[];
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      ventaId: conIla.id,
      codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO',
      grupo: 'boleta',
    });
  });

  it('el botón sobre una venta que se anuló entre la lista y el bloqueo: la salta, no la emite (Review Focus 5)', async () => {
    await reiniciarLimpio();
    await agotarCaf39();
    // Una venta pendiente (sin pagos), anulable, que queda sin_emitir por falta de folios.
    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
      pagos: [],
    });
    expect((await boletaDelSistema(venta.id)).estado_envio).toBe('sin_emitir');
    // Con folios la boleta SÍ saldría: lo único que la frena es lo que pasa abajo.
    await subirCafNuevo();

    // Quien anula toma la fila de la venta (`FOR UPDATE`, como `cancelarUnaVez`) y la retiene.
    // Se hace en SQL desde un query runner propio y no por la ruta de anular: la ruta pide ese
    // mismo bloqueo desde otra conexión y esperaría al runner, que no podría soltar nunca.
    const runner = ds.createQueryRunner();
    let boton: Promise<request.Response> | undefined;
    try {
      await runner.connect();
      await runner.startTransaction();
      await runner.query(
        `SELECT venta_id FROM ventas WHERE venta_id = $1 FOR UPDATE`,
        [venta.id],
      );
      const [{ pid }]: { pid: number }[] = await runner.query(
        `SELECT pg_backend_pid() AS pid`,
      );

      boton = botonCon(token).then((r) => r);
      // El botón llega al bloqueo de la venta y espera: no la emitió por delante.
      let esperando = 0;
      for (let i = 0; i < 100 && esperando === 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const [{ n }] = await ds.query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
          [pid],
        );
        esperando = n;
      }
      expect(esperando).toBeGreaterThan(0);

      // La anulación gana: estado y descarte, como `cancelarUnaVez` y `descartarAlAnular`.
      await runner.query(
        `UPDATE ventas SET estado = 'cancelada', cancelada_el = now(), motivo_cancelacion = $2,
                actualizado_el = now()
          WHERE venta_id = $1`,
        [venta.id, 'Anulada mientras el botón esperaba'],
      );
      await runner.query(
        `UPDATE venta_documentos
            SET descarte = 'armado_sin_enviar', descartado_el = now(), actualizado_el = now()
          WHERE venta_id = $1 AND descarte IS NULL AND eliminado_el IS NULL`,
        [venta.id],
      );
      await runner.commitTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }

    const res = await boton;
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ emitidas: 0, pendientes: 0, errores: [] });
    expect(await boletaDelSistema(venta.id)).toMatchObject({
      estado_envio: 'sin_emitir',
      dte_documento_id: null,
    });
    expect(await colaDte()).toEqual([]);
    expect(await siguienteFolio()).toBe(CAF39.desde);
    // Nunca una venta cancelada con una boleta emitida.
    const [{ n }] = await ds.query<{ n: string }[]>(
      `SELECT count(*) AS n
         FROM ventas v JOIN venta_documentos d ON d.venta_id = v.venta_id
        WHERE v.venta_id = $1 AND v.estado = 'cancelada' AND d.estado_envio = 'emitido'`,
      [venta.id],
    );
    expect(Number(n)).toBe(0);
  });

  it('anular una boleta sin_emitir: 201 y queda descartada; una emitida: 400 con el motivo', async () => {
    await reiniciarLimpio();
    await agotarCaf39();
    const sinEmitir = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
      pagos: [],
    });
    await subirCafNuevo();
    // Con folios, una venta pendiente emite su boleta en el momento.
    const emitida = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
      pagos: [],
    });
    expect((await boletaDelSistema(emitida.id)).estado_envio).toBe('emitido');

    const anulada = await llamar('post', `ventas/${sinEmitir.id}/anular`, {
      motivo: 'Cargada por error al cliente',
    });
    expect(anulada.status).toBe(201);
    expect(await boletaDelSistema(sinEmitir.id)).toMatchObject({
      estado_envio: 'sin_emitir',
      dte_documento_id: null,
    });
    const [descartada] = await ds.query<{ descarte: string | null }[]>(
      `SELECT descarte FROM venta_documentos
        WHERE venta_id = $1 AND emisor = 'sistema' AND eliminado_el IS NULL`,
      [sinEmitir.id],
    );
    expect(descartada.descarte).toBe('armado_sin_enviar');
    // Descartada, ya no figura entre las que faltan emitir.
    expect((await getCon(token, 'dte/boletas-sin-emitir')).body).toEqual([]);

    const rechazada = await llamar('post', `ventas/${emitida.id}/anular`, {
      motivo: 'Cargada por error al cliente',
    });
    expect(rechazada.status).toBe(400);
    expect((rechazada.body as { message: string }).message).toBe(
      MOTIVO_ANULAR_EMITIDA,
    );
    expect((await boletaDelSistema(emitida.id)).estado_envio).toBe('emitido');
  });

  it('la nota de crédito sobre una venta emitida: 201 con el aviso, y el detalle marca su nota como pendiente', async () => {
    await reiniciarLimpio();
    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });
    const [{ pago_id }] = await ds.query<{ pago_id: string }[]>(
      `SELECT pago_id FROM pagos
        WHERE venta_id = $1 AND metodo_pago_id = $2 AND eliminado_el IS NULL`,
      [venta.id, EFECTIVO_ID],
    );
    const clave = randomUUID();
    const cuerpo = {
      monto: '1000',
      comentario: 'devolución parcial',
      devolucion: { pagoId: pago_id },
    };

    const nc = await llamar(
      'post',
      `ventas/${venta.id}/notas-credito`,
      cuerpo,
      clave,
    );

    expect(nc.status).toBe(201);
    expect(
      (nc.body as { avisoNcElectronica: string | null }).avisoNcElectronica,
    ).toBe(AVISO_NC);
    // El reintento con la misma clave reproduce la respuesta, aviso incluido.
    const repetida = await llamar(
      'post',
      `ventas/${venta.id}/notas-credito`,
      cuerpo,
      clave,
    );
    expect(repetida.status).toBe(201);
    expect(repetida.body).toMatchObject({
      repetida: true,
      avisoNcElectronica: AVISO_NC,
    });

    const { documentos } = await detalleDe(venta.id);
    const ncId = (nc.body as IdResponse).id;
    const boleta = documentos.find((d) => d.ventaId === venta.id)!;
    const delaNota = documentos.find((d) => d.ventaId === ncId)!;
    expect(boleta).toMatchObject({
      estadoEnvio: 'emitido',
      folio: CAF39.desde,
      estadoSii: 'pendiente',
      emisionError: null,
      ncElectronicaPendiente: false,
    });
    expect(delaNota).toMatchObject({
      emisor: 'sistema',
      ncElectronicaPendiente: true,
    });
  });

  it('la nota de crédito sobre una boleta que no se emitió (interruptor apagado) no trae aviso ni marca', async () => {
    await reiniciarLimpio();
    await emision(false);
    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });
    const [{ pago_id }] = await ds.query<{ pago_id: string }[]>(
      `SELECT pago_id FROM pagos
        WHERE venta_id = $1 AND metodo_pago_id = $2 AND eliminado_el IS NULL`,
      [venta.id, EFECTIVO_ID],
    );

    const nc = await llamar(
      'post',
      `ventas/${venta.id}/notas-credito`,
      {
        monto: '1000',
        comentario: 'devolución parcial',
        devolucion: { pagoId: pago_id },
      },
      randomUUID(),
    );

    expect(nc.status).toBe(201);
    expect(
      (nc.body as { avisoNcElectronica: string | null }).avisoNcElectronica,
    ).toBeNull();
    const { documentos } = await detalleDe(venta.id);
    expect(documentos.every((d) => !d.ncElectronicaPendiente)).toBe(true);
    expect(documentos.find((d) => d.ventaId === venta.id)).toMatchObject({
      estadoEnvio: 'armado',
      folio: null,
      estadoSii: null,
    });
  });

  it('el detalle de una boleta sin emitir trae su motivo', async () => {
    await reiniciarLimpio();
    await agotarCaf39();
    const venta = await venderOk({
      lineas: [{ itemId: itemAfecto, cantidad: '1' }],
    });

    const { documentos } = await detalleDe(venta.id);

    expect(documentos.find((d) => d.emisor === 'sistema')).toMatchObject({
      estadoEnvio: 'sin_emitir',
      folio: null,
      emisionError: expect.stringContaining('No quedan folios de tipo 39'),
      ncElectronicaPendiente: false,
    });
  });

  // ---- El aviso del cajero ---------------------------------------------------------------

  it('GET /dte/estado-emision: el cajero lo lee; con menos de 100 folios trae POCOS_FOLIOS y cuenta las sin emitir', async () => {
    await reiniciarLimpio();
    const tokenCajero = await loginComo(CAJERO);
    // Quedan 51 folios de 200.
    await ds.query(
      `UPDATE dte_cafs SET siguiente_folio = 5150
        WHERE razon_social_id = $1 AND tipo = 39 AND eliminado_el IS NULL`,
      [razonSocialId],
    );

    const sano = await getCon(tokenCajero, 'dte/estado-emision');
    expect(sano.status).toBe(200);
    sinBlobs(sano);
    const estado = sano.body as EstadoEmisionRes;
    expect(estado.activa).toBe(true);
    expect(estado.sinEmitir).toBe(0);
    expect(estado.conProblemas).toBe(0);
    // También avisa el CAF de exentas (50 folios): se busca el de las afectas.
    expect(estado.avisos).toContainEqual({
      codigo: 'POCOS_FOLIOS',
      mensaje: expect.stringMatching(/Quedan 51 folios/) as string,
    });

    await agotarCaf39();
    await venderOk({ lineas: [{ itemId: itemAfecto, cantidad: '1' }] });
    await venderOk({ lineas: [{ itemId: itemAfecto, cantidad: '2' }] });

    const conPendientes = await getCon(tokenCajero, 'dte/estado-emision');
    expect(conPendientes.status).toBe(200);
    expect((conPendientes.body as EstadoEmisionRes).sinEmitir).toBe(2);
    // Sin emitir no es "con problemas": todavía no hay nada en el SII.
    expect((conPendientes.body as EstadoEmisionRes).conProblemas).toBe(0);
    // El admin, que también vende, lo lee igual.
    expect((await getCon(token, 'dte/estado-emision')).status).toBe(200);
  });

  it('GET /dte/estado-emision con la emisión apagada: activa false, sin avisos y sin conteo', async () => {
    await reiniciarLimpio();
    await agotarCaf39();
    await venderOk({ lineas: [{ itemId: itemAfecto, cantidad: '1' }] });
    await emision(false);
    const tokenCajero = await loginComo(CAJERO);

    const res = await getCon(tokenCajero, 'dte/estado-emision');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      activa: false,
      avisos: [],
      sinEmitir: 0,
      conProblemas: 0,
    });
  });

  it('el cajero no emite pendientes, no ve la lista y no toca el interruptor: 403', async () => {
    await reiniciarLimpio();
    const tokenCajero = await loginComo(CAJERO);

    expect((await botonCon(tokenCajero)).status).toBe(403);
    expect((await getCon(tokenCajero, 'dte/boletas-sin-emitir')).status).toBe(
      403,
    );
    expect(
      (await getCon(tokenCajero, 'dte/boletas-con-problemas')).status,
    ).toBe(403);
    const interruptor = await request(app.getHttpServer())
      .patch('/api/dte/emision')
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({ activa: false });
    expect(interruptor.status).toBe(403);
    // Y la emisión sigue prendida.
    expect((await getCon(token, 'dte/perfil')).body).toMatchObject({
      emisionActiva: true,
    });
  });

  it('sin sesión, las cuatro rutas dan 401', async () => {
    const sin = (m: 'get' | 'post', ruta: string) =>
      request(app.getHttpServer())[m](`/api/${ruta}`);
    expect((await sin('post', 'dte/emitir-pendientes')).status).toBe(401);
    expect((await sin('get', 'dte/boletas-sin-emitir')).status).toBe(401);
    expect((await sin('get', 'dte/estado-emision')).status).toBe(401);
    expect((await sin('get', 'dte/boletas-con-problemas')).status).toBe(401);
  });

  // ---- Boletas con problemas en el SII ---------------------------------------------------

  describe('boletas con problemas', () => {
    interface FilaProblemaRes {
      documentoId: string;
      ventaId: string | null;
      tipo: number;
      folio: number;
      emitidaEl: string;
      monto: string | null;
      motivo: string | null;
    }
    interface ProblemasRes {
      atrasadas: FilaProblemaRes[];
      rechazadas: FilaProblemaRes[];
      conReparos: FilaProblemaRes[];
    }
    interface Sembrada {
      ventaId: string;
      documentoId: string; // el de `dte_documentos`
      monto: string; // el del documento de venta, tal como lo guarda la base
    }

    // El panel de soporte (/admin/dte) agrega sus `it` DENTRO de este describe y reusa las filas
    // A y B: por eso se arman una vez en el `beforeAll` y se limpian en el `afterAll`, no al final
    // de un `it`.
    let A: Sembrada; // atrasada
    let B: Sembrada; // rechazada
    let C: Sembrada; // con reparos reciente
    let D: Sembrada; // con reparos de hace más de 30 días: no aparece
    let E: Sembrada; // rechazada pero dada de baja: no aparece
    let F: Sembrada; // pendiente de hace 10 minutos: no aparece

    /**
     * Una venta con su boleta recién encolada (`pendiente`). Los estados del SII se dejan por SQL
     * porque el SII de verdad no existe en el e2e; el camino real del job lo cubre
     * `dte-cola.e2e-spec.ts`.
     */
    async function vender1(): Promise<Sembrada> {
      const venta = await venderOk({
        lineas: [{ itemId: itemAfecto, cantidad: '1' }],
      });
      const doc = await boletaDelSistema(venta.id);
      expect(doc.dte_documento_id).not.toBeNull();
      return {
        ventaId: venta.id,
        documentoId: doc.dte_documento_id as string,
        monto: doc.monto,
      };
    }

    const dejar = (
      b: Sembrada,
      estado: string,
      emitidoHace: string,
      detalle: object | null = null,
      baja = false,
    ) =>
      ds.query(
        `UPDATE dte_documentos
            SET estado = $2, emitido_el = now() - $3::interval, detalle_sii = $4::jsonb,
                eliminado_el = CASE WHEN $5::boolean THEN now() ELSE NULL END
          WHERE documento_id = $1`,
        [
          b.documentoId,
          estado,
          emitidoHace,
          detalle === null ? null : JSON.stringify(detalle),
          baja,
        ],
      );

    const ids = (filas: FilaProblemaRes[]) => filas.map((f) => f.documentoId);

    beforeAll(async () => {
      await reiniciarLimpio();
      A = await vender1();
      B = await vender1();
      C = await vender1();
      D = await vender1();
      E = await vender1();
      F = await vender1();
      await dejar(A, 'pendiente', '61 minutes');
      await dejar(B, 'rechazado', '5 minutes', {
        origen: 'sobre',
        estado: 'RSC',
      });
      await dejar(C, 'reparos', '2 days', {
        estado: 'RLV',
        error: [{ descripcion: 'Fecha atrasada' }],
      });
      await dejar(D, 'reparos', '31 days', {
        estado: 'RLV',
        error: [{ descripcion: 'Fecha atrasada' }],
      });
      await dejar(E, 'rechazado', '5 minutes', { origen: 'sobre' }, true);
      await dejar(F, 'pendiente', '10 minutes');
    }, 90000);

    afterAll(async () => {
      // Las seis filas quedan como `aceptado` y vivas: no molestan a otros tests ni a la franja
      // del cajero de otras suites (E, la dada de baja, sigue de baja).
      await ds.query(
        `UPDATE dte_documentos SET estado = 'aceptado', detalle_sii = NULL
          WHERE documento_id = ANY($1::uuid[])`,
        [[A, B, C, D, E, F].map((b) => b.documentoId)],
      );
    });

    it('GET /dte/boletas-con-problemas: cada boleta en su grupo, con su venta, su monto y su motivo', async () => {
      const res = await getCon(token, 'dte/boletas-con-problemas');

      expect(res.status).toBe(200);
      sinBlobs(res);
      const r = res.body as ProblemasRes;
      expect(ids(r.atrasadas)).toEqual([A.documentoId]);
      expect(r.atrasadas[0]).toMatchObject({
        ventaId: A.ventaId,
        tipo: 39,
        monto: A.monto,
        motivo: null,
      });
      expect(ids(r.rechazadas)).toEqual([B.documentoId]);
      expect(r.rechazadas[0]).toMatchObject({
        ventaId: B.ventaId,
        monto: B.monto,
        motivo: 'Error del sistema al enviarla al SII.',
      });
      expect(typeof r.rechazadas[0].monto).toBe('string');
      expect(ids(r.conReparos)).toEqual([C.documentoId]);
      expect(r.conReparos[0]).toMatchObject({
        ventaId: C.ventaId,
        motivo: 'El SII avisa: Fecha atrasada.',
      });
    });

    it('GET /dte/estado-emision cuenta las atrasadas y las rechazadas (no las con reparos ni las recientes)', async () => {
      const tokenCajero = await loginComo(CAJERO);

      const res = await getCon(tokenCajero, 'dte/estado-emision');

      expect(res.status).toBe(200);
      expect((res.body as EstadoEmisionRes).conProblemas).toBe(2);
    });

    it('con la emisión apagada el conteo es 0 aunque haya boletas con problemas', async () => {
      const tokenCajero = await loginComo(CAJERO);
      await emision(false);
      try {
        const res = await getCon(tokenCajero, 'dte/estado-emision');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          activa: false,
          avisos: [],
          sinEmitir: 0,
          conProblemas: 0,
        });
      } finally {
        await emision(true);
      }
    });

    it('el admin de otro comercio no ve nada de este: las tres listas vacías', async () => {
      const tokenFalabella = await loginComo(
        ADMIN_FALABELLA,
        FALABELLA_TENANT_ID,
      );

      const res = await getCon(tokenFalabella, 'dte/boletas-con-problemas');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        atrasadas: [],
        rechazadas: [],
        conReparos: [],
      });
    });
  });
});
