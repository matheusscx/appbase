import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
// Vendedor: no es admin del tenant → TenantAdminGuard lo rechaza al escribir,
// pero igual lee (es quien ve los atajos en el drawer de movimientos).
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' };
const ADMIN_FALABELLA = { email: 'admin@sistema.com', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface Concepto {
  id: string;
  nombre: string;
  tipo: string;
  activo: boolean;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
  tenantId: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('Conceptos de movimiento de caja (e2e) — CRUD admin-only + aislamiento', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenFalabella: string;
  const sufijo = Date.now();
  const creados: string[] = [];

  const http = () => request(app.getHttpServer());
  const crear = (token: string, body: Record<string, unknown>) =>
    http()
      .post('/api/conceptos-movimiento-caja')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const listar = async (token: string, query = ''): Promise<Concepto[]> => {
    const res = await http()
      .get(`/api/conceptos-movimiento-caja${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Concepto[];
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    tokenAdmin = await login(
      app,
      ADMIN_PARIS.email,
      ADMIN_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenVendedor = await login(
      app,
      VENDEDOR_PARIS.email,
      VENDEDOR_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenFalabella = await login(
      app,
      ADMIN_FALABELLA.email,
      ADMIN_FALABELLA.pass,
      FALABELLA_TENANT_ID,
    );
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    for (const id of creados) {
      const r = await http()
        .delete(`/api/conceptos-movimiento-caja/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      if (![204, 404].includes(r.status)) fallos.push(`${id}: ${r.status}`);
    }
    await app.close();
    expect(fallos).toEqual([]);
  });

  it('sin autenticar → 401', async () => {
    const res = await http().get('/api/conceptos-movimiento-caja');
    expect(res.status).toBe(401);
  });

  it('POST por admin → 201, tipo ambos y activo por defecto', async () => {
    const res = await crear(tokenAdmin, { nombre: `  Cambio ${sufijo} ` });
    expect(res.status).toBe(201);
    const c = res.body as Concepto;
    creados.push(c.id);
    expect(c.nombre).toBe(`Cambio ${sufijo}`);
    expect(c.tipo).toBe('ambos');
    expect(c.activo).toBe(true);
  });

  it('POST por no-admin → 403', async () => {
    const res = await crear(tokenVendedor, { nombre: `x ${sufijo}` });
    expect(res.status).toBe(403);
  });

  it('POST con nombre vacío, tipo inválido o campo ajeno → 400', async () => {
    for (const body of [
      { nombre: '' },
      { nombre: '   ' },
      { nombre: `ok ${sufijo}`, tipo: 'otro' },
      { nombre: `ok ${sufijo}`, tenantId: FALABELLA_TENANT_ID },
    ]) {
      const res = await crear(tokenAdmin, body);
      expect(res.status).toBe(400);
    }
  });

  it('POST con el nombre repetido (sin importar mayúsculas) → 400', async () => {
    const res = await crear(tokenAdmin, { nombre: `CAMBIO ${sufijo}` });
    expect(res.status).toBe(400);
  });

  it('el mismo nombre en otro tenant es válido y no se ve desde el primero', async () => {
    const res = await crear(tokenFalabella, {
      nombre: `Cambio ${sufijo}`,
      tipo: 'entrada',
    });
    expect(res.status).toBe(201);
    const ajeno = res.body as Concepto;
    const deParis = await listar(tokenAdmin);
    expect(deParis.some((c) => c.id === ajeno.id)).toBe(false);
    const del = await http()
      .delete(`/api/conceptos-movimiento-caja/${ajeno.id}`)
      .set('Authorization', `Bearer ${tokenFalabella}`);
    expect(del.status).toBe(204);
  });

  it('GET lo lee cualquier miembro del tenant (el vendedor)', async () => {
    const lista = await listar(tokenVendedor);
    expect(lista.some((c) => c.nombre === `Cambio ${sufijo}`)).toBe(true);
  });

  it('GET ?soloActivas=true saca los inactivos y no filtra por tipo', async () => {
    const entrada = (
      await crear(tokenAdmin, { nombre: `Aporte ${sufijo}`, tipo: 'entrada' })
    ).body as Concepto;
    const inactivo = (
      await crear(tokenAdmin, {
        nombre: `Insumos ${sufijo}`,
        tipo: 'salida',
        activo: false,
      })
    ).body as Concepto;
    creados.push(entrada.id, inactivo.id);

    const todos = (await listar(tokenVendedor)).map((c) => c.id);
    expect(todos).toContain(inactivo.id);
    const activos = (await listar(tokenVendedor, '?soloActivas=true')).map(
      (c) => c.id,
    );
    expect(activos).toContain(entrada.id);
    expect(activos).not.toContain(inactivo.id);
  });

  it('PATCH por admin cambia nombre, tipo y activo; por no-admin → 403', async () => {
    const id = creados[0];
    const ok = await http()
      .patch(`/api/conceptos-movimiento-caja/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'salida', activo: false });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id, tipo: 'salida', activo: false });

    const no = await http()
      .patch(`/api/conceptos-movimiento-caja/${id}`)
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ activo: true });
    expect(no.status).toBe(403);
  });

  it('PATCH con nombre vacío/null → 400 y con nombre de otro concepto → 400', async () => {
    const id = creados[0];
    for (const nombre of ['', '   ', null, `Aporte ${sufijo}`]) {
      const res = await http()
        .patch(`/api/conceptos-movimiento-caja/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre });
      expect(res.status).toBe(400);
    }
  });

  it('PATCH y DELETE de un concepto de otro tenant → 404', async () => {
    const ajeno = (await crear(tokenFalabella, { nombre: `Ajeno ${sufijo}` }))
      .body as Concepto;
    const patch = await http()
      .patch(`/api/conceptos-movimiento-caja/${ajeno.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ activo: false });
    expect(patch.status).toBe(404);
    const del = await http()
      .delete(`/api/conceptos-movimiento-caja/${ajeno.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(del.status).toBe(404);
    const aun = await listar(tokenFalabella);
    expect(aun.find((c) => c.id === ajeno.id)?.activo).toBe(true);
    await http()
      .delete(`/api/conceptos-movimiento-caja/${ajeno.id}`)
      .set('Authorization', `Bearer ${tokenFalabella}`);
  });

  it('DELETE por no-admin → 403; por admin → 204 con soft delete y autor, y libera el nombre', async () => {
    const id = creados[0];
    const no = await http()
      .delete(`/api/conceptos-movimiento-caja/${id}`)
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(no.status).toBe(403);

    const del = await http()
      .delete(`/api/conceptos-movimiento-caja/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(del.status).toBe(204);

    const ds = app.get(DataSource);
    const filas: { eliminado_el: Date | null; eliminado_por: string | null }[] =
      await ds.query(
        `SELECT eliminado_el, eliminado_por FROM concepto_movimiento_caja
          WHERE concepto_movimiento_caja_id = $1`,
        [id],
      );
    expect(filas).toHaveLength(1);
    expect(filas[0].eliminado_el).not.toBeNull();
    expect(filas[0].eliminado_por).not.toBeNull();

    expect((await listar(tokenAdmin)).some((c) => c.id === id)).toBe(false);
    const otraVez = await http()
      .delete(`/api/conceptos-movimiento-caja/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(otraVez.status).toBe(404);

    const recrea = await crear(tokenAdmin, { nombre: `Cambio ${sufijo}` });
    expect(recrea.status).toBe(201);
    creados.push((recrea.body as Concepto).id);
  });

  describe('papelera', () => {
    let borradoId: string;
    const nombre = () => `Papelera ${sufijo}`;

    it('lo borrado aparece con ?incluirEliminados=true, con quién lo borró, y solo para el admin del tenant', async () => {
      const c = (await crear(tokenAdmin, { nombre: nombre() }))
        .body as Concepto;
      borradoId = c.id;
      creados.push(c.id);
      const del = await http()
        .delete(`/api/conceptos-movimiento-caja/${c.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(del.status).toBe(204);

      const normal = await listar(tokenAdmin);
      expect(normal.some((x) => x.id === c.id)).toBe(false);

      const conBorrados = (await listar(
        tokenAdmin,
        '?incluirEliminados=true',
      )) as (Concepto & {
        eliminadoEl?: string | null;
        eliminadoPorNombre?: string | null;
      })[];
      const fila = conBorrados.find((x) => x.id === c.id);
      expect(fila?.eliminadoEl).toBeTruthy();
      expect(fila?.eliminadoPorNombre).toBeTruthy();

      const deFalabella = await listar(
        tokenFalabella,
        '?incluirEliminados=true',
      );
      expect(deFalabella.some((x) => x.id === c.id)).toBe(false);
    });

    it('POST :id/restaurar por no-admin → 403; de otro tenant → 404', async () => {
      const no = await http()
        .post(`/api/conceptos-movimiento-caja/${borradoId}/restaurar`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({});
      expect(no.status).toBe(403);
      const ajeno = await http()
        .post(`/api/conceptos-movimiento-caja/${borradoId}/restaurar`)
        .set('Authorization', `Bearer ${tokenFalabella}`)
        .send({});
      expect(ajeno.status).toBe(404);
    });

    it('restaurar con el nombre tomado por uno vivo → 400 con el nombre sugerido; con otro nombre → 200', async () => {
      const vivo = await crear(tokenAdmin, { nombre: nombre() });
      expect(vivo.status).toBe(201);
      creados.push((vivo.body as Concepto).id);

      const choca = await http()
        .post(`/api/conceptos-movimiento-caja/${borradoId}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});
      expect(choca.status).toBe(400);
      expect(
        (choca.body as { nombreSugerido?: string }).nombreSugerido,
      ).toBeTruthy();

      const ok = await http()
        .post(`/api/conceptos-movimiento-caja/${borradoId}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: `${nombre()} 2` });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        id: borradoId,
        nombre: `${nombre()} 2`,
      });
      expect((await listar(tokenAdmin)).some((x) => x.id === borradoId)).toBe(
        true,
      );
    });

    it('restaurar uno que no está en la papelera → 404', async () => {
      const res = await http()
        .post(`/api/conceptos-movimiento-caja/${borradoId}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
