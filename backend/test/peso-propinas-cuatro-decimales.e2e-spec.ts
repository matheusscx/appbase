import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';

/**
 * El peso de un garzón en el reparto de propinas con más de 4 decimales es
 * 400, no se redondea (owner, 2026-10-13, en el chat de la orquestadora:
 * "rechazalo con aviso"). Las dos columnas son `NUMERIC(18,4)`, y hasta esta
 * fecha `1.50005` entraba con 2xx y quedaba `1.5001`: el peso de un grupo lo
 * redondeaba el service (`toFixed(4)`) y el peso a mano de una liquidación,
 * Postgres. Medido por HTTP (`docs/agent/resueltos.md`).
 *
 * Cada camino, con `1.5` y `1.0001` (entran y se guardan tal cual) y con
 * `1.50005` (400 y no escribe nada). Lo pone `@EsCantidad(mensaje)` con
 * `EscalaMonedaPipe`, la misma mecánica de las cantidades (`87a3d437`).
 *
 * ⚠️ Queda una liquidación en borrador del 2003, un rango sin ventas: un
 * borrador no se anula. El reparto de Paris se restaura en `afterAll`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const MENSAJE = 'El peso admite como máximo 4 decimales.';

interface TokenResponse {
  access_token: string;
}
type Respuesta = { status: number; body: unknown };

interface Distribucion {
  porcentajeSugerido: string;
  habilitadoPos: boolean;
  habilitadoSalones: boolean;
  grupos: {
    tipoGarzon: string;
    nombre: string;
    porcentaje: string;
    criterio: string;
    baseVentas: string;
    manualModo: string | null;
    activo: boolean;
    orden: number;
    pesos: { garzonId: string; peso: string }[];
  }[];
}

describe('El peso de un garzón con más de 4 decimales es 400 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let distribucion: Distribucion;
  let garzonId: string;

  function pedir(
    metodo: 'post' | 'patch' | 'put' | 'get',
    ruta: string,
    body: object = {},
  ): Promise<Respuesta> {
    return request(app.getHttpServer())
      [metodo](`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  function mensaje(res: Respuesta): string {
    const m = (res.body as { message?: string | string[] }).message ?? '';
    return [m].flat().join(' ');
  }

  const bodyDistribucion = (d: Distribucion) => ({
    porcentajeSugerido: d.porcentajeSugerido,
    habilitadoPos: d.habilitadoPos,
    habilitadoSalones: d.habilitadoSalones,
    grupos: d.grupos.map((g) => ({
      tipoGarzon: g.tipoGarzon,
      nombre: g.nombre,
      porcentaje: g.porcentaje,
      criterio: g.criterio,
      baseVentas: g.baseVentas,
      manualModo: g.manualModo,
      activo: g.activo,
      orden: g.orden,
      pesos: g.pesos,
    })),
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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
    token = (resTenant.body as TokenResponse).access_token;

    const dist = await pedir('get', 'propinas/distribucion');
    expect(dist.status).toBe(200);
    distribucion = dist.body as Distribucion;

    // Garzón PROPIO: las suites comparten seed.
    const garzon = await pedir('post', 'garzones', {
      nombre: `Garzón peso 4 decimales E2E ${randomUUID().slice(0, 8)}`,
    });
    expect(garzon.status).toBe(201);
    garzonId = (garzon.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    try {
      expect(
        (
          await pedir(
            'put',
            'propinas/distribucion',
            bodyDistribucion(distribucion),
          )
        ).status,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('el peso de un garzón en un grupo MANUAL por pesos', async () => {
    const base = bodyDistribucion(distribucion);
    const guardar = (peso: string) =>
      pedir('put', 'propinas/distribucion', {
        ...base,
        grupos: base.grupos.map((g, i) =>
          i === 0
            ? {
                ...g,
                criterio: 'MANUAL',
                manualModo: 'PESOS',
                pesos: [{ garzonId, peso }],
              }
            : g,
        ),
      });
    const version = async () => {
      const [fila]: { version: number }[] = await ds.query(
        `SELECT version FROM propina_configuracion
          WHERE tenant_id = $1 AND eliminado_el IS NULL`,
        [PARIS_TENANT_ID],
      );
      return fila.version;
    };
    const leer = async () => {
      const filas: { peso: string }[] = await ds.query(
        `SELECT peso::text AS peso FROM propina_grupo_peso_manual
          WHERE tenant_id = $1 AND garzon_id = $2 AND eliminado_el IS NULL`,
        [PARIS_TENANT_ID, garzonId],
      );
      return filas.map((f) => f.peso);
    };

    for (const [peso, guardado] of [
      ['1.5', '1.5000'],
      ['1.0001', '1.0001'],
    ]) {
      const res = await guardar(peso);
      expect({ peso, status: res.status }).toEqual({ peso, status: 200 });
      expect(await leer()).toEqual([guardado]);
    }

    const antes = await version();
    const res = await guardar('1.50005');
    expect(res.status).toBe(400);
    expect(mensaje(res)).toBe(MENSAJE);
    expect(await version()).toBe(antes);
    expect(await leer()).toEqual(['1.0001']);
  });

  it('el peso a mano de un participante de una liquidación', async () => {
    const borrador = await pedir('post', 'propinas/liquidaciones', {
      fechaDesde: '2003-01-01',
      fechaHasta: '2003-01-02',
    });
    expect(borrador.status).toBe(201);
    const liquidacion = borrador.body as {
      id: string;
      grupos: { id: string }[];
    };
    const conManual = await pedir(
      'patch',
      `propinas/liquidaciones/${liquidacion.id}`,
      {
        participantes: [
          {
            garzonId,
            grupoId: liquidacion.grupos[0].id,
            motivoAjuste: 'Peso 4 decimales E2E',
          },
        ],
        recalcular: false,
      },
    );
    expect(conManual.status).toBe(200);
    const participanteId = (
      conManual.body as { participantes: { id: string; garzonId: string }[] }
    ).participantes.find((p) => p.garzonId === garzonId)!.id;

    const cargar = (pesoManual: string) =>
      pedir('patch', `propinas/liquidaciones/${liquidacion.id}`, {
        participantes: [{ id: participanteId, pesoManual }],
        recalcular: false,
      });
    const leer = async () => {
      const [fila]: { peso: string | null }[] = await ds.query(
        `SELECT peso_manual::text AS peso FROM liquidacion_propinas_participante
          WHERE liquidacion_propinas_participante_id = $1
            AND eliminado_el IS NULL`,
        [participanteId],
      );
      return fila.peso;
    };

    for (const [peso, guardado] of [
      ['1.5', '1.5000'],
      ['1.0001', '1.0001'],
    ]) {
      const res = await cargar(peso);
      expect({ peso, status: res.status }).toEqual({ peso, status: 200 });
      expect(await leer()).toBe(guardado);
    }

    const res = await cargar('1.50005');
    expect(res.status).toBe(400);
    expect(mensaje(res)).toBe(MENSAJE);
    expect(await leer()).toBe('1.0001');
  });
});
