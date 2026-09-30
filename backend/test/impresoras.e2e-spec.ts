import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { randomUUID } from 'node:crypto';

/**
 * `GET /impresoras/operacion` — la impresora para quien IMPRIME, sin
 * `Impresoras:Leer` (Tarea 1 de
 * `docs/superpowers/plans/2026-09-30-impresion-quien-opera.md`). No toca
 * `GET /impresoras` (configuración), que sigue exigiendo `Impresoras:Leer`.
 *
 * Los tres roles que tienen que pasar el guard nuevo, y por qué camino:
 * - `vendedor@paris.cl` — `Ventas:Crear` (cobra en el POS).
 * - `ana.torres@paris.cl` (rol `Salón`) — `Salones:Operar` (comanda, precuenta
 *   y cierre de cuenta por PIN).
 * - `encargado.salon@paris.cl` — `Salones:Operar` también (superset del rol
 *   `Salón`, sin ser admin del tenant).
 *
 * `contador@paris.cl` (solo `Inventario` + `Items:Leer`, del seed de
 * `seedRolesInventario`) no tiene ninguno de los tres permisos: es el 403.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const OTRO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040'; // Demo Bodega

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR = { email: 'vendedor@paris.cl', pass: 'admin' };
const GARZON = { email: 'ana.torres@paris.cl', pass: 'admin' };
const ENCARGADO_SALON = { email: 'encargado.salon@paris.cl', pass: 'admin' };
/** Sin `Ventas:Crear`, sin `Salones:Operar`, sin `Ventas:Anular`: el 403. */
const SIN_PERMISO = { email: 'contador@paris.cl', pass: 'admin' };

// Impresoras del seed para Paris (`seedImpresoras`): dos de rol 'comanda'
// (Cocina, Barra) y una de rol 'boleta' (Caja), las tres `activo: true`.
const SEED_COCINA_ID = '550e8400-e29b-41d4-a716-446655440247';
const SEED_BARRA_ID = '550e8400-e29b-41d4-a716-446655440248';
const SEED_CAJA_ID = '550e8400-e29b-41d4-a716-446655440249';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface ImpresoraOperativa {
  id: string;
  tipoConexion: string;
  host: string | null;
  puerto: number | null;
  nombreCola: string | null;
  activo: boolean;
}

async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

describe('GET /impresoras/operacion (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenGarzon: string;
  let tokenEncargadoSalon: string;
  let tokenSinPermiso: string;

  let borradaId: string;
  let inactivaId: string;
  let otroTenantId: string;

  function operacion(rol: 'comanda' | 'boleta', token: string) {
    return request(app.getHttpServer())
      .get('/api/impresoras/operacion')
      .query({ rol })
      .set('Authorization', `Bearer ${token}`);
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
    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenVendedor = await entrar(app, VENDEDOR.email, VENDEDOR.pass);
    tokenGarzon = await entrar(app, GARZON.email, GARZON.pass);
    tokenEncargadoSalon = await entrar(
      app,
      ENCARGADO_SALON.email,
      ENCARGADO_SALON.pass,
    );
    tokenSinPermiso = await entrar(app, SIN_PERMISO.email, SIN_PERMISO.pass);

    const marca = Date.now();

    // Impresora 'boleta' creada y borrada (soft delete) por el admin: tiene que
    // desaparecer del listado operativo igual que del de configuración.
    const creada = await request(app.getHttpServer())
      .post('/api/impresoras')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Boleta borrada E2E ${marca}`,
        rol: 'boleta',
        tipoConexion: 'sistema',
        nombreCola: 'cola-boleta-borrada-e2e',
      });
    expect(creada.status).toBe(201);
    borradaId = (creada.body as IdResponse).id;
    const eliminada = await request(app.getHttpServer())
      .delete(`/api/impresoras/${borradaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(eliminada.status).toBe(200);

    // Impresora 'boleta' INACTIVA: el endpoint filtra `activo: true` en el
    // propio `where` (no es un filtro que el frontend tenga que repetir).
    const creadaInactiva = await request(app.getHttpServer())
      .post('/api/impresoras')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Boleta inactiva E2E ${marca}`,
        rol: 'boleta',
        tipoConexion: 'sistema',
        nombreCola: 'cola-boleta-inactiva-e2e',
        activo: false,
      });
    expect(creadaInactiva.status).toBe(201);
    inactivaId = (creadaInactiva.body as IdResponse).id;

    // Impresora de OTRO tenant (Demo Bodega), por SQL directo: no hay camino
    // de API para crear un recurso en un tenant al que este token no
    // pertenece (mismo criterio que `boleta-reimpresion.e2e-spec.ts`).
    const filasOtroTenant: { impresora_id: string }[] = await ds.query(
      `INSERT INTO impresoras (
         tenant_id, nombre, rol, tipo_conexion, nombre_cola, activo
       ) VALUES ($1, $2, 'boleta', 'sistema', 'cola-otro-tenant-e2e', true)
       RETURNING impresora_id`,
      [OTRO_TENANT_ID, `Boleta otro tenant E2E ${marca}`],
    );
    otroTenantId = filasOtroTenant[0].impresora_id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('vendedor (Ventas:Crear): 200 con los 6 campos exactos', async () => {
    const res = await operacion('boleta', tokenVendedor);
    expect(res.status).toBe(200);
    const cuerpo = res.body as ImpresoraOperativa[];
    expect(cuerpo.length).toBeGreaterThan(0);
    for (const impresora of cuerpo) {
      expect(Object.keys(impresora).sort()).toEqual(
        ['activo', 'host', 'id', 'nombreCola', 'puerto', 'tipoConexion'].sort(),
      );
    }
    expect(cuerpo.map((i) => i.id)).toContain(SEED_CAJA_ID);
  });

  it('garzón (Salones:Operar): 200 con las dos impresoras de comanda del seed', async () => {
    const res = await operacion('comanda', tokenGarzon);
    expect(res.status).toBe(200);
    const ids = (res.body as ImpresoraOperativa[]).map((i) => i.id);
    // Contiene las del seed y no la de boleta; no se afirma el conteo exacto: otras
    // suites del e2e crean impresoras de comanda en Paris y no todas las borran.
    expect(ids).toEqual(
      expect.arrayContaining([SEED_COCINA_ID, SEED_BARRA_ID]),
    );
    expect(ids).not.toContain(SEED_CAJA_ID);
  });

  it('encargado de salón (Salones:Operar): 200', async () => {
    const res = await operacion('boleta', tokenEncargadoSalon);
    expect(res.status).toBe(200);
    expect((res.body as ImpresoraOperativa[]).map((i) => i.id)).toContain(
      SEED_CAJA_ID,
    );
  });

  it('un rol sin Ventas:Crear, Salones:Operar ni Ventas:Anular recibe 403', async () => {
    const res = await operacion('comanda', tokenSinPermiso);
    expect(res.status).toBe(403);
  });

  it('una impresora borrada (soft delete) no viene', async () => {
    const res = await operacion('boleta', tokenVendedor);
    expect(res.status).toBe(200);
    expect((res.body as ImpresoraOperativa[]).map((i) => i.id)).not.toContain(
      borradaId,
    );
  });

  it('una impresora inactiva no viene', async () => {
    const res = await operacion('boleta', tokenVendedor);
    expect(res.status).toBe(200);
    expect((res.body as ImpresoraOperativa[]).map((i) => i.id)).not.toContain(
      inactivaId,
    );
  });

  it('una impresora de otro tenant no viene', async () => {
    const res = await operacion('boleta', tokenVendedor);
    expect(res.status).toBe(200);
    expect((res.body as ImpresoraOperativa[]).map((i) => i.id)).not.toContain(
      otroTenantId,
    );
  });

  it('sin `rol` (o con un valor que no es comanda/boleta) da 400', async () => {
    const sinRol = await request(app.getHttpServer())
      .get('/api/impresoras/operacion')
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(sinRol.status).toBe(400);

    const rolInvalido = await request(app.getHttpServer())
      .get('/api/impresoras/operacion')
      .query({ rol: 'configuracion' })
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(rolInvalido.status).toBe(400);
  });
});
