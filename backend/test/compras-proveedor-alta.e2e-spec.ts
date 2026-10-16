import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * **Alta de proveedor desde la carga de una compra** (auditoría UX 06.11,
 * decisión del owner 2026-10-16): quien carga compras (`Compras:Crear`) crea
 * el proveedor sin tener el módulo Terceros, pero NO edita ni borra otros
 * terceros ni crea terceros de otro tipo. El guard del backend lo decide, no
 * la pantalla (invariante 6).
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
/** `Compras:Leer`, `Crear`, `Actualizar`, `Anular`; sin el módulo Terceros. */
const ENCARGADO_COMPRAS_EMAIL = 'encargado.compras@paris.cl';
/** Solo `Compras:Leer`. */
const COMPRAS_LECTURA_EMAIL = 'compras.lectura@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ProveedorCreado {
  id: string;
  nombre: string;
  rut: string | null;
  plazoPagoDias: number | null;
}

describe('Compras — alta de proveedor desde la carga (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let tokenLectura: string;

  const nombreUnico = (base: string) =>
    `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    tokenAdmin = await login(ADMIN_EMAIL);
    tokenEncargado = await login(ENCARGADO_COMPRAS_EMAIL);
    tokenLectura = await login(COMPRAS_LECTURA_EMAIL);
  });

  afterAll(async () => {
    await app.close();
  });

  it('quien tiene Compras:Crear crea un proveedor, y aparece en la lista de la carga', async () => {
    const nombre = nombreUnico('Proveedor alta');
    const res = await request(app.getHttpServer())
      .post('/api/compras/proveedores')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ nombre, rut: '76.123.456-7', plazoPagoDias: 15 });
    expect(res.status).toBe(201);
    const creado = res.body as ProveedorCreado;
    expect(creado.nombre).toBe(nombre);
    expect(creado.plazoPagoDias).toBe(15);

    const lista = await request(app.getHttpServer())
      .get('/api/compras/proveedores')
      .set('Authorization', `Bearer ${tokenEncargado}`);
    expect(lista.status).toBe(200);
    expect((lista.body as ProveedorCreado[]).map((p) => p.id)).toContain(
      creado.id,
    );
  });

  it('el tercero nace como proveedor del tenant del token, aunque el body diga otra cosa', async () => {
    const nombre = nombreUnico('Proveedor forzado');
    const res = await request(app.getHttpServer())
      .post('/api/compras/proveedores')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ nombre, tipo: 'persona_natural' });
    // `tipo` no es parte del contrato: el pipe global lo rechaza (whitelist).
    expect(res.status).toBe(400);

    const ok = await request(app.getHttpServer())
      .post('/api/compras/proveedores')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ nombre });
    expect(ok.status).toBe(201);
    const terceros = await request(app.getHttpServer())
      .get('/api/terceros')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(terceros.status).toBe(200);
    const fila = (terceros.body as { id: string; tipo: string }[]).find(
      (t) => t.id === (ok.body as ProveedorCreado).id,
    );
    expect(fila?.tipo).toBe('proveedor');
  });

  it('el nombre es obligatorio', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/compras/proveedores')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ nombre: '   ' });
    expect(res.status).toBe(400);
  });

  it('quien solo lee compras no puede crear proveedores: 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/compras/proveedores')
      .set('Authorization', `Bearer ${tokenLectura}`)
      .send({ nombre: nombreUnico('Sin permiso') });
    expect(res.status).toBe(403);
  });

  it('crear el proveedor NO da el módulo Terceros: ni listar, ni crear de otro tipo, ni editar, ni borrar', async () => {
    const creado = await request(app.getHttpServer())
      .post('/api/compras/proveedores')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ nombre: nombreUnico('Proveedor ajeno') });
    expect(creado.status).toBe(201);
    const id = (creado.body as ProveedorCreado).id;
    const con = (m: 'get' | 'post' | 'patch' | 'delete', url: string) =>
      request(app.getHttpServer())
        [m](url)
        .set('Authorization', `Bearer ${tokenEncargado}`)
        .send(
          m === 'post' ? { tipo: 'empresa', nombre: 'X' } : { nombre: 'Y' },
        );

    expect((await con('get', '/api/terceros')).status).toBe(403);
    expect((await con('post', '/api/terceros')).status).toBe(403);
    expect((await con('patch', `/api/terceros/${id}`)).status).toBe(403);
    expect((await con('delete', `/api/terceros/${id}`)).status).toBe(403);
  });
});
