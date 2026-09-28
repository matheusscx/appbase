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
 * **Compras — el XML del DTE** (spec
 * `docs/superpowers/specs/2026-09-27-compras-xml-dte-design.md` § 5.3 y § 7):
 * `POST /compras/dte/lectura` (tarea 1, solo lectura) y el aprendizaje al
 * guardar el borrador, `POST /compras` y `PATCH /compras/:id` (tarea 2,
 * § 5.2). La tarea 1 dejó todo test de "toda clave sale sin asociar" porque
 * nada podía escribir todavía; la tarea 2 agrega el describe de más abajo.
 *
 * Proveedores, ítems y compras son **propios** del archivo, con RUT y folio
 * aleatorios: no depende de lo que dejaron otras suites.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ENCARGADO_COMPRAS_EMAIL = 'encargado.compras@paris.cl';
/** Solo `Compras:Leer`: el que distingue "ver" de "cargar". */
const COMPRAS_LECTURA_EMAIL = 'compras.lectura@paris.cl';
const PASS = 'admin';

/** La razón social del tenant demo (seed, `seedRazonesSociales`). */
const RUT_PARIS = '76.123.456-7';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface TipoDocumento {
  id: string;
  nombre: string;
  codigo: string | null;
}
interface LecturaDte {
  receptorEsDelTenant: boolean;
  proveedor: { id: string; nombre: string } | null;
  candidatos: { id: string; nombre: string }[];
  tipoDocumento: { id: string; nombre: string } | null;
  compraExistente: {
    id: string;
    estado: string;
    confirmadoEl: string | null;
  } | null;
  asociaciones: { clave: string; destino: unknown; nota?: string }[];
}

/** Cuerpo (8 dígitos) y DV (módulo 11) de un RUT válido aleatorio. */
function rutAleatorioPartes(): { cuerpo: string; dv: string } {
  const cuerpo = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
  let suma = 0;
  let mult = 2;
  for (const d of [...cuerpo].reverse()) {
    suma += Number(d) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return { cuerpo, dv };
}

/** RUT válido aleatorio, con puntos y guion: "12.345.678-9". */
function rutAleatorio(): string {
  const { cuerpo, dv } = rutAleatorioPartes();
  return `${cuerpo.slice(0, -6)}.${cuerpo.slice(-6, -3)}.${cuerpo.slice(-3)}-${dv}`;
}

/**
 * El mismo RUT válido en dos formatos, del mismo cuerpo+DV: `sinFormato`
 * ("123456789", como puede haber quedado guardado en `terceros.rut` — texto
 * libre, sin máscara) y `conFormato` ("12.345.678-9", como lo manda la
 * lectura del XML). Ejercita la rama "comparar también sin guion" del
 * service (spec compras-xml-dte § 7, duda del revisor).
 */
function rutEnDosFormatos(): { sinFormato: string; conFormato: string } {
  const { cuerpo, dv } = rutAleatorioPartes();
  return {
    sinFormato: `${cuerpo}${dv}`,
    conFormato: `${cuerpo.slice(0, -6)}.${cuerpo.slice(-6, -3)}.${cuerpo.slice(-3)}-${dv}`,
  };
}

describe('lectura del XML del DTE (spec compras-xml-dte § 5.3 y § 7)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let bodegaId: string;
  let productoId: string;
  let factura: TipoDocumento;

  const nombreUnico = (base: string) =>
    `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const folioUnico = () =>
    `DTE-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  async function login(email: string): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASS });
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
    return (resTenant.body as TokenResponse).access_token;
  }

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
    conToken = token,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${conToken}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function get<T>(
    url: string,
    esperado = 200,
    conToken = token,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${conToken}`);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  /** El intento crudo: status y mensaje, para afirmar sobre los dos. */
  async function intentar(
    body: Record<string, unknown>,
    conToken = token,
  ): Promise<{ status: number; message: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/compras/dte/lectura')
      .set('Authorization', `Bearer ${conToken}`)
      .send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
    };
  }

  const leer = (body: Record<string, unknown>, conToken = token) =>
    post<LecturaDte>('/api/compras/dte/lectura', body, 200, conToken);

  function cuerpoBase(extra: Record<string, unknown> = {}) {
    return {
      emisorRut: rutAleatorio(),
      receptorRut: RUT_PARIS,
      tipoDte: '33',
      folio: folioUnico(),
      claves: [],
      ...extra,
    };
  }

  async function proveedorNuevo(
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; nombre: string }> {
    const nombre = nombreUnico('Proveedor DTE E2E');
    const { id } = await post<IdResponse>('/api/terceros', {
      tipo: 'proveedor',
      nombre,
      ...extra,
    });
    return { id, nombre };
  }

  /** Un producto propio, con nombre único, base "unidad" (para el aprendizaje). */
  async function productoNuevo(
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: nombreUnico('Producto DTE Aprender E2E'),
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        ...extra,
      })
    ).id;
  }

  interface PresentacionVista {
    id: string;
    proveedorId: string;
    itemId: string;
    nombre: string;
    contenido: string;
    unidadCodigo: string;
  }

  const crearPresentacion = (body: Record<string, unknown>) =>
    post<PresentacionVista>('/api/compras/presentaciones', body);

  /**
   * El encabezado de un borrador, con folio propio; `extra` pisa lo que haga
   * falta. `totalDocumento` de relleno: Factura es `obligatorio` (spec
   * compras-deuda-proveedor § 3), y este archivo no prueba esa regla, solo
   * necesita borradores que puedan confirmarse.
   */
  function cuerpoCompra(
    proveedorId: string,
    lineas: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ) {
    return {
      proveedorId,
      tipoDocumentoCompraId: factura.id,
      folio: folioUnico(),
      fechaDocumento: '2026-09-27',
      ubicacionId: bodegaId,
      totalDocumento: '999999',
      lineas,
      ...extra,
    };
  }

  /** El intento crudo de guardar un borrador: status y mensaje. */
  async function intentarGuardar(
    body: Record<string, unknown>,
    conToken = token,
  ): Promise<{ status: number; message: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/compras')
      .set('Authorization', `Bearer ${conToken}`)
      .send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
    };
  }

  /** Cuántas filas vivas o borradas tiene una clave, para afirmar el reaprendizaje. */
  async function filasDeClave(
    proveedorId: string,
    clave: string,
  ): Promise<{ eliminado_el: string | null }[]> {
    return ds.query(
      `SELECT eliminado_el FROM codigos_proveedor
        WHERE tenant_id = $1 AND proveedor_id = $2 AND clave = $3`,
      [PARIS_TENANT_ID, proveedorId, clave],
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

    token = await login(ADMIN_EMAIL);

    bodegaId = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: nombreUnico('Bodega DTE E2E'),
        tipo: 'bodega',
      })
    ).id;
    productoId = (
      await post<IdResponse>('/api/items', {
        nombre: nombreUnico('Producto DTE E2E'),
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
      })
    ).id;
    const tipos = await get<TipoDocumento[]>('/api/compras/tipos-documento');
    factura = tipos.find((t) => t.codigo === '33')!;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('proveedor por `rut`, con el RUT sin puntos en la lectura', async () => {
    const rut = rutAleatorio();
    const prov = await proveedorNuevo({ rut });
    const r = await leer(cuerpoBase({ emisorRut: rut.replace(/\./g, '') }));
    expect(r.proveedor).toEqual({ id: prov.id, nombre: prov.nombre });
    expect(r.candidatos).toEqual([]);
  });

  it('proveedor solo por `rutFiscal`, con el RUT sin puntos en la lectura', async () => {
    const rut = rutAleatorio();
    const prov = await proveedorNuevo({ rutFiscal: rut });
    const r = await leer(cuerpoBase({ emisorRut: rut.replace(/\./g, '') }));
    expect(r.proveedor).toEqual({ id: prov.id, nombre: prov.nombre });
  });

  it('proveedor con `rut` guardado sin puntos NI guion: la lectura con puntos y guion lo resuelve', async () => {
    const { sinFormato, conFormato } = rutEnDosFormatos();
    const prov = await proveedorNuevo({ rut: sinFormato });
    const r = await leer(cuerpoBase({ emisorRut: conFormato }));
    expect(r.proveedor).toEqual({ id: prov.id, nombre: prov.nombre });
  });

  it('dos proveedores con el mismo RUT: proveedor null, candidatos con los dos', async () => {
    const rut = rutAleatorio();
    const a = await proveedorNuevo({ rut });
    const b = await proveedorNuevo({ rut });
    const r = await leer(cuerpoBase({ emisorRut: rut }));
    expect(r.proveedor).toBeNull();
    expect(r.candidatos.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('RUT desconocido: proveedor null, candidatos y asociaciones vacíos', async () => {
    const r = await leer(cuerpoBase({ claves: ['CUALQUIERA'] }));
    expect(r.proveedor).toBeNull();
    expect(r.candidatos).toEqual([]);
    expect(r.asociaciones).toEqual([]);
  });

  it('receptor: un RUT ajeno da false; una segunda razón social de París da true', async () => {
    const r = await leer(cuerpoBase({ receptorRut: rutAleatorio() }));
    expect(r.receptorEsDelTenant).toBe(false);

    const rutSegunda = rutAleatorio();
    await post('/api/tenants/razones-sociales', {
      nombre: nombreUnico('Segunda razón social DTE E2E'),
      rut: rutSegunda,
    });
    const r2 = await leer(cuerpoBase({ receptorRut: rutSegunda }));
    expect(r2.receptorEsDelTenant).toBe(true);
  });

  it('receptor: una razón social guardada sin puntos NI guion también calza (mismo fallback que el proveedor)', async () => {
    const { sinFormato, conFormato } = rutEnDosFormatos();
    await post('/api/tenants/razones-sociales', {
      nombre: nombreUnico('Razón social sin formato DTE E2E'),
      rut: sinFormato,
    });
    const r = await leer(cuerpoBase({ receptorRut: conFormato }));
    expect(r.receptorEsDelTenant).toBe(true);
  });

  it('tipoDte 61 (nota de crédito) sale sin tipo; 33 es la factura del seed', async () => {
    const rNota = await leer(cuerpoBase({ tipoDte: '61' }));
    expect(rNota.tipoDocumento).toBeNull();

    const rFactura = await leer(cuerpoBase({ tipoDte: '33' }));
    expect(rFactura.tipoDocumento).toEqual({
      id: factura.id,
      nombre: factura.nombre,
    });
  });

  describe('compra existente (mismo proveedor, tipo y folio)', () => {
    it('borrador → estado borrador; confirmada → confirmada con confirmadoEl; anulada → libre', async () => {
      const rut = rutAleatorio();
      const prov = await proveedorNuevo({ rut });
      const folio = folioUnico();
      const cuerpoCompra = (folioPropio: string) => ({
        proveedorId: prov.id,
        tipoDocumentoCompraId: factura.id,
        folio: folioPropio,
        fechaDocumento: '2026-09-27',
        ubicacionId: bodegaId,
        totalDocumento: '999999',
        lineas: [
          {
            itemId: productoId,
            cantidad: '10',
            unidadCodigo: 'unidad',
            precioUnitario: '1000',
          },
        ],
      });

      const borrador = await post<IdResponse>(
        '/api/compras',
        cuerpoCompra(folio),
      );
      const rBorrador = await leer(cuerpoBase({ emisorRut: rut, folio }));
      expect(rBorrador.compraExistente).toMatchObject({
        id: borrador.id,
        estado: 'borrador',
        confirmadoEl: null,
      });

      const folioConfirmado = folioUnico();
      const compraConfirmar = await post<IdResponse>(
        '/api/compras',
        cuerpoCompra(folioConfirmado),
      );
      await post(`/api/compras/${compraConfirmar.id}/confirmar`, {});
      const rConfirmada = await leer(
        cuerpoBase({ emisorRut: rut, folio: folioConfirmado }),
      );
      expect(rConfirmada.compraExistente?.id).toBe(compraConfirmar.id);
      expect(rConfirmada.compraExistente?.estado).toBe('confirmada');
      expect(rConfirmada.compraExistente?.confirmadoEl).not.toBeNull();

      const folioAnulado = folioUnico();
      const compraAnular = await post<IdResponse>(
        '/api/compras',
        cuerpoCompra(folioAnulado),
      );
      await post(`/api/compras/${compraAnular.id}/confirmar`, {});
      await post(`/api/compras/${compraAnular.id}/anular`, {
        motivo: 'anulada para el e2e de la lectura del DTE',
      });
      const rAnulada = await leer(
        cuerpoBase({ emisorRut: rut, folio: folioAnulado }),
      );
      expect(rAnulada.compraExistente).toBeNull();
    });
  });

  it('asociaciones: sin escritura todavía (tarea 2), toda clave sale sin asociar', async () => {
    const rut = rutAleatorio();
    await proveedorNuevo({ rut });
    const r = await leer(
      cuerpoBase({ emisorRut: rut, claves: ['INT1:CC350-12', 'FLETE'] }),
    );
    expect(r.asociaciones).toEqual([
      { clave: 'INT1:CC350-12', destino: null },
      { clave: 'FLETE', destino: null },
    ]);
  });

  it('proveedorId con otro RUT guardado: 400 con el mensaje', async () => {
    const prov = await proveedorNuevo({ rut: rutAleatorio() });
    const r = await intentar(
      cuerpoBase({ proveedorId: prov.id, emisorRut: rutAleatorio() }),
    );
    expect(r.status).toBe(400);
    expect(r.message).toContain(prov.nombre);
    expect(r.message).toContain('RUT');
  });

  it('proveedorId de un tercero que NO es proveedor: 400 genérico, sin filtrar nombre ni RUT', async () => {
    const rutTercero = rutAleatorio();
    const nombre = nombreUnico('Empresa cliente DTE E2E');
    const empresa = await post<IdResponse>('/api/terceros', {
      tipo: 'empresa',
      nombre,
      rut: rutTercero,
    });
    const r = await intentar(
      cuerpoBase({ proveedorId: empresa.id, emisorRut: rutAleatorio() }),
    );
    expect(r).toEqual({ status: 400, message: 'Proveedor no encontrado' });
    expect(r.message).not.toContain(nombre);
    expect(r.message).not.toContain(rutTercero);
  });

  it('proveedorId de un proveedor pausado (`activo: false`): 400 genérico, sin filtrar nombre ni RUT', async () => {
    const rutProveedor = rutAleatorio();
    const prov = await proveedorNuevo({ rut: rutProveedor });
    await request(app.getHttpServer())
      .patch(`/api/terceros/${prov.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activo: false })
      .expect(200);
    const r = await intentar(
      cuerpoBase({ proveedorId: prov.id, emisorRut: rutAleatorio() }),
    );
    expect(r).toEqual({ status: 400, message: 'Proveedor no encontrado' });
    expect(r.message).not.toContain(prov.nombre);
    expect(r.message).not.toContain(rutProveedor);
  });

  it('proveedorId de otro tenant: 400 "Proveedor no encontrado"', async () => {
    const otro = await loginSegundoTenant(app);
    const provOtroTenant = await post<IdResponse>(
      '/api/terceros',
      { tipo: 'proveedor', nombre: nombreUnico('Proveedor otro tenant DTE') },
      201,
      otro,
    );
    const r = await intentar(cuerpoBase({ proveedorId: provOtroTenant.id }));
    expect(r).toEqual({ status: 400, message: 'Proveedor no encontrado' });
  });

  it('aislamiento: con el token del segundo tenant, el RUT de un proveedor de París no calza', async () => {
    const rut = rutAleatorio();
    await proveedorNuevo({ rut });
    const otro = await loginSegundoTenant(app);
    const r = await leer(cuerpoBase({ emisorRut: rut }), otro);
    expect(r.proveedor).toBeNull();
    expect(r.candidatos).toEqual([]);
  });

  it('permisos: solo Compras:Leer es 403; el encargado de compras entra', async () => {
    const lectura = await login(COMPRAS_LECTURA_EMAIL);
    expect((await intentar(cuerpoBase(), lectura)).status).toBe(403);

    const encargado = await login(ENCARGADO_COMPRAS_EMAIL);
    const r = await leer(cuerpoBase(), encargado);
    expect(r.receptorEsDelTenant).toBeDefined();
  });

  it('DTO: tipoDte no numérico, más de 60 claves o una clave de 161 son 400', async () => {
    expect((await intentar(cuerpoBase({ tipoDte: 'abc' }))).status).toBe(400);
    expect(
      (
        await intentar(
          cuerpoBase({ claves: Array.from({ length: 61 }, (_, i) => `C${i}`) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await intentar(cuerpoBase({ claves: ['X'.repeat(161)] }))).status,
    ).toBe(400);
  });

  it('DTO: un RUT de 21 caracteres (12 + 9 espacios de cola) es 400: `PATRON_RUT` no acota el largo por sí solo', async () => {
    const rutDe21 = '76.543.210-3' + ' '.repeat(9);
    expect(rutDe21.length).toBe(21);
    expect((await intentar(cuerpoBase({ emisorRut: rutDe21 }))).status).toBe(
      400,
    );
  });

  /**
   * **Aprender al guardar el borrador (tarea 2, spec § 5.2).** Todo por API:
   * proveedor, producto y presentación propios de cada test; `ds.query` solo
   * para LEER lo que quedó en `codigos_proveedor`/`compras` (permitido por la
   * regla del repo — nunca para armar el escenario).
   */
  describe('aprender al guardar el borrador (tarea 2, spec § 5.2)', () => {
    it('una línea con claveProveedor en una presentación: la lectura la resuelve', async () => {
      const rut = rutAleatorio();
      const prov = await proveedorNuevo({ rut });
      const item = await productoNuevo();
      const caja = await crearPresentacion({
        proveedorId: prov.id,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const clave = 'CODIGO:INT1:CC350-12';
      await post(
        '/api/compras',
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
            claveProveedor: clave,
            descripcionProveedor: 'Coca-Cola 350ml CJ12',
          },
        ]),
      );
      const r = await leer(cuerpoBase({ emisorRut: rut, claves: [clave] }));
      expect(r.asociaciones).toEqual([
        { clave, destino: { itemId: item, presentacionId: caja.id } },
      ]);
    });

    it('reaprender: la misma clave en unidadCodigo calza distinto, y deja la fila vieja con eliminado_el', async () => {
      const rut = rutAleatorio();
      const prov = await proveedorNuevo({ rut });
      const item = await productoNuevo();
      const caja = await crearPresentacion({
        proveedorId: prov.id,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const clave = 'CODIGO:INT1:REAPRENDER';
      await post(
        '/api/compras',
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
            claveProveedor: clave,
            descripcionProveedor: 'Primera vez',
          },
        ]),
      );
      await post(
        '/api/compras',
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '5',
            unidadCodigo: 'unidad',
            precioUnitario: '800',
            claveProveedor: clave,
            descripcionProveedor: 'Reaprendida por unidad',
          },
        ]),
      );
      const r = await leer(cuerpoBase({ emisorRut: rut, claves: [clave] }));
      expect(r.asociaciones).toEqual([
        { clave, destino: { itemId: item, unidadCodigo: 'unidad' } },
      ]);

      const filas = await filasDeClave(prov.id, clave);
      expect(filas).toHaveLength(2);
      expect(filas.filter((f) => f.eliminado_el !== null)).toHaveLength(1);
    });

    it('apartadas: se aprenden con no_mercaderia y la lectura las resuelve', async () => {
      const rut = rutAleatorio();
      const prov = await proveedorNuevo({ rut });
      const item = await productoNuevo();
      const clave = 'NOMBRE:FLETE-APRENDER';
      await post(
        '/api/compras',
        cuerpoCompra(
          prov.id,
          [
            {
              itemId: item,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '100',
            },
          ],
          { apartadas: [{ clave, descripcion: 'Flete' }] },
        ),
      );
      const r = await leer(cuerpoBase({ emisorRut: rut, claves: [clave] }));
      expect(r.asociaciones).toEqual([{ clave, destino: 'no_mercaderia' }]);
    });

    it('la misma clave en una línea y en apartadas: 400 que la nombra', async () => {
      const prov = await proveedorNuevo();
      const item = await productoNuevo();
      const clave = 'CODIGO:CHOQUE-LINEA-APARTADA';
      const r = await intentarGuardar(
        cuerpoCompra(
          prov.id,
          [
            {
              itemId: item,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '100',
              claveProveedor: clave,
              descripcionProveedor: 'Mercadería',
            },
          ],
          { apartadas: [{ clave, descripcion: 'También flete' }] },
        ),
      );
      expect(r.status).toBe(400);
      expect(r.message).toContain(clave);
    });

    it('retirar la presentación aprendida: la lectura da null con su nota; borrar el producto da la del producto', async () => {
      const rut = rutAleatorio();
      const prov = await proveedorNuevo({ rut });
      const item = await productoNuevo();
      const caja = await crearPresentacion({
        proveedorId: prov.id,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const clave = 'CODIGO:RETIRAR-PRESENTACION';
      await post(
        '/api/compras',
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
            claveProveedor: clave,
            descripcionProveedor: 'X',
          },
        ]),
      );

      await request(app.getHttpServer())
        .delete(`/api/compras/presentaciones/${caja.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      const r1 = await leer(cuerpoBase({ emisorRut: rut, claves: [clave] }));
      expect(r1.asociaciones).toEqual([
        {
          clave,
          destino: null,
          nota: 'la presentación a la que apuntaba fue retirada',
        },
      ]);

      const resDelete = await request(app.getHttpServer())
        .delete(`/api/items/${item}`)
        .set('Authorization', `Bearer ${token}`);
      expect([200, 204]).toContain(resDelete.status);
      const r2 = await leer(cuerpoBase({ emisorRut: rut, claves: [clave] }));
      expect(r2.asociaciones).toEqual([
        {
          clave,
          destino: null,
          nota: 'el producto al que apuntaba ya no está',
        },
      ]);
    });

    it('una línea sin claveProveedor no crea fila en codigos_proveedor', async () => {
      const prov = await proveedorNuevo();
      const item = await productoNuevo();
      const contar = async () => {
        const filas: { total: string }[] = await ds.query(
          `SELECT COUNT(*)::text AS total FROM codigos_proveedor WHERE tenant_id = $1 AND proveedor_id = $2`,
          [PARIS_TENANT_ID, prov.id],
        );
        return filas[0].total;
      };
      const antes = await contar();
      await post(
        '/api/compras',
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '10',
            unidadCodigo: 'unidad',
            precioUnitario: '100',
          },
        ]),
      );
      expect(antes).toBe('0');
      expect(await contar()).toBe(antes);
    });

    it('rutProveedor: proveedor sin RUT lo guarda en rut_fiscal; la siguiente lectura lo resuelve sin proveedorId', async () => {
      const prov = await proveedorNuevo();
      const item = await productoNuevo();
      const rutEmisor = rutAleatorio();
      await post(
        '/api/compras',
        cuerpoCompra(
          prov.id,
          [
            {
              itemId: item,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '100',
            },
          ],
          { rutProveedor: rutEmisor },
        ),
      );
      const r = await leer(cuerpoBase({ emisorRut: rutEmisor }));
      expect(r.proveedor).toEqual({ id: prov.id, nombre: prov.nombre });
    });

    it('rutProveedor: con otro RUT ya guardado, 400 y la compra no se crea', async () => {
      const rut = rutAleatorio();
      const prov = await proveedorNuevo({ rut });
      const item = await productoNuevo();
      const otroRut = rutAleatorio();
      const folio = folioUnico();
      const r = await intentarGuardar(
        cuerpoCompra(
          prov.id,
          [
            {
              itemId: item,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '100',
            },
          ],
          { folio, rutProveedor: otroRut },
        ),
      );
      expect(r.status).toBe(400);
      const existe = await ds.query(
        `SELECT 1 FROM compras WHERE tenant_id = $1 AND proveedor_id = $2 AND folio = $3`,
        [PARIS_TENANT_ID, prov.id, folio],
      );
      expect(existe).toEqual([]);
    });

    it('descripcionProveedor sin claveProveedor: 400; apartadas con 61: 400', async () => {
      const prov = await proveedorNuevo();
      const item = await productoNuevo();
      const rSinClave = await intentarGuardar(
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '10',
            unidadCodigo: 'unidad',
            precioUnitario: '100',
            descripcionProveedor: 'Sin clave',
          },
        ]),
      );
      expect(rSinClave.status).toBe(400);

      const rApartadas61 = await intentarGuardar(
        cuerpoCompra(
          prov.id,
          [
            {
              itemId: item,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '100',
            },
          ],
          {
            apartadas: Array.from({ length: 61 }, (_, i) => ({
              clave: `C${i}`,
              descripcion: 'X',
            })),
          },
        ),
      );
      expect(rApartadas61.status).toBe(400);
    });

    it('claveProveedor o apartadas.clave de solo espacios: 400 (fix round 1)', async () => {
      const prov = await proveedorNuevo();
      const item = await productoNuevo();
      const rLineaEspacios = await intentarGuardar(
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '10',
            unidadCodigo: 'unidad',
            precioUnitario: '100',
            claveProveedor: '   ',
            descripcionProveedor: 'X',
          },
        ]),
      );
      expect(rLineaEspacios.status).toBe(400);

      const rApartadaEspacios = await intentarGuardar(
        cuerpoCompra(
          prov.id,
          [
            {
              itemId: item,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '100',
            },
          ],
          { apartadas: [{ clave: '   ', descripcion: 'X' }] },
        ),
      );
      expect(rApartadaEspacios.status).toBe(400);
    });

    it('aislamiento: la clave aprendida en un tenant no calza en el otro para el mismo RUT', async () => {
      const rut = rutAleatorio();
      const prov = await proveedorNuevo({ rut });
      const item = await productoNuevo();
      const clave = 'CODIGO:AISLAMIENTO-TENANT';
      await post(
        '/api/compras',
        cuerpoCompra(prov.id, [
          {
            itemId: item,
            cantidad: '10',
            unidadCodigo: 'unidad',
            precioUnitario: '100',
            claveProveedor: clave,
            descripcionProveedor: 'X',
          },
        ]),
      );

      const otro = await loginSegundoTenant(app);
      await post(
        '/api/terceros',
        { tipo: 'proveedor', nombre: nombreUnico('Prov aislamiento DTE'), rut },
        201,
        otro,
      );
      const r = await leer(
        cuerpoBase({ emisorRut: rut, claves: [clave] }),
        otro,
      );
      expect(r.asociaciones).toEqual([{ clave, destino: null }]);
    });
  });
});
