import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Chile
const CHILE = '550e8400-e29b-41d4-a716-446655440000';
const ARGENTINA = '550e8400-e29b-41d4-a716-446655440372';
const COLOMBIA = '550e8400-e29b-41d4-a716-446655440373';
const MEXICO = '550e8400-e29b-41d4-a716-446655440374';

interface TokenResponse {
  access_token: string;
}

interface FilaNC {
  tipo_documento_id: string;
  codigo: string | null;
  activo: boolean;
}

/**
 * Contra-prueba del bug que cerró el 2026-09-03: el flujo de reembolso usaba una
 * constante con la fila CHILENA código 61 sin mirar el país, así que una
 * devolución en un tenant argentino congelaba un documento de otro país —y
 * ADR-010 dice que lo congelado en la transacción no se corrige después—.
 *
 * Acá se fija la forma del catálogo. Que el flujo la RESUELVA bien contra la
 * base real lo cubre el bloque de NC de `ventas.e2e-spec.ts`, que corre sobre un
 * tenant chileno y dejaría de encontrar su tipo si la resolución se rompiera.
 */
describe('Nota de crédito por país (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  const ncDelPais = async (paisId: string): Promise<FilaNC[]> => {
    const filas: FilaNC[] = await ds.query(
      `SELECT tipo_documento_id, codigo, activo
         FROM tipos_documento_tributario
        WHERE pais_id = $1 AND es_nota_credito = true
          AND eliminado_el IS NULL`,
      [paisId],
    );
    return filas;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['Chile', CHILE],
    ['Argentina', ARGENTINA],
    ['Colombia', COLOMBIA],
    ['México', MEXICO],
  ])(
    '%s tiene exactamente una nota de crédito, y está oculta del POS',
    async (_pais, paisId) => {
      const filas = await ncDelPais(paisId);
      // Exactamente una: con dos, la resolución elegiría cualquiera de las dos y
      // el tipo congelado dependería del orden del planner.
      expect(filas).toHaveLength(1);
      expect(filas[0].activo).toBe(false);
    },
  );

  it('solo Chile lleva código tributario: los otros tres todavía no emiten', async () => {
    expect((await ncDelPais(CHILE))[0].codigo).toBe('61');
    for (const paisId of [ARGENTINA, COLOMBIA, MEXICO])
      expect((await ncDelPais(paisId))[0].codigo).toBeNull();
  });

  it('el índice único no deja dos notas de crédito en el mismo país', async () => {
    // Sin esto, la resolución del reembolso —que toma la primera fila marcada—
    // dejaría el tipo congelado a merced del orden que elija el planner.
    //
    // ⚠️ Va dentro de una transacción que SIEMPRE revierte, y el motivo es el
    // día en que este test tenga que atrapar la regresión de verdad: sin el
    // índice el INSERT pasa, y una segunda nota de crédito para el mismo país
    // no solo ensucia un catálogo fiscal — **impide crear el índice en el
    // próximo arranque**, así que el backend no levanta hasta limpiarla a mano.
    // El test no puede dejar la base peor que como la encontró justo cuando
    // está avisando de un bug.
    // Usa `ds.transaction` y no el `createQueryRunner()` a mano de
    // `caja.e2e-spec.ts` / `membresia-ultimo-admin.e2e-spec.ts` /
    // `orden-locks-desfases.e2e-spec.ts`: es el mismo `DataSource`, pero el
    // helper libera la conexión en su propio `finally`, así que acá no hay
    // `release()` que olvidar. Desviación deliberada del patrón de esos tres.
    let errorDelInsert: unknown;
    await ds
      .transaction(async (m) => {
        try {
          await m.query(
            `INSERT INTO tipos_documento_tributario
               (tipo_documento_id, pais_id, nombre, activo, customer_requerido,
                es_nota_credito)
             VALUES ($1, $2, 'NC duplicada', false, false, true)`,
            [randomUUID(), CHILE],
          );
        } catch (e) {
          errorDelInsert = e;
        }
        throw new Error('rollback deliberado');
      })
      .catch(() => undefined);

    // Por el NOMBRE del índice, no por "falló": un INSERT puede fallar por una
    // columna faltante y dar la misma sensación de cobertura sin cobertura.
    expect((errorDelInsert as Error | undefined)?.message).toContain(
      'uq_tipo_documento_nota_credito_pais',
    );
  });

  it('la nota de crédito no aparece en el selector de documentos del POS', async () => {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin.paris@paris.cl', password: 'admin' });
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

    const res = await request(app.getHttpServer())
      .get('/api/tipos-documento')
      .set(
        'Authorization',
        `Bearer ${(resTenant.body as TokenResponse).access_token}`,
      );
    expect(res.status).toBe(200);

    const ncChile = (await ncDelPais(CHILE))[0].tipo_documento_id;
    const ids = (res.body as { id: string }[]).map((t) => t.id);
    expect(ids).not.toContain(ncChile);
    expect(ids.length).toBeGreaterThan(0);
  });
});
