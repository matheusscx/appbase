import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * La unicidad de nombre por tenant es CASE-INSENSITIVE en los 8 recursos que la
 * tienen. Decisión del owner (2026-08-01): *"Extras" y "extras" son el mismo
 * nombre* — en una lista de catálogo que alguien elige a ojo, dos entradas que
 * solo difieren en mayúsculas son un error de tipeo, no dos cosas distintas.
 *
 * Estaba partida 4 y 4 sin que nadie lo hubiera decidido: `causas_merma`, los
 * dos `motivos_diferencia` y `grupos_modificadores` comparaban con `LOWER()`;
 * `descuentos`, `recargos`, `turnos` y `cajones` comparaban exacto. Los tres
 * primeros de ese segundo grupo ni siquiera tenían índice: la unicidad vivía
 * solo en el código, con una ventana de carrera entre el SELECT y el INSERT.
 *
 * Vive como e2e y no solo como unit porque **lo que se está fijando es el
 * índice**, y un unit con el repositorio mockeado no ve la base. Y la conducta
 * se prueba por el camino de `restaurar()`, que es el único que escribe sin
 * pasar por la validación de código: si el índice fuera case-sensitive, ese
 * camino dejaría dos filas vivas con nombres que el producto considera iguales.
 *
 * El chequeo de forma va POR TABLA y no por nombre de índice a propósito: el
 * nombre no es la regla. (Y de hecho hay drift: `motivo_diferencia_caja` se
 * llama distinto en `startup-pos.sql` que en el seeder — misma definición,
 * anotado en docs/agent/pendientes.md.)
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

// Tipos sembrados (`seeder.service.ts` → `seedTiposRegla`).
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';

/** Las 8 tablas con unicidad de nombre por tenant. */
const TABLAS_CON_NOMBRE_UNICO = [
  'descuentos',
  'recargos',
  'turnos',
  'cajones',
  'causas_merma',
  'motivo_diferencia_caja',
  'motivo_diferencia_inventario',
  'grupos_modificadores',
];

interface TokenResponse {
  access_token: string;
}
interface ConId {
  id: string;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Unicidad de nombre (e2e) — case-insensitive en los 8', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);
    token = await login(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // ─── Forma del índice ─────────────────────────────────────────────────────

  it.each(TABLAS_CON_NOMBRE_UNICO)(
    '%s tiene un índice único parcial sobre lower(nombre)',
    async (tabla) => {
      const rows: { indexdef: string }[] = await ds.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
        [tabla],
      );
      const deNombre = rows
        .map((r) => r.indexdef)
        .filter(
          (def) =>
            def.includes('UNIQUE') &&
            def.includes('tenant_id') &&
            /lower\(/i.test(def),
        );

      // Exactamente lo que este test existe para fijar: que exista, que sea
      // sobre `lower(...)` y no sobre `nombre` pelado, y que sea PARCIAL —sin
      // el `WHERE eliminado_el IS NULL` bloquearía recrear algo tras borrarlo.
      expect(deNombre).toHaveLength(1);
      expect(deNombre[0]).toContain('eliminado_el');
    },
  );

  // ─── Conducta: crear ──────────────────────────────────────────────────────
  // El camino que SÍ pasa por la validación de código. Cubre los 4 que
  // comparaban exacto hasta 2026-08-01.

  const sufijo = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  it('crear un descuento que solo difiere en mayúsculas es rechazado', async () => {
    const base = `Directo CI E2E ${sufijo()}`;
    const cuerpo = (nombre: string) => ({
      nombre,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valor: '0.10',
    });
    const primero = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo(base));
    expect(primero.status).toBe(201);

    const segundo = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo(base.toUpperCase()));
    expect(segundo.status).toBe(400);
  });

  it('crear un recargo que solo difiere en mayúsculas es rechazado', async () => {
    const base = `General CI E2E ${sufijo()}`;
    const cuerpo = (nombre: string) => ({
      nombre,
      tipoReglaId: TIPO_RECARGO_GENERAL,
      modo: 'porcentaje',
      valor: '0.05',
    });
    const primero = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo(base));
    expect(primero.status).toBe(201);

    const segundo = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo(base.toUpperCase()));
    expect(segundo.status).toBe(400);
  });

  it('crear un turno que solo difiere en mayúsculas es rechazado', async () => {
    const base = `Turno CI E2E ${sufijo()}`;
    const cuerpo = (nombre: string) => ({
      nombre,
      horaInicio: '08:00',
      horaFin: '15:00',
    });
    const primero = await request(app.getHttpServer())
      .post('/api/turnos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo(base));
    expect(primero.status).toBe(201);

    const segundo = await request(app.getHttpServer())
      .post('/api/turnos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo(base.toUpperCase()));
    expect(segundo.status).toBe(409);
  });

  it('crear un cajón que solo difiere en mayúsculas es rechazado', async () => {
    const base = `Cajon CI E2E ${sufijo()}`;
    const primero = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: base });
    expect(primero.status).toBe(201);

    const segundo = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: base.toUpperCase() });
    expect(segundo.status).toBe(409);
  });

  // ─── Conducta: restaurar ──────────────────────────────────────────────────
  // El camino que NO pasa por la validación de código: escribe directo y lo
  // único que lo frena es el índice. Es el que prueba que el índice existe y
  // que es el correcto, no solo que el service compara bien.

  it.each([
    {
      recurso: 'descuentos',
      crear: (nombre: string) => ({
        nombre,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'porcentaje',
        valor: '0.10',
      }),
      statusDelete: 200,
    },
    {
      recurso: 'recargos',
      crear: (nombre: string) => ({
        nombre,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'porcentaje',
        valor: '0.05',
      }),
      statusDelete: 200,
    },
    {
      recurso: 'turnos',
      crear: (nombre: string) => ({
        nombre,
        horaInicio: '08:00',
        horaFin: '15:00',
      }),
      statusDelete: 200,
    },
    {
      recurso: 'cajones',
      crear: (nombre: string) => ({ nombre }),
      statusDelete: 200,
    },
  ])(
    'restaurar en $recurso cuando el nombre lo tomó otro que solo difiere en mayúsculas es 400 con sugerencia',
    async ({ recurso, crear, statusDelete }) => {
      const base = `Restaurar CI E2E ${sufijo()}`;
      const post = async (nombre: string) => {
        const res = await request(app.getHttpServer())
          .post(`/api/${recurso}`)
          .set('Authorization', `Bearer ${token}`)
          .send(crear(nombre));
        expect(res.status).toBe(201);
        return (res.body as ConId).id;
      };

      const originalId = await post(base);
      const del = await request(app.getHttpServer())
        .delete(`/api/${recurso}/${originalId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(statusDelete);

      // Con el original en la papelera el nombre queda libre, así que otro lo
      // toma — en MAYÚSCULA, que es el caso que un índice case-sensitive
      // dejaría pasar.
      await post(base.toUpperCase());

      const res = await request(app.getHttpServer())
        .post(`/api/${recurso}/${originalId}/restaurar`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      // Y trae la salida: un nombre libre para reintentar. La sugerencia
      // también ignora mayúsculas — si no, propondría algo que la base rechaza
      // y el usuario recibiría el mismo 400 tras confirmar el modal.
      expect((res.body as { nombreSugerido?: string }).nombreSugerido).toBe(
        `${base} 2`,
      );
    },
  );
});
