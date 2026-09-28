import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';
import { localDelSegundoTenant } from './helpers/segundo-tenant';

/**
 * **Aviso de stock bajo — el bloque del inicio**: `GET /inventario/stock-bajo/resumen`
 * devuelve un número y hasta 4 ubicaciones, nunca la lista. Doc viva:
 * `docs/features/aviso-stock-bajo.md`.
 *
 * ⚠️ **Corre en el segundo tenant sembrado, no en Paris, y es a propósito.** El
 * resumen cuenta TODO el tenant, y la suite del listado (`stock-minimo.e2e-spec`)
 * deja en Paris pares bajo el mínimo; ahí un `total` exacto dependería del orden
 * de las suites. El segundo tenant no tiene catálogo sembrado y ninguna otra
 * suite le carga mínimos (`helpers/segundo-tenant.ts`, el papel de "tenant
 * propio"), así que acá los números son absolutos y cada caso arma su estado
 * limpiando lo que dejó el anterior.
 */

const SEGUNDO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

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
interface Resumen {
  total: number;
  porUbicacion: {
    ubicacionId: string;
    ubicacionNombre: string;
    cantidad: number;
  }[];
}

const SELLO = `SB${Date.now()}${Math.floor(Math.random() * 1e5)}`;

describe('Stock bajo — resumen del inicio (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let localId: string;
  let proveedorId: string;
  let facturaId: string;
  /** Todo par con mínimo que esta suite cargó: `afterEach` los limpia. */
  const cargados: { itemId: string; ubicacionId: string }[] = [];

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

  async function leer(conToken = token) {
    return request(app.getHttpServer())
      .get('/api/inventario/stock-bajo/resumen')
      .set('Authorization', `Bearer ${conToken}`);
  }

  async function resumen(): Promise<Resumen> {
    const res = await leer();
    expect(res.status).toBe(200);
    return res.body as Resumen;
  }

  async function minimo(itemId: string, ubicacionId: string, valor: string) {
    const res = await request(app.getHttpServer())
      .put(`/api/inventario/stock-minimo/${itemId}/${ubicacionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ minimo: valor });
    expect(res.status).toBe(200);
    cargados.push({ itemId, ubicacionId });
  }

  async function producto(stock?: string): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${SELLO} ${randomUUID().slice(0, 8)}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        ...(stock ? { stock } : {}),
      })
    ).id;
  }

  async function bodega(): Promise<string> {
    return (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: `${SELLO} Bodega ${randomUUID().slice(0, 8)}`,
        tipo: 'bodega',
      })
    ).id;
  }

  /** `n` productos distintos bajo el mínimo en `ubicacionId` (stock 0 ahí). */
  async function bajoMinimo(ubicacionId: string, n: number) {
    for (let k = 0; k < n; k++) {
      await minimo(await producto(), ubicacionId, '5');
    }
  }

  async function compra(itemId: string, ubicacionId: string) {
    return post<IdResponse>('/api/compras', {
      proveedorId,
      tipoDocumentoCompraId: facturaId,
      folio: `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(-12),
      fechaDocumento: '2026-09-15',
      ubicacionId,
      // Factura es `obligatorio` (spec compras-deuda-proveedor § 3): sin
      // esto, confirmar es 400 desde esta pieza. Este archivo no prueba esa
      // regla.
      totalDocumento: '999999',
      lineas: [{ itemId, cantidad: '2', unidadCodigo: 'unidad' }],
    });
  }

  /** Rol propio con exactamente estos permisos, nunca el admin del seed. */
  async function usuarioCon(
    permisos: { modulo: string; acciones: string[] }[],
  ): Promise<string> {
    const modulos = await request(app.getHttpServer())
      .get('/api/roles/modulos-disponibles')
      .set('Authorization', `Bearer ${token}`);
    expect(modulos.status).toBe(200);
    const rol = await post<IdResponse>('/api/roles', {
      nombre: `E2E stock-bajo ${randomUUID()}`,
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
    const correo = `stock-bajo.${randomUUID()}@e2e.cl`;
    const alta = await post<{ usuarioId: string }>('/api/tenants/usuarios', {
      nombre: 'Stock',
      apellido: 'Bajo',
      correo,
      rolIds: [rol.id],
    });
    const invitacion = await app
      .get(TokensAccesoService)
      .emitir(alta.usuarioId, TipoTokenAcceso.INVITACION);
    const contrasena = 'clave-e2e-stock-bajo-1234';
    const elegir = await request(app.getHttpServer())
      .post(`/api/auth/invitacion/${invitacion}`)
      .send({ contrasena });
    expect(elegir.status).toBe(200);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: correo, password: contrasena });
    expect(login.status).toBe(200);
    const enTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: SEGUNDO_TENANT_ID });
    expect(enTenant.status).toBe(200);
    return (enTenant.body as TokenResponse).access_token;
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

    ({ token, localId } = await localDelSegundoTenant(app));

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

  afterEach(async () => {
    for (const { itemId, ubicacionId } of cargados.splice(0)) {
      const res = await request(app.getHttpServer())
        .put(`/api/inventario/stock-minimo/${itemId}/${ubicacionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ minimo: null });
      expect(res.status).toBe(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('permisos', () => {
    it('200 con un rol que tiene SOLO Inventario:Leer', async () => {
      const soloLeer = await usuarioCon([
        { modulo: 'Inventario', acciones: ['Leer'] },
      ]);
      expect((await leer(soloLeer)).status).toBe(200);
    });

    it('403 con un rol sin Inventario', async () => {
      const sinInventario = await usuarioCon([
        { modulo: 'Items', acciones: ['Leer'] },
      ]);
      expect((await leer(sinInventario)).status).toBe(403);
    });
  });

  it('sin nada bajo el mínimo: total 0 y ninguna ubicación', async () => {
    expect(await resumen()).toEqual({ total: 0, porUbicacion: [] });
  });

  it('agrupa por ubicación, de la más afectada a la menos', async () => {
    const b = await bodega();
    await bajoMinimo(localId, 1);
    await bajoMinimo(b, 2);

    const r = await resumen();
    expect(r.total).toBe(3);
    expect(r.porUbicacion.map((u) => [u.ubicacionId, u.cantidad])).toEqual([
      [b, 2],
      [localId, 1],
    ]);
  });

  it('la prueba del ruido: con 6 ubicaciones afectadas detalla 4, y el total las cuenta todas', async () => {
    const bodegas: string[] = [];
    for (let k = 0; k < 5; k++) bodegas.push(await bodega());
    // 6 ubicaciones con 6,5,4,3,2,1 productos abajo: 21 en total, y las 4
    // que se detallan suman 18 — el total tiene que ser MAYOR que la suma.
    const afectadas = [localId, ...bodegas];
    for (let k = 0; k < afectadas.length; k++) {
      await bajoMinimo(afectadas[k], 6 - k);
    }

    const r = await resumen();
    expect(r.porUbicacion).toHaveLength(4);
    expect(r.total).toBe(21);
    expect(r.porUbicacion.map((u) => u.cantidad)).toEqual([6, 5, 4, 3]);
    expect(r.porUbicacion.reduce((s, u) => s + u.cantidad, 0)).toBeLessThan(
      r.total,
    );
  });

  it('stock igual al mínimo no cuenta; uno por debajo sí', async () => {
    const itemId = await producto('5');
    await minimo(itemId, localId, '5');
    expect((await resumen()).total).toBe(0);
    await minimo(itemId, localId, '6');
    expect((await resumen()).total).toBe(1);
  });

  describe('lo ya pedido (spec § 2)', () => {
    it('una compra en borrador saca el par; confirmada y sin alcanzar, vuelve', async () => {
      const itemId = await producto('1');
      await minimo(itemId, localId, '50');
      expect((await resumen()).total).toBe(1);

      const c = await compra(itemId, localId);
      expect((await resumen()).total).toBe(0);

      await post(`/api/compras/${c.id}/confirmar`, {});
      // Llegaron 2: stock 3 contra 50. Lo que llegó no alcanzó, es urgente.
      expect((await resumen()).total).toBe(1);
    });

    it('una compra anulada lo devuelve al aviso', async () => {
      const itemId = await producto('1');
      await minimo(itemId, localId, '50');
      const c = await compra(itemId, localId);
      await post(`/api/compras/${c.id}/confirmar`, {});
      await post(`/api/compras/${c.id}/anular`, {
        motivo: 'Cargada por error',
      });
      expect((await resumen()).total).toBe(1);
    });
  });

  describe('ciclo de vida del mínimo (spec § 9)', () => {
    it('una bodega desactivada no cuenta; reactivada vuelve con su mínimo', async () => {
      const b = await bodega();
      await bajoMinimo(b, 2);
      expect((await resumen()).total).toBe(2);

      const patch = (activo: boolean) =>
        request(app.getHttpServer())
          .patch(`/api/ubicaciones/${b}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ activo });
      expect((await patch(false)).status).toBe(200);
      expect(await resumen()).toEqual({ total: 0, porUbicacion: [] });

      expect((await patch(true)).status).toBe(200);
      expect((await resumen()).total).toBe(2);
    });
  });

  it('un producto en la papelera no cuenta', async () => {
    const itemId = await producto();
    await minimo(itemId, localId, '5');
    expect((await resumen()).total).toBe(1);

    const res = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((await resumen()).total).toBe(0);
    // Ya no se puede limpiar (el ítem está en la papelera): sale de la lista
    // de limpieza, y su mínimo queda guardado para cuando se restaure.
    cargados.splice(
      cargados.findIndex((c) => c.itemId === itemId),
      1,
    );
  });

  it('el token de otro tenant no ve estos números', async () => {
    await bajoMinimo(localId, 2);
    expect((await resumen()).total).toBe(2);

    const paris = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin.paris@paris.cl', password: 'admin' });
    expect(paris.status).toBe(200);
    const enParis = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (paris.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(paris.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: '550e8400-e29b-41d4-a716-446655440007' });
    expect(enParis.status).toBe(200);
    const r = await leer((enParis.body as TokenResponse).access_token);
    expect(r.status).toBe(200);
    const ids = (r.body as Resumen).porUbicacion.map((u) => u.ubicacionId);
    expect(ids).not.toContain(localId);
  });
});
