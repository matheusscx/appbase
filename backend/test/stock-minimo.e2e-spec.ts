import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';
import { InventarioService } from '../src/modules/inventario/inventario.service';

/**
 * **Aviso de stock bajo — el listado**: `GET /inventario/stock-minimo` lista
 * cada producto en cada ubicación activa, con su mínimo (si se cargó) y la
 * marca `bajoMinimo`/`enCamino`. Doc viva: `docs/features/aviso-stock-bajo.md`.
 *
 * Cada caso usa productos propios con un sello de corrida en el nombre y filtra
 * por `search`: el listado es de TODO el catálogo del tenant, y el resto de las
 * suites también crea productos.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface ModuloDisponible {
  moduloTenantId: string;
  nombre: string;
  permisos: { moduloAppPermisoId: string; permisoNombre: string }[];
}
interface StockMinimoFila {
  itemId: string;
  itemNombre: string;
  ubicacionId: string;
  ubicacionNombre: string;
  unidadMedida: string;
  minimo: string | null;
  origen: 'manual' | 'sistema' | null;
  stock: string;
  bajoMinimo: boolean;
  enCamino: boolean;
  origenSugerido: {
    ubicacionId: string;
    ubicacionNombre: string;
    stock: string;
  } | null;
}
interface Pagina {
  data: StockMinimoFila[];
  meta: { total: number; page: number; pageSize: number };
}

const SELLO = `SM${Date.now()}${Math.floor(Math.random() * 1e5)}`;

describe('Stock mínimo — listado (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let inventario: InventarioService;
  let localId: string;
  let proveedorId: string;
  let facturaId: string;

  async function loginEnParis(email: string, password: string) {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    expect(resLogin.status).toBe(200);
    const suelto = (resLogin.body as TokenResponse).access_token;
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set('Authorization', `Bearer ${suelto}`)
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    return (resTenant.body as TokenResponse).access_token;
  }

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function patch(url: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(200);
  }

  /**
   * Un usuario propio con un rol propio que tiene EXACTAMENTE estos permisos:
   * nunca el admin del seed, que tiene todo y tapa el 403 ajeno.
   */
  async function usuarioCon(
    permisos: { modulo: string; acciones: string[] }[],
  ): Promise<string> {
    const modulos = await request(app.getHttpServer())
      .get('/api/roles/modulos-disponibles')
      .set('Authorization', `Bearer ${token}`);
    expect(modulos.status).toBe(200);
    const rol = await post<IdResponse>('/api/roles', {
      nombre: `E2E stock-minimo ${randomUUID()}`,
    });
    for (const { modulo, acciones } of permisos) {
      const m = (modulos.body as ModuloDisponible[]).find(
        (x) => x.nombre === modulo,
      );
      expect(m).toBeTruthy();
      const ids = acciones.map((a) => {
        const p = m!.permisos.find((x) => x.permisoNombre === a);
        expect(p).toBeTruthy();
        return p!.moduloAppPermisoId;
      });
      const set = await request(app.getHttpServer())
        .put(`/api/roles/${rol.id}/modules/${m!.moduloTenantId}/permissions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ moduloAppPermisoIds: ids });
      expect(set.status).toBe(200);
    }
    const correo = `stock-minimo.${randomUUID()}@e2e.cl`;
    const alta = await post<{ usuarioId: string }>('/api/tenants/usuarios', {
      nombre: 'Stock',
      apellido: 'Minimo',
      correo,
      rolIds: [rol.id],
    });
    const invitacion = await app
      .get(TokensAccesoService)
      .emitir(alta.usuarioId, TipoTokenAcceso.INVITACION);
    const contrasena = 'clave-e2e-stock-minimo-1234';
    const elegir = await request(app.getHttpServer())
      .post(`/api/auth/invitacion/${invitacion}`)
      .send({ contrasena });
    expect(elegir.status).toBe(200);
    return loginEnParis(correo, contrasena);
  }

  async function producto(
    nombre: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${SELLO} ${nombre}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        ...extra,
      })
    ).id;
  }

  async function bodega(nombre: string): Promise<string> {
    return (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: `${SELLO} ${nombre}`,
        tipo: 'bodega',
      })
    ).id;
  }

  async function listar(query: string, conToken = token) {
    return request(app.getHttpServer())
      .get(`/api/inventario/stock-minimo?pageSize=100&search=${SELLO}${query}`)
      .set('Authorization', `Bearer ${conToken}`);
  }

  async function filas(query = ''): Promise<StockMinimoFila[]> {
    const res = await listar(query);
    expect(res.status).toBe(200);
    return (res.body as Pagina).data;
  }

  /**
   * Filtra por ubicación en el servidor: el listado es producto × ubicación
   * activa, y el resto de las suites deja bodegas en el tenant, así que sin
   * filtro la fila buscada puede caer fuera de la página.
   */
  async function fila(itemId: string, ubicacionId: string) {
    return (await filas(`&ubicacionId=${ubicacionId}`)).find(
      (f) => f.itemId === itemId,
    );
  }

  function cuerpoCompra(
    ubicacionId: string,
    lineas: { itemId: string; cantidad: string }[],
    folio: string,
  ) {
    return {
      proveedorId,
      tipoDocumentoCompraId: facturaId,
      folio,
      fechaDocumento: '2026-09-15',
      ubicacionId,
      lineas: lineas.map((l) => ({ ...l, unidadCodigo: 'unidad' })),
    };
  }

  async function compraBorrador(
    itemId: string,
    ubicacionId: string,
    cantidad = '10',
  ): Promise<{ id: string; folio: string }> {
    const folio = `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(-12);
    const { id } = await post<IdResponse>(
      '/api/compras',
      cuerpoCompra(ubicacionId, [{ itemId, cantidad }], folio),
    );
    return { id, folio };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    inventario = app.get(InventarioService);

    token = await loginEnParis(ADMIN_EMAIL, ADMIN_PASS);

    const ubic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(ubic.status).toBe(200);
    localId = (ubic.body as { id: string; tipo: string }[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    proveedorId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'proveedor',
        nombre: `${SELLO} Proveedor`,
      })
    ).id;
    const tipos = await request(app.getHttpServer())
      .get('/api/compras/tipos-documento')
      .set('Authorization', `Bearer ${token}`);
    expect(tipos.status).toBe(200);
    facturaId = (tipos.body as { id: string; codigo: string | null }[]).find(
      (t) => t.codigo === '33',
    )!.id;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  describe('permisos', () => {
    it('200 con un rol que tiene SOLO Inventario:Leer', async () => {
      const soloLeer = await usuarioCon([
        { modulo: 'Inventario', acciones: ['Leer'] },
      ]);
      const res = await listar('', soloLeer);
      expect(res.status).toBe(200);
    });

    it('403 con un rol que tiene Items:Leer pero nada de Inventario', async () => {
      const sinInventario = await usuarioCon([
        { modulo: 'Items', acciones: ['Leer'] },
      ]);
      const res = await listar('', sinInventario);
      expect(res.status).toBe(403);
    });
  });

  it('sin mínimo cargado la fila sale sin marca; con mínimo y stock abajo, marcada', async () => {
    const itemId = await producto('Cerveza', { stock: '2' });
    const sinMinimo = await fila(itemId, localId);
    expect(sinMinimo).toMatchObject({
      minimo: null,
      origen: null,
      bajoMinimo: false,
      enCamino: false,
    });
    expect(new Decimal(sinMinimo!.stock).toFixed(4)).toBe('2.0000');

    await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '5');
    const conMinimo = await fila(itemId, localId);
    expect(conMinimo).toMatchObject({
      origen: 'manual',
      bajoMinimo: true,
      enCamino: false,
    });
    expect(new Decimal(conMinimo!.minimo!).toFixed(4)).toBe('5.0000');
  });

  it('cruza cada producto solo con las ubicaciones activas de SU tenant', async () => {
    const itemId = await producto('Aislado');
    const ubic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(ubic.status).toBe(200);
    const deParis = new Set(
      (ubic.body as { id: string; activo: boolean }[])
        .filter((u) => u.activo)
        .map((u) => u.id),
    );

    const res = await request(app.getHttpServer())
      .get(
        `/api/inventario/stock-minimo?pageSize=100&search=${encodeURIComponent(`${SELLO} Aislado`)}`,
      )
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const { data, meta } = res.body as Pagina;
    expect(meta.total).toBe(deParis.size);
    expect(data.every((f) => f.itemId === itemId)).toBe(true);
    expect(new Set(data.map((f) => f.ubicacionId))).toEqual(deParis);
  });

  it('limpiar el mínimo saca la marca y deja la fila como si nunca se hubiera cargado', async () => {
    const itemId = await producto('Limpiado', { stock: '1' });
    await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '5');
    expect((await fila(itemId, localId))!.bajoMinimo).toBe(true);

    await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, null);
    expect(await fila(itemId, localId)).toMatchObject({
      minimo: null,
      origen: null,
      bajoMinimo: false,
    });
  });

  it('stock IGUAL al mínimo no está bajo el mínimo', async () => {
    const itemId = await producto('Justo', { stock: '5' });
    await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '5');
    expect((await fila(itemId, localId))!.bajoMinimo).toBe(false);
  });

  it('un mínimo en una ubicación donde el producto nunca se movió cuenta stock 0', async () => {
    const b = await bodega('Bodega nueva');
    const itemId = await producto('Nunca movido', { stock: '4' });
    await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, b, '3');

    const f = await fila(itemId, b);
    expect(f).toMatchObject({ bajoMinimo: true });
    expect(new Decimal(f!.stock).isZero()).toBe(true);
    // Y dónde está la mercadería para cubrirlo: el local, con sus 4.
    expect(f!.origenSugerido).toMatchObject({ ubicacionId: localId });
    expect(new Decimal(f!.origenSugerido!.stock).toFixed(4)).toBe('4.0000');
  });

  it('sin stock en ninguna otra ubicación no hay origen sugerido', async () => {
    const itemId = await producto('Solo en el local', { stock: '1' });
    await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '5');
    expect((await fila(itemId, localId))!.origenSugerido).toBeNull();
  });

  describe('lo ya pedido', () => {
    it('una compra en borrador en ESA ubicación lo marca en camino; en otra, no', async () => {
      const b = await bodega('Bodega pedido');
      const itemId = await producto('Pedido', { stock: '1' });
      await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '5');

      await compraBorrador(itemId, b);
      expect((await fila(itemId, localId))!.enCamino).toBe(false);

      await compraBorrador(itemId, localId);
      expect(await fila(itemId, localId)).toMatchObject({
        bajoMinimo: true,
        enCamino: true,
      });
    });

    it('descartar el borrador lo vuelve a dejar sin camino', async () => {
      const itemId = await producto('Descartado', { stock: '1' });
      await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '5');
      const compra = await compraBorrador(itemId, localId);
      expect((await fila(itemId, localId))!.enCamino).toBe(true);

      const res = await request(app.getHttpServer())
        .delete(`/api/compras/${compra.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect((await fila(itemId, localId))!.enCamino).toBe(false);
    });

    it('editar el borrador sacando la línea lo devuelve al aviso', async () => {
      const itemId = await producto('Corregido', { stock: '1' });
      const otro = await producto('Reemplazo');
      await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '5');
      const compra = await compraBorrador(itemId, localId);
      expect((await fila(itemId, localId))!.enCamino).toBe(true);

      const res = await request(app.getHttpServer())
        .patch(`/api/compras/${compra.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(
          cuerpoCompra(
            localId,
            [{ itemId: otro, cantidad: '3' }],
            compra.folio,
          ),
        );
      expect(res.status).toBe(200);
      expect((await fila(itemId, localId))!.enCamino).toBe(false);
    });

    it('una compra CONFIRMADA que no alcanza el mínimo no lo saca: sigue urgente', async () => {
      const itemId = await producto('Llegó poco', { stock: '1' });
      await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '50');
      const compra = await compraBorrador(itemId, localId, '10');
      await post(`/api/compras/${compra.id}/confirmar`, {});

      const f = await fila(itemId, localId);
      expect(new Decimal(f!.stock).toFixed(4)).toBe('11.0000');
      expect(f).toMatchObject({ bajoMinimo: true, enCamino: false });
    });
  });

  it('los tres modos comparan unidades contra el saldo de la ubicación', async () => {
    const serie = await producto('Serie', { modoInventario: 'serie' });
    for (const n of [1, 2]) {
      const r = await request(app.getHttpServer())
        .patch(`/api/items/${serie}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          ubicacionId: localId,
          cantidad: '1',
          series: [{ serie: `${SELLO}-S${n}` }],
        });
      expect(r.status).toBe(200);
    }
    const lote = await producto('Lote', { modoInventario: 'lote' });
    const rl = await request(app.getHttpServer())
      .patch(`/api/items/${lote}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '13',
        costoUnitario: '1000',
        lote: { codigoLote: `${SELLO}-L`, fechaVencimiento: '2027-06-01' },
      });
    expect(rl.status).toBe(200);

    // 2 unidades de serie contra 3 → abajo; 13 del lote contra 13 → no.
    await inventario.upsertMinimo(PARIS_TENANT_ID, serie, localId, '3');
    await inventario.upsertMinimo(PARIS_TENANT_ID, lote, localId, '13');
    expect((await fila(serie, localId))!.bajoMinimo).toBe(true);
    expect((await fila(lote, localId))!.bajoMinimo).toBe(false);

    // Y el borde del otro lado, para que ninguno de los dos pase por azar.
    await inventario.upsertMinimo(PARIS_TENANT_ID, serie, localId, '2');
    await inventario.upsertMinimo(PARIS_TENANT_ID, lote, localId, '14');
    expect((await fila(serie, localId))!.bajoMinimo).toBe(false);
    expect((await fila(lote, localId))!.bajoMinimo).toBe(true);
  });

  it('soloBajoMinimo trae solo las marcadas', async () => {
    const bajo = await producto('Filtro bajo', { stock: '1' });
    const ok = await producto('Filtro ok', { stock: '9' });
    await inventario.upsertMinimo(PARIS_TENANT_ID, bajo, localId, '5');
    await inventario.upsertMinimo(PARIS_TENANT_ID, ok, localId, '5');

    const soloBajo = await filas(`&soloBajoMinimo=true&ubicacionId=${localId}`);
    expect(soloBajo.every((f) => f.bajoMinimo)).toBe(true);
    const ids = soloBajo.map((f) => f.itemId);
    expect(ids).toContain(bajo);
    expect(ids).not.toContain(ok);
  });

  describe('ciclo de vida del mínimo (spec § 9)', () => {
    it('una bodega desactivada no se lista; reactivada vuelve con el mínimo que tenía', async () => {
      const b = await bodega('Bodega de temporada');
      const itemId = await producto('Temporada', { stock: '1' });
      await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, b, '7');
      expect((await fila(itemId, b))!.bajoMinimo).toBe(true);

      await patch(`/api/ubicaciones/${b}`, { activo: false });
      expect(await fila(itemId, b)).toBeUndefined();

      await patch(`/api/ubicaciones/${b}`, { activo: true });
      const vuelta = await fila(itemId, b);
      expect(vuelta).toMatchObject({ bajoMinimo: true });
      expect(new Decimal(vuelta!.minimo!).toFixed(4)).toBe('7.0000');
    });

    it('un producto en la papelera no se lista', async () => {
      const itemId = await producto('Papelera');
      await inventario.upsertMinimo(PARIS_TENANT_ID, itemId, localId, '2');
      expect(await fila(itemId, localId)).toBeDefined();

      const res = await request(app.getHttpServer())
        .delete(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(await fila(itemId, localId)).toBeUndefined();
    });
  });
});
